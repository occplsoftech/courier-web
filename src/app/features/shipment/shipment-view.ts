import { ShipmentBusCrossingCard } from '@features/bus-depot/shipment-bus-crossing-card';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AuthService } from '@core/auth/auth.service';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { AppRole } from '@core/models/role.model';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { MasterDataService } from '@features/masters/master-data.service';
import { CompanyProfileService } from '@features/company/company-profile.service';
import { ShipmentResponse, ShipmentCharge, TimelineStep, ShipmentDrs, ShipmentStatusHistoryEntry, CANCELLABLE_STATUSES, Manifest, ShipmentEwayBillInfo, PaymentModeChange, PaymentModeTarget } from '@core/models/shipment.model';
import { TrackingCard } from './components/tracking-card';
import { ChargeSummary } from './components/charge-summary';
import { ShipmentCommunicationCard } from '@features/communication/components/shipment-communication-card';
import { ShipmentService } from './shipment.service';
import { EwayBillService } from './eway-bill.service';
import { companyAddressLine, ConsignmentPrintData } from './consignment-print.util';
import { printPerformaBillCopies } from './performa-bill-print.util';
import { ShipmentLabelsDialog } from './shipment-labels-dialog';
import { ShipmentForwardDialog } from './shipment-forward-dialog';
import { ShipmentResolveForwardDialog } from './shipment-resolve-forward-dialog';
import { ShipmentLabelData } from './shipment-label-print.util';
import { emptyPage } from '@core/models/page.model';
import { TicketService } from '@core/services/ticket.service';
import { Ticket } from '@core/models/ticket.model';
import { FollowUpService } from '@core/services/follow-up.service';
import { FollowUp } from '@core/models/follow-up.model';
import { ManifestService } from '@features/manifest/manifest.service';
import { VehicleService } from '@features/manifest/vehicle.service';
import { ShipmentMovementService } from '@features/shipment-movement/shipment-movement.service';

const WRITERS = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER, AppRole.BOOKING_OPERATOR];
interface MovementDoc {
  manifest: Manifest;
  createdAt: string | null;
  dispatchedAt: string | null;
  receivedAt: string | null;
  vehicle: string | null;
  driver: { name: string; mobile: string } | null;
}

const TIMELINE_ICONS: Record<string, string> = {
  BOOKED: 'add_box', MANIFEST_CREATED: 'qr_code_scanner',
  DISPATCHED: 'outbound', IN_SCAN: 'move_to_inbox', OUT_FOR_DELIVERY: 'directions_run',
  DELIVERED: 'task_alt'
};

/** Shipment Details — the booking in full, with the sender/receiver resolved, and links
 *  to the three sub-resource pages (Charges, History, Documents) the backend exposes as
 *  their own endpoints. */
