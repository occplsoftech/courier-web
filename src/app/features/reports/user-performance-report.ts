import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { AppRole } from '@core/models/role.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiDrawer } from '@shared/components/ui-drawer/ui-drawer';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { downloadCsv } from '@shared/utils/csv-export.util';
import { MasterDataService } from '@features/masters/master-data.service';
import {
  Attribution, CashHandover, PerformanceDetailRow, PerformanceMetric, PerformanceQuery, UserPerformanceResult,
  UserPerformanceRow, UserPerformanceService
} from './user-performance.service';
import { CashHandoverDialog, CashHandoverDialogData } from './cash-handover-dialog';

const METRIC_TITLES: Record<PerformanceMetric, string> = {
  BOOKINGS: 'Bookings', COUNTER: 'Counter payments', DELIVERIES: 'Deliveries', WALLET: 'Wallet entries',
  HANDOVERS: 'Cash handovers'
};

/** Today in India, as yyyy-MM-dd — the backend cuts days at midnight IST. */
export function todayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now);
}

/**
 * User Performance Report (`reports/user-performance`). Per user of a branch: bookings, counter cash, deliveries,
 * cash collected on delivery, branch-wallet debits under their name, cash handed over and still outstanding — with a
 * drill-down behind every figure and a Cash Handovers tab. Scope is the backend's: a company admin / finance user picks
 * a branch, managers see their branch's users, everyone else sees only their own row ("My Performance").
 */
