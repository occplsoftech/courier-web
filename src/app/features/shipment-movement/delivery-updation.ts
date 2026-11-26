import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Observable, concatMap, from, map, of, switchMap, toArray, catchError } from 'rxjs';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { Page } from '@core/models/page.model';
import {
  DeliveryProof, DeliveryUpdationRow, DrsDetail, DrsShipmentRow, DrsSummary, UndeliveredReason
} from '@core/models/shipment.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { ShipmentMovementService } from './shipment-movement.service';

type Tab = 'pending' | 'drs' | 'delivered';
type Outcome = 'DELIVERED' | 'UNDELIVERED' | 'RTO';

const PROOFS: { value: DeliveryProof; label: string }[] = [
  { value: 'DROP', label: 'Drop' }, { value: 'SIGNATURE', label: 'Signature' }, { value: 'STAMP_AND_SIGN', label: 'Stamp and Sign' }
];
/** The previous software's undelivered "proof" list, each kept as a reason (and a note where two share one). */
const UNDELIVERED: { value: string; label: string; reason: UndeliveredReason; note?: string }[] = [
  { value: 'CUSTOMER_INSTRUCTION', label: 'As per instruction given by customer', reason: 'CUSTOMER_INSTRUCTION' },
  { value: 'CLOSED', label: 'Closed', reason: 'PREMISES_CLOSED' },
  { value: 'HOLD', label: 'Hold', reason: 'HOLD' },
  { value: 'MISROUTE', label: 'Missroute', reason: 'MISROUTE' },
  { value: 'NO_SERVICE', label: 'No Service', reason: 'NO_SERVICE' },
  { value: 'REFUSED', label: 'Refused', reason: 'REFUSED' },
  { value: 'SHIFTED', label: 'Shifted', reason: 'SHIFTED' },
  { value: 'SHORT_ADDRESS', label: 'Short Address', reason: 'ADDRESS_INCORRECT', note: 'Short address' },
  { value: 'WRONG_ADDRESS', label: 'Wrong Address', reason: 'ADDRESS_INCORRECT', note: 'Wrong address' },
  { value: 'NOT_AVAILABLE', label: 'Receiver not available', reason: 'RECEIVER_NOT_AVAILABLE' },
  { value: 'COD_NOT_READY', label: 'COD amount not ready', reason: 'COD_NOT_READY' },
  { value: 'OTHER', label: 'Other', reason: 'OTHER' }
];
const MAX_PHOTO = 2 * 1024 * 1024;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The update form, for one shipment (dialog) or one DRS row. */
interface UpdateForm {
  outcome: Outcome | '';
  deliveredOn: string;
  proof: string;
  receivedBy: string;
  relation: string;
  remarks: string;
}

/** One shipment of an open DRS, with its pending outcome. */
interface DrsLine extends UpdateForm { row: DrsShipmentRow; done: boolean; error: string | null; }

/**
 * Delivery Updation, as in the previous software: three tabs.
 *  - Pending for Delivery: shipments out for delivery; click one to record its outcome (delivered with proof, received
 *    by, relation, date and photo; undelivered with the reason; or return to office / RTO).
 *  - Update DRS: a delivery run's shipments at once, each with its outcome, one photo for the run.
 *  - Delivered: closed deliveries with how they were proved.
 */
