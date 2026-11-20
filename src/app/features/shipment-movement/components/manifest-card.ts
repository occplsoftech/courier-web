import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { ShipmentStatusBadge } from '@features/shipment/components/shipment-status-badge';
import { Manifest, Shipment } from '@core/models/shipment.model';
import { ManifestService } from '@features/manifest/manifest.service';
import { NotificationService } from '@core/services/notification.service';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';

/**
 * One open manifest's own card: heading (manifest number, lane, total weight, total
 * parcels) and its LR table underneath. Adding a shipment to a manifest already is the
 * "loading sheet created" milestone (V20, on direct request — there is no separate scan
 * action any more; see ManifestService.create and ShipmentStatus's own class doc), so
 * this card stays a read-only worklist by default — the next action for any of these
 * shipments is a Trip Hire Challan (THC). `showDispatchAction` opts a card into
 * surfacing that action itself (THC's own worklist), instead of every consumer building
 * its own trigger.
 * `showInScanAction` does the same for In Scan's pending-manifest worklist — receives
 * every shipment on the manifest that isn't `IN_SCAN` yet. `showRemoveAction` (Loading
 * Sheet only — a manifest is always still CREATED there) adds a per-row remove button
 * that calls `ManifestService.removeShipment` directly and reverts the shipment to
 * BOOKED; the card owns this mutation itself rather than delegating to a parent output,
 * the same way it already owns fetching its own shipment list.
 * `showPrintAction` (Loading Sheet) adds a Print button that just emits `print` with the
 * manifest — the card has no opinion on layout, the parent renders the actual sheet (see
 * `LoadingSheet.printLoadingSheet`, the same branded-challan approach THC's own print uses).
 */
@Component({
  selector: 'app-manifest-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiCard, UiLoader, UiButton, ShipmentStatusBadge],
  template: `
    <app-card>
      <div class="mh">
        <div>
          <strong>{{ manifest().manifestNumber }}</strong>
          <span class="text-caption">{{ fromLabel() }} → {{ toLabel() }}</span>
        </div>
        <div class="mh__stats">
          <div class="stat"><span class="stat__value">{{ totalWeight() }} kg</span><span class="stat__label">Total Weight</span></div>
          <div class="stat"><span class="stat__value">{{ totalParcels() }}</span><span class="stat__label">Total Parcels</span></div>
          @if (showDispatchAction()) {
            <app-button icon="outbound" (pressed)="dispatch.emit(manifest())">THC</app-button>
          }
          @if (showPrintAction()) {
            <app-button variant="stroked" icon="print" (pressed)="print.emit(manifest())">Print</app-button>
          }
          @if (showInScanAction()) {
            <app-button icon="qr_code_scanner" [loading]="inScanLoading()"
              [disabled]="!pendingCount()" (pressed)="inScan.emit(manifest())">
              In Scan{{ pendingCount() ? ' (' + pendingCount() + ')' : '' }}
            </app-button>
          }
        </div>
      </div>

      @if (loading()) {
        <app-loader [minHeight]="100" caption="Loading…" />
      } @else if (!shipments().length) {
        <p class="empty">No shipments on this manifest.</p>
      } @else {
        <div class="tbl__wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>#</th><th>Shipment No.</th><th>Sender → Receiver</th><th>From City → To City</th><th class="tbl--right">Weight</th><th>Status</th>
                @if (showRemoveAction()) { <th></th> }
              </tr>
            </thead>
            <tbody>
              @for (s of shipments(); track s.id; let i = $index) {
                <tr>
                  <td>{{ i + 1 }}</td>
                  <td><a [routerLink]="['/shipments', s.id]">{{ s.shipmentNumber }}</a></td>
                  <td>{{ s.senderName }} → {{ s.receiverName }}</td>
                  <td>{{ s.fromCity || '—' }} → {{ s.toCity || '—' }}</td>
                  <td class="tbl--right">{{ s.chargeableWeight }} kg</td>
                  <td><app-shipment-status-badge [status]="s.status" /></td>
                  @if (showRemoveAction()) {
                    <td class="tbl--right">
                      <app-button variant="text" icon="remove_circle" [loading]="removingId() === s.id"
                        (pressed)="removeShipment(s)">Remove</app-button>
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </app-card>
  `,
  styles: [`
    .mh { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; margin-bottom:16px; }
    .mh strong { display:block; font:600 19px var(--font-sans); }
    .mh__stats { display:flex; gap:20px; }
    .stat { display:flex; flex-direction:column; align-items:flex-end; }
    .stat__value { font:600 18px var(--font-sans); color:var(--content-fg); }
    .stat__label { font:400 14px var(--font-sans); color:var(--content-muted); text-transform:uppercase; letter-spacing:.03em; }
    .tbl__wrap { overflow-x:auto; border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .tbl { width:100%; border-collapse:collapse; font:400 16px var(--font-sans); }
    .tbl th { text-align:left; padding:10px 14px; background:var(--surface-muted); color:var(--content-muted); font:600 14px var(--font-sans); text-transform:uppercase; letter-spacing:.03em; white-space:nowrap; }
    .tbl td { padding:10px 14px; border-top:1px solid var(--surface-border); white-space:nowrap; }
    .tbl--right { text-align:right; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:16px; }
    @media (max-width:760px){ .mh { flex-direction:column; } .mh__stats { gap:14px; } }
  `]
})
export class ManifestCard implements OnInit {
  private readonly manifestService = inject(ManifestService);
  private readonly notify = inject(NotificationService);
  private readonly confirm = inject(DialogService);

