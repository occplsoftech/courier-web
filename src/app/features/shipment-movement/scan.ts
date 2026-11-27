import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { DrsDetail, DrsSummary, Manifest, Shipment, UNDELIVERED_REASONS } from '@core/models/shipment.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { downloadCsv } from '@shared/utils/csv-export.util';
import { MasterDataService } from '@features/masters/master-data.service';
import { ManifestService } from '@features/manifest/manifest.service';
import { VehicleService } from '@features/manifest/vehicle.service';
import { ShipmentService } from '@features/shipment/shipment.service';
import { ShipmentMovementService } from './shipment-movement.service';
import { OutscanAssignDialog } from './components/outscan-assign-dialog';
import { ManifestEditDialog } from './components/manifest-edit-dialog';
import { DrsEditDialog } from './components/drs-edit-dialog';
import { CoLoaderService } from '@features/manifest/co-loader.service';
import { money, printLetterhead, shortDate } from '@shared/utils/letterhead-print.util';
import { CompanyLetterhead, CompanyProfileService } from '@features/company/company-profile.service';

export type ScanTab = 'out' | 'in' | 'del' | 'drs' | 'man';
interface Opt { value: string; label: string; }

/** The branch a shipment leaves this one for: its next stop, else its delivery branch. */
export function destinationOf(s: Pick<Shipment, 'nextLocationId' | 'deliveryBranchId'>): string | null {
  return s.nextLocationId ?? s.deliveryBranchId ?? null;
}

/** Booked at, as a date: the booking date, else when the record was created. */
function bookedAt(s: Shipment): string | null { return s.createdDate ?? s.bookingDate ?? null; }

/**
 * Scan — the earlier portal's Scan screen on this app's own movement steps, one screen for the whole branch flow:
 * Booked → Pending Outscan → Outscan (loading sheet + THC dispatched in one step) → Pending Inscan at the destination →
 * Inscan → Pending Delivery → Generate DRS / Update Delivery. Every action is the same server call the Loading Sheet,
 * THC, In Scan, DRS and Delivery screens make, so tracking, reports, wallets and commissions are unchanged.
 */