@Component({
  selector: 'app-shipment-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, DatePipe, RouterLink, MatIconModule, UiCard, UiLoader, UiButton, TrackingCard,
    ChargeSummary, ShipmentCommunicationCard, ShipmentBusCrossingCard],
  template: `
    @if (loading()) {
      <app-loader [minHeight]="320" caption="Loading…" />
    } @else if (!shipment()) {
      <app-card><p class="empty">Shipment not found or outside your scope.</p></app-card>
    } @else {
      <div class="sv">
        <app-tracking-card [shipmentNumber]="shipment()!.shipmentNumber" [trackingNumber]="shipment()!.trackingNumber"
                           [status]="shipment()!.status" [bookingDate]="shipment()!.bookingDate"
                           [expectedDeliveryDate]="shipment()!.expectedDeliveryDate ?? null"
                           [deliveredAt]="shipment()!.deliveredAt ?? null" />

        @if (paymentMode(); as pm) {
          @if (pm.changed) {
            <div class="pm-flag" role="status">
              <mat-icon>swap_horiz</mat-icon>
              <div>
                <strong>Payment mode changed by admin</strong>
                <span>{{ pm.changedFromModeName }} → {{ pm.currentModeName }}
                  @if (pm.changedAt) { · {{ pm.changedAt | date: 'dd MMM yyyy, h:mm a' }} }</span>
              </div>
            </div>
          }
        }

        <div class="sv__actions">
          <a class="sv__link" [routerLink]="['/shipments', id, 'history']"><mat-icon>history</mat-icon> History</a>
          <a class="sv__link" [routerLink]="['/shipments', id, 'documents']"><mat-icon>description</mat-icon> Documents</a>
          <a class="sv__link" [routerLink]="['/support/tickets/new']"
             [queryParams]="{ shipmentId: id, branchId: shipment()!.bookingBranchId }">
            <mat-icon>support_agent</mat-icon> Raise Ticket</a>
          <a class="sv__link" [routerLink]="['/follow-ups/new']"
             [queryParams]="{ shipmentId: id, branchId: shipment()!.bookingBranchId }">
            <mat-icon>event_repeat</mat-icon> Create Follow-up</a>
          <span class="sv__spacer"></span>
          <app-button variant="stroked" icon="label" (pressed)="printLabels()">Print Labels</app-button>
          @if (charge(); as c) {
            <app-button variant="stroked" icon="print" (pressed)="print3(c)">Booking Receipt</app-button>
          }
          @if (can().update && shipment()!.status === 'BOOKED') {
            <app-button variant="stroked" icon="edit" (pressed)="edit()">Edit</app-button>
          }
          @if (canForward()) {
            <app-button variant="stroked" icon="local_shipping" (pressed)="forward()">Forward to courier</app-button>
          }
          @if (can().cancel && cancellable()) {
            <app-button variant="danger" icon="cancel" (pressed)="cancel()">Cancel</app-button>
          }
        </div>

        @if (shipment()!.forward; as f) {
          <app-card title="Courier partner">
            @if (f.state === 'BOOKED') {
              <p class="sv__name">Forwarded to {{ courierName(f.provider) }} · {{ f.service }}</p>
              <p class="sv__sub">Courier AWB <strong>{{ f.awb || '—' }}</strong>@if (f.cost !== null) { · our cost ₹{{ f.cost | number: '1.2-2' }} }
                @if (f.forwardedAt) { · {{ f.forwardedAt | date: 'dd MMM yyyy, h:mm a' }} }</p>
              <p class="sv__sub">The customer keeps the OCCPL tracking number {{ shipment()!.trackingNumber }}; the courier delivers.</p>
              @if (f.labelUrl) { <p class="sv__sub"><a class="sv__link" [href]="f.labelUrl" target="_blank" rel="noopener"><mat-icon>label</mat-icon> Open the courier's label</a></p> }
            } @else if (f.state === 'UNKNOWN') {
              <p class="sv__name">Forward to {{ courierName(f.provider) }} not confirmed</p>
              <p class="sv__sub">We could not tell whether {{ courierName(f.provider) }} accepted it{{ f.note ? ' (' + f.note + ')' : '' }}. Check with the courier before trying again; it is not retried automatically.</p>
              @if (canResolve()) {
                <app-button variant="stroked" icon="rule" (pressed)="resolveForward()">Resolve</app-button>
              }
            } @else {
              <p class="sv__sub">Being forwarded to {{ courierName(f.provider) }}…</p>
            }
          </app-card>
        }

        @if (shipment()!.rto; as r) {
          <app-card title="Return to sender (RTO)">
            @if (shipment()!.status === 'RETURNED') {
              <p class="sv__name">Handed back to the sender@if (r.handedTo) { · received by {{ r.handedTo }} }</p>
              @if (r.deliveredAt) { <p class="sv__sub">{{ r.deliveredAt | date: 'dd MMM yyyy, h:mm a' }}</p> }
            } @else if (r.backAtOrigin) {
              <p class="sv__name">Back at the booking branch — hand it back to the sender</p>
              <p class="sv__sub"><a class="sv__link" href="/movement/returns"><mat-icon>assignment_return</mat-icon> Open Returns (RTO)</a></p>
            } @else {
              <p class="sv__name">On its way back to the booking branch</p>
              <p class="sv__sub">It travels on a normal Load Sheet to its booking branch, then is handed back from Returns (RTO).</p>
            }
            @if (r.startedAt) { <p class="sv__sub">Return started {{ r.startedAt | date: 'dd MMM yyyy, h:mm a' }}</p> }
          </app-card>
        }

        <div class="sv__grid-parties">
          <app-card title="Sender">
            <p class="sv__name">{{ shipment()!.senderName }}</p>
            <p class="sv__sub">{{ shipment()!.senderContact }}</p>
            <p class="sv__sub">{{ shipment()!.senderAddress }}</p>
          </app-card>

          <app-card title="Receiver">
            <p class="sv__name">{{ shipment()!.receiverName }}</p>
            <p class="sv__sub">{{ shipment()!.receiverContact }}</p>
            <p class="sv__sub">{{ shipment()!.receiverAddress }}</p>
          </app-card>
        </div>

        <div class="sv__grid2">
          <app-card title="Timeline">
            @if (loadingDetails()) {
              <app-loader [minHeight]="140" caption="Loading…" />
            } @else {
              <div class="tl">
                @for (step of steps(); track step.status) {
                  <div class="tl__row" [class.tl__row--done]="step.completed">
                    <div class="tl__icon"><mat-icon>{{ timelineIcon(step.status) }}</mat-icon></div>
                    <div class="tl__body">
                      <strong>{{ step.label }}</strong>
                      @if (step.completed) {
                        <span class="text-caption">{{ step.changedAt | date: 'medium' }}</span>
                      } @else {
                        <span class="text-caption tl__pending">Pending</span>
                      }
                    </div>
                  </div>
                }
              </div>
            }
          </app-card>

          <app-card title="Charges">
            @if (loadingDetails()) {
              <app-loader [minHeight]="140" caption="Loading…" />
            } @else if (charge(); as c) {
              <app-charge-summary [charges]="c" />
              @if (paymentMode(); as pm) {
                @if (pm.changeable) {
                  <div class="pm-edit">
                    <span class="pm-edit__l">Payment mode: <strong>{{ pm.currentModeName }}</strong></span>
                    @for (t of pm.targets; track t.id) {
                      <app-button variant="stroked" icon="swap_horiz" [loading]="paymentModeSaving()"
                                  (pressed)="changePaymentMode(pm, t)">Change to {{ t.name }}</app-button>
                    }
                    <span class="rate-edit__h">Pending shipments only. Switching moves the booking wallet.</span>
                  </div>
                }
              }
              @if (canEditRate()) {
                <div class="rate-edit">
                  <label class="rate-edit__l">Rate/KG
                    <input class="rate-edit__i" type="number" min="0.01" step="0.01"
                           [value]="rateInput() ?? currentRatePerKg()" (input)="onRateInput($event)" />
                  </label>
                  <app-button variant="stroked" icon="calculate" [loading]="rateCalculating()"
                              [disabled]="rateInput() === null" (pressed)="calculateRate()">Calculate</app-button>
                  <app-button icon="check" [loading]="rateSaving()" [disabled]="!ratePreview()"
                              (pressed)="saveRate()">Update Rate/KG</app-button>
                  <span class="rate-edit__h">Calculate to preview the new charges, then update.</span>
                </div>
                @if (ratePreview(); as p) {
                  <div class="rate-preview">
                    <div class="rate-preview__t">Preview at {{ rateInput() | number: '1.2-2' }}/KG — not saved yet</div>
                    <app-charge-summary [charges]="p" />
                  </div>
                }
              }
            } @else {
              <p class="empty">No charge record.</p>
            }
          </app-card>
        </div>

        <app-card title="Loading Sheet / THC" subtitle="Every load sheet this shipment has travelled on">
          @if (loadingMovement()) {
            <app-loader [minHeight]="100" caption="Loading…" />
          } @else if (!movementDocs().length) {
            <p class="empty">Not on a loading sheet yet.</p>
          } @else {
            <div class="mt-wrap">
              <table class="mt">
                <thead>
                  <tr>
                    <th>Loading Sheet / THC No.</th><th>Status</th><th>Created</th><th>Dispatched</th>
                    <th>Received</th><th>Vehicle</th><th>Driver</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (d of movementDocs(); track d.manifest.id) {
                    <tr>
                      <td class="mt__strong">{{ d.manifest.manifestNumber }}</td>
                      <td><span class="tag">{{ d.manifest.status }}</span></td>
                      <td>{{ d.createdAt | date: 'dd MMM yyyy, h:mm a' }}</td>
                      <td>{{ d.dispatchedAt ? (d.dispatchedAt | date: 'dd MMM yyyy, h:mm a') : '—' }}</td>
                      <td>{{ d.receivedAt ? (d.receivedAt | date: 'dd MMM yyyy, h:mm a') : 'Pending' }}</td>
                      <td>{{ d.vehicle || '—' }}</td>
                      <td>{{ d.driver ? d.driver.name + (d.driver.mobile !== '—' ? ' · ' + d.driver.mobile : '') : '—' }}</td>
                      <td>
                        <a class="sv__link" [routerLink]="['/movement/trip-hire-challan']" [queryParams]="{ manifestNumber: d.manifest.manifestNumber }">
                          <mat-icon>outbound</mat-icon> THC</a>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </app-card>

        <app-card title="DRS (Delivery Run Sheet)">
          @if (loadingMovement()) {
            <app-loader [minHeight]="100" caption="Loading…" />
          } @else if (drs(); as r) {
            <div class="mt-wrap">
              <table class="mt">
                <thead>
                  <tr>
                    <th>DRS No.</th><th>Status</th><th>Created</th><th>Delivered</th>
                    <th>Delivery Person</th><th>Vehicle</th><th>Received By</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="mt__strong">{{ r.drsNumber || '—' }}</td>
                    <td><span class="tag">{{ r.status }}</span></td>
                    <td>{{ r.assignedAt | date: 'dd MMM yyyy, h:mm a' }}</td>
                    <td>{{ r.deliveredAt ? (r.deliveredAt | date: 'dd MMM yyyy, h:mm a') : 'Pending' }}</td>
                    <td>{{ drsUser() ? drsUser()!.name + (drsUser()!.mobile !== '—' ? ' · ' + drsUser()!.mobile : '') : '—' }}</td>
                    <td>{{ drsVehicle() || '—' }}</td>
                    <td>{{ r.receiverName || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          } @else {
            <p class="empty">Not out for delivery yet.</p>
          }
        </app-card>

        <div class="sv__grid2">
          <app-card title="Tickets" [subtitle]="tickets().length + ' raised for this shipment'">
            @if (loadingRelated()) {
              <app-loader [minHeight]="80" caption="Loading…" />
            } @else if (!tickets().length) {
              <p class="empty">No tickets raised for this shipment.</p>
            } @else {
              <div class="rel">
                @for (t of tickets(); track t.id) {
                  <a class="rel__row" [routerLink]="['/support/tickets', t.id]">
                    <span class="rel__title">{{ t.ticketNumber }} — {{ t.subject }}</span>
                    <span class="tag">{{ t.status }}</span>
                  </a>
                }
              </div>
            }
          </app-card>

          <app-card title="Follow-ups" [subtitle]="followUps().length + ' raised for this shipment'">
            @if (loadingRelated()) {
              <app-loader [minHeight]="80" caption="Loading…" />
            } @else if (!followUps().length) {
              <p class="empty">No follow-ups raised for this shipment.</p>
            } @else {
              <div class="rel">
                @for (f of followUps(); track f.id) {
                  <a class="rel__row" [routerLink]="['/follow-ups', f.id]">
                    <span class="rel__title">{{ f.title }}</span>
                    <span class="tag">{{ f.status }}</span>
                  </a>
                }
              </div>
            }
          </app-card>
        </div>

        @if (!loadingDetails() && isCompanyLevel() && charge(); as c) {
          <app-card title="Booking Branch Commission" subtitle="Computed from the booking branch's own charge percentages.">
            <div class="commission">
              <div class="commission__row"><span>Commission on Basic Freight</span><strong>{{ c.commissionOnBasicFreight | number:'1.2-2' }}</strong></div>
              <div class="commission__row"><span>Branch Commission on Other Amount</span><strong>{{ c.branchCommissionOnOtherAmount | number:'1.2-2' }}</strong></div>
              <div class="commission__row"><span>Company Commission on Basic Freight</span><strong>{{ c.companyCommissionOnBasicFreight | number:'1.2-2' }}</strong></div>
              <div class="commission__row commission__row--total"><span>Total Commission</span><strong>{{ c.totalCommission | number:'1.2-2' }}</strong></div>
            </div>
          </app-card>
        }

        <div class="sv__grid">
          <app-card title="Service">
            <dl class="kv">
              <dt>Booking Branch</dt><dd>{{ branchLabel(shipment()!.bookingBranchId) }}</dd>
              <dt>Delivery Branch</dt><dd>{{ branchLabel(shipment()!.deliveryBranchId) }}</dd>
              <dt>Pincode</dt><dd>{{ shipment()!.pickupPincode }} → {{ shipment()!.deliveryPincode }}</dd>
              @if (shipment()!.status !== 'DELIVERED' && shipment()!.currentLocationId) {
                <dt>Current Stock</dt><dd>Stock at {{ branchLabel(shipment()!.currentLocationId!) }}</dd>
              }
              <dt>Service Type</dt><dd>{{ serviceTypeLabel(shipment()!.serviceTypeId) }}</dd>
              <dt>Package Type</dt><dd>{{ packageTypeLabel(shipment()!.packageTypeId) }}</dd>
              <dt>Payment Mode</dt><dd>{{ paymentModeLabel(shipment()!.paymentModeId) }}</dd>
              <dt>Shipment Type</dt><dd>{{ shipment()!.shipmentType }}</dd>
              <dt>Delivery Type</dt><dd>{{ shipment()!.deliveryType === 'DOOR' ? 'Door Delivery' : 'Office Delivery' }}</dd>
              @if (shipment()!.appointmentDelivery) {
                <dt>Appointment Delivery</dt>
                <dd>{{ shipment()!.appointmentDate }} · {{ shipment()!.appointmentTimeSlot }}</dd>
              }
              @if (shipment()!.insuranceApplicable) {
                <dt>FOV</dt><dd>Applicable (2% of Invoice Value)</dd>
              }
            </dl>
          </app-card>

          @if (shipment()!.flowType === 'MSRTC') {
            <app-shipment-bus-crossing-card [shipmentId]="shipment()!.id" [canEdit]="can().update"
              [fromBranchId]="shipment()!.bookingBranchId" [toBranchId]="shipment()!.deliveryBranchId ?? null" />
          }

          <app-card title="Weight &amp; Value">
            <dl class="kv">
              <dt>Actual Weight</dt><dd class="mono">{{ shipment()!.actualWeight | number: '1.3-3' }} kg</dd>
              <dt>Volumetric Weight</dt><dd class="mono">{{ shipment()!.volumetricWeight | number: '1.3-3' }} kg</dd>
              <dt>Chargeable Weight</dt><dd class="mono">{{ shipment()!.chargeableWeight | number: '1.3-3' }} kg</dd>
              <dt>Number of Packages</dt><dd>{{ shipment()!.numberOfPackages }}</dd>
              @if (shipment()!.declaredValue) { <dt>Declared Value</dt><dd class="mono">{{ shipment()!.declaredValue | number: '1.2-2' }}</dd> }
            </dl>
          </app-card>

          <app-card title="Items" [subtitle]="shipment()!.items.length + ' package(s)'">
            <div class="sv__items">
              @for (i of shipment()!.items; track i.id) {
                <div class="sv__item">
                  <span>{{ i.itemName }} × {{ i.quantity }}@if (i.fragile) { <span class="tag">Fragile</span> }@if (i.dangerousGoods) { <span class="tag tag--d">DG</span> }</span>
                  <span class="mono">{{ i.weight }} kg</span>
                </div>
              }
            </div>
          </app-card>

          @if (shipment()!.remarks) {
            <app-card title="Remarks"><p class="sv__remarks">{{ shipment()!.remarks }}</p></app-card>
          }

          @if (shipment()!.ewayBillRequired || shipment()!.invoiceValue || shipment()!.ewayBill) {
            <app-card title="E-Way Bill" subtitle="Part-A generated at booking, Part-B at manifest dispatch.">
              <dl class="kv">
                <dt>Required</dt><dd>{{ shipment()!.ewayBillRequired ? 'Yes' : 'No' }}</dd>
                @if (shipment()!.invoiceValue != null) {
                  <dt>Invoice Value</dt><dd class="mono">{{ shipment()!.invoiceValue | number: '1.2-2' }}</dd>
                }
                @if (shipment()!.ewayBill; as eb) {
                  <dt>Overall Status</dt>
                  <dd><span class="eway-status" [class.eway-status--failed]="eb.status === 'FAILED'"
                            [class.eway-status--done]="eb.status === 'GENERATED'">{{ eb.status }}</span></dd>
                  <dt>E-Way Bill Number</dt><dd class="mono">{{ eb.ewayBillNumber || '— not yet issued —' }}</dd>
                  <dt>Part-A</dt><dd>{{ partAStatusLabel(eb) }}</dd>
                  <dt>Part-B</dt><dd>{{ partBStatusLabel(eb) }}</dd>
                  @if (eb.validFrom || eb.validUntil) {
                    <dt>Validity</dt>
                    <dd>{{ eb.validFrom ? (eb.validFrom | date: 'mediumDate') : '—' }} – {{ eb.validUntil ? (eb.validUntil | date: 'mediumDate') : '—' }}</dd>
                  }
                  @if (eb.status === 'FAILED' && eb.lastError) {
                    <dt>Failure Reason</dt><dd class="eway-missing">{{ eb.lastError }}</dd>
                  }
                  @if (eb.documentUrl) {
                    <dt>Document</dt><dd><a [href]="eb.documentUrl" target="_blank" rel="noopener">View document</a></dd>
                  }
                } @else if (shipment()!.ewayBillRequired) {
                  <dt>E-Way Bill</dt><dd class="eway-missing">Not generated yet</dd>
                }
              </dl>
              @if (can().update && shipment()!.ewayBill; as eb) {
                <div class="eway-actions">
                  @if (canRetryEwayBill(eb)) {
                    <app-button variant="stroked" [loading]="ewayBillBusy()" (pressed)="retryEwayBill(eb.id)">Retry</app-button>
                  }
                  @if (eb.status !== 'CANCELLED') {
                    <app-button variant="stroked" (pressed)="ewayBillFile.click()">Upload Document</app-button>
                    <input #ewayBillFile type="file" accept=".pdf,.jpg,.jpeg,.png" hidden (change)="onEwayBillFile($event, eb.id)" />
                    <app-button variant="danger" [loading]="ewayBillBusy()" (pressed)="cancelEwayBill(eb.id)">Cancel</app-button>
                  }
                </div>
              }
            </app-card>
          }

          @if (shipment()!.shipmentImageUrl) {
            <app-card title="Shipment Photo">
              <img class="sv__pod" [src]="shipment()!.shipmentImageUrl" alt="Shipment photo" />
            </app-card>
          }

          @if (shipment()!.podPhotoUrl) {
            <app-card title="Proof of Delivery" [subtitle]="shipment()!.deliveredAt ? ('Delivered ' + (shipment()!.deliveredAt | date: 'medium')) : ''">
              <img class="sv__pod" [src]="shipment()!.podPhotoUrl" alt="Proof of delivery photo" />
            </app-card>
          }

          <app-shipment-communication-card [shipmentId]="shipment()!.id" />
        </div>
      </div>
    }
  `,
  styles: [`
    .mt-wrap { overflow-x:auto; }
    .mt { width:100%; border-collapse:collapse; font:400 13px var(--font-sans); }
    .mt th { text-align:left; padding:10px 12px; font-weight:600; font-size:12px; color:var(--content-muted);
      border-bottom:1px solid var(--surface-border); white-space:nowrap; }
    .mt td { padding:12px; border-bottom:1px solid var(--surface-border); color:var(--content-fg); white-space:nowrap; }
    .mt tbody tr:last-child td { border-bottom:0; }
    .mt__strong { font-weight:600; }
    .mt .tag { margin-left:0; background:var(--brand-100); color:var(--brand-700); }
    .sv { display:flex; flex-direction:column; gap:16px; }
    .sv__actions { display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
    .sv__link { display:inline-flex; align-items:center; gap:6px; font:600 13px var(--font-sans); color:var(--content-fg);
      text-decoration:none; padding:8px 4px; }
    .sv__link:hover { color:var(--brand-600); }
    .sv__link mat-icon { font-size:18px; width:18px; height:18px; }
    .sv__spacer { flex:1; }
    .sv__grid-parties { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
    .sv__grid2 { display:grid; grid-template-columns:1.3fr 1fr; gap:16px; align-items:start; }
    .tl { display:flex; flex-direction:column; }
    .tl__row { display:flex; gap:14px; align-items:flex-start; padding:10px 4px; position:relative; }
    .tl__row:not(:last-child)::before { content:''; position:absolute; left:19px; top:40px; bottom:-2px; width:2px; background:var(--surface-border); }
    .tl__icon { width:38px; height:38px; border-radius:50%; background:var(--surface-muted); color:var(--content-muted); display:grid; place-items:center; flex:0 0 auto; z-index:1; }
    .tl__row--done .tl__icon { background:var(--brand-50); color:var(--brand-600); }
    .tl__body { display:flex; flex-direction:column; gap:2px; padding-top:6px; }
    .tl__body strong { font:600 14px var(--font-sans); color:var(--content-fg); }
    .tl__row:not(.tl__row--done) .tl__body strong { color:var(--content-muted); }
    .tl__pending { font-style:italic; }
    .sv__grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
    .sv__grid app-card:nth-child(3) { grid-column:1 / -1; }
    .sv__name { margin:0; font:600 15px var(--font-sans); color:var(--content-fg); }
    .sv__sub { margin:4px 0 0; font:400 13px var(--font-sans); color:var(--content-muted); }
    .kv { display:grid; grid-template-columns:160px 1fr; gap:10px 16px; margin:0; }
    .kv dt { font:500 13px var(--font-sans); color:var(--content-muted); }
    .kv dd { font:600 14px var(--font-sans); color:var(--content-fg); margin:0; }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .sv__items { display:flex; flex-direction:column; gap:6px; }
    .sv__item { display:flex; justify-content:space-between; font:400 13px var(--font-sans); color:var(--content-fg);
      padding:6px 0; border-bottom:1px solid var(--surface-border); }
    .tag { font:600 10px var(--font-sans); padding:2px 6px; border-radius:6px; background:var(--warning-bg); color:var(--warning); margin-left:6px; }
    .tag--d { background:var(--danger-bg); color:var(--danger); }
    .rate-edit { display:flex; align-items:flex-end; gap:12px; flex-wrap:wrap; margin-top:16px; padding-top:16px; border-top:1px solid var(--border, #e5e7eb); }
    .rate-edit__l { display:flex; flex-direction:column; gap:4px; font:500 12px var(--font-sans); color:var(--content-fg); }
    .rate-edit__i { width:120px; padding:8px 10px; font:400 14px var(--font-sans); border:1px solid var(--border, #d1d5db); border-radius:6px; background:transparent; color:inherit; }
    .pm-flag { display:flex; align-items:center; gap:12px; padding:12px 16px; border-radius:10px; border:1px solid var(--warning, #f59e0b); background:var(--warning-bg, #fef3c7); color:var(--warning-fg, #92400e); }
    .pm-flag mat-icon { flex:none; }
    .pm-flag div { display:flex; flex-direction:column; gap:2px; font:400 13px var(--font-sans); }
    .pm-flag strong { font-weight:600; }
    .pm-edit { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:16px; padding-top:16px; border-top:1px solid var(--border, #e5e7eb); }
    .pm-edit__l { font:400 14px var(--font-sans); }
    .rate-preview { margin-top:12px; padding:12px; border:1px dashed var(--border, #d1d5db); border-radius:8px; }
    .rate-preview__t { font:600 12px var(--font-sans); margin-bottom:8px; opacity:.8; }
    .rate-edit__h { font:400 12px var(--font-sans); opacity:.7; }
    .sv__remarks { margin:0; font:400 14px var(--font-sans); color:var(--content-fg); }
    .sv__pod { display:block; max-width:100%; max-height:360px; border-radius:var(--r-field); border:1px solid var(--surface-border); }
    .empty { font:400 14px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
    .commission { display:flex; flex-direction:column; gap:10px; }
    .commission__row { display:flex; align-items:center; justify-content:space-between; font:400 14px var(--font-sans); color:var(--content-fg); }
    .commission__row strong { font-weight:600; }
    .commission__row--total { border-top:1px solid var(--surface-border); padding-top:10px; margin-top:2px; }
    .commission__row--total strong { color:var(--brand-600); }
    .eway-missing { color:var(--danger); }
    .eway-actions { display:flex; gap:10px; margin-top:14px; flex-wrap:wrap; }
    .eway-status { font:600 12px var(--font-sans); letter-spacing:.02em; }
    .eway-status--done { color:var(--brand-600); }
    .eway-status--failed { color:var(--danger); }
    .rel { display:flex; flex-direction:column; gap:2px; }
    .rel__row { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 4px;
      border-bottom:1px solid var(--surface-border); text-decoration:none; color:var(--content-fg); }
    .rel__row:last-child { border-bottom:0; }
    .rel__row:hover .rel__title { color:var(--brand-600); }
    .rel__title { font:500 13px var(--font-sans); }
    @media (max-width:860px){ .sv__grid-parties { grid-template-columns:1fr; } .sv__grid { grid-template-columns:1fr; } .sv__grid app-card:nth-child(3) { grid-column:auto; } .sv__grid2 { grid-template-columns:1fr; } }
  `]
})
export class ShipmentView implements OnInit {
  private readonly service = inject(ShipmentService);
  private readonly ewayBillService = inject(EwayBillService);
  private readonly ticketService = inject(TicketService);
  private readonly followUpService = inject(FollowUpService);
  private readonly manifestService = inject(ManifestService);
  private readonly vehicleService = inject(VehicleService);
  private readonly movementService = inject(ShipmentMovementService);
  private readonly auth = inject(AuthService);
  private readonly masters = inject(MasterDataService);
  private readonly companyProfile = inject(CompanyProfileService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly confirmDialog = inject(DialogService);
  private readonly matDialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly shipment = signal<ShipmentResponse | null>(null);
  readonly loadingDetails = signal(true);
  readonly steps = signal<TimelineStep[]>([]);
  readonly charge = signal<ShipmentCharge | null>(null);
  readonly ewayBillBusy = signal(false);

  readonly loadingRelated = signal(true);
  readonly tickets = signal<Ticket[]>([]);
  readonly followUps = signal<FollowUp[]>([]);

  readonly loadingMovement = signal(false);
  readonly movementDocs = signal<MovementDoc[]>([]);
  readonly drs = signal<ShipmentDrs | null>(null);
  readonly drsUser = signal<{ name: string; mobile: string } | null>(null);
  readonly drsVehicle = signal<string | null>(null);

  private readonly branchOptions = signal<SelectOption[]>([]);
  private readonly serviceTypeOptions = signal<SelectOption[]>([]);
  private readonly packageTypeOptions = signal<SelectOption[]>([]);
  private readonly paymentModeOptions = signal<SelectOption[]>([]);

  readonly can = computed(() => ({
    update: this.perms.canAccess({ roles: WRITERS, permissions: ['SHIPMENT_UPDATE'] }),
    cancel: this.perms.canAccess({ roles: WRITERS, permissions: ['SHIPMENT_DELETE'] })
  }));
  /** The admin, or a branch / hub manager, on a shipment still at the hub that was not forwarded (the backend checks the hub is theirs). */
  readonly canForward = computed(() => {
    const st = this.shipment()?.status;
    return !!this.shipment() && !this.shipment()!.forward
      && (st === 'BOOKED' || st === 'READY_FOR_MANIFEST' || st === 'IN_SCAN')
      && this.auth.hasAnyRole([AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER, AppRole.HUB_MANAGER]);
  });
  readonly canResolve = computed(() => this.shipment()?.forward?.state === 'UNKNOWN'
    && this.auth.hasAnyRole([AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER, AppRole.HUB_MANAGER]));
  readonly cancellable = computed(() => !!this.shipment() && CANCELLABLE_STATUSES.includes(this.shipment()!.status));
  /** Commission is a company-level figure — hidden for branch-level roles tracking
   *  someone else's shipment (BRANCH_MANAGER, BOOKING_OPERATOR, etc). */
  readonly rateInput = signal<number | null>(null);
  readonly rateSaving = signal(false);
  readonly rateCalculating = signal(false);
  /** Charges recalculated for the typed Rate/KG; cleared whenever the input changes. */
  readonly ratePreview = signal<ShipmentCharge | null>(null);
  /** Admin-only, BOOKED-only — the backend enforces both, this just hides the control. */
  readonly canEditRate = computed(() =>
    this.auth.hasAnyRole([AppRole.COMPANY_ADMIN]) && this.shipment()?.status === 'BOOKED');
  readonly currentRatePerKg = computed(() => {
    const c = this.charge(); const w = this.shipment()?.chargeableWeight;
    return c && w ? Math.round((c.freight / w) * 100) / 100 : 0;
  });

  /** DELHIVERY -> Delhivery (the shipment carries the courier's code). */
  protected courierName(code: string | null): string {
    return code ? code.charAt(0) + code.slice(1).toLowerCase().replace(/_(\w)/g, (_, c: string) => ' ' + c.toUpperCase()) : 'the courier';
  }

  protected forward(): void {
    const s = this.shipment();
    if (!s) return;
    this.matDialog.open(ShipmentForwardDialog, { data: { shipmentId: s.id, shipmentNumber: s.shipmentNumber }, autoFocus: false, panelClass: 'app-dialog' })
      .afterClosed().subscribe((r) => { if (r) this.load(); });
  }

  protected resolveForward(): void {
    const s = this.shipment();
    if (!s) return;
    this.matDialog.open(ShipmentResolveForwardDialog, {
      data: { shipmentId: s.id, shipmentNumber: s.shipmentNumber, courier: this.courierName(s.forward?.provider ?? null) },
      autoFocus: false, panelClass: 'app-dialog'
    }).afterClosed().subscribe((r) => { if (r) this.load(); });
  }

  protected onRateInput(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    this.rateInput.set(Number.isFinite(v) && v > 0 ? v : null);
    this.ratePreview.set(null);
  }

  protected calculateRate(): void {
    const s = this.shipment(); const rate = this.rateInput();
    if (!s || rate === null) return;
    this.rateCalculating.set(true);
    this.service.previewRatePerKg(s.id, rate).subscribe({
      next: (c) => { this.rateCalculating.set(false); this.ratePreview.set(c); },
      error: (e) => { this.rateCalculating.set(false); this.notify.error(e?.error?.message ?? 'Could not calculate.'); }
    });
  }

  protected saveRate(): void {
    const s = this.shipment(); const rate = this.rateInput();
    if (!s || rate === null) return;
    this.rateSaving.set(true);
    this.service.updateRatePerKg(s.id, s.version, rate).subscribe({
      next: () => { this.rateSaving.set(false); this.rateInput.set(null); this.ratePreview.set(null); this.notify.success('Rate/KG updated.'); this.load(); },
      error: (e) => { this.rateSaving.set(false); this.notify.error(e?.error?.message ?? 'Could not update Rate/KG.'); }
    });
  }

  readonly isCompanyLevel = computed(() => this.auth.hasAnyRole([AppRole.COMPANY_ADMIN]));

  /** Admin-side PAID / TO_PAY switch state (null for branch users — the backend refuses them). */
  readonly paymentMode = signal<PaymentModeChange | null>(null);
  readonly paymentModeSaving = signal(false);

  private loadPaymentMode(): void {
    if (!this.isCompanyLevel()) { this.paymentMode.set(null); return; }
    this.service.paymentModeChange(this.id).pipe(catchError(() => of(null)))
      .subscribe((pm) => this.paymentMode.set(pm));
  }

  protected changePaymentMode(pm: PaymentModeChange, target: PaymentModeTarget): void {
    const s = this.shipment();
    if (!s) return;
    const money = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (target.direction === 'DEBIT' && !target.sufficientBalance) {
      this.notify.error(`Insufficient wallet balance: available ${money(pm.walletBalance)}, required ${money(target.walletAmount)}.`);
      return;
    }
    const message = target.direction === 'DEBIT'
      ? `${money(target.walletAmount)} will be debited from the booking branch wallet (available ${money(pm.walletBalance)}). Change ${pm.currentModeName} → ${target.name}?`
      : `${money(target.walletAmount)} will be credited back to the booking branch wallet. Change ${pm.currentModeName} → ${target.name}?`;
    this.confirmDialog.confirm({
      title: `Change to ${target.name}`, message, confirmLabel: `Change to ${target.name}`
    }).subscribe((ok) => {
      if (!ok) return;
      this.paymentModeSaving.set(true);
      this.service.changePaymentMode(s.id, s.version, target.id).subscribe({
        next: () => {
          this.paymentModeSaving.set(false);
          this.notify.success(`Payment mode changed to ${target.name}.`);
          this.load();
        },
        error: (e) => {
          this.paymentModeSaving.set(false);
          this.notify.error(e?.error?.message ?? 'Could not change the payment mode.');
        }
      });
    });
  }

  id = '';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.masters.options('branches').subscribe((o) => this.branchOptions.set(o));
    this.masters.options('service-types').subscribe((o) => this.serviceTypeOptions.set(o));
    this.masters.options('package-types').subscribe((o) => this.packageTypeOptions.set(o));
    this.masters.options('payment-modes').subscribe((o) => this.paymentModeOptions.set(o));
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.get(this.id).subscribe({
      next: (s) => {
        this.shipment.set(s);
        this.breadcrumb.set([{ label: 'Shipments', route: '/shipments' }, { label: s.shipmentNumber }]);
        this.loading.set(false);
        this.loadDetails();
        this.loadPaymentMode();
        this.loadRelated();
        this.loadMovement(s.manifestId ?? null);
      },
      error: () => { this.shipment.set(null); this.loading.set(false); }
    });
  }