@Component({
  selector: 'app-user-performance-report',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatIconModule, UiButton, UiDrawer],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">{{ teamView() ? 'User Performance' : 'My Performance' }}</h1>
          <p class="text-caption">
            {{ teamView() ? 'Bookings, deliveries, cash and wallet debits per user of the branch.' : 'What you booked, delivered and collected.' }}
            @if (report()?.trackingFrom; as tf) { Outstanding cash counted from {{ tf | date: 'd MMM y' }}. }
          </p>
        </div>
        <div class="page__actions">
          @if (companyWide) {
            <label class="dfld">Branch
              <select aria-label="Branch" [value]="branchId() ?? ''" (change)="onBranch($event)">
                @if (!branchId()) { <option value="">Select a branch</option> }
                @for (b of branchOptions(); track b.value) { <option [value]="b.value">{{ b.label }}</option> }
              </select>
            </label>
          }
          <label class="dfld">From <input type="date" aria-label="From" [value]="from()" [max]="to()" (change)="onFrom($event)" /></label>
          <label class="dfld">To <input type="date" aria-label="To" [value]="to()" [min]="from()" (change)="onTo($event)" /></label>
          @if (teamView()) {
            <label class="dfld" title="Work done: a debit counts for the user whose booking or delivery caused it. Entered by: whoever was signed in.">Debits by
              <select aria-label="Debits by" [value]="attribution()" (change)="onAttribution($event)">
                <option value="WORK">Work done</option>
                <option value="ENTERED_BY">Entered by</option>
              </select>
            </label>
          }
          @if (report()) {
            <app-button icon="payments" (pressed)="handOver()">Hand over cash</app-button>
          }
          <app-button variant="stroked" icon="download" [disabled]="!report()" (pressed)="exportCsv()">Export</app-button>
        </div>
      </header>

      @if (report()) {
        <nav class="tabs" role="tablist">
          <button role="tab" [class.on]="tab() === 'performance'" [attr.aria-selected]="tab() === 'performance'"
                  (click)="tab.set('performance')">Performance</button>
          <button role="tab" [class.on]="tab() === 'handovers'" [attr.aria-selected]="tab() === 'handovers'"
                  (click)="openHandovers()">Cash handovers
            @if (pending().length) { <span class="count" aria-label="pending handovers">{{ pending().length }}</span> }</button>
        </nav>
      }

      @if (companyWide && !branchId()) {
        <p class="empty">Choose a branch to see its users.</p>
      } @else if (tab() === 'performance') {
        <div class="stats">
          <div class="stat"><span class="stat__l">Booked</span><span class="stat__v">{{ dash(total()?.booked) }}</span></div>
          <div class="stat"><span class="stat__l">Delivered</span>
            <span class="stat__v">{{ dash(total()?.delivered) }}
              @if (total()?.successRate != null) { <small>{{ total()!.successRate }}%</small> }</span></div>
          <div class="stat"><span class="stat__l">Cash collected</span><span class="stat__v">{{ money(total()?.cashCollected) }}</span></div>
          <div class="stat"><span class="stat__l">Handed over</span><span class="stat__v">{{ money(total()?.handedOver) }}</span></div>
          <div class="stat stat--warn"><span class="stat__l">Outstanding</span><span class="stat__v">{{ money(total()?.closingOutstanding) }}</span></div>
          <div class="stat"><span class="stat__l">Wallet debit</span><span class="stat__v">{{ money(total()?.walletDebit) }}</span></div>
        </div>

        <div class="tbl app-scroll">
          <table aria-label="User performance">
            <thead>
              <tr class="grp">
                <th rowspan="2" class="sticky">User</th>
                <th colspan="4">Booking</th>
                <th colspan="2">Counter</th>
                <th colspan="4">Delivery</th>
                <th colspan="3">Branch wallet</th>
                <th colspan="5">Cash in hand</th>
              </tr>
              <tr>
                <th>Booked</th><th>Cancelled</th><th>Value</th><th>Paid / To-Pay / COD / Credit</th>
                <th>Cash</th><th>UPI / online</th>
                <th>Delivered</th><th>Pending</th><th>Success</th><th>Collected</th>
                <th>Debit</th><th>Refund</th><th>Net</th>
                <th>Collected</th><th>Opening</th><th>Handed over</th><th>Awaiting approval</th><th>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              @if (loading()) {
                <tr><td [attr.colspan]="colspan()" class="muted center">Loading…</td></tr>
              } @else if (!rows().length) {
                <tr><td [attr.colspan]="colspan()" class="muted center">Nothing booked, delivered or collected on these days.</td></tr>
              }
              @for (r of rows(); track r.userId ?? 'system') {
                <tr [class.sys]="r.system">
                  <td class="sticky name">{{ r.userName }}</td>
                  <td class="num"><button class="lnk" [disabled]="!r.booked" (click)="drill(r, 'BOOKINGS')">{{ r.booked }}</button></td>
                  <td class="num">{{ r.cancelled || '—' }}</td>
                  <td class="num">{{ money(r.bookingValue) }}</td>
                  <td class="num muted">{{ r.paidCount }} / {{ r.toPayCount }} / {{ r.codCount }} / {{ r.creditCount }}</td>
                  <td class="num"><button class="lnk" [disabled]="!r.paidCount" (click)="drill(r, 'COUNTER')">{{ money(r.counterCash) }}</button></td>
                  <td class="num muted">{{ money(r.counterOnline) }}
                    @if (r.counterPending > 0) { <span class="pend" title="Razorpay QR not paid yet">+{{ money(r.counterPending) }} pending</span> }</td>
                  <td class="num"><button class="lnk" [disabled]="!r.delivered && !r.deliveryPending" (click)="drill(r, 'DELIVERIES')">{{ r.delivered }}</button></td>
                  <td class="num">{{ r.deliveryPending || '—' }}
                    @if (r.failedAttempts) { <span class="pend">{{ r.failedAttempts }} failed</span> }</td>
                  <td class="num">{{ r.successRate == null ? '—' : r.successRate + '%' }}</td>
                  <td class="num">{{ money(r.deliveryCash) }}</td>
                  <td class="num"><button class="lnk" [disabled]="!r.walletDebit && !r.walletRefund && !r.commission" (click)="drill(r, 'WALLET')">{{ money(r.walletDebit) }}</button></td>
                  <td class="num">{{ money(r.walletRefund) }}</td>
                  <td class="num strong">{{ money(r.walletNet) }}</td>
                  <td class="num strong">{{ money(r.cashCollected) }}</td>
                  <td class="num">{{ money(r.openingOutstanding) }}</td>
                  <td class="num"><button class="lnk" [disabled]="!r.handedOver && r.system" (click)="drill(r, 'HANDOVERS')">{{ money(r.handedOver) }}</button></td>
                  <td class="num" [class.wait]="r.awaitingApproval > 0">{{ money(r.awaitingApproval) }}</td>
                  <td class="num strong" [class.due]="r.closingOutstanding > 0">{{ money(r.closingOutstanding) }}</td>
                </tr>
              }
            </tbody>
            @if (teamView() && total() && rows().length) {
              <tfoot>
                <tr>
                  <td class="sticky name">Branch total</td>
                  <td class="num">{{ total()!.booked }}</td><td class="num">{{ total()!.cancelled }}</td>
                  <td class="num">{{ money(total()!.bookingValue) }}</td>
                  <td class="num muted">{{ total()!.paidCount }} / {{ total()!.toPayCount }} / {{ total()!.codCount }} / {{ total()!.creditCount }}</td>
                  <td class="num">{{ money(total()!.counterCash) }}</td><td class="num">{{ money(total()!.counterOnline) }}</td>
                  <td class="num">{{ total()!.delivered }}</td><td class="num">{{ total()!.deliveryPending }}</td>
                  <td class="num">{{ total()!.successRate == null ? '—' : total()!.successRate + '%' }}</td>
                  <td class="num">{{ money(total()!.deliveryCash) }}</td>
                  <td class="num">{{ money(total()!.walletDebit) }}</td><td class="num">{{ money(total()!.walletRefund) }}</td>
                  <td class="num">{{ money(total()!.walletNet) }}</td>
                  <td class="num">{{ money(total()!.cashCollected) }}</td><td class="num">{{ money(total()!.openingOutstanding) }}</td>
                  <td class="num">{{ money(total()!.handedOver) }}</td><td class="num">{{ money(total()!.awaitingApproval) }}</td>
                  <td class="num">{{ money(total()!.closingOutstanding) }}</td>
                </tr>
              </tfoot>
            }
          </table>
        </div>

        @if (report()?.reconciliation; as rc) {
          <section class="rec" aria-label="Branch wallet reconciliation">
            <h2 class="text-h3">Branch wallet on these days</h2>
            <div class="rec__grid">
              <span>Debits</span><strong>{{ money(rc.walletDebits) }}</strong>
              <span>Under users' names</span><strong>{{ money(rc.attributedDebits) }}</strong>
              <span>Not tied to a user (manual debits, penalties, transfers)</span>
              <strong><button class="lnk" [disabled]="!rc.unattributedDebits" (click)="drillUnattributed()">{{ money(rc.unattributedDebits) }}</button></strong>
              <span>Credits (recharges, refunds, commissions)</span><strong>{{ money(rc.walletCredits) }}</strong>
            </div>
            <p class="text-caption" [class.bad]="reconciles() === false">
              @if (reconciles()) { ✓ Every debit is accounted for. } @else { Debits do not add up — check the entries. }
            </p>
          </section>
        }
      } @else {
        <section class="sec" aria-label="Waiting for approval">
          <h2 class="text-h3">Waiting for approval</h2>
          <p class="text-caption">{{ report()?.canApproveHandover
            ? 'Check the proof and that the money reached you, then approve. Approved cash is taken off what that user still holds.'
            : 'Your handovers the branch manager or accounts desk has not checked yet.' }}</p>
          @if (!pending().length) { <p class="muted">Nothing is waiting.</p> }
          <div class="cards">
            @for (h of pending(); track h.id) {
              <article class="card" [attr.aria-label]="'Handover from ' + h.userName">
                <button class="card__proof" (click)="viewProof(h)" [attr.aria-label]="'View proof from ' + h.userName">
                  <img [src]="h.proofImageUrl" alt="Proof" loading="lazy" />
                </button>
                <div class="card__body">
                  <strong class="card__amt">{{ money(h.amount) }}</strong>
                  <span>{{ h.userName }} · {{ modeLabel(h.mode) }}</span>
                  <span class="muted">{{ h.handoverDate | date: 'd MMM y' }}@if (h.reference) { · Ref {{ h.reference }} }</span>
                  @if (h.remarks) { <span class="muted">{{ h.remarks }}</span> }
                  <span class="muted">Sent {{ h.submittedAt | date: 'd MMM, h:mm a' }}</span>
                  @if (report()?.canApproveHandover && h.userId !== selfId) {
                    <div class="card__acts">
                      <button class="act" (click)="approve(h)" [attr.aria-label]="'Approve handover from ' + h.userName">Approve</button>
                      <button class="act act--danger" (click)="reject(h)" [attr.aria-label]="'Reject handover from ' + h.userName">Reject</button>
                    </div>
                  }
                </div>
              </article>
            }
          </div>
        </section>

        <h2 class="text-h3 sec__h">Handovers on these days</h2>
        <div class="tbl app-scroll">
          <table aria-label="Cash handovers">
            <thead><tr><th>Date</th><th>User</th><th>Amount</th><th>Mode</th><th>Reference</th><th>Proof</th><th>Status</th><th>Checked by</th><th></th></tr></thead>
            <tbody>
              @if (handoversLoading()) { <tr><td colspan="9" class="muted center">Loading…</td></tr> }
              @else if (!handovers().length) { <tr><td colspan="9" class="muted center">No cash handed over on these days.</td></tr> }
              @for (h of handovers(); track h.id) {
                <tr [class.void]="h.status === 'VOIDED' || h.status === 'REJECTED'">
                  <td>{{ h.handoverDate | date: 'd MMM y' }}</td>
                  <td>{{ h.userName }}</td>
                  <td class="num strong">{{ money(h.amount) }}</td>
                  <td>{{ modeLabel(h.mode) }}</td>
                  <td>{{ h.reference || '—' }}@if (h.remarks) { <span class="muted"> · {{ h.remarks }}</span> }</td>
                  <td><button class="lnk" (click)="viewProof(h)">View</button></td>
                  <td><span [class]="'badge badge--' + h.status.toLowerCase()"
                            [title]="h.voidReason ?? h.decisionRemarks ?? ''">{{ statusLabel(h.status) }}</span>
                    @if (h.status === 'REJECTED' && h.decisionRemarks) { <span class="pend">{{ h.decisionRemarks }}</span> }</td>
                  <td>@if (h.decidedByName) { {{ h.decidedByName }}<span class="muted"> · {{ h.decidedAt | date: 'd MMM, h:mm a' }}</span> } @else { — }</td>
                  <td>@if (h.status === 'APPROVED' && canVoid(h)) {
                    <button class="act act--danger" (click)="voidHandover(h)" [attr.aria-label]="'Void handover from ' + h.userName">Void</button>
                  }</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <app-drawer [open]="!!drawer()" [title]="drawer()?.title ?? ''" [subtitle]="drawer()?.subtitle ?? ''" [width]="760"
                  (closed)="drawer.set(null)">
        @if (drawerLoading()) { <p class="muted">Loading…</p> }
        @else if (!detailRows().length) { <p class="muted">Nothing to show.</p> }
        @else {
          <table class="det" aria-label="Details">
            <thead><tr><th>Date</th><th>Reference</th><th>Type</th><th>Detail</th><th>Status</th><th class="num">Amount</th></tr></thead>
            <tbody>
              @for (d of detailRows(); track $index) {
                <tr><td>{{ (d.at ?? d.day) | date: 'd MMM, h:mm a' }}</td><td class="mono">{{ d.reference }}</td>
                  <td>{{ d.type }}</td><td>{{ d.detail }}</td><td>{{ d.status }}</td><td class="num">{{ money(d.amount) }}</td></tr>
              }
            </tbody>
          </table>
        }
        <div drawer-footer>
          <app-button variant="stroked" icon="download" [disabled]="!detailRows().length" (pressed)="exportDetails()">Export</app-button>
        </div>
      </app-drawer>
    </div>
  `,
  styles: [`
    .page__head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:12px; }
    .page__actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .dfld { display:flex; align-items:center; gap:6px; font:500 16px var(--font-sans); color:var(--content-fg); }
    .dfld input, .dfld select { height:38px; padding:0 10px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-field); font:400 16px var(--font-sans); color:var(--content-fg); }
    .tabs { display:flex; gap:4px; border-bottom:1px solid var(--surface-border); margin-bottom:14px; }
    .tabs button { border:0; background:transparent; padding:10px 14px; font:600 16px var(--font-sans); color:var(--content-muted);
      border-bottom:2px solid transparent; cursor:pointer; }
    .tabs button.on { color:var(--brand-600); border-bottom-color:var(--brand-600); }
    .empty { padding:32px; text-align:center; color:var(--content-muted); }
    .stats { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
    .stat { display:flex; flex-direction:column; gap:4px; padding:12px 18px; min-width:140px;
      background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .stat--warn .stat__v { color:var(--warning, #b45309); }
    .stat__l { font:500 15px var(--font-sans); color:var(--content-muted); }
    .stat__v { font:700 23px var(--font-sans); color:var(--content-fg); }
    .stat__v small { font:600 15px var(--font-sans); color:var(--content-muted); margin-left:6px; }
    .tbl { overflow:auto; background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    table { border-collapse:collapse; width:100%; font:400 15px var(--font-sans); color:var(--content-fg); }
    th, td { padding:9px 12px; border-bottom:1px solid var(--surface-border); white-space:nowrap; text-align:left; }
    thead th { font:600 14px var(--font-sans); color:var(--content-muted); background:var(--surface-sunken, var(--surface)); }
    tr.grp th { text-align:center; border-left:1px solid var(--surface-border); }
    tfoot td { font-weight:700; background:var(--surface-sunken, var(--surface)); }
    .sticky { position:sticky; left:0; background:var(--surface); z-index:1; }
    .name { font-weight:600; }
    tr.sys td { color:var(--content-muted); font-style:italic; }
    tr.void td { opacity:.55; text-decoration:line-through; }
    tr.void td:nth-last-child(-n+4) { text-decoration:none; }
    .wait { color:var(--brand-600); }
    .count { display:inline-block; min-width:20px; margin-left:6px; padding:0 6px; border-radius:999px; background:var(--danger);
      color:#fff; font:700 13px/20px var(--font-sans); text-align:center; }
    .sec { margin-bottom:18px; }
    .sec__h { margin:6px 0 10px; }
    .cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:12px; margin-top:10px; }
    .card { display:flex; gap:12px; padding:12px; background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .card__proof { flex:0 0 96px; height:96px; padding:0; border:1px solid var(--surface-border); border-radius:8px; overflow:hidden;
      background:var(--surface-sunken, var(--surface)); cursor:zoom-in; }
    .card__proof img { width:100%; height:100%; object-fit:cover; }
    .card__body { display:flex; flex-direction:column; gap:3px; font:400 15px var(--font-sans); min-width:0; }
    .card__amt { font:700 20px var(--font-sans); }
    .card__acts { display:flex; gap:8px; margin-top:6px; }
    .badge--pending { background:var(--brand-100); }
    .badge--approved { background:#dcfce7; color:#166534; }
    .badge--rejected, .badge--voided { background:transparent; border:1px solid var(--danger); color:var(--danger); }
    .num { text-align:right; font-variant-numeric:tabular-nums; }
    .strong { font-weight:700; }
    .due { color:var(--warning, #b45309); }
    .muted { color:var(--content-muted); }
    .center { text-align:center; padding:28px; }
    .pend { display:block; font-size:13px; color:var(--content-muted); }
    .lnk { border:0; background:transparent; padding:0; font:inherit; color:var(--brand-600); cursor:pointer; text-decoration:underline dotted; }
    .lnk:disabled { color:inherit; text-decoration:none; cursor:default; }
    .act { border:1px solid var(--brand-500); background:transparent; color:var(--brand-600); border-radius:6px; padding:4px 10px;
      font:600 14px var(--font-sans); cursor:pointer; }
    .act--danger { border-color:var(--danger); color:var(--danger); }
    .badge { font:600 13px var(--font-sans); padding:2px 8px; border-radius:999px; background:var(--brand-100); color:var(--brand-700, var(--brand-600)); }
    .rec { margin-top:16px; padding:16px 18px; background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); max-width:640px; }
    .rec__grid { display:grid; grid-template-columns:1fr auto; gap:6px 24px; margin:10px 0; font:400 15px var(--font-sans); }
    .rec__grid strong { text-align:right; font-variant-numeric:tabular-nums; }
    .bad { color:var(--danger); }
    .det { font-size:14px; }
    .det td { white-space:normal; }
    .mono { font-family:var(--font-mono, monospace); }
  `]
})
export class UserPerformanceReport implements OnInit {
  private readonly service = inject(UserPerformanceService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly dialogs = inject(DialogService);

  /** Company admin / finance user: pick any branch (mirrors backend FinanceBranchScope.companyWide). */
  protected readonly companyWide = this.auth.hasAnyRole([AppRole.COMPANY_ADMIN, AppRole.FINANCE_USER]);
  protected readonly selfId = this.auth.user()?.userId ?? null;
  protected readonly branchOptions = signal<SelectOption[]>([]);
  protected readonly branchId = signal<string | null>(this.auth.user()?.branchId ?? null);
  protected readonly from = signal(todayIst());
  protected readonly to = signal(todayIst());
  protected readonly attribution = signal<Attribution>('WORK');
  protected readonly tab = signal<'performance' | 'handovers'>('performance');

  protected readonly loading = signal(false);
  protected readonly report = signal<UserPerformanceResult | null>(null);
  protected readonly handovers = signal<CashHandover[]>([]);
  protected readonly handoversLoading = signal(false);
  protected readonly pending = signal<CashHandover[]>([]);

  protected readonly drawer = signal<{ title: string; subtitle: string; userId: string | null; metric: PerformanceMetric } | null>(null);
  protected readonly drawerLoading = signal(false);
  protected readonly detailRows = signal<PerformanceDetailRow[]>([]);

  protected readonly rows = computed(() => this.report()?.rows ?? []);
  protected readonly total = computed(() => this.report()?.total ?? null);
  protected readonly teamView = computed(() => this.report()?.teamView ?? false);
  protected readonly colspan = signal(19);
  protected readonly reconciles = computed(() => {
    const rc = this.report()?.reconciliation;
    if (!rc) return null;
    return Math.abs(rc.walletDebits - rc.attributedDebits - rc.unattributedDebits) < 0.005;
  });

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Reports' }, { label: 'User Performance' }]);
    if (this.companyWide) {
      this.masters.options('branches').subscribe((o) => this.branchOptions.set(o));
    }
    this.load();
  }

  private query(): PerformanceQuery {
    return { branchId: this.companyWide ? this.branchId() : null, from: this.from(), to: this.to(), attribution: this.attribution() };
  }

  load(): void {
    if (this.companyWide && !this.branchId()) { this.report.set(null); return; }
    this.loading.set(true);
    this.service.report(this.query()).subscribe({
      next: (r) => { this.report.set(r); this.loading.set(false); },
      error: (e) => { this.loading.set(false); this.notify.error(e?.error?.message ?? 'Could not load the report.'); }
    });
    this.loadPending();
    if (this.tab() === 'handovers') this.loadHandovers();
  }

  private loadPending(): void {
    this.service.pendingHandovers(this.companyWide ? this.branchId() : null).subscribe({
      next: (p) => this.pending.set(p),
      error: () => this.pending.set([])
    });
  }

  private loadHandovers(): void {
    this.handoversLoading.set(true);
    this.service.listHandovers(this.query()).subscribe({
      next: (h) => { this.handovers.set(h); this.handoversLoading.set(false); },
      error: (e) => { this.handoversLoading.set(false); this.notify.error(e?.error?.message ?? 'Could not load handovers.'); }
    });
  }

  openHandovers(): void { this.tab.set('handovers'); this.loadHandovers(); }

  onBranch(e: Event): void { this.branchId.set((e.target as HTMLSelectElement).value || null); this.load(); }
  onFrom(e: Event): void { const v = (e.target as HTMLInputElement).value; if (v) { this.from.set(v); if (this.to() < v) this.to.set(v); this.load(); } }
  onTo(e: Event): void { const v = (e.target as HTMLInputElement).value; if (v) { this.to.set(v); if (this.from() > v) this.from.set(v); this.load(); } }
  onAttribution(e: Event): void { this.attribution.set((e.target as HTMLSelectElement).value as Attribution); this.load(); }

  drill(r: UserPerformanceRow, metric: PerformanceMetric): void {
    this.openDrawer(METRIC_TITLES[metric], r.userName, r.userId, metric);
  }

  drillUnattributed(): void {
    this.openDrawer('Debits not tied to a user', 'Manual debits, penalties, transfers', null, 'WALLET');
  }

  private openDrawer(title: string, who: string, userId: string | null, metric: PerformanceMetric): void {
    this.drawer.set({ title, subtitle: `${who} · ${this.rangeLabel()}`, userId, metric });
    this.detailRows.set([]);
    this.drawerLoading.set(true);
    this.service.details(this.query(), userId, metric).subscribe({
      next: (rows) => { this.detailRows.set(rows); this.drawerLoading.set(false); },
      error: (e) => { this.drawerLoading.set(false); this.notify.error(e?.error?.message ?? 'Could not load the details.'); }
    });
  }

  /** The signed-in user hands over their own cash, with proof, for approval. */
  handOver(): void {
    const own = this.rows().find((r) => r.userId === this.selfId);
    const data: CashHandoverDialogData = {
      branchId: this.companyWide ? this.branchId() : null,
      outstanding: own ? Math.max(0, own.closingOutstanding - own.awaitingApproval) : 0,
      today: todayIst()
    };
    this.dialog.open(CashHandoverDialog, { data, autoFocus: false, panelClass: 'app-dialog' })
      .afterClosed().subscribe((saved) => { if (saved) this.load(); });
  }

  viewProof(h: CashHandover): void {
    this.dialogs.previewImage(h.proofImageUrl, `${h.userName} · ${this.money(h.amount)} · ${this.modeLabel(h.mode)}`);
  }

  approve(h: CashHandover): void {
    this.dialogs.confirm({
      title: 'Approve handover', confirmLabel: 'Approve',
      message: `Approve ${this.money(h.amount)} from ${h.userName}? Confirm you have checked the proof and received the money.`
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.approveHandover(h.id).subscribe({
        next: () => { this.notify.success('Handover approved.'); this.refreshHandovers(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not approve the handover.')
      });
    });
  }

  reject(h: CashHandover): void {
    this.dialogs.prompt({
      title: 'Reject handover', danger: true, confirmLabel: 'Reject', maxLength: 500, label: 'Reason',
      message: `Reject ${this.money(h.amount)} from ${h.userName}? They will see your reason and can send it again.`
    }).subscribe((reason) => {
      if (!reason) return;
      this.service.rejectHandover(h.id, reason).subscribe({
        next: () => { this.notify.success('Handover rejected.'); this.refreshHandovers(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not reject the handover.')
      });
    });
  }

  protected canVoid(h: CashHandover): boolean {
    return !!this.report()?.canApproveHandover
      && (h.decidedBy === this.selfId || this.auth.hasAnyRole([AppRole.COMPANY_ADMIN]));
  }

  voidHandover(h: CashHandover): void {
    this.dialogs.prompt({
      title: 'Void handover', danger: true, confirmLabel: 'Void', maxLength: 500, label: 'Reason',
      message: `Void ${this.money(h.amount)} from ${h.userName}? It counts as outstanding again.`
    }).subscribe((reason) => {
      if (!reason) return;
      this.service.voidHandover(h.id, reason).subscribe({
        next: () => { this.notify.success('Handover voided.'); this.refreshHandovers(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not void the handover.')
      });
    });
  }

  /** Report, pending list and (on this tab) the handover list — load() covers all three. */
  private refreshHandovers(): void { this.load(); }

  exportCsv(): void {
    const header = ['user', 'booked', 'cancelled', 'bookingValue', 'paid', 'toPay', 'cod', 'credit', 'counterCash',
      'counterOnline', 'counterPending', 'delivered', 'deliveryPending', 'failedAttempts', 'successRate', 'deliveryCash',
      'walletDebit', 'walletRefund', 'walletNet', 'commission', 'cashCollected', 'openingOutstanding', 'handedOver',
      'awaitingApproval', 'closingOutstanding'];
    const lines = this.rows().map((r) => [r.userName, r.booked, r.cancelled, r.bookingValue, r.paidCount, r.toPayCount,
      r.codCount, r.creditCount, r.counterCash, r.counterOnline, r.counterPending, r.delivered, r.deliveryPending,
      r.failedAttempts, r.successRate ?? '', r.deliveryCash, r.walletDebit, r.walletRefund, r.walletNet, r.commission,
      r.cashCollected, r.openingOutstanding, r.handedOver, r.awaitingApproval, r.closingOutstanding]);
    downloadCsv(`user-performance-${this.from()}-to-${this.to()}.csv`, header, lines,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
    this.notify.info(`Exported ${lines.length} user row(s).`);
  }

  exportDetails(): void {
    const d = this.drawer();
    if (!d) return;
    const lines = this.detailRows().map((r) => [r.day, r.at ?? '', r.reference, r.type, r.detail, r.status, r.amount]);
    downloadCsv(`${d.metric.toLowerCase()}-${d.subtitle.split(' · ')[0].replace(/\W+/g, '-')}-${this.from()}.csv`,
      ['day', 'at', 'reference', 'type', 'detail', 'status', 'amount'], lines, [6]);
  }

  protected statusLabel(st: string): string {
    return st === 'PENDING' ? 'Awaiting approval' : st === 'APPROVED' ? 'Approved' : st === 'REJECTED' ? 'Rejected' : 'Voided';
  }
  protected modeLabel(m: string): string { return m === 'BANK_DEPOSIT' ? 'Bank deposit' : m === 'UPI' ? 'UPI' : 'Cash'; }
  protected dash(v: number | null | undefined): string { return this.loading() || v == null ? '—' : String(v); }
  protected money(v: number | null | undefined): string {
    if (this.loading() || v == null) return '—';
    return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  private rangeLabel(): string { return this.from() === this.to() ? this.from() : `${this.from()} to ${this.to()}`; }
}