@Component({
  selector: 'app-scan',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, MatIconModule, UiButton, OutscanAssignDialog, ManifestEditDialog, DrsEditDialog],
  template: `
    <div class="sc">
      <header class="page__head sc__head">
        <div><h1 class="text-h1">Scan</h1>
        <p class="flow"><b>Booked</b><mat-icon>east</mat-icon>Pending Outscan<mat-icon>east</mat-icon><b>Outscan</b><mat-icon>east</mat-icon>
          Pending Inscan<mat-icon>east</mat-icon><b>Inscan</b><mat-icon>east</mat-icon>Generate DRS / Update Delivery</p></div>
      </header>

      <nav class="tabs" role="tablist">
        @for (t of tabs; track t.id) {
          <button type="button" role="tab" class="tab" [class]="'tab tab--' + t.id" [class.tab--on]="tab() === t.id" [attr.aria-selected]="tab() === t.id"
                  [attr.aria-label]="t.label + ', ' + countOf(t.id)" (click)="setTab(t.id)">
            <span class="tab__ic"><mat-icon>{{ t.icon }}</mat-icon></span>
            <span class="tab__txt"><b>{{ t.label }}</b><small>{{ t.hint }}</small></span>
            <span class="tab__n">{{ countOf(t.id) }}</span></button>
        }
      </nav>

      @if (tab() === 'drs') {
        <section class="card">
          <div class="bar">
            <label class="f f--inline"><span class="f__l">Delivery Boy</span>
              <select class="in" id="sc-drs-who" [value]="drsWho()" (change)="drsWho.set($any($event.target).value)">
                <option value="">Everyone</option>
                <optgroup label="Staff">@for (o of users(); track o.value) { <option [value]="'u:' + o.value">{{ o.label }}</option> }</optgroup>
                @if (coLoaderOpts().length) { <optgroup label="Co-Loaders">@for (o of coLoaderOpts(); track o.value) { <option [value]="'c:' + o.value">{{ o.label }}</option> }</optgroup> }
              </select></label>
            <button type="button" class="ico" (click)="reload()" title="Refresh" aria-label="Refresh"><mat-icon>refresh</mat-icon></button>
          </div>
          @if (!drsRows().length) { <p class="muted empty">No delivery runs from this branch in the last 30 days.</p> }
          @else {
            <div class="cards">
              @for (d of drsRows(); track drsKey(d)) {
                <article class="rc" [attr.aria-label]="'DRS ' + (d.drsNumber || '')">
                  <div class="rc__top"><span class="rc__no">{{ d.drsNumber || '—' }}</span>
                    <span class="st" [class.st--run]="d.pendingCount > 0" [class.st--ok]="!d.pendingCount">{{ d.pendingCount ? 'Out for delivery' : 'Completed' }}</span>
                    <span class="rc__sp"></span>
                    @if (d.pendingCount && d.drsNumber) { <button type="button" class="pill" (click)="editDrs(d)" [attr.aria-label]="'Edit ' + d.drsNumber"><mat-icon>edit</mat-icon>Edit</button> }
                    <button type="button" class="pill" (click)="printDrs(d)" [attr.aria-label]="'Print ' + (d.drsNumber || 'DRS')"><mat-icon>print</mat-icon>Print</button></div>
                  <div class="rc__facts"><div><span>Date</span>{{ d.runDate | date: 'd MMM y' }}</div><div><span>Branch</span>{{ branchName(d.deliveryBranchId) }}</div>
                    <div><span>Delivery by</span>{{ deliveryByLabel(d) }}</div>
                    <div><span>Vehicle</span>{{ drsOpen()[drsKey(d)] ? (vehicleLabel(drsOpen()[drsKey(d)]!.vehicleId) || '—') : '…' }}</div></div>
                  <div class="rc__tot"><span><b>{{ d.shipmentCount }}</b> AWB</span><span class="ok"><b>{{ d.deliveredCount }}</b> delivered</span>
                    <span class="run"><b>{{ d.pendingCount }}</b> pending</span>
                    @if (drsOpen()[drsKey(d)]; as det) { <span>{{ drsMoney(det) }}</span> }</div>
                  @if (drsOpen()[drsKey(d)]; as det) {
                    <div class="tw"><table class="t t--in"><thead><tr><th>AWB</th><th>Receiver</th><th>Address</th><th class="n">Qty</th><th class="n">Wt</th><th>Status</th></tr></thead>
                      <tbody>@for (r of det.shipments; track r.shipmentId) {
                        <tr><td class="mono">{{ r.shipmentNumber }}</td><td>{{ r.receiverName }}</td><td class="wrap">{{ r.receiverAddress }}</td>
                          <td class="n">{{ r.numberOfPackages ?? 1 }}</td><td class="n">{{ r.actualWeight ?? '—' }}</td>
                          <td><span [class.ok]="r.status === 'DELIVERED'">{{ r.status === 'DELIVERED' ? 'Delivered' : r.status === 'OUT_FOR_DELIVERY' ? 'Out for delivery' : r.status }}</span></td></tr>
                      }</tbody></table></div>
                  }
                  <button type="button" class="rc__tog" (click)="toggleDrs(d)">{{ drsOpen()[drsKey(d)] ? '▴ Hide AWBs' : '▾ Show ' + d.shipmentCount + ' AWB' }}</button>
                </article>
              }
            </div>
          }
        </section>
      } @else if (tab() === 'man') {
        <section class="card">
          <div class="bar">
            <div class="seg" role="tablist" aria-label="Manifests">
              <button type="button" class="pill" id="sc-man-sent" [class.pill--on]="manView() === 'sent'" (click)="manView.set('sent')">Sent ({{ sheets().length }})</button>
              <button type="button" class="pill" id="sc-man-in" [class.pill--on]="manView() === 'in'" (click)="manView.set('in')">Incoming ({{ incoming().length }})</button>
            </div>
            <label class="f f--inline"><span class="f__l">Co-Loader</span>
              <select class="in" id="sc-man-cl" [value]="manCoLoader()" (change)="manCoLoader.set($any($event.target).value)">
                <option value="">All</option>@for (o of coLoaderOpts(); track o.value) { <option [value]="o.value">{{ o.label }}</option> }
              </select></label>
            <button type="button" class="ico" (click)="reload()" title="Refresh" aria-label="Refresh"><mat-icon>refresh</mat-icon></button>
          </div>
          @if (!manRows().length) { <p class="muted empty">{{ manView() === 'sent' ? 'No manifests from this branch yet.' : 'No dispatched manifests addressed to this branch.' }}</p> }
          @else {
            <div class="cards">
              @for (m of manRows(); track m.id) {
                <article class="rc" [attr.aria-label]="'Manifest ' + m.manifestNumber">
                  <div class="rc__top"><span class="rc__no">{{ m.manifestNumber }}</span>
                    <span class="st" [class.st--out]="m.status === 'DISPATCHED'" [class.st--ok]="m.status === 'COMPLETED'">{{ m.status === 'DISPATCHED' ? 'Dispatched' : m.status === 'COMPLETED' ? 'Received' : 'Created' }}</span>
                    <span class="rc__sp"></span>
                    @if (m.status === 'CREATED' && manView() === 'sent') {
                      <button type="button" class="pill" (click)="editManifest(m, false)" [attr.aria-label]="'Edit ' + m.manifestNumber"><mat-icon>edit</mat-icon>Edit</button>
                      <button type="button" class="pill pill--go" (click)="editManifest(m, true)"><mat-icon>local_shipping</mat-icon>Dispatch</button>
                    }
                    <button type="button" class="pill" (click)="printManifest(m)" [attr.aria-label]="'Print ' + m.manifestNumber"><mat-icon>print</mat-icon>Print</button>
                    @if (m.status === 'CREATED' && manView() === 'sent') {
                      <button type="button" class="pill pill--rm" (click)="deleteManifest(m)" [attr.aria-label]="'Delete ' + m.manifestNumber" title="Delete"><mat-icon>delete</mat-icon></button>
                    }</div>
                  <div class="rc__facts"><div><span>{{ m.dispatchedAt ? 'Dispatched' : 'Created' }}</span>{{ (m.dispatchedAt || m.createdAt) | date: 'd MMM y' }}</div>
                    <div><span>From → To</span>{{ branchCode(m.bookingBranchId) }} → {{ m.deliveryBranchId ? branchCode(m.deliveryBranchId) : 'Direct' }}</div>
                    <div><span>Co-Loader</span>{{ coLoaderName(m.coLoaderId) }}</div>
                    <div><span>Vehicle / Driver</span>{{ [vehicleLabel(m.vehicleId), userLabel(m.driverUserId)].filter(isSet).join(' · ') || '—' }}</div></div>
                  <div class="rc__tot"><span><b>{{ m.shipmentCount }}</b> AWB</span><span><b>{{ m.totalPackages }}</b> pcs</span>
                    <span><b>{{ m.totalWeight | number: '1.0-2' }} kg</b></span><span><b>{{ m.bagsCount ?? 0 }}</b> bags</span>
                    @if (manOpen()[m.id]; as rows) { @if (fwdCount(rows); as n) { <span>Forwarder No. {{ n }}/{{ rows.length }}</span> } }</div>
                  @if (manOpen()[m.id]; as rows) {
                    <div class="tw"><table class="t t--in"><thead><tr><th>AWB</th><th>FWD No</th><th>Receiver</th><th>Destination</th><th class="n">Qty</th><th class="n">Wt</th><th>Paymode</th></tr></thead>
                      <tbody>@for (r of rows; track r.id) {
                        <tr><td class="mono">{{ r.shipmentNumber }}</td><td>{{ r.forwarderNumber || '—' }}</td><td>{{ r.receiverName }}</td><td class="wrap">{{ r.toCity || '—' }}</td>
                          <td class="n">{{ r.numberOfPackages ?? 1 }}</td><td class="n">{{ r.actualWeight ?? r.chargeableWeight }}</td><td>{{ payLabel(r) }}</td></tr>
                      }</tbody></table></div>
                  }
                  <button type="button" class="rc__tog" (click)="toggleMan(m)">{{ manOpen()[m.id] ? '▴ Hide AWBs' : '▾ Show ' + m.shipmentCount + ' AWB' }}</button>
                </article>
              }
            </div>
          }
        </section>
      } @else {
      <div class="body" [class.body--split]="!!selected().size && tab() !== 'out'">
        <section class="card">
          <div class="bar">
            <div class="scanbox">
              <mat-icon>qr_code_scanner</mat-icon>
              <input id="sc-scan" [value]="scanText()" (input)="scanText.set($any($event.target).value)" (keydown.enter)="scanOne()"
                     [placeholder]="tab() === 'in' ? 'Scan AWB to receive…' : 'Scan or type AWB, Enter to select…'" autocomplete="off" />
            </div>
            @if (tab() === 'out') {
              <app-button icon="outbox" (pressed)="openAssign()">ASSIGN</app-button>
              <button type="button" class="pill" id="sc-rto" (click)="openRto()"><mat-icon>undo</mat-icon>Return to Origin</button>
            }
            <div class="seg">
              <button type="button" class="pill" [class.pill--on]="!today()" (click)="today.set(false)">All</button>
              <button type="button" class="pill" [class.pill--on]="today()" (click)="today.set(true)">Today</button>
            </div>
            <input class="in in--date" type="date" [value]="from()" (change)="from.set($any($event.target).value); today.set(false)" aria-label="From date" />
            <input class="in in--date" type="date" [value]="to()" (change)="to.set($any($event.target).value); today.set(false)" aria-label="To date" />
            <input class="in" [value]="search()" (input)="search.set($any($event.target).value)" placeholder="Search AWB, consignee, city…" aria-label="Search shipments" />
            <button type="button" class="pill" (click)="exportList()"><mat-icon>download</mat-icon>Export Excel</button>
            <button type="button" class="ico" (click)="reload()" title="Refresh" aria-label="Refresh"><mat-icon>refresh</mat-icon></button>
          </div>
          @if (scanError()) { <p class="err" role="alert">{{ scanError() }}</p> }
          @if (actionError() && !selected().size) { <p class="err" role="alert">{{ actionError() }}</p> }

          @if (selected().size) {
            <div class="chips"><span class="text-caption">Selected ({{ selected().size }}):</span>
              @for (s of selectedRows(); track s.id) { <button type="button" class="chip" (click)="toggle(s.id)">{{ s.shipmentNumber }} <mat-icon>close</mat-icon></button> }
              <button type="button" class="clear" (click)="clearSelection()">Clear</button>
            </div>
          }

          @if (loading()) {
            <p class="muted">Loading…</p>
          } @else if (!rows().length) {
            <p class="muted empty">{{ emptyText() }}</p>
          } @else {
            <div class="tw"><table class="t">
              <thead><tr>
                <th class="cbc"><input type="checkbox" [checked]="allSelected()" (change)="toggleAll($any($event.target).checked)" aria-label="Select all" /></th>
                <th>AWB</th>
                @if (tab() === 'out') { <th>Booked</th><th>Consignee</th><th>To</th> }
                @if (tab() === 'in') { <th>From</th><th>THC</th><th>Consignee</th> }
                @if (tab() === 'del') { <th>Consignee</th><th>To</th><th>Status</th> }
                <th class="n">Pcs</th><th class="n">Weight</th>
              </tr></thead>
              <tbody>
                @for (s of rows(); track s.id) {
                  <tr [class.sel]="selected().has(s.id)" (click)="toggle(s.id)">
                    <td class="cbc"><input type="checkbox" [checked]="selected().has(s.id)" (click)="$event.stopPropagation()" (change)="toggle(s.id)" [attr.aria-label]="'Select ' + s.shipmentNumber" /></td>
                    <td><span class="mono">{{ s.shipmentNumber }}</span></td>
                    @if (tab() === 'out') {
                      <td>{{ bookedAtOf(s) | date: 'd MMM HH:mm' }}</td><td>{{ s.receiverName }}</td>
                      <td>@if (destinationOf(s); as d) { {{ branchName(d) }} } @else { <span class="warn">No route yet</span> }</td>
                    }
                    @if (tab() === 'in') { <td>{{ s.fromCity || branchName(s.bookingBranchId) }}</td><td>{{ thcOf(s) }}</td><td>{{ s.receiverName }}</td> }
                    @if (tab() === 'del') {
                      <td>{{ s.receiverName }}</td><td>{{ s.toCity || '—' }}</td>
                      <td><span class="st" [class.st--out]="s.status === 'OUT_FOR_DELIVERY'">{{ s.status === 'OUT_FOR_DELIVERY' ? 'Out for delivery' : 'Inscanned' }}</span></td>
                    }
                    <td class="n">{{ s.numberOfPackages ?? 1 }}</td><td class="n">{{ s.chargeableWeight | number: '1.0-3' }} kg</td>
                  </tr>
                }
              </tbody>
            </table></div>
          }
        </section>

        @if (selected().size && tab() !== 'out') {
          <aside class="card side">
            @if (tab() === 'in') {
              <h2 class="sec">Inscan {{ selected().size }} parcel(s)</h2>
              <p class="text-caption">Receives them at this branch. They then wait in Pending Delivery.</p>
              <label class="f"><span class="f__l">Remarks</span><input class="in" id="sc-in-remarks" [value]="remarks()" (input)="remarks.set($any($event.target).value)" placeholder="Optional" /></label>
              <div class="acts"><button type="button" class="pill" (click)="clearSelection()">Cancel</button>
                <app-button icon="move_to_inbox" [loading]="busy()" (pressed)="inscan()">Inscan</app-button></div>
            }
            @if (tab() === 'del') {
              <div class="seg seg--wide">
                <button type="button" class="pill" [class.pill--on]="delAction() === 'drs'" (click)="delAction.set('drs')"><mat-icon>directions_run</mat-icon>Generate DRS ({{ selectedInscanned().length }})</button>
                <button type="button" class="pill" [class.pill--on]="delAction() === 'update'" (click)="delAction.set('update')"><mat-icon>edit_note</mat-icon>Update Delivery ({{ selectedOut().length }})</button>
              </div>
              @if (delAction() === 'drs') {
                @if (!selectedInscanned().length) { <p class="err">Select inscanned parcels to put on a DRS.</p> }
                @else {
                  <div class="g2">
                    <label class="f"><span class="f__l">Delivery Boy <b class="req">*</b></span>
                      <select class="in" id="sc-boy" [value]="deliveryUserId()" (change)="deliveryUserId.set($any($event.target).value)">
                        <option value="">Select delivery boy</option>@for (o of users(); track o.value) { <option [value]="o.value">{{ o.label }}</option> }
                      </select></label>
                    <label class="f"><span class="f__l">Vehicle</span>
                      <select class="in" [value]="drsVehicleId()" (change)="drsVehicleId.set($any($event.target).value)">
                        <option value="">Optional</option>@for (o of vehicles(); track o.value) { <option [value]="o.value">{{ o.label }}</option> }
                      </select></label>
                  </div>
                  <div class="acts"><app-button icon="directions_run" [loading]="busy()" (pressed)="generateDrs()">Create DRS</app-button></div>
                }
              } @else {
                @if (!selectedOut().length) { <p class="err">Select out-for-delivery parcels to update.</p> }
                @else {
                  <div class="seg">
                    <button type="button" class="pill" [class.pill--on]="delivered()" (click)="delivered.set(true)"><mat-icon>check</mat-icon>Delivered</button>
                    <button type="button" class="pill" [class.pill--on]="!delivered()" (click)="delivered.set(false)"><mat-icon>close</mat-icon>Undelivered</button>
                  </div>
                  @if (delivered()) {
                    <label class="f"><span class="f__l">Received by <b class="req">*</b></span><input class="in" id="sc-received" [value]="receivedBy()" (input)="receivedBy.set($any($event.target).value)" /></label>
                  } @else {
                    <label class="f"><span class="f__l">Reason <b class="req">*</b></span>
                      <select class="in" id="sc-reason" [value]="reason()" (change)="reason.set($any($event.target).value)">
                        <option value="">Select reason</option>@for (r of reasons; track r.value) { <option [value]="r.value">{{ r.label }}</option> }
                      </select></label>
                  }
                  <label class="f"><span class="f__l">Note {{ !delivered() && reason() === 'OTHER' ? '(required)' : '(optional)' }}</span><input class="in" id="sc-note" [value]="note()" (input)="note.set($any($event.target).value)" /></label>
                  <div class="acts"><app-button icon="task_alt" [loading]="busy()" (pressed)="updateDelivery()">Update {{ selectedOut().length }}</app-button></div>
                }
              }
            }
            @if (actionError()) { <p class="err" role="alert">{{ actionError() }}</p> }
          </aside>
        }
      </div>
      }

      @if (rtoOpen()) {
        <div class="rto" (keydown.escape)="rtoOpen.set(false)">
          <div class="rto__dlg" role="dialog" aria-modal="true" aria-labelledby="rto-t">
            <h2 id="rto-t" class="sec">Return to Origin — {{ selected().size }} AWB</h2>
            <p class="text-caption">{{ selectedNumbers() }}</p>
            <label class="f"><span class="f__l">Reason <b class="req">*</b></span>
              <input class="in" id="sc-rto-why" maxlength="300" [value]="rtoWhy()" (input)="rtoWhy.set($any($event.target).value)" placeholder="Why it goes back to the sender" /></label>
            @if (rtoError()) { <p class="err" role="alert">{{ rtoError() }}</p> }
            <div class="acts"><button type="button" class="pill" (click)="rtoOpen.set(false)">Cancel</button>
              <app-button icon="undo" [loading]="busy()" (pressed)="returnSelected()">Return</app-button></div>
          </div>
        </div>
      }
      @if (drsEditing(); as d) {
        <app-drs-edit-dialog [drs]="d" [deliveryBy]="deliveryByLabel(d)" [pending]="lists().del" (changed)="onDrsChanged(d)" (closed)="drsEditing.set(null); reload()" />
      }
      @if (editing(); as e) {
        <app-manifest-edit-dialog [manifest]="e.m" [startDispatch]="e.dispatch" [pending]="lists().out" [branches]="branchOptions()"
          [coLoaders]="coLoaderOpts()" [vehicles]="vehicles()" [users]="users()"
          (changed)="onManifestChanged($event)" (closed)="editing.set(null)" />
      }
      @if (assignOpen()) {
        <app-outscan-assign-dialog [pending]="lists().out" [preselected]="selectedIds()" [defaultBranchId]="outDestination()" [branches]="branchOptions()"
          [hubIds]="hubIds()" [coLoaders]="coLoaderOpts()" [vehicles]="vehicles()" [users]="users()" [myBranchId]="branchId!"
          (done)="onAssigned($event)" (closed)="assignOpen.set(false)" />
      }
      @if (lastDone(); as d) {
        <div class="done" role="status"><mat-icon>check_circle</mat-icon><span>{{ d.text }}</span>
          @if (d.link) { <button type="button" class="clear" (click)="go(d.link)">{{ d.linkLabel }}</button> }
          <button type="button" class="ico ico--sm" (click)="lastDone.set(null)" aria-label="Dismiss"><mat-icon>close</mat-icon></button></div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .f--inline { display: flex; flex-direction: row; align-items: center; gap: 8px; } .f--inline .in { min-width: 240px; }
    .sc { display: flex; flex-direction: column; gap: 14px; }
    .flow { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: 6px 0 0; font: 400 15px var(--font-sans); color: var(--content-muted); }
    .flow b { color: var(--content-fg); font-weight: 600; }
    .flow mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .tabs { display: grid; grid-template-columns: repeat(3, 1fr) repeat(2, minmax(0, .8fr)); gap: 14px; margin-bottom: 4px; }
    .tab { display: flex; align-items: center; gap: 14px; padding: 16px 18px; border: 2px solid var(--surface-border); border-radius: 18px;
      background: var(--surface); cursor: pointer; text-align: left; color: var(--content-fg); font: inherit; transition: .15s;
      box-shadow: var(--shadow-clay-sm); }
    .tab:hover { border-color: var(--brand-200); }
    .tab__ic { flex: none; display: grid; place-items: center; width: 48px; height: 48px; border-radius: 14px; }
    .tab__ic mat-icon { font-size: 24px; width: 24px; height: 24px; }
    .tab--out .tab__ic { background: var(--brand-50); color: var(--brand-700); }
    .tab--in .tab__ic { background: var(--info-bg); color: var(--info); }
    .tab--del .tab__ic { background: var(--success-bg); color: var(--success); }
    .tab--drs .tab__ic, .tab--man .tab__ic { background: var(--surface-muted); color: var(--content-fg); }
    .tab__txt { display: flex; flex-direction: column; min-width: 0; }
    .tab__txt b { font: 600 18px var(--font-sans); }
    .tab__txt small { font: 400 14px var(--font-sans); color: var(--content-muted); }
    .tab__n { margin-left: auto; font: 700 34px var(--font-sans); line-height: 1; color: var(--content-fg); }
    .tab--on { border-color: var(--brand-600); background: var(--brand-50); box-shadow: 0 8px 20px rgb(214 31 69 / 18%); }
    .tab--on .tab__n { color: var(--brand-700); }
    @media (max-width: 1300px) { .tabs { grid-template-columns: repeat(3, 1fr); } }
    @media (max-width: 900px) { .tabs { grid-template-columns: 1fr; gap: 10px; } .tab { padding: 12px 14px; } .tab__n { font-size: 28px; } }
    .body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
    .body--split { grid-template-columns: minmax(0, 1fr) 380px; }
    .card { background: var(--surface); border: 1px solid var(--surface-border); border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .side { position: sticky; top: 16px; }
    .sec { margin: 0; font: 600 19px var(--font-sans); color: var(--content-fg); }
    .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .scanbox { flex: 1 1 260px; display: flex; align-items: center; gap: 8px; border: 1px solid var(--surface-border); border-radius: 10px; padding: 0 12px; background: var(--surface); }
    .scanbox:focus-within { border-color: var(--brand-600); box-shadow: 0 0 0 3px var(--brand-50); }
    .scanbox mat-icon { color: var(--content-muted); }
    .scanbox input { flex: 1; border: 0; outline: 0; padding: 10px 0; font: 400 17px var(--font-sans); background: transparent; color: var(--content-fg); min-width: 0; }
    .in { border: 1px solid var(--surface-border); border-radius: 10px; padding: 9px 12px; font: 400 16px var(--font-sans); color: var(--content-fg); background: var(--surface); min-width: 0; }
    .in:focus { outline: 0; border-color: var(--brand-600); box-shadow: 0 0 0 3px var(--brand-50); }
    .in--date { width: 150px; }
    .seg { display: inline-flex; gap: 6px; flex-wrap: wrap; }
    .seg--wide { display: grid; grid-template-columns: 1fr 1fr; }
    .seg--wide .pill { white-space: normal; padding: 8px 10px; font-size: 14px; }
    .pill { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 14px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--surface-border); background: var(--surface); font: 500 15px var(--font-sans); color: var(--content-fg); white-space: nowrap; }
    .pill mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .pill--on { border-color: var(--brand-600); background: var(--brand-50); color: var(--brand-700); }
    .ico { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 10px; border: 1px solid var(--surface-border); background: var(--surface); cursor: pointer; color: var(--content-muted); }
    .ico--sm { width: 30px; height: 30px; border: 0; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px 4px 12px; border-radius: 999px; border: 0; cursor: pointer;
      background: var(--brand-50); color: var(--brand-700); font: 600 14px var(--font-mono, ui-monospace, monospace); }
    .chip mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .clear { border: 0; background: none; color: var(--brand-700); font: 600 14px var(--font-sans); cursor: pointer; padding: 0 4px; }
    .tw { overflow-x: auto; }
    .t { width: 100%; border-collapse: collapse; font: 400 16px var(--font-sans); }
    .t th { text-align: left; padding: 8px 10px; font: 600 13px var(--font-sans); color: var(--content-muted); text-transform: uppercase; letter-spacing: .04em;
      border-bottom: 1px solid var(--surface-border); white-space: nowrap; }
    .t td { padding: 10px; border-bottom: 1px solid var(--surface-border); white-space: nowrap; }
    .t tbody tr { cursor: pointer; }
    .t tbody tr:hover { background: var(--surface-muted, #fafafa); }
    .t tr.sel { background: var(--brand-50); }
    .t .n { text-align: right; }
    .cbc { width: 36px; }
    .cbc input { width: 18px; height: 18px; accent-color: var(--brand-600); }
    .mono { font-family: var(--font-mono, ui-monospace, monospace); font-weight: 600; color: var(--brand-700); }
    .warn { color: var(--warning, #b45309); font-weight: 500; }
    .st { padding: 3px 10px; border-radius: 999px; background: #fff7e6; color: #b45309; font: 600 13px var(--font-sans); }
    .st--out { background: #eef2ff; color: #4338ca; }
    .cards { display: flex; flex-direction: column; gap: 14px; margin-top: 12px; }
    .rc { border: 1px solid var(--surface-border); border-radius: 14px; overflow: hidden; background: var(--surface); box-shadow: 0 1px 4px rgb(0 0 0 / 5%); }
    .rc__top { display: flex; align-items: center; gap: 10px; padding: 14px 16px 8px; flex-wrap: wrap; }
    .rc__no { font: 700 18px var(--font-mono, monospace); color: var(--brand-700); } .rc__sp { flex: 1; }
    .rc__top .pill + .pill { margin-left: 2px; }
    .rc__facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px 16px; padding: 0 16px 12px; font: 400 15px var(--font-sans); }
    .rc__facts span { display: block; color: var(--content-muted); font: 600 11.5px var(--font-sans); text-transform: uppercase; letter-spacing: .04em; }
    .rc__tot { display: flex; flex-wrap: wrap; gap: 6px 18px; padding: 10px 16px; background: var(--surface-muted); border-top: 1px solid var(--surface-border); font: 400 14px var(--font-sans); }
    .rc__tot b { font-size: 15px; } .ok { color: #067647; } .run { color: #c2410c; }
    .rc__tog { display: block; width: 100%; text-align: left; border: 0; border-top: 1px solid var(--surface-border); background: none; padding: 9px 16px; color: var(--brand-700); font: 600 14px var(--font-sans); cursor: pointer; }
    .t--in { font-size: 14px; } .t--in td.wrap { white-space: normal; max-width: 260px; }
    .st--run { background: #fff1e6; color: #c2410c; }
    @media (max-width: 760px) { .rc__facts { grid-template-columns: 1fr 1fr; } }
    .acts-row { white-space: nowrap; width: 1%; } .acts-row .pill + .pill { margin-left: 4px; }
    .acts-row .pill { padding: 5px 9px; } .t td.wrap { max-width: 180px; white-space: normal; }
    .pill--go { background: var(--occpl-gradient-button, #c8102e); color: #fff; border-color: transparent; }
    .pill--rm { color: var(--danger); }
    .st--ok { background: #ecfdf3; color: #067647; }
    .f { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .f__l { font: 500 15px var(--font-sans); color: var(--content-muted); }
    .req { color: var(--danger); }
    .ro { font: 600 17px var(--font-sans); color: var(--content-fg); }
    .g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .acts { display: flex; justify-content: flex-end; gap: 10px; align-items: center; }
    .err { margin: 0; color: var(--danger); font: 500 15px var(--font-sans); }
    .muted { margin: 0; color: var(--content-muted); font: 400 16px var(--font-sans); }
    .empty { padding: 24px 0; text-align: center; }
    .rto { position: fixed; inset: 0; z-index: 1000; background: rgb(15 16 32 / 55%); display: grid; place-items: center; padding: 16px; }
    .rto__dlg { width: min(460px, 100%); background: var(--surface); border-radius: 18px; padding: 22px 24px; display: flex; flex-direction: column; gap: 12px; }
    .done { position: sticky; bottom: 12px; display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: 12px;
      background: var(--success-surface, #e9f7ee); color: var(--success, #15803d); font: 500 16px var(--font-sans); }
    .done span { flex: 1; }
    @media (max-width: 1100px) { .body--split { grid-template-columns: 1fr; } .side { position: static; } }
    @media (max-width: 640px) { .g2, .seg--wide { grid-template-columns: 1fr; } .in--date { width: 100%; } }
  `]
})
export class Scan {
  private readonly shipments = inject(ShipmentService);
  private readonly manifests = inject(ManifestService);
  private readonly movement = inject(ShipmentMovementService);
  private readonly vehicleService = inject(VehicleService);
  private readonly coLoaderService = inject(CoLoaderService);
  private readonly masters = inject(MasterDataService);
  private readonly companyProfile = inject(CompanyProfileService);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  protected readonly branchId = inject(AuthService).user()?.branchId ?? null;
  private readonly branchTypes = signal<Map<string, string>>(new Map());
  protected readonly branchOptions = signal<Opt[]>([]);