  private loadDetails(): void {
    this.loadingDetails.set(true);
    forkJoin({
      steps: this.service.timeline(this.id),
      charge: this.service.charges(this.id).pipe(catchError(() => of(null)))
    }).subscribe({
      next: ({ steps, charge }) => {
        this.steps.set(steps);
        this.charge.set(charge);
        this.loadingDetails.set(false);
      },
      error: () => this.loadingDetails.set(false)
    });
  }

  /** Tickets/follow-ups already raised against this shipment — the create links in
   *  the actions bar only cover raising a new one. */
  private loadRelated(): void {
    this.loadingRelated.set(true);
    forkJoin({
      tickets: this.ticketService.search({ page: 0, size: 5, sort: 'createdAt,desc', relatedShipmentId: this.id })
        .pipe(catchError(() => of(emptyPage<Ticket>()))),
      followUps: this.followUpService.search({ page: 0, size: 5, sort: 'dueDate,desc', shipment: this.id })
        .pipe(catchError(() => of(emptyPage<FollowUp>())))
    }).subscribe(({ tickets, followUps }) => {
      this.tickets.set(tickets.content);
      this.followUps.set(followUps.content);
      this.loadingRelated.set(false);
    });
  }

  /** Loading Sheet / THC history (every manifest named in the status log, plus the
   *  current one) and the DRS row. A Load Sheet and its THC are the same `Manifest`. */
  private loadMovement(currentManifestId: string | null): void {
    this.loadingMovement.set(true);
    forkJoin({
      history: this.service.history(this.id).pipe(catchError(() => of([] as ShipmentStatusHistoryEntry[]))),
      drs: this.service.deliveryRun(this.id).pipe(catchError(() => of(null))),
      dir: this.movementService.userDirectory().pipe(catchError(() => of(new Map<string, { name: string; mobile: string }>())))
    }).subscribe(({ history, drs, dir }) => {
      const ids: string[] = [];
      for (const h of history) if (h.manifestId && !ids.includes(h.manifestId)) ids.push(h.manifestId);
      if (currentManifestId && !ids.includes(currentManifestId)) ids.push(currentManifestId);

      const vehicleIds = new Set<string>();
      if (drs?.vehicleId) vehicleIds.add(drs.vehicleId);
      this.drs.set(drs);
      this.drsUser.set(drs ? dir.get(drs.deliveryUserId) ?? null : null);

      const manifests$ = ids.length
        ? forkJoin(ids.map((id) => this.manifestService.get(id).pipe(catchError(() => of(null)))))
        : of([] as (Manifest | null)[]);
      manifests$.subscribe((list) => {
        const manifests = list.filter((m): m is Manifest => !!m);
        manifests.forEach((m) => m.vehicleId && vehicleIds.add(m.vehicleId));
        const vehicles$ = vehicleIds.size
          ? forkJoin([...vehicleIds].map((vid) => this.vehicleService.get(vid)
              .pipe(map((v) => [vid, v.vehicleNumber] as const), catchError(() => of([vid, null] as const)))))
          : of([] as (readonly [string, string | null])[]);
        vehicles$.subscribe((pairs) => {
          const vNames = new Map(pairs);
          const at = (m: Manifest, status: string, last = false): string | null => {
            const rows = history.filter((h) => h.manifestId === m.id && h.status === status);
            return rows.length ? rows[last ? rows.length - 1 : 0].changedAt : null;
          };
          this.movementDocs.set(manifests.map((m) => ({
            manifest: m,
            createdAt: at(m, 'MANIFEST_CREATED') ?? m.createdAt ?? null,
            dispatchedAt: at(m, 'DISPATCHED') ?? m.departureTime ?? m.dispatchedAt ?? null,
            receivedAt: at(m, 'IN_SCAN', true),
            vehicle: m.vehicleId ? vNames.get(m.vehicleId) ?? null : null,
            driver: m.driverUserId ? dir.get(m.driverUserId) ?? null : null
          })));
          this.drsVehicle.set(drs?.vehicleId ? vNames.get(drs.vehicleId) ?? null : null);
          this.loadingMovement.set(false);
        });
      });
    });
  }

