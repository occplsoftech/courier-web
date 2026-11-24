import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { Manifest, Shipment, UNDELIVERED_REASONS } from '@core/models/shipment.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { downloadCsv } from '@shared/utils/csv-export.util';
import { MasterDataService } from '@features/masters/master-data.service';
import { ManifestService } from '@features/manifest/manifest.service';
import { VehicleService } from '@features/manifest/vehicle.service';
import { ShipmentService } from '@features/shipment/shipment.service';
import { ShipmentMovementService } from './shipment-movement.service';

export type ScanTab = 'out' | 'in' | 'del';
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
  imports: [DatePipe, DecimalPipe, MatIconModule, UiButton],
  template: `
    <div class="sc">
      <header class="page__head sc__head">
        <div><h1 class="text-h1">Scan</h1>
        <p class="flow"><b>Booked</b><mat-icon>east</mat-icon>Pending Outscan<mat-icon>east</mat-icon><b>Outscan</b><mat-icon>east</mat-icon>
          Pending Inscan<mat-icon>east</mat-icon><b>Inscan</b><mat-icon>east</mat-icon>Generate DRS / Update Delivery</p></div>
      </header>

      <nav class="tabs" role="tablist">
        @for (t of tabs; track t.id) {
          <button type="button" role="tab" class="tab" [class.tab--on]="tab() === t.id" [attr.aria-selected]="tab() === t.id" (click)="setTab(t.id)">
            <mat-icon>{{ t.icon }}</mat-icon>{{ t.label }}<span class="cnt">{{ countOf(t.id) }}</span></button>
        }
      </nav>

      <div class="body" [class.body--split]="!!selected().size">
        <section class="card">
          <div class="bar">
            <div class="scanbox">
              <mat-icon>qr_code_scanner</mat-icon>
              <input id="sc-scan" [value]="scanText()" (input)="scanText.set($any($event.target).value)" (keydown.enter)="scanOne()"
                     [placeholder]="tab() === 'in' ? 'Scan AWB to receive…' : 'Scan or type AWB, Enter to select…'" autocomplete="off" />
            </div>
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

        @if (selected().size) {
          <aside class="card side">
            @if (tab() === 'out') {
              <h2 class="sec">Outscan {{ selected().size }} parcel(s)</h2>
              <p class="text-caption">Creates the loading sheet and dispatches the trip (THC) in one step.</p>
              @if (outDestinationError(); as e) { <p class="err">{{ e }}</p> }
              @else {
                <label class="f"><span class="f__l">To Branch</span><span class="ro">{{ branchName(outDestination()!) }}</span></label>
                <div class="g2">
                  <label class="f"><span class="f__l">Vehicle <b class="req">*</b></span>
                    <select class="in" id="sc-vehicle" [value]="vehicleId()" (change)="vehicleId.set($any($event.target).value)">
                      <option value="">Select vehicle</option>@for (o of vehicles(); track o.value) { <option [value]="o.value">{{ o.label }}</option> }
                    </select></label>
                  <label class="f"><span class="f__l">Driver <b class="req">*</b></span>
                    <select class="in" id="sc-driver" [value]="driverId()" (change)="driverId.set($any($event.target).value)">
                      <option value="">Select driver</option>@for (o of users(); track o.value) { <option [value]="o.value">{{ o.label }}</option> }
                    </select></label>
                  <label class="f"><span class="f__l">Bags Count</span><input class="in" id="sc-bags" inputmode="numeric" [value]="bags()" (input)="bags.set(digits($event, 4))" /></label>
                  <label class="f"><span class="f__l">Remarks</span><input class="in" id="sc-remarks" [value]="remarks()" (input)="remarks.set($any($event.target).value)" placeholder="Optional" /></label>
                </div>
                <div class="acts"><button type="button" class="pill" (click)="clearSelection()">Cancel</button>
                  <app-button icon="outbox" [loading]="busy()" (pressed)="outscan()">Outscan</app-button></div>
              }
            }
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

      @if (lastDone(); as d) {
        <div class="done" role="status"><mat-icon>check_circle</mat-icon><span>{{ d.text }}</span>
          @if (d.link) { <button type="button" class="clear" (click)="go(d.link)">{{ d.linkLabel }}</button> }
          <button type="button" class="ico ico--sm" (click)="lastDone.set(null)" aria-label="Dismiss"><mat-icon>close</mat-icon></button></div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .sc { display: flex; flex-direction: column; gap: 14px; }
    .flow { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: 6px 0 0; font: 400 15px var(--font-sans); color: var(--content-muted); }
    .flow b { color: var(--content-fg); font-weight: 600; }
    .flow mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--surface-border); overflow-x: auto; }
    .tab { display: inline-flex; align-items: center; gap: 8px; padding: 12px 18px; border: 0; background: none; cursor: pointer; white-space: nowrap;
      font: 600 16px var(--font-sans); color: var(--content-muted); border-bottom: 3px solid transparent; margin-bottom: -1px; }
    .tab mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .tab--on { color: var(--brand-700); border-bottom-color: var(--brand-600); }
    .cnt { padding: 1px 9px; border-radius: 999px; background: var(--surface-muted, #eee); font-size: 13px; }
    .tab--on .cnt { background: var(--brand-50); color: var(--brand-700); }
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
    .f { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .f__l { font: 500 15px var(--font-sans); color: var(--content-muted); }
    .req { color: var(--danger); }
    .ro { font: 600 17px var(--font-sans); color: var(--content-fg); }
    .g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .acts { display: flex; justify-content: flex-end; gap: 10px; align-items: center; }
    .err { margin: 0; color: var(--danger); font: 500 15px var(--font-sans); }
    .muted { margin: 0; color: var(--content-muted); font: 400 16px var(--font-sans); }
    .empty { padding: 24px 0; text-align: center; }
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
  private readonly masters = inject(MasterDataService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly branchId = inject(AuthService).user()?.branchId ?? null;

  protected readonly tabs: { id: ScanTab; label: string; icon: string }[] = [
    { id: 'out', label: 'Pending Outscan', icon: 'outbox' },
    { id: 'in', label: 'Pending Inscan', icon: 'move_to_inbox' },
    { id: 'del', label: 'Pending Delivery', icon: 'local_shipping' }
  ];
  protected readonly reasons = UNDELIVERED_REASONS;
  protected readonly destinationOf = destinationOf;
  protected readonly bookedAtOf = bookedAt;

  protected readonly tab = signal<ScanTab>('out');
  protected readonly lists = signal<Record<ScanTab, Shipment[]>>({ out: [], in: [], del: [] });
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
  protected readonly vehicleId = signal('');
  protected readonly driverId = signal('');
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
  protected readonly outDestinationError = computed(() => {
    const rows = this.selectedRows();
    if (!rows.length) return null;
    if (rows.some((s) => !destinationOf(s))) return 'Some selected parcels have no route yet (no next branch). Send those from Loading Sheet (hub).';
    return this.outDestination() ? null : 'Select parcels going to one branch: one outscan is one trip to one branch.';
  });

  constructor() {
    inject(BreadcrumbService).set([{ label: 'Operations' }, { label: 'Scan' }]);
    this.masters.branchDirectory().subscribe((list) =>
      this.branchNames.set(new Map(list.map((b) => [b.id, `${b.branchName} (${b.branchCode})`]))));
    this.vehicleService.list(true).subscribe({ next: (v) => this.vehicles.set(v.map((x) => ({ value: x.id, label: x.vehicleNumber }))), error: () => undefined });
    this.movement.userOptions().subscribe({ next: (u) => this.users.set(u.map((x) => ({ value: x.id, label: x.label }))), error: () => undefined });
    this.reload();
    setTimeout(() => document.getElementById('sc-scan')?.focus());
  }

  protected countOf(t: ScanTab): number { return this.lists()[t].length; }
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
        map((p) => p.content), catchError(() => of([] as Manifest[])))
    }).subscribe(({ out, inNext, inDest, delDest, delHere, thc }) => {
      this.thcNumbers.set(new Map(thc.map((m) => [m.id, m.manifestNumber])));
      const newestFirst = (a: Shipment, b: Shipment) => (bookedAt(b) ?? '').localeCompare(bookedAt(a) ?? '');
      this.lists.set({
        out: out.sort(newestFirst),
        in: merge(inNext, inDest).sort(newestFirst),
        del: merge(delDest, delHere).sort(newestFirst)
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

  /** Outscan: a loading sheet to the parcels' branch, then the trip dispatched with the vehicle and driver. */
  protected outscan(): void {
    const dest = this.outDestination();
    const rows = this.selectedRows();
    if (this.outDestinationError() || !dest) return;
    if (!this.vehicleId() || !this.driverId()) { this.actionError.set('Select the vehicle and the driver.'); return; }
    const note = [this.bags() ? `Bags: ${this.bags()}` : '', this.remarks().trim()].filter(Boolean).join(' · ') || null;
    this.busy.set(true);
    this.actionError.set(null);
    let sheet: Manifest | null = null;
    this.manifests.create({ bookingBranchId: this.branchId!, deliveryBranchId: dest, deliveryMode: 'BRANCH_DELIVERY', destinationCity: null,
      shipmentIds: rows.map((s) => s.id), remarks: note }).pipe(
      switchMap((m) => { sheet = m; return this.movement.dispatch({ manifestId: m.id, vehicleId: this.vehicleId(), driverUserId: this.driverId(),
        departureTime: null, fuelCost: null, driverAdvance: null, tollAmount: null, otherAmount: null }); })
    ).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.lastDone.set({ text: `${rows.length} parcel(s) outscanned to ${this.branchName(dest)} — loading sheet ${r.manifestNumber} dispatched.`,
          link: '/movement/trip-hire-challan', linkLabel: 'Print THC' });
        this.afterAction();
      },
      error: (e: HttpErrorResponse) => {
        this.busy.set(false);
        const why = e.error?.message ?? 'The server refused it.';
        const made = sheet as Manifest | null;
        this.actionError.set(made
          ? `Loading sheet ${made.manifestNumber} was created but the trip was not dispatched: ${why} Dispatch it from Trip Hire Challan.`
          : `Could not outscan: ${why}`);
        if (made) this.afterAction(false);
      }
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