  protected readonly tabs: { id: ScanTab; label: string; icon: string; hint: string }[] = [
    { id: 'out', label: 'Pending Outscan', icon: 'outbox', hint: 'Booked here, to send' },
    { id: 'in', label: 'Pending Inscan', icon: 'move_to_inbox', hint: 'Coming to this branch' },
    { id: 'del', label: 'Pending Delivery', icon: 'local_shipping', hint: 'Here, to deliver' },
    { id: 'drs', label: 'DRS', icon: 'assignment', hint: 'Last 30 days' },
    { id: 'man', label: 'Manifest', icon: 'description', hint: 'Drafts, sent, incoming' }
  ];
  protected readonly reasons = UNDELIVERED_REASONS;
  protected readonly destinationOf = destinationOf;
  protected readonly bookedAtOf = bookedAt;

  // ?tab=man (back from Edit Shipment on a draft manifest's Qty / Wt) opens that tab.
  protected readonly tab = signal<ScanTab>((['out', 'in', 'del', 'drs', 'man'] as ScanTab[])
    .find((t) => t === inject(ActivatedRoute).snapshot.queryParamMap.get('tab')) ?? 'out');
  protected readonly lists = signal<Record<ScanTab, Shipment[]>>({ out: [], in: [], del: [], drs: [], man: [] });
  protected readonly loading = signal(true);
  protected readonly selected = signal<Set<string>>(new Set());
  protected readonly today = signal(false);
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly search = signal('');
  protected readonly scanText = signal('');
  protected readonly scanError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly lastDone = signal<{ text: string; link?: string; linkLabel?: string } | null>(null);