  timelineIcon(status: string): string { return TIMELINE_ICONS[status] ?? 'circle'; }

  branchLabel(id: string | null | undefined): string { return this.branchOptions().find((o) => o.value === id)?.label ?? id ?? '—'; }
  serviceTypeLabel(id: string): string { return this.serviceTypeOptions().find((o) => o.value === id)?.label ?? id; }
  packageTypeLabel(id: string | null | undefined): string { return this.packageTypeOptions().find((o) => o.value === id)?.label ?? id ?? '—'; }
  paymentModeLabel(id: string): string { return this.paymentModeOptions().find((o) => o.value === id)?.label ?? id; }

  edit(): void { this.router.navigate(['/shipments', this.id, 'edit']); }

  private buildPrintData(c: ShipmentCharge) {
    const s = this.shipment()!;
    return forkJoin({
      company: this.companyProfile.get().pipe(catchError(() => of(null))),
      bookingGeo: s.pickupPincode
        ? this.masters.pincodeGeo(s.pickupPincode).pipe(catchError(() => of(null)))
        : of(null),
      deliveryGeo: s.deliveryPincode
        ? this.masters.pincodeGeo(s.deliveryPincode, s.destinationAreaId).pipe(catchError(() => of(null)))
        : of(null)
    }).pipe(map(({ company, bookingGeo, deliveryGeo }): ConsignmentPrintData => ({
      companyName: company?.companyName ?? this.auth.companyName() ?? 'Courier SaaS',
      companyLogo: company?.logo ?? this.auth.companyLogo(),
      companyAddress: companyAddressLine(company),
      companyGst: company?.gstNumber ?? null,
      companyContact: company?.mobile ?? null,
      companyWebsite: company?.website ?? null,
      shipmentNumber: s.shipmentNumber, trackingNumber: s.trackingNumber, bookingDate: s.bookingDate,
      expectedDeliveryDate: s.expectedDeliveryDate ?? null,
      bookingBranchLabel: this.branchLabel(s.bookingBranchId),
      deliveryBranchLabel: s.deliveryBranchId
        ? this.branchLabel(s.deliveryBranchId)
        : s.toCity || '—',
      bookingPincode: s.pickupPincode || null,
      bookingDistrict: bookingGeo?.districtName ?? null,
      bookingArea: bookingGeo?.areaName ?? null,
      deliveryPincode: s.deliveryPincode || null,
      deliveryDistrict: deliveryGeo?.districtName ?? null,
      deliveryArea: deliveryGeo?.areaName ?? null,
      senderName: s.senderName, senderAddress: s.senderAddress, senderContact: s.senderContact,
      receiverName: s.receiverName, receiverAddress: s.receiverAddress, receiverContact: s.receiverContact,
      serviceTypeLabel: this.serviceTypeLabel(s.serviceTypeId), packageTypeLabel: this.packageTypeLabel(s.packageTypeId),
      paymentModeLabel: this.paymentModeLabel(s.paymentModeId),
      deliveryType: s.deliveryType,
      numberOfPackages: s.numberOfPackages, chargeableWeight: s.chargeableWeight,
      declaredValue: s.declaredValue ?? null,
      charges: {
        freight: c.freight, fuelCharge: c.fuelCharge, handlingCharge: c.handlingCharge, odaCharge: c.odaCharge,
        insuranceCharge: c.insuranceCharge, applicableCharges: c.applicableCharges,
        applicableChargeLines: c.applicableChargeLines, gstAmount: c.gstAmount,
        discount: c.discountAmount, roundOff: c.roundOff,
        // The saved netAmount already includes Other, Appointment, Door-delivery and To-Pay
        // charges, and the print totals add each back on top (same shape as the booking-time
        // print) — take them out here so they are counted once.
        netAmount: c.netAmount - (c.otherCharges ?? 0) - (c.appointmentDeliveryCharge ?? 0)
          - (c.doorDeliveryCharge ?? 0) - (c.toPayCharge ?? 0)
      },
      otherCharges: c.otherCharges,
      appointmentDeliveryCharge: c.appointmentDeliveryCharge,
      doorDeliveryCharge: c.doorDeliveryCharge,
      toPayCharge: c.toPayCharge,
      remarks: s.remarks ?? null,
      createdByName: s.createdByName ?? null,
      invoiceValue: s.invoiceValue ?? null,
      items: s.items.map((i) => ({ weight: i.weight, lengthCm: i.lengthCm, widthCm: i.widthCm, heightCm: i.heightCm }))
    })));
  }