@Component({
  selector: 'app-delivery-updation',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, FormsModule, MatIconModule, UiButton, UiPagination],
  template: `
    <div class="du">
      <header class="page__head">
        <div><h1 class="text-h1">Delivery Updation</h1>
          <p class="text-caption">Record what happened to each shipment out for delivery, one by one or a whole DRS at once.</p></div>
        <div class="page__actions"><app-button variant="stroked" icon="refresh" (pressed)="refresh()">Refresh</app-button></div>
      </header>

      <nav class="tabs" role="tablist">
        <button type="button" role="tab" class="tab" [class.tab--on]="tab() === 'pending'" (click)="setTab('pending')">
          <mat-icon>pending_actions</mat-icon>Pending for Delivery<span class="cnt">{{ pending()?.totalElements ?? '…' }}</span></button>
        <button type="button" role="tab" class="tab" [class.tab--on]="tab() === 'drs'" (click)="setTab('drs')">
          <mat-icon>assignment</mat-icon>Update DRS<span class="cnt">{{ drsList()?.length ?? '…' }}</span></button>
        <button type="button" role="tab" class="tab" [class.tab--on]="tab() === 'delivered'" (click)="setTab('delivered')">
          <mat-icon>task_alt</mat-icon>Delivered<span class="cnt">{{ delivered()?.totalElements ?? '…' }}</span></button>
      </nav>

      <section class="card">
        <div class="bar">
          <div class="search">
            <mat-icon>search</mat-icon>
            <input type="search" [placeholder]="tab() === 'drs' ? 'Search DRS number or delivery person…' : 'Search AWB, shipment, consignee or DRS…'"
                   [ngModel]="search()" (ngModelChange)="onSearch($event)" aria-label="Search deliveries" />
          </div>
        </div>

        @if (loading()) {
          <p class="muted center">Loading…</p>
        } @else if (tab() === 'pending') {
          @if (!pending()?.content?.length) {
            <p class="muted center">Nothing is out for delivery{{ search() ? ' for this search' : '' }}.</p>
          } @else {
            <div class="scroll">
              <table class="t">
                <thead><tr><th>Booking date</th><th>AWB</th><th>Package</th><th>Branch</th><th>To</th><th>Status</th>
                  <th>Delivery person</th><th>DRS</th><th>Forwarding no.</th><th>Out for delivery</th><th>Assigned by</th></tr></thead>
                <tbody>
                  @for (r of pending()!.content; track r.shipmentId) {
                    <tr (click)="open(r)" tabindex="0" (keydown.enter)="open(r)">
                      <td>{{ r.bookingDate | date: 'dd-MM-yyyy' }}</td>
                      <td class="awb">{{ r.trackingNumber }}</td>
                      <td>{{ r.packageType || '—' }}</td>
                      <td>{{ r.bookingBranch || '—' }}</td>
                      <td>{{ r.destination || '—' }}</td>
                      <td><span class="pill">Pending for delivery</span></td>
                      <td>{{ r.deliveryPerson || '—' }}</td>
                      <td>{{ r.drsNumber || '—' }}</td>
                      <td>{{ r.forwardingNumber || '—' }}</td>
                      <td>{{ r.outForDeliveryAt | date: 'dd-MM-yyyy HH:mm' }}</td>
                      <td>{{ r.assignedBy || '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (pending()!.totalPages > 1) { <app-pagination [page]="pending()!" (pageChange)="loadList($event)" /> }
          }
        } @else if (tab() === 'drs') {
          @if (!drsShown().length) {
            <p class="muted center">No DRS in the last 30 days{{ search() ? ' for this search' : '' }}.</p>
          } @else {
            <div class="scroll">
              <table class="t">
                <thead><tr><th>DRS</th><th>Date</th><th>Delivery person</th><th class="n">Shipments</th><th class="n">Delivered</th><th class="n">Pending</th><th></th></tr></thead>
                <tbody>
                  @for (d of drsShown(); track d.deliveryUserId + d.deliveryBranchId + d.runDate) {
                    <tr (click)="openDrs(d)">
                      <td class="awb">{{ d.drsNumber || '—' }}</td>
                      <td>{{ d.runDate | date: 'dd-MM-yyyy' }}</td>
                      <td>{{ personName(d.deliveryUserId) }}</td>
                      <td class="n">{{ d.shipmentCount }}</td>
                      <td class="n">{{ d.deliveredCount }}</td>
                      <td class="n">@if (d.pendingCount) { <span class="pill">{{ d.pendingCount }}</span> } @else { 0 }</td>
                      <td class="n"><button type="button" class="link" (click)="$event.stopPropagation(); openDrs(d)">{{ d.pendingCount ? 'Update' : 'View' }}</button></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        } @else {
          @if (!delivered()?.content?.length) {
            <p class="muted center">No deliveries recorded{{ search() ? ' for this search' : '' }}.</p>
          } @else {
            <div class="scroll">
              <table class="t">
                <thead><tr><th>Booking date</th><th>AWB</th><th>Package</th><th>Branch</th><th>Delivered</th><th>Proof</th>
                  <th>Received by</th><th>Relation</th><th>Remarks</th><th>Delivered by</th><th>Updated by</th><th>Photo</th></tr></thead>
                <tbody>
                  @for (r of delivered()!.content; track r.shipmentId) {
                    <tr class="ro">
                      <td>{{ r.bookingDate | date: 'dd-MM-yyyy' }}</td>
                      <td class="awb">{{ r.trackingNumber }}</td>
                      <td>{{ r.packageType || '—' }}</td>
                      <td>{{ r.bookingBranch || '—' }}</td>
                      <td>{{ r.deliveredAt | date: 'dd-MM-yyyy' }}</td>
                      <td>{{ r.proofLabel || '—' }}</td>
                      <td>{{ r.receivedBy || '—' }}</td>
                      <td>{{ r.relation || '—' }}</td>
                      <td class="wrap">{{ r.remarks || '—' }}</td>
                      <td>{{ r.deliveryPerson || '—' }}</td>
                      <td>{{ r.updatedBy || '—' }}</td>
                      <td>@if (r.photoUrl) { <button type="button" class="link" (click)="photo.set(r.photoUrl)">View photo</button> } @else { — }</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (delivered()!.totalPages > 1) { <app-pagination [page]="delivered()!" (pageChange)="loadList($event)" /> }
          }
        }
      </section>

      <!-- Update one shipment -->
      @if (current(); as r) {
        <div class="scrim" (click)="close()"></div>
        <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="du-title" (keydown.escape)="close()">
          <header class="dlg__head"><h2 id="du-title">Update delivery · {{ r.trackingNumber }}</h2>
            <button type="button" class="x" aria-label="Close" (click)="close()"><mat-icon>close</mat-icon></button></header>
          <div class="dlg__body">
            <p class="muted">{{ r.consignee }} · {{ r.destination }} · {{ r.deliveryPerson || 'no delivery person' }} · {{ r.drsNumber }}</p>
            <div class="grid">
              <label class="f">Status
                <select [(ngModel)]="form.outcome" (ngModelChange)="form.proof = ''">
                  <option value="">Select status</option>
                  <option value="DELIVERED">Delivered</option>
                  <option value="UNDELIVERED">Undelivered</option>
                  <option value="RTO">Return to Office (RTO)</option>
                </select></label>
              <label class="f">Delivered date
                <input type="date" [(ngModel)]="form.deliveredOn" [max]="maxDate" [disabled]="form.outcome !== 'DELIVERED'" /></label>
              @if (form.outcome === 'DELIVERED' || form.outcome === 'UNDELIVERED') {
                <label class="f">{{ form.outcome === 'DELIVERED' ? 'Proof' : 'Reason' }}
                  <select [(ngModel)]="form.proof">
                    <option value="">Select</option>
                    @for (p of (form.outcome === 'DELIVERED' ? proofs : undelivered); track p.value) { <option [value]="p.value">{{ p.label }}</option> }
                  </select></label>
              }
              @if (form.outcome === 'DELIVERED') {
                <label class="f">Received by <input [(ngModel)]="form.receivedBy" maxlength="150" placeholder="Name of the person" /></label>
                <label class="f">Relation <input [(ngModel)]="form.relation" maxlength="50" placeholder="Self, Security, Neighbour…" /></label>
              }
              <label class="f f--wide">Remarks <textarea [(ngModel)]="form.remarks" rows="3" maxlength="255"></textarea></label>
            </div>
            @if (form.outcome === 'DELIVERED') {
              <div class="photo">
                <input #ph type="file" accept="image/*" hidden (change)="pickPhoto(ph.files)" />
                <app-button variant="stroked" icon="photo_camera" (pressed)="ph.click()">{{ photoFile() ? 'Change photo' : 'Upload photo' }}</app-button>
                @if (photoFile(); as p) { <span class="muted">{{ p.name }}</span> }
              </div>
            }
            @if (dialogError()) { <p class="err" role="alert">{{ dialogError() }}</p> }
          </div>
          <footer class="dlg__foot">
            <app-button variant="stroked" (pressed)="close()">Cancel</app-button>
            <app-button icon="done" [loading]="saving()" (pressed)="saveOne()">Update</app-button>
          </footer>
        </div>
      }

      <!-- Update a DRS -->
      @if (drs(); as d) {
        <div class="scrim" (click)="closeDrs()"></div>
        <div class="dlg dlg--wide" role="dialog" aria-modal="true" aria-labelledby="drs-title" (keydown.escape)="closeDrs()">
          <header class="dlg__head"><h2 id="drs-title">Update DRS {{ d.drsNumber || '' }} · {{ d.runDate | date: 'dd-MM-yyyy' }} · {{ personName(d.deliveryUserId) }}</h2>
            <button type="button" class="x" aria-label="Close" (click)="closeDrs()"><mat-icon>close</mat-icon></button></header>
          <div class="dlg__body">
            <div class="scroll">
              <table class="t t--form">
                <thead><tr><th>AWB</th><th>Consignee</th><th>Status</th><th>Proof / reason</th><th>Received by</th><th>Remarks</th></tr></thead>
                <tbody>
                  @for (l of drsLines(); track l.row.shipmentId) {
                    <tr class="ro">
                      <td class="awb">{{ l.row.trackingNumber }}</td>
                      <td>{{ l.row.receiverName }}</td>
                      @if (l.row.status !== 'OUT_FOR_DELIVERY' || l.done) {
                        <td colspan="4" class="muted">{{ l.done ? 'Updated' : statusText(l.row.status) }}</td>
                      } @else {
                        <td><select [(ngModel)]="l.outcome" (ngModelChange)="l.proof = ''" [attr.aria-label]="'Status of ' + l.row.trackingNumber">
                          <option value="">—</option><option value="DELIVERED">Delivered</option><option value="UNDELIVERED">Undelivered</option><option value="RTO">RTO</option>
                        </select></td>
                        <td>@if (l.outcome === 'DELIVERED' || l.outcome === 'UNDELIVERED') {
                          <select [(ngModel)]="l.proof" [attr.aria-label]="'Proof of ' + l.row.trackingNumber"><option value="">Select</option>
                            @for (p of (l.outcome === 'DELIVERED' ? proofs : undelivered); track p.value) { <option [value]="p.value">{{ p.label }}</option> }
                          </select> }</td>
                        <td>@if (l.outcome === 'DELIVERED') { <input [(ngModel)]="l.receivedBy" maxlength="150" [attr.aria-label]="'Received by for ' + l.row.trackingNumber" /> }</td>
                        <td><input [(ngModel)]="l.remarks" maxlength="255" placeholder="Remarks" [attr.aria-label]="'Remarks for ' + l.row.trackingNumber" /></td>
                      }
                    </tr>
                    @if (l.error) { <tr class="ro"><td></td><td colspan="5" class="err">{{ l.error }}</td></tr> }
                  }
                </tbody>
              </table>
            </div>
            <div class="photo">
              <label class="f f--date">Delivered date <input type="date" [(ngModel)]="drsDate" [max]="maxDate" /></label>
              <input #dph type="file" accept="image/*" hidden (change)="pickPhoto(dph.files)" />
              <app-button variant="stroked" icon="photo_camera" (pressed)="dph.click()">{{ photoFile() ? 'Change photo' : 'Upload photo for the DRS' }}</app-button>
              @if (photoFile(); as p) { <span class="muted">{{ p.name }}</span> }
            </div>
            @if (dialogError()) { <p class="err" role="alert">{{ dialogError() }}</p> }
          </div>
          <footer class="dlg__foot">
            <app-button variant="stroked" (pressed)="closeDrs()">Close</app-button>
            <app-button icon="done_all" [loading]="saving()" [disabled]="!drsChosen()" (pressed)="saveDrs()">Update {{ drsChosen() || '' }}</app-button>
          </footer>
        </div>
      }

      @if (photo(); as url) {
        <div class="scrim" (click)="photo.set(null)"></div>
        <div class="dlg" role="dialog" aria-modal="true" aria-label="Delivery photo" (keydown.escape)="photo.set(null)">
          <header class="dlg__head"><h2>Delivery photo</h2>
            <button type="button" class="x" aria-label="Close" (click)="photo.set(null)"><mat-icon>close</mat-icon></button></header>
          <div class="dlg__body"><img [src]="url" alt="Proof of delivery photo" class="pod" /></div>
        </div>
      }
    </div>
  `,
  styles: [`
    .du { display:flex; flex-direction:column; gap:16px; }
    .tabs { display:flex; gap:4px; border-bottom:1px solid var(--surface-border); overflow-x:auto; }
    .tab { display:inline-flex; align-items:center; gap:8px; padding:12px 18px; border:0; background:none; cursor:pointer; white-space:nowrap;
      font:600 16px var(--font-sans); color:var(--content-muted); border-bottom:3px solid transparent; margin-bottom:-1px; }
    .tab mat-icon { font-size:20px; width:20px; height:20px; }
    .tab--on { color:var(--brand-700); border-bottom-color:var(--brand-600); }
    .cnt { min-width:24px; padding:2px 8px; border-radius:999px; background:var(--surface-muted); font:600 13px var(--font-sans); text-align:center; }
    .tab--on .cnt { background:var(--brand-50); color:var(--brand-700); }
    .card { background:var(--surface); border:1px solid var(--surface-border); border-radius:14px; padding:18px; display:flex; flex-direction:column; gap:12px; min-width:0; }
    .bar { display:flex; gap:12px; flex-wrap:wrap; }
    .search { display:flex; align-items:center; gap:8px; flex:1; max-width:520px; padding:0 12px; height:44px; border:1px solid var(--surface-border); border-radius:10px; background:var(--surface); }
    .search mat-icon { color:var(--content-muted); }
    .search input { flex:1; border:0; outline:0; background:transparent; font:400 16px var(--font-sans); color:var(--content-fg); }
    .scroll { overflow-x:auto; }
    .t { width:100%; border-collapse:collapse; font:400 16px var(--font-sans); }
    .t th { text-align:left; padding:8px 10px; font:600 13px var(--font-sans); color:var(--content-muted); text-transform:uppercase; letter-spacing:.04em;
      border-bottom:1px solid var(--surface-border); white-space:nowrap; }
    .t td { padding:10px; border-bottom:1px solid var(--surface-border); white-space:nowrap; }
    .t td.wrap { white-space:normal; min-width:160px; }
    .t tbody tr { cursor:pointer; }
    .t tbody tr.ro { cursor:default; }
    .t tbody tr:hover { background:var(--surface-muted, #fafafa); }
    .t .n { text-align:right; }
    .t--form select, .t--form input { height:36px; padding:0 8px; border:1px solid var(--surface-border); border-radius:8px; background:var(--surface); color:var(--content-fg); font:400 15px var(--font-sans); min-width:120px; }
    .awb { font-weight:600; font-variant-numeric:tabular-nums; }
    .pill { display:inline-block; padding:2px 10px; border-radius:999px; background:var(--warning-bg); color:var(--warning); font:600 13px var(--font-sans); }
    .link { border:0; background:none; color:var(--brand-700); font:600 15px var(--font-sans); cursor:pointer; padding:0; }
    .muted { color:var(--content-muted); }
    .center { text-align:center; padding:24px 0; margin:0; }
    .scrim { position:fixed; inset:0; background:rgb(0 0 0 / 35%); z-index:1000; }
    .dlg { position:fixed; z-index:1001; top:50%; left:50%; transform:translate(-50%, -50%); width:min(620px, calc(100vw - 32px)); max-height:calc(100vh - 48px);
      display:flex; flex-direction:column; background:var(--surface); border-radius:16px; box-shadow:0 20px 60px rgb(0 0 0 / 25%); }
    .dlg--wide { width:min(1040px, calc(100vw - 32px)); }
    .dlg__head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:18px 20px; border-bottom:1px solid var(--surface-border); }
    .dlg__head h2 { margin:0; font:600 19px var(--font-sans); }
    .x { border:0; background:none; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .dlg__body { padding:16px 20px; overflow:auto; display:flex; flex-direction:column; gap:14px; }
    .dlg__foot { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid var(--surface-border); }
    .grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:14px 16px; }
    .f { display:flex; flex-direction:column; gap:6px; font:600 14px var(--font-sans); color:var(--content-muted); }
    .f--wide { grid-column:1 / -1; }
    .f input, .f select, .f textarea { min-height:42px; padding:8px 10px; border:1px solid var(--surface-border); border-radius:10px; background:var(--surface);
      color:var(--content-fg); font:400 16px var(--font-sans); box-sizing:border-box; }
    .f--date { flex-direction:row; align-items:center; gap:10px; }
    .photo { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
    .err { margin:0; color:var(--danger); font:500 15px var(--font-sans); white-space:normal; }
    .pod { max-width:100%; border-radius:10px; }
    @media (max-width:640px){ .grid { grid-template-columns:1fr; } }
  `]
})
export class DeliveryUpdation implements OnInit {
  private readonly movement = inject(ShipmentMovementService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);