  protected readonly vehicles = signal<Opt[]>([]);
  protected readonly users = signal<Opt[]>([]);
  private readonly branchNames = signal<Map<string, string>>(new Map());
  private readonly thcNumbers = signal<Map<string, string>>(new Map());

  // Outscan
  protected readonly bags = signal('');
  protected readonly remarks = signal('');
  // Pending Delivery
  protected readonly delAction = signal<'drs' | 'update'>('drs');
  protected readonly deliveryUserId = signal('');
  protected readonly drsVehicleId = signal('');
  protected readonly delivered = signal(true);
  protected readonly receivedBy = signal('');
  protected readonly reason = signal('');
  protected readonly note = signal('');

  /** The current tab's rows, after Today / date range / search. */
  protected readonly rows = computed(() => {
    const all = this.lists()[this.tab()];
    const q = this.search().trim().toLowerCase();
    const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
    const todayIso = localIso(new Date());
    return all.filter((s) => {
      const d = day(bookedAt(s));
      if (this.today() && d !== todayIso) return false;
      if (this.from() && d && d < this.from()) return false;
      if (this.to() && d && d > this.to()) return false;
      if (!q) return true;
      return [s.shipmentNumber, s.trackingNumber, s.receiverName, s.toCity, s.fromCity]
        .some((v) => (v ?? '').toLowerCase().includes(q));
    });
  });
  protected readonly selectedRows = computed(() => this.lists()[this.tab()].filter((s) => this.selected().has(s.id)));
  protected readonly allSelected = computed(() => !!this.rows().length && this.rows().every((s) => this.selected().has(s.id)));
  protected readonly selectedInscanned = computed(() => this.selectedRows().filter((s) => s.status === 'IN_SCAN' || s.status === 'READY_FOR_MANIFEST'));
  protected readonly selectedOut = computed(() => this.selectedRows().filter((s) => s.status === 'OUT_FOR_DELIVERY'));