  /** One label per package (`numberOfPackages`), all under this shipment's single AWB. */
  printLabels(): void {
    const s = this.shipment()!;
    this.companyProfile.get().pipe(catchError(() => of(null))).subscribe((company) => {
      const data: ShipmentLabelData = {
        companyName: company?.companyName ?? this.auth.companyName() ?? 'Courier SaaS',
        companyLogo: company?.logo ?? this.auth.companyLogo(),
        trackingNumber: s.trackingNumber,
        bookingDate: s.bookingDate,
        bookingBranchLabel: this.branchLabel(s.bookingBranchId),
        destinationLabel: s.toCity || (s.deliveryBranchId ? this.branchLabel(s.deliveryBranchId) : '—'),
        destinationPincode: s.deliveryPincode || null,
        senderName: s.senderName,
        receiverName: s.receiverName, receiverContact: s.receiverContact, receiverAddress: s.receiverAddress,
        weight: s.chargeableWeight,
        paymentModeLabel: this.paymentModeLabel(s.paymentModeId),
        serviceTypeLabel: this.serviceTypeLabel(s.serviceTypeId),
        routing: s.fromCity && s.toCity ? `${s.fromCity} → ${s.toCity}` : null,
        numberOfPackages: Math.max(1, s.numberOfPackages || 1)
      };
      this.matDialog.open(ShipmentLabelsDialog, { data, width: '560px', maxWidth: '95vw', autoFocus: false, panelClass: 'app-dialog' });
    });
  }