  readonly manifest = input.required<Manifest>();
  readonly branchNames = input<Map<string, string>>(new Map());
  readonly showDispatchAction = input(false);
  readonly showInScanAction = input(false);
  readonly showRemoveAction = input(false);
  readonly showPrintAction = input(false);
  readonly inScanLoading = input(false);
  readonly dispatch = output<Manifest>();
  readonly inScan = output<Manifest>();
  readonly removed = output<Manifest>();
  readonly print = output<Manifest>();

  readonly shipments = signal<Shipment[]>([]);
  readonly loading = signal(true);
  readonly removingId = signal<string | null>(null);

  protected readonly fromLabel = computed(() =>
    this.branchNames().get(this.manifest().bookingBranchId) ?? 'Booking branch');
  protected readonly toLabel = computed(() =>
    this.manifest().deliveryMode === 'DIRECT_COMPANY_DELIVERY'
      ? 'Direct Company Delivery'
      : (this.manifest().deliveryBranchId ? this.branchNames().get(this.manifest().deliveryBranchId!) : null)
        ?? 'Delivery branch');
  protected readonly totalWeight = computed(() =>
    this.shipments().reduce((sum, s) => sum + (s.chargeableWeight ?? 0), 0));
  protected readonly totalParcels = computed(() => this.shipments().length);
  protected readonly pendingCount = computed(() =>
    this.shipments().filter((s) => s.status !== 'IN_SCAN').length);

  ngOnInit(): void {
    this.manifestService.shipments(this.manifest().id).subscribe({
      next: (s) => { this.shipments.set(s); this.loading.set(false); },
      error: () => { this.shipments.set([]); this.loading.set(false); }
    });
  }

  protected removeShipment(shipment: Shipment): void {
    this.confirm.confirm({
      title: 'Remove shipment',
      message: `${shipment.shipmentNumber} will come off this manifest and go back to BOOKED.`,
      confirmLabel: 'Remove', danger: true
    }).subscribe((ok) => { if (ok) this.doRemove(shipment.id); });
  }

  private doRemove(shipmentId: string): void {
    this.removingId.set(shipmentId);
    this.manifestService.removeShipment(this.manifest().id, shipmentId).subscribe({
      next: () => {
        this.shipments.update((list) => list.filter((s) => s.id !== shipmentId));
        this.removingId.set(null);
        this.notify.success('Shipment removed — back to BOOKED.');
        this.removed.emit(this.manifest());
      },
      error: (e: HttpErrorResponse) => {
        this.removingId.set(null);
        this.notify.error(e.error?.message ?? 'Could not remove the shipment.');
      }
    });
  }
}