  /** All selected parcels must be going to the same branch for one loading sheet. */
  protected readonly outDestination = computed(() => {
    const dests = new Set(this.selectedRows().map((s) => destinationOf(s)));
    return dests.size === 1 ? [...dests][0] : null;
  });

  constructor() {
    inject(BreadcrumbService).set([{ label: 'OCCPL Operation' }, { label: 'Scan' }]);
    this.masters.branchDirectory().subscribe((list) => {
      this.branchNames.set(new Map(list.map((b) => [b.id, `${b.branchName} (${b.branchCode})`])));
      this.branchTypes.set(new Map(list.map((b) => [b.id, String(b.branchType ?? '')])));
      this.branchOptions.set(list
        .filter((b) => b.id !== this.branchId && b.branchType !== 'PICKUP_DELIVERY_PARTNER')
        .sort((a, b) => (a.branchType === 'HUB' ? 0 : 1) - (b.branchType === 'HUB' ? 0 : 1) || a.branchName.localeCompare(b.branchName))
        .map((b) => ({ value: b.id, label: `${b.branchName} (${b.branchCode})${b.branchType === 'HUB' ? ' · Hub' : ''}` })));
    });
    this.coLoaderService.list().subscribe({ next: (c) => this.coLoaderOpts.set(c.map((x) => ({ value: x.id, label: x.name }))), error: () => undefined });
    this.vehicleService.list(true).subscribe({ next: (v) => this.vehicles.set(v.map((x) => ({ value: x.id, label: x.vehicleNumber }))), error: () => undefined });
    this.movement.userOptions().subscribe({ next: (u) => this.users.set(u.map((x) => ({ value: x.id, label: x.label }))), error: () => undefined });
    this.reload();
    setTimeout(() => document.getElementById('sc-scan')?.focus());
  }

  protected countOf(t: ScanTab): number { return t === 'drs' ? this.drsRuns().length : t === 'man' ? this.sheets().length : this.lists()[t].length; }
  protected branchName(id: string | null | undefined): string { return id ? (this.branchNames().get(id) ?? '—') : '—'; }
  protected thcOf(s: Shipment): string { return (s.manifestId && this.thcNumbers().get(s.manifestId)) || '—'; }
  protected emptyText(): string {
    const any = this.lists()[this.tab()].length;
    if (any) return 'Nothing matches these filters.';
    return this.tab() === 'out' ? 'No parcels are pending outscan at this branch.'
      : this.tab() === 'in' ? 'No parcels are on their way to this branch.' : 'No parcels are waiting for delivery at this branch.';
  }

  protected setTab(t: ScanTab): void {
    this.tab.set(t);
    this.clearSelection();
    this.scanError.set(null);
    setTimeout(() => document.getElementById('sc-scan')?.focus());
  }