  print3(c: ShipmentCharge): void {
    this.buildPrintData(c).subscribe((data) => printPerformaBillCopies(data));
  }

  // ------------------------------------------------------------------- E-Way Bill

  /** Part-A is done once a provider-issued number exists — independent of the current
   *  `status`, so a row FAILED at Part-B still shows Part-A as generated. Mirrors
   *  backend `EwayBill.partAGenerated()`. */
  protected partAStatusLabel(eb: ShipmentEwayBillInfo): string {
    if (eb.ewayBillNumber) return 'Generated';
    if (eb.status === 'FAILED') return 'Failed';
    if (eb.status === 'CANCELLED') return 'Cancelled';
    return 'Pending';
  }

  protected partBStatusLabel(eb: ShipmentEwayBillInfo): string {
    if (eb.status === 'GENERATED') return 'Generated';
    if (eb.status === 'CANCELLED') return 'Cancelled';
    if (eb.status === 'EXPIRED') return 'Expired';
    if (!eb.ewayBillNumber) return 'Awaiting Part-A';
    if (eb.status === 'FAILED') return 'Failed';
    return 'Awaiting vehicle assignment';
  }

  protected canRetryEwayBill(eb: ShipmentEwayBillInfo): boolean {
    return eb.status === 'FAILED' || eb.status === 'EXPIRED';
  }