  protected readonly proofs = PROOFS;
  protected readonly undelivered = UNDELIVERED;
  protected readonly maxDate = today();

  protected readonly tab = signal<Tab>('pending');
  protected readonly search = signal('');
  protected readonly loading = signal(false);
  protected readonly pending = signal<Page<DeliveryUpdationRow> | null>(null);
  protected readonly delivered = signal<Page<DeliveryUpdationRow> | null>(null);
  protected readonly drsList = signal<DrsSummary[] | null>(null);
  protected readonly people = signal<Map<string, string>>(new Map());
  protected readonly current = signal<DeliveryUpdationRow | null>(null);
  protected readonly drs = signal<DrsDetail | null>(null);
  protected readonly drsLines = signal<DrsLine[]>([]);
  protected readonly photoFile = signal<File | null>(null);
  protected readonly photo = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly dialogError = signal<string | null>(null);
  protected form: UpdateForm = this.blank();
  protected drsDate = today();
  private listPage = 0;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly drsShown = computed(() => {
    const q = this.search().trim().toLowerCase();
    const list = this.drsList() ?? [];
    return q ? list.filter((d) => (d.drsNumber ?? '').toLowerCase().includes(q) || this.personName(d.deliveryUserId).toLowerCase().includes(q)) : list;
  });

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Operations' }, { label: 'Delivery Updation' }]);
    this.movement.userOptions().subscribe({ next: (u) => this.people.set(new Map(u.map((x) => [x.id, x.label]))), error: () => undefined });
    this.loadList(0);
    this.loadCounts();
  }

  protected setTab(t: Tab): void {
    if (this.tab() === t) return;
    this.tab.set(t);
    this.search.set('');
    this.loadList(0);
  }

  protected onSearch(v: string): void {
    this.search.set(v);
    if (this.tab() === 'drs') return; // filtered on the page
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadList(0), 300);
  }

  protected refresh(): void {
    this.loadList(this.listPage);
    this.loadCounts();
  }

  /** Each tab's count, so the tab bar shows them all from the start. */
  private loadCounts(): void {
    this.movement.deliveryUpdation('PENDING', '', 0, 1).subscribe({ next: (p) => { if (this.tab() !== 'pending') this.pending.set(p); }, error: () => undefined });
    this.movement.deliveryUpdation('DELIVERED', '', 0, 1).subscribe({ next: (p) => { if (this.tab() !== 'delivered') this.delivered.set(p); }, error: () => undefined });
    this.movement.listDrs().subscribe({ next: (d) => this.drsList.set(d), error: () => this.drsList.set([]) });
  }

  protected loadList(page: number): void {
    this.listPage = page;
    const t = this.tab();
    this.loading.set(true);
    if (t === 'drs') {
      this.movement.listDrs().subscribe({
        next: (d) => { this.drsList.set(d); this.loading.set(false); },
        error: () => { this.drsList.set([]); this.loading.set(false); }
      });
      return;
    }
    this.movement.deliveryUpdation(t === 'pending' ? 'PENDING' : 'DELIVERED', this.search(), page).subscribe({
      next: (p) => { (t === 'pending' ? this.pending : this.delivered).set(p); this.loading.set(false); },
      error: (e: HttpErrorResponse) => { this.loading.set(false); this.notify.error(e.error?.message ?? 'Deliveries could not be loaded.'); }
    });
  }

  protected personName(id: string | null): string { return (id && this.people().get(id)) || '—'; }

  protected statusText(s: string | null): string {
    return s === 'DELIVERED' ? 'Delivered' : s ? s.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) : '—';
  }

  // ------------------------------------------------------------------ one shipment

  private blank(): UpdateForm {
    return { outcome: '', deliveredOn: today(), proof: '', receivedBy: '', relation: '', remarks: '' };
  }

  protected open(r: DeliveryUpdationRow): void {
    this.form = this.blank();
    this.photoFile.set(null);
    this.dialogError.set(null);
    this.current.set(r);
  }

  protected close(): void { this.current.set(null); this.photoFile.set(null); }

  protected pickPhoto(files: FileList | null): void {
    const f = files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { this.notify.error('Choose an image file.'); return; }
    if (f.size > MAX_PHOTO) { this.notify.error('The photo is larger than 2 MB. Choose a smaller one.'); return; }
    this.photoFile.set(f);
  }

  protected saveOne(): void {
    const r = this.current();
    if (!r) return;
    const problem = this.check(this.form);
    if (problem) { this.dialogError.set(problem); return; }
    this.saving.set(true);
    this.dialogError.set(null);
    this.apply(r.shipmentId, this.form, this.photoFile()).subscribe({
      next: () => {
        this.saving.set(false);
        this.notify.success(`${r.trackingNumber} updated.`);
        this.close();
        this.refresh();
      },
      error: (e: HttpErrorResponse) => { this.saving.set(false); this.dialogError.set(e.error?.message ?? 'The delivery could not be updated.'); }
    });
  }

  /** What is missing before an update can be saved, or null. */
  private check(f: UpdateForm): string | null {
    if (!f.outcome) return 'Choose the status.';
    if (f.outcome === 'DELIVERED') {
      if (!f.proof) return 'Choose the proof of delivery.';
      if (!f.receivedBy.trim()) return 'Enter who received it.';
      if (f.deliveredOn && f.deliveredOn > today()) return 'The delivered date cannot be in the future.';
    }
    if (f.outcome === 'UNDELIVERED' && !f.proof) return 'Choose why it was not delivered.';
    return null;
  }

  /** Saves one outcome: delivered (photo first when there is one), undelivered, or return to office. */
  private apply(shipmentId: string, f: UpdateForm, photo: File | null, photoUrl?: string | null): Observable<unknown> {
    const remarks = f.remarks.trim() || null;
    if (f.outcome === 'DELIVERED') {
      const url$: Observable<string | null> = photoUrl !== undefined ? of(photoUrl)
        : photo ? this.movement.uploadPodFile(shipmentId, photo, 'PHOTO').pipe(map((u) => u.url)) : of(null);
      return url$.pipe(switchMap((url) => this.movement.deliver({
        shipmentId, receiverName: f.receivedBy.trim(), remarks, photoUrl: url,
        receiverRelation: f.relation.trim() || null, proofType: f.proof as DeliveryProof,
        deliveredOn: f.deliveredOn && f.deliveredOn !== today() ? f.deliveredOn : null
      })));
    }
    if (f.outcome === 'UNDELIVERED') {
      const pick = UNDELIVERED.find((u) => u.value === f.proof)!;
      const note = [pick.note, remarks].filter(Boolean).join(' · ') || null;
      return this.movement.markUndelivered(shipmentId, pick.reason, note);
    }
    return this.movement.returnToSender(shipmentId, remarks ? `Return to office (RTO): ${remarks}` : 'Return to office (RTO)');
  }

  // ------------------------------------------------------------------ a whole DRS

  protected openDrs(d: DrsSummary): void {
    this.dialogError.set(null);
    this.photoFile.set(null);
    this.drsDate = today();
    this.movement.drsDetail(d.deliveryUserId, d.deliveryBranchId, d.runDate).subscribe({
      next: (detail) => {
        this.drsLines.set(detail.shipments.map((row) => ({ row, done: false, error: null, outcome: '', deliveredOn: today(),
          proof: '', receivedBy: row.receiverName ?? '', relation: '', remarks: '' })));
        this.drs.set(detail);
      },
      error: (e: HttpErrorResponse) => this.notify.error(e.error?.message ?? 'The DRS could not be opened.')
    });
  }

  protected closeDrs(): void { this.drs.set(null); this.drsLines.set([]); this.photoFile.set(null); }

  protected drsChosen(): number {
    return this.drsLines().filter((l) => !l.done && l.row.status === 'OUT_FOR_DELIVERY' && !!l.outcome).length;
  }

  /** Saves every chosen outcome in turn; one photo (uploaded once) goes with every delivered shipment. */
  protected saveDrs(): void {
    const lines = this.drsLines().filter((l) => !l.done && l.row.status === 'OUT_FOR_DELIVERY' && !!l.outcome);
    for (const l of lines) {
      l.deliveredOn = this.drsDate;
      l.error = this.check(l);
    }
    if (lines.some((l) => l.error)) { this.drsLines.set([...this.drsLines()]); this.dialogError.set('Fix the rows marked in red.'); return; }
    this.saving.set(true);
    this.dialogError.set(null);
    const firstDelivered = lines.find((l) => l.outcome === 'DELIVERED');
    const photo = this.photoFile();
    const url$: Observable<string | null> = photo && firstDelivered
      ? this.movement.uploadPodFile(firstDelivered.row.shipmentId, photo, 'PHOTO').pipe(map((u) => u.url)) : of(null);
    url$.pipe(
      switchMap((url) => from(lines).pipe(
        concatMap((l) => this.apply(l.row.shipmentId, l, null, url).pipe(
          map(() => { l.done = true; l.error = null; return true; }),
          catchError((e: HttpErrorResponse) => { l.error = e.error?.message ?? 'Not updated.'; return of(false); }))),
        toArray()))
    ).subscribe({
      next: (results) => {
        this.saving.set(false);
        this.drsLines.set([...this.drsLines()]);
        const ok = results.filter(Boolean).length;
        if (ok) this.notify.success(`${ok} shipment(s) updated.`);
        if (ok < results.length) this.dialogError.set(`${results.length - ok} could not be updated; see the rows in red.`);
        this.refresh();
      },
      error: (e: HttpErrorResponse) => { this.saving.set(false); this.dialogError.set(e.error?.message ?? 'The photo could not be uploaded.'); }
    });
  }
}