  /** Loads the three lists for this branch, with the same filters the Loading Sheet, In Scan and DRS screens use. */
  protected reload(): void {
    const me = this.branchId;
    if (!me) { this.loading.set(false); this.notify.error('Your user has no branch, so there is nothing to scan.'); return; }
    this.loading.set(true);
    const page = (q: Record<string, unknown>): Observable<Shipment[]> =>
      this.shipments.list({ page: 0, size: 200, ...q }).pipe(map((p) => p.content), catchError(() => of([] as Shipment[])));
    const merge = (...lists: Shipment[][]) => [...new Map(lists.flat().map((s) => [s.id, s])).values()];
    forkJoin({
      out: page({ currentLocationId: me, status: ['BOOKED', 'READY_FOR_MANIFEST'], flowType: 'STANDARD' }),
      inNext: page({ nextLocationId: me, status: 'DISPATCHED' }),
      inDest: page({ deliveryBranchId: me, status: 'DISPATCHED' }),
      delDest: page({ deliveryBranchId: me, status: ['IN_SCAN', 'OUT_FOR_DELIVERY'] }),
      delHere: page({ currentLocationId: me, unassignedDeliveryBranch: true, status: ['IN_SCAN', 'OUT_FOR_DELIVERY'] }),
      thc: this.manifests.list({ page: 0, size: 100, status: 'DISPATCHED', deliveryBranchId: me }).pipe(
        map((p) => p.content), catchError(() => of([] as Manifest[]))),
      drs: this.movement.listDrs(null, null, me).pipe(catchError(() => of([] as DrsSummary[]))),
      sent: this.manifests.list({ page: 0, size: 100, bookingBranchId: me }).pipe(map((p) => p.content), catchError(() => of([] as Manifest[]))),
      // Addressed to this branch: only once dispatched (a draft stays with the branch that made it).
      incoming: this.manifests.list({ page: 0, size: 100, deliveryBranchId: me, sent: true }).pipe(map((p) => p.content), catchError(() => of([] as Manifest[])))
    }).subscribe(({ out, inNext, inDest, delDest, delHere, thc, drs, sent, incoming }) => {
      this.drsRuns.set(drs);
      this.sheets.set(sent);
      this.incoming.set(incoming);
      this.thcNumbers.set(new Map(thc.map((m) => [m.id, m.manifestNumber])));
      const newestFirst = (a: Shipment, b: Shipment) => (bookedAt(b) ?? '').localeCompare(bookedAt(a) ?? '');
      this.lists.set({
        out: out.sort(newestFirst),
        in: merge(inNext, inDest).sort(newestFirst),
        del: merge(delDest, delHere).sort(newestFirst),
        drs: [], man: []
      });
      this.selected.update((sel) => new Set([...sel].filter((id) => this.lists()[this.tab()].some((s) => s.id === id))));
      this.loading.set(false);
    });
  }