  retryEwayBill(id: string): void {
    this.ewayBillBusy.set(true);
    this.ewayBillService.retry(id).subscribe({
      next: () => { this.ewayBillBusy.set(false); this.notify.success('E-Way Bill retried.'); this.load(); },
      error: (e) => { this.ewayBillBusy.set(false); this.notify.error(e?.error?.message ?? 'Could not retry the E-Way Bill.'); }
    });
  }

  onEwayBillFile(event: Event, ewayBillId: string): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.ewayBillBusy.set(true);
    this.ewayBillService.upload(ewayBillId, file).subscribe({
      next: () => { this.ewayBillBusy.set(false); this.notify.success('E-Way Bill document uploaded.'); this.load(); },
      error: (e) => { this.ewayBillBusy.set(false); this.notify.error(e?.error?.message ?? 'Could not upload the document.'); }
    });
  }

  cancelEwayBill(id: string): void {
    this.confirmDialog.prompt({
      title: 'Cancel E-Way Bill',
      message: 'This E-Way Bill will be cancelled and cannot be edited, validated or documented again.',
      label: 'Reason (optional)', placeholder: 'Amended, reissued…',
      confirmLabel: 'Cancel E-Way Bill', danger: true
    }).subscribe((reason) => {
      if (reason === undefined) return;
      this.ewayBillBusy.set(true);
      this.ewayBillService.cancel(id, reason).subscribe({
        next: () => { this.ewayBillBusy.set(false); this.notify.success('E-Way Bill cancelled.'); this.load(); },
        error: (e) => { this.ewayBillBusy.set(false); this.notify.error(e?.error?.message ?? 'Could not cancel the E-Way Bill.'); }
      });
    });
  }

  cancel(): void {
    this.confirmDialog.prompt({
      title: 'Cancel shipment',
      message: `"${this.shipment()!.shipmentNumber}" will be cancelled. This cannot be undone once it has left the branch.`,
      label: 'Reason', placeholder: 'Booked in error, customer request…',
      confirmLabel: 'Cancel Shipment', danger: true
    }).subscribe((reason) => {
      if (!reason) return;
      this.service.cancel(this.id, reason).subscribe({
        next: () => { this.notify.success('Shipment cancelled.'); this.load(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not cancel the shipment.')
      });
    });
  }
}