  protected toggle(id: string): void {
    this.selected.update((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    this.actionError.set(null);
  }
  protected toggleAll(on: boolean): void {
    this.selected.set(on ? new Set(this.rows().map((s) => s.id)) : new Set());
  }
  protected clearSelection(): void { this.selected.set(new Set()); this.actionError.set(null); }

  /** Enter in the scan box selects that AWB, as the earlier portal's chips did. */
  protected scanOne(): void {
    const raw = this.scanText().trim().toUpperCase();
    this.scanText.set('');
    if (!raw) return;
    const hit = this.lists()[this.tab()].find((s) => s.shipmentNumber?.toUpperCase() === raw || s.trackingNumber?.toUpperCase() === raw);
    if (!hit) {
      this.scanError.set(`AWB ${raw} is not in ${this.tabs.find((t) => t.id === this.tab())!.label}.`);
      return;
    }
    if (this.selected().has(hit.id)) { this.scanError.set(`AWB ${raw} is already selected.`); return; }
    this.scanError.set(null);
    this.toggle(hit.id);
  }

  protected digits(e: Event, max: number): string {
    const el = e.target as HTMLInputElement;
    el.value = el.value.replace(/\D/g, '').slice(0, max);
    return el.value;
  }

  // ---- Pending Outscan → ASSIGN (the earlier portal's "Assign Outscan Item")
  protected readonly assignOpen = signal(false);
  protected readonly selectedIds = computed(() => [...this.selected()]);
  protected readonly hubIds = computed(() => [...this.branchTypes().entries()].filter(([, t]) => t === 'HUB').map(([id]) => id));
  protected readonly coLoaderOpts = signal<Opt[]>([]);
  protected openAssign(): void {
    if (!this.lists().out.length) { this.actionError.set('No parcels are pending outscan at this branch.'); return; }
    this.actionError.set(null);
    this.assignOpen.set(true);
  }
  // ---- Pending Outscan → Return to Origin (was "Assign to RTO" in the ASSIGN popup)
  protected readonly rtoOpen = signal(false);
  protected readonly rtoWhy = signal('');
  protected readonly rtoError = signal<string | null>(null);
  protected selectedNumbers(): string { return this.selectedRows().map((s) => s.shipmentNumber).join(', '); }
  protected openRto(): void {
    if (!this.selected().size) { this.actionError.set('Tick the AWBs to return to the sender first.'); return; }
    this.actionError.set(null); this.rtoError.set(null); this.rtoWhy.set('');
    this.rtoOpen.set(true);
  }
  protected returnSelected(): void {
    const why = this.rtoWhy().trim();
    if (!why) { this.rtoError.set('Enter the reason.'); return; }
    const rows = this.selectedRows();
    this.busy.set(true);
    forkJoin(rows.map((s) => this.movement.returnToSender(s.id, why).pipe(
      map(() => null as string | null), catchError((e: HttpErrorResponse) => of(`${s.shipmentNumber}: ${e.error?.message ?? 'failed'}`)))))
      .subscribe((errs) => {
        this.busy.set(false);
        const bad = errs.filter((x): x is string => !!x);
        if (bad.length) { this.rtoError.set(`${bad.length} not returned — ${bad.join('; ')}`); }
        else this.rtoOpen.set(false);
        const ok = rows.length - bad.length;
        if (ok) this.lastDone.set({ text: `${ok} AWB(s) returned to the sender.` });
        this.afterAction(!bad.length);
      });
  }
  protected onAssigned(text: string): void {
    this.assignOpen.set(false);
    this.lastDone.set({ text });
    this.afterAction();
  }

  // ---- DRS and Manifest tabs
  protected readonly drsRuns = signal<DrsSummary[]>([]);
  protected readonly drsWho = signal('');
  protected readonly drsRows = computed(() => {
    const who = this.drsWho();
    if (!who) return this.drsRuns();
    const id = who.slice(2);
    return this.drsRuns().filter((d) => who.startsWith('u:') ? d.deliveryUserId === id : d.coLoaderId === id);
  });
  protected readonly sheets = signal<Manifest[]>([]);
  protected readonly manCoLoader = signal('');
  protected readonly incoming = signal<Manifest[]>([]);
  protected readonly manView = signal<'sent' | 'in'>('sent');
  protected readonly manRows = computed(() => {
    const list = this.manView() === 'sent' ? this.sheets() : this.incoming();
    return this.manCoLoader() ? list.filter((m) => m.coLoaderId === this.manCoLoader()) : list;
  });
  // ---- cards: AWB lists folded open on demand
  protected readonly manOpen = signal<Record<string, Shipment[] | undefined>>({});
  protected readonly drsOpen = signal<Record<string, DrsDetail | undefined>>({});
  private readonly payModes = signal<{ names: Map<string, string>; toPay: Set<string> }>({ names: new Map(), toPay: new Set() });
  protected readonly drsEditing = signal<DrsSummary | null>(null);
  protected isSet = (v: unknown) => !!v;
  protected drsKey(d: DrsSummary): string { return `${d.drsNumber}|${d.runDate}|${d.deliveryUserId ?? d.coLoaderId}`; }
  protected vehicleLabel(id: string | null | undefined): string { return id ? (this.vehicles().find((v) => v.value === id)?.label ?? '') : ''; }
  protected userLabel(id: string | null | undefined): string { return id ? (this.users().find((u) => u.value === id)?.label ?? '') : ''; }
  protected branchCode(id: string): string { const n = this.branchName(id); return n.match(/\(([^)]+)\)\s*$/)?.[1] ?? n; }
  protected fwdCount(rows: Shipment[]): number { return rows.filter((r) => !!r.forwarderNumber).length; }
  protected payLabel(r: Shipment): string {
    const pm = this.payModes();
    const name = pm.names.get(r.paymentModeId) ?? '';
    const due = pm.toPay.has(r.paymentModeId) && r.netAmount ? ' · ' + Number(r.netAmount).toFixed(0) : r.codAmount ? ' · COD ' + Number(r.codAmount).toFixed(0) : '';
    return name + due;
  }
  protected drsMoney(det: DrsDetail): string {
    const pm = this.payModes();
    const toPay = det.shipments.filter((s) => s.status !== 'DELIVERED' && pm.toPay.has(s.paymentModeId)).reduce((a, s) => a + Number(s.netAmount ?? 0), 0);
    const cod = det.shipments.filter((s) => s.status !== 'DELIVERED').reduce((a, s) => a + Number(s.codAmount ?? 0), 0);
    return `To collect: To Pay ₹${toPay.toFixed(0)} · COD ₹${cod.toFixed(0)}`;
  }
  private loadPayModes(): void {
    if (this.payModes().names.size) return;
    this.masters.paymentModeDirectory().pipe(catchError(() => of([]))).subscribe((modes) => this.payModes.set({
      names: new Map(modes.map((m) => [m.id, m.name])),
      toPay: new Set(modes.filter((m) => m.collectAtDelivery && !m.cashOnDelivery && !m.requiresCreditAccount).map((m) => m.id))
    }));
  }
  protected toggleMan(m: Manifest): void {
    if (this.manOpen()[m.id]) { this.manOpen.update((o) => ({ ...o, [m.id]: undefined })); return; }
    this.loadPayModes();
    this.manifests.shipments(m.id).subscribe({
      next: (rows) => this.manOpen.update((o) => ({ ...o, [m.id]: rows })),
      error: () => this.notify.error('Could not load this manifest.')
    });
  }
  protected toggleDrs(d: DrsSummary): void {
    const k = this.drsKey(d);
    if (this.drsOpen()[k]) { this.drsOpen.update((o) => ({ ...o, [k]: undefined })); return; }
    this.loadPayModes();
    this.movement.drsDetail(d.deliveryUserId, d.deliveryBranchId, d.runDate, d.coLoaderId ?? null, d.drsNumber ?? null).subscribe({
      next: (det) => this.drsOpen.update((o) => ({ ...o, [k]: det })),
      error: () => this.notify.error('Could not load this DRS.')
    });
  }
  protected editDrs(d: DrsSummary): void { this.drsEditing.set(d); }
  protected onDrsChanged(d: DrsSummary): void { this.drsOpen.update((o) => ({ ...o, [this.drsKey(d)]: undefined })); }

  /** The draft manifest open in Edit (or on its Dispatch confirmation). */
  protected readonly editing = signal<{ m: Manifest; dispatch: boolean } | null>(null);
  protected editManifest(m: Manifest, dispatch: boolean): void { this.editing.set({ m, dispatch }); }
  protected onManifestChanged(text: string | null): void {
    if (text) this.lastDone.set({ text });
    this.manOpen.set({});
    this.reload();
  }
  protected deleteManifest(m: Manifest): void {
    if (!window.confirm(`Delete draft manifest ${m.manifestNumber}? Its ${m.shipmentCount} AWB(s) go back to Pending Outscan.`)) return;
    this.manifests.deleteDraft(m.id).subscribe({
      next: () => { this.lastDone.set({ text: `Manifest ${m.manifestNumber} deleted; its AWBs are back in Pending Outscan.` }); this.reload(); },
      error: (e: HttpErrorResponse) => this.notify.error(e.error?.message ?? 'Could not delete the manifest.')
    });
  }
  protected coLoaderName(id: string | null | undefined): string { return id ? (this.coLoaderOpts().find((o) => o.value === id)?.label ?? '—') : '—'; }
  protected deliveryByLabel(d: DrsSummary): string {
    if (d.coLoaderId) return this.coLoaderName(d.coLoaderId) + ' (co-loader)';
    return this.users().find((u) => u.value === d.deliveryUserId)?.label ?? '—';
  }
  /** Letterhead, To-Pay payment modes and service names for the DRS / manifest prints (cached after the first print). */
  private printRefs(): Observable<{ company: CompanyLetterhead | null; toPay: Set<string>; services: Map<string, string>; payModes: Map<string, string> }> {
    return forkJoin({
      company: this.companyProfile.get().pipe(catchError(() => of(null))),
      modes: this.masters.paymentModeDirectory().pipe(catchError(() => of([]))),
      services: this.masters.serviceTypeDirectory().pipe(catchError(() => of([])))
    }).pipe(map(({ company, modes, services }) => ({
      company,
      // To Pay: collected from the receiver at delivery, not COD, not a credit account (as the backend's own isToPay).
      toPay: new Set(modes.filter((m) => m.collectAtDelivery && !m.cashOnDelivery && !m.requiresCreditAccount).map((m) => m.id)),
      services: new Map(services.map((t) => [t.id, t.name])),
      payModes: new Map(modes.map((m) => [m.id, m.name]))
    })));
  }
  /** "Area, City, STATE" per shipment (its pincode and the Area picked at booking): the manifest's Destination column. */
  private destinations(rows: Shipment[]): Observable<Map<string, string>> {
    const keys = [...new Set(rows.filter((x) => x.deliveryPincode).map((x) => `${x.deliveryPincode}|${x.destinationAreaId ?? ''}`))];
    if (!keys.length) return of(new Map());
    return forkJoin(keys.map((k) => {
      const [pin, area] = k.split('|');
      return this.masters.pincodeGeo(pin, area || null).pipe(
        map((g) => [k, [g.areaName, g.cityName, g.stateName?.toUpperCase()].filter(Boolean).join(', ')] as [string, string]),
        catchError(() => of([k, ''] as [string, string])));
    })).pipe(map((l) => new Map(l)));
  }
  private printBlocked(ok: boolean): void { if (!ok) this.notify.error('Pop-up blocked — allow pop-ups to print.'); }

  /** Delivery Run Sheet, as the company's sample: DRS ID, Delivery Person, Date; Sr No, AWB, Consignee, To Pay, COD, Remark. */
  protected printDrs(d: DrsSummary): void {
    forkJoin({ det: this.movement.drsDetail(d.deliveryUserId, d.deliveryBranchId, d.runDate, d.coLoaderId ?? null, d.drsNumber ?? null),
      refs: this.printRefs() }).subscribe({
      next: ({ det, refs }) => this.printBlocked(printLetterhead({
        title: 'DELIVERY RUN SHEET', company: refs.company, logo: this.auth.companyLogo(), qr: d.drsNumber ?? null,
        // Tall rows: the receiver's stamp (about 30 mm) goes in Remark without touching the rows above or below.
        rowHeight: '38mm',
        details: [
          [{ label: 'DRS ID', value: d.drsNumber ?? '—', big: true }, { label: 'Branch', value: this.branchName(d.deliveryBranchId) }],
          [{ label: 'Delivery Person', value: this.deliveryByLabel(d), big: true }, { label: 'Date', value: shortDate(d.runDate) }],
          [{ label: 'Parcels', value: String(det.shipments.length), big: true },
            { label: 'Vehicle', value: this.vehicles().find((v) => v.value === det.vehicleId)?.label ?? '—' }]],
        columns: [{ label: 'Sr. No', width: '48px' }, { label: 'AWB Number', nowrap: true }, { label: 'Consignee' },
          { label: 'To Pay', width: '70px', right: true }, { label: 'COD', width: '70px', right: true }, { label: 'Remark / Stamp', width: '34%' }],
        rows: det.shipments.map((s, i) => [String(i + 1), s.shipmentNumber,
          [s.receiverName, s.receiverAddress, s.deliveryPincode && !(s.receiverAddress ?? '').includes(s.deliveryPincode) ? s.deliveryPincode : null,
            s.receiverContact].filter(Boolean).join(', '),
          refs.toPay.has(s.paymentModeId) ? money(s.netAmount) : '', money(s.codAmount), ''])
      })),
      error: () => this.notify.error('Could not load this DRS.')
    });
  }
  /** Manifest: Manifest No, From, Delivery Boy, To, Date, Bags; Sr No, AWB No, (FWD No), Delivery Branch / Vendor, Destination, Qty, Actual Wt, Mode / Service Type, Paymode. */
  protected printManifest(m: Manifest): void {
    this.manifests.shipments(m.id).pipe(
      switchMap((rows) => forkJoin({ rows: of(rows), refs: this.printRefs(), dest: this.destinations(rows) }))
    ).subscribe({
      next: ({ rows, refs, dest }) => {
        const withFwd = rows.some((s) => !!s.forwarderNumber);
        // Delivery branch of each AWB; a co-loader (vendor) when it has no branch of ours to go to.
        const branchOrVendor = (s: Shipment) => s.deliveryBranchId ? this.branchName(s.deliveryBranchId)
          : m.deliveryBranchId ? this.branchName(m.deliveryBranchId) : m.coLoaderId ? this.coLoaderName(m.coLoaderId) : '—';
        const payMode = (s: Shipment) => {
          const name = refs.payModes.get(s.paymentModeId) ?? '';
          const due = refs.toPay.has(s.paymentModeId) ? money(s.netAmount) : s.codAmount ? 'COD ' + money(s.codAmount) : '';
          return [name, due].filter(Boolean).join(' · ');
        };
        const driver = this.users().find((u) => u.value === m.driverUserId)?.label;
        const vehicle = this.vehicles().find((v) => v.value === m.vehicleId)?.label;
        const by = m.coLoaderId ? this.coLoaderName(m.coLoaderId) : [driver, vehicle].filter(Boolean).join(' - ') || '—';
        this.printBlocked(printLetterhead({
          title: 'MANIFEST', company: refs.company, logo: this.auth.companyLogo(), qr: m.manifestNumber,
          details: [
            [{ label: 'Manifest No', value: m.manifestNumber, big: true }, { label: 'From', value: this.branchName(m.bookingBranchId) }],
            [{ label: 'Delivery Boy', value: by, big: true }, { label: 'To', value: m.deliveryBranchId ? this.branchName(m.deliveryBranchId) : 'Direct delivery' }],
            [{ label: 'Date', value: shortDate(m.dispatchedAt || m.createdAt), big: true },
              { label: m.forwardingNumber ? 'Bags · Forwarding No.' : 'Bags',
                value: [m.bagsCount != null ? String(m.bagsCount) : '—', m.forwardingNumber].filter(Boolean).join(' · ') }]],
          columns: [{ label: 'Sr No', width: '44px' }, { label: 'AWB No', nowrap: true }, ...(withFwd ? [{ label: 'FWD No', nowrap: true }] : []),
            { label: 'Delivery Branch / Vendor' }, { label: 'Destination' },
            { label: 'Qty', width: '44px', right: true }, { label: 'Actual Wt (kg)', width: '70px', right: true },
            { label: 'Mode / Service Type' }, { label: 'Paymode' }],
          rows: rows.map((s, i) => [String(i + 1), s.shipmentNumber, ...(withFwd ? [s.forwarderNumber ?? ''] : []),
            branchOrVendor(s),
            dest.get(`${s.deliveryPincode}|${s.destinationAreaId ?? ''}`) || s.toCity || '',
            String(s.numberOfPackages ?? 1), String(s.actualWeight ?? s.chargeableWeight ?? ''),
            (s.serviceTypeId ? refs.services.get(s.serviceTypeId) : '') ?? '', payMode(s)])
        }));
      },
      error: () => this.notify.error('Could not load this manifest.')
    });
  }

  /** Inscan: receives the selected parcels at this branch. */
  protected inscan(): void {
    const rows = this.selectedRows();
    this.busy.set(true);
    this.actionError.set(null);
    this.movement.inScan({ receivingBranchId: this.branchId!, trackingNumbers: rows.map((s) => s.trackingNumber),
      remarks: this.remarks().trim() || null }).subscribe({
      next: (r) => {
        this.busy.set(false);
        if (r.failureCount) {
          const bad = r.results.filter((x) => !x.success).map((x) => `${x.reference}: ${x.message ?? 'failed'}`);
          this.actionError.set(`${r.failureCount} of ${r.results.length} not received — ${bad.join('; ')}`);
        }
        if (r.successCount) this.lastDone.set({ text: `${r.successCount} parcel(s) inscanned. They are now in Pending Delivery.` });
        this.afterAction(!r.failureCount);
      },
      error: (e: HttpErrorResponse) => { this.busy.set(false); this.actionError.set(e.error?.message ?? 'Inscan failed.'); }
    });
  }

  /** Generate DRS: the selected inscanned parcels go out with the delivery boy. */
  protected generateDrs(): void {
    const rows = this.selectedInscanned();
    if (!this.deliveryUserId()) { this.actionError.set('Select the delivery boy.'); return; }
    this.busy.set(true);
    this.actionError.set(null);
    this.movement.outForDelivery({ shipmentIds: rows.map((s) => s.id), deliveryUserId: this.deliveryUserId(),
      vehicleId: this.drsVehicleId() || null }).subscribe({
      next: (r) => {
        this.busy.set(false);
        if (r.failureCount) this.actionError.set(`${r.failureCount} of ${r.results.length} not added to the DRS — ${r.results.filter((x) => !x.success).map((x) => x.message).join('; ')}`);
        if (r.successCount) this.lastDone.set({ text: `DRS ${r.drsNumber ?? ''} created for ${r.successCount} parcel(s).`.replace("DRS  ", "DRS "), link: '/reports/drs', linkLabel: 'Open DRS to print' });
        this.afterAction(!r.failureCount);
      },
      error: (e: HttpErrorResponse) => { this.busy.set(false); this.actionError.set(e.error?.message ?? 'Could not create the DRS.'); }
    });
  }

  /** Update Delivery: each selected out-for-delivery parcel is delivered, or recorded as not delivered. */
  protected updateDelivery(): void {
    const rows = this.selectedOut();
    if (this.delivered() && !this.receivedBy().trim()) { this.actionError.set('Enter who received the parcel.'); return; }
    if (!this.delivered() && !this.reason()) { this.actionError.set('Select why it was not delivered.'); return; }
    if (!this.delivered() && this.reason() === 'OTHER' && !this.note().trim()) { this.actionError.set('Add a note for "Other".'); return; }
    this.busy.set(true);
    this.actionError.set(null);
    const note = this.note().trim() || null;
    const calls = rows.map((s) => (this.delivered()
      ? this.movement.deliver({ shipmentId: s.id, receiverName: this.receivedBy().trim(), remarks: note })
      : this.movement.markUndelivered(s.id, this.reason(), note)
    ).pipe(map(() => null as string | null), catchError((e: HttpErrorResponse) => of(`${s.shipmentNumber}: ${e.error?.message ?? 'failed'}`))));
    forkJoin(calls).subscribe((errs) => {
      this.busy.set(false);
      const failed = errs.filter((x): x is string => !!x);
      const ok = rows.length - failed.length;
      if (failed.length) this.actionError.set(`${failed.length} not updated — ${failed.join('; ')}`);
      if (ok) this.lastDone.set({ text: `${ok} parcel(s) marked ${this.delivered() ? 'delivered' : 'not delivered'}.` });
      this.afterAction(!failed.length);
    });
  }

  private afterAction(clear = true): void {
    // The rows acted on usually leave this tab on reload, taking the side panel (and any message in it) with them:
    // a message still to read moves to the list instead (see the template).
    if (clear) {
      this.clearSelection();
      this.remarks.set(''); this.bags.set(''); this.receivedBy.set(''); this.reason.set(''); this.note.set('');
    }
    this.reload();
  }

  protected go(link: string): void { this.router.navigateByUrl(link); }

  protected exportList(): void {
    const t = this.tab();
    const label = this.tabs.find((x) => x.id === t)!.label;
    downloadCsv(`${label.replace(/\s+/g, '_')}.csv`,
      ['AWB Number', 'Tracking Number', 'Booked', 'Consignee', 'From', 'To', 'Next Branch', 'Status', 'Pieces', 'Weight (kg)'],
      this.rows().map((s) => [s.shipmentNumber, s.trackingNumber, bookedAt(s)?.slice(0, 16).replace('T', ' ') ?? '', s.receiverName,
        s.fromCity ?? '', s.toCity ?? '', this.branchName(destinationOf(s)), s.status, s.numberOfPackages ?? 1, s.chargeableWeight]), [8, 9]);
  }
}

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
