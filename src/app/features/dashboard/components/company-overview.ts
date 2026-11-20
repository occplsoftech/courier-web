import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { CompanyOverview as CompanyOverviewData } from '../models/dashboard.model';

interface ActionItem {
  key: string;
  label: string;
  count: number;
  icon: string;
  tone: 'brand' | 'warning' | 'danger' | 'info';
  actionLabel: string;
  route: string;
}

const money = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/**
 * Company-wide operational overview for a COMPANY_ADMIN: the shipment pipeline, the
 * action-required backlog (each item routes to the real page that clears it), wallet
 * total across every branch, and Top Routes / Top Customers this month. Every figure
 * comes from `DashboardSummaryResponse.companyOverview` — no client-side computation.
 */
@Component({
  selector: 'app-company-overview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, RouterLink, UiCard, UiLoader],
  template: `
    @if (loading()) {
      <app-card title="Company Overview">
        <app-loader [minHeight]="220" />
      </app-card>
    } @else if (!data()) {
      <app-card title="Company Overview">
        <div class="co-empty">
          <mat-icon>bar_chart</mat-icon>
          <p class="text-caption">No company-wide data yet</p>
        </div>
      </app-card>
    } @else {
      <!-- Left column: pipeline + wallet stacked, together roughly matching Action
           Required's height — kept out of the plain auto-fit grid because a 3-up grid
           packs unequal-height cards into equal-height rows, leaving dead space under
           the two short cards. -->
      <div class="co-col">
        <app-card tone="brand" title="Shipment Pipeline" subtitle="This month, stage by stage">
          <div class="co-pipeline">
            @for (stage of data()!.pipeline; track stage.stage; let last = $last) {
              <a class="co-pipeline__stage" [routerLink]="['/shipments']">
                <span class="co-pipeline__badge" [attr.data-tone]="stageTone(stage.stage)">{{ stage.count }}</span>
                <span class="co-pipeline__label">{{ stageLabel(stage.stage) }}</span>
              </a>
              @if (!last) { <span class="co-pipeline__connector" [attr.data-tone]="stageTone(stage.stage)"></span> }
            }
          </div>
        </app-card>

        <app-card tone="success" title="Wallet — All Branches" subtitle="Spendable balance, company-wide">
          <div class="co-wallet">
            <span class="co-wallet__icon"><mat-icon>account_balance_wallet</mat-icon></span>
            <div class="co-wallet__figure">
              <p class="co-wallet__value">₹{{ money(data()!.totalWalletBalance) }}</p>
              <p class="text-caption">Total available balance</p>
            </div>
          </div>
          @if (data()!.lowBalanceBranches > 0) {
            <div class="co-wallet__warn">
              <mat-icon>warning</mat-icon>
              <span>{{ data()!.lowBalanceBranches }} branch(es) below recommended balance</span>
            </div>
          }
          <a card-actions routerLink="/finance/branch-wallet" class="co-link">Recharge <mat-icon>chevron_right</mat-icon></a>
        </app-card>
      </div>

      <!-- Action required -->
      <app-card tone="warning" title="Action Required" subtitle="Clear the operational backlog">
        @if (actionItems().length === 0) {
          <div class="co-empty">
            <mat-icon>task_alt</mat-icon>
            <p class="text-caption">Nothing pending — all clear</p>
          </div>
        } @else {
          <ul class="co-actions">
            @for (a of actionItems(); track a.key) {
              <li class="co-actions__item co-actions__item--{{ a.tone }}">
                <span class="co-actions__icon" [attr.data-tone]="a.tone"><mat-icon>{{ a.icon }}</mat-icon></span>
                <div class="co-actions__body">
                  <p class="co-actions__count">{{ a.count }}</p>
                  <p class="text-caption">{{ a.label }}</p>
                </div>
                <a class="co-actions__btn" [attr.data-tone]="a.tone" [routerLink]="[a.route]">
                  {{ a.actionLabel }} <mat-icon>arrow_forward</mat-icon>
                </a>
              </li>
            }
          </ul>
        }
      </app-card>

      <!-- Top routes -->
      <app-card tone="info" title="Top Routes" subtitle="This month, by shipment count">
        @if (data()!.topRoutes.length === 0) {
          <div class="co-empty"><mat-icon>alt_route</mat-icon><p class="text-caption">No bookings yet this month</p></div>
        } @else {
          <table class="co-table">
            <thead><tr><th></th><th>Destination</th><th>Shipments</th><th>Revenue</th></tr></thead>
            <tbody>
              @for (r of data()!.topRoutes; track r.branchId ?? r.branchName; let i = $index) {
                <tr>
                  <td><span class="co-rank" [attr.data-rank]="i + 1">{{ i + 1 }}</span></td>
                  <td class="co-table__name">{{ r.branchName }}</td>
                  <td>{{ r.shipmentCount }}</td>
                  <td class="co-table__money">₹{{ money(r.revenue) }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </app-card>

      <!-- Top customers -->
      <app-card tone="brand" title="Top Customers" subtitle="This month, by shipment count">
        @if (data()!.topCustomers.length === 0) {
          <div class="co-empty"><mat-icon>groups</mat-icon><p class="text-caption">No bookings yet this month</p></div>
        } @else {
          <table class="co-table">
            <thead><tr><th></th><th>Customer</th><th>Shipments</th><th>Revenue</th></tr></thead>
            <tbody>
              @for (c of data()!.topCustomers; track c.customerContact ?? c.customerName; let i = $index) {
                <tr>
                  <td><span class="co-avatar">{{ initials(c.customerName) }}</span></td>
                  <td class="co-table__name">{{ c.customerName ?? 'Unknown' }}</td>
                  <td>{{ c.shipmentCount }}</td>
                  <td class="co-table__money">₹{{ money(c.revenue) }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </app-card>
    }
  `,
  styles: [`
    /* Host renders as plain content, not a box — the parent (.dash__overview in
       dashboard.ts) is the actual grid; without this, all five app-card children land
       in one single grid cell (this component's host element) and stack with zero gap
       between them regardless of the parent's own gap setting. */
    :host { display:contents; }

    .co-col { display:flex; flex-direction:column; gap:18px; min-width:0; }

    .co-empty { display:flex; flex-direction:column; align-items:center; gap:6px; padding:24px 0; color:var(--content-muted); }
    .co-empty mat-icon { font-size:34px; width:34px; height:34px; opacity:.45; }

    /* --- Pipeline: a colored stepper, not plain numbers --- */
    .co-pipeline { display:flex; align-items:center; gap:0; flex-wrap:wrap; row-gap:20px; }
    .co-pipeline__stage { display:flex; flex-direction:column; align-items:center; gap:8px;
      padding:10px 2px; border-radius:16px; text-decoration:none; color:inherit;
      transition:transform .15s ease; }
    .co-pipeline__stage:hover { transform:translateY(-2px); }
    .co-pipeline__badge { display:grid; place-items:center; width:40px; height:40px; border-radius:50%;
      font:700 18px var(--font-sans); color:#fff; box-shadow:var(--shadow-clay-sm); flex-shrink:0; }
    .co-pipeline__badge[data-tone="brand"]   { background:linear-gradient(155deg, var(--brand-400),   var(--brand-600)); }
    .co-pipeline__badge[data-tone="info"]    { background:linear-gradient(155deg, #60a5fa, var(--info)); }
    .co-pipeline__badge[data-tone="warning"] { background:linear-gradient(155deg, #fbbf24, var(--warning)); }
    .co-pipeline__badge[data-tone="success"] { background:linear-gradient(155deg, #4ade80, var(--success)); }
    .co-pipeline__label { font:600 13.5px var(--font-sans); color:var(--content-muted); text-align:center;
      max-width:64px; }
    .co-pipeline__connector { flex:1; min-width:16px; max-width:56px; height:3px; border-radius:2px; margin:0 -2px 26px;
      background:var(--surface-border); }
    .co-pipeline__connector[data-tone="brand"]   { background:linear-gradient(90deg, var(--brand-400),   var(--brand-300)); }
    .co-pipeline__connector[data-tone="info"]    { background:linear-gradient(90deg, var(--info), #93c5fd); }
    .co-pipeline__connector[data-tone="warning"] { background:linear-gradient(90deg, var(--warning), #fde68a); }
    .co-pipeline__connector[data-tone="success"] { background:linear-gradient(90deg, var(--success), #86efac); }

    /* --- Action Required: icon badges + pill CTA --- */
    .co-actions { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:10px; }
    .co-actions__item { display:flex; align-items:center; gap:14px; padding:12px; border-radius:18px;
      background:var(--surface-muted); transition:transform .15s ease, box-shadow .15s ease; }
    .co-actions__item:hover { transform:translateY(-1px); box-shadow:var(--shadow-clay-sm); }
    .co-actions__item--warning { background:var(--warning-bg); }
    .co-actions__item--danger { background:var(--danger-bg); }
    .co-actions__item--brand { background:var(--brand-50); }
    .co-actions__item--info { background:var(--info-bg); }
    .co-actions__icon { display:grid; place-items:center; width:40px; height:40px; border-radius:14px;
      flex-shrink:0; box-shadow:var(--shadow-clay-sm); }
    .co-actions__icon mat-icon { font-size:20px; color:#fff; }
    .co-actions__icon[data-tone="warning"] { background:linear-gradient(155deg, #fbbf24, var(--warning)); }
    .co-actions__icon[data-tone="danger"]  { background:linear-gradient(155deg, #f87171, var(--danger)); }
    .co-actions__icon[data-tone="brand"]   { background:linear-gradient(155deg, var(--brand-400), var(--brand-600)); }
    .co-actions__icon[data-tone="info"]    { background:linear-gradient(155deg, #60a5fa, var(--info)); }
    .co-actions__body { flex:1; min-width:0; }
    .co-actions__count { font:700 21px var(--font-sans); margin:0; }
    .co-actions__btn { flex-shrink:0; display:inline-flex; align-items:center; gap:2px; padding:6px 8px 6px 14px;
      border-radius:var(--r-pill); font:600 15px var(--font-sans); text-decoration:none; color:#fff; }
    .co-actions__btn mat-icon { font-size:16px; width:16px; height:16px; }
    .co-actions__btn[data-tone="warning"] { background:linear-gradient(155deg, #fbbf24, var(--warning)); }
    .co-actions__btn[data-tone="danger"]  { background:linear-gradient(155deg, #f87171, var(--danger)); }
    .co-actions__btn[data-tone="brand"]   { background:linear-gradient(155deg, var(--brand-400), var(--brand-600)); }
    .co-actions__btn[data-tone="info"]    { background:linear-gradient(155deg, #60a5fa, var(--info)); }

    /* --- Wallet --- */
    .co-wallet { display:flex; align-items:center; gap:16px; }
    .co-wallet__icon { display:grid; place-items:center; width:52px; height:52px; border-radius:18px;
      flex-shrink:0; background:linear-gradient(155deg, #4ade80, var(--success)); box-shadow:var(--shadow-clay-sm); }
    .co-wallet__icon mat-icon { font-size:24px; color:#fff; }
    .co-wallet__value { font:700 33px var(--font-sans); margin:0; letter-spacing:-.02em; color:var(--success); }
    .co-wallet__warn { display:flex; align-items:center; gap:6px; margin-top:12px; padding:8px 12px;
      border-radius:12px; background:var(--warning-bg); color:var(--warning); font:600 16px var(--font-sans); }
    .co-wallet__warn mat-icon { font-size:18px; width:18px; height:18px; }
    .co-link { display:inline-flex; align-items:center; font:600 16px var(--font-sans); color:var(--success);
      text-decoration:none; }
    .co-link mat-icon { font-size:18px; width:18px; height:18px; }

    /* --- Tables: ranked rows, avatars, hover highlight --- */
    .co-table { width:100%; border-collapse:collapse; font:500 16px var(--font-sans); }
    .co-table th { text-align:left; color:var(--content-muted); font-weight:600; font-size:14px;
      text-transform:uppercase; letter-spacing:.04em; padding:0 8px 8px; }
    .co-table tbody tr { transition:background .1s ease; }
    .co-table tbody tr:hover { background:var(--surface-muted); }
    .co-table td { padding:9px 8px; border-top:1px solid var(--surface-border); }
    .co-table__name { font-weight:600; }
    .co-table__money { font-weight:700; color:var(--success); text-align:right; }
    .co-rank { display:grid; place-items:center; width:24px; height:24px; border-radius:50%;
      font:700 14px var(--font-sans); color:#fff; background:var(--content-muted); }
    .co-rank[data-rank="1"] { background:linear-gradient(155deg, #fcd34d, #d97706); }
    .co-rank[data-rank="2"] { background:linear-gradient(155deg, #cbd5e1, #64748b); }
    .co-rank[data-rank="3"] { background:linear-gradient(155deg, #fdba74, #c2410c); }
    .co-avatar { display:grid; place-items:center; width:28px; height:28px; border-radius:50%;
      font:700 14px var(--font-sans); color:var(--brand-700); background:var(--brand-100); }
  `]
})
export class CompanyOverview {
  readonly loading = input(false);
  readonly data = input<CompanyOverviewData | null>(null);

  readonly actionItems = computed<ActionItem[]>(() => {
    const d = this.data();
    if (!d) return [];
    const items: ActionItem[] = [];
    if (d.readyForManifest > 0) {
      items.push({ key: 'manifest', label: 'Ready for manifest', count: d.readyForManifest,
        icon: 'inventory', tone: 'brand', actionLabel: 'Create Manifest', route: '/movement/loading-sheet' });
    }
    if (d.manifestsAwaitingDispatch > 0) {
      items.push({ key: 'dispatch', label: 'Manifests awaiting dispatch', count: d.manifestsAwaitingDispatch,
        icon: 'local_shipping', tone: 'info', actionLabel: 'Dispatch', route: '/movement/trip-hire-challan' });
    }
    if (d.pendingDelivery > 0) {
      items.push({ key: 'delivery', label: 'Pending delivery', count: d.pendingDelivery,
        icon: 'call_received', tone: 'warning', actionLabel: 'View', route: '/movement/pending-delivery' });
    }
    if (d.delayedShipments > 0) {
      items.push({ key: 'delayed', label: 'Delayed shipments', count: d.delayedShipments,
        icon: 'schedule', tone: 'danger', actionLabel: 'View', route: '/shipments' });
    }
    if (d.lowBalanceBranches > 0) {
      items.push({ key: 'lowBalance', label: 'Branch(es) with low wallet balance', count: d.lowBalanceBranches,
        icon: 'account_balance_wallet', tone: 'danger', actionLabel: 'Recharge', route: '/finance/branch-wallet' });
    }
    if (d.toPayAwaitingDelivery > 0) {
      items.push({ key: 'toPay', label: 'TO_PAY awaiting delivery', count: d.toPayAwaitingDelivery,
        icon: 'payments', tone: 'info', actionLabel: 'View', route: '/movement/pending-delivery' });
    }
    return items;
  });

  /** Tone shading for the pipeline stepper, earliest to latest stage. */
  private static readonly STAGE_TONES: Record<string, 'brand' | 'info' | 'warning' | 'success'> = {
    BOOKED: 'brand', READY_FOR_MANIFEST: 'info', MANIFEST_CREATED: 'info',
    DISPATCHED: 'warning', IN_SCAN: 'warning', OUT_FOR_DELIVERY: 'warning', DELIVERED: 'success'
  };

  money(v: number): string { return money.format(v); }

  stageLabel(stage: string): string {
    return stage.split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ');
  }

  stageTone(stage: string): string {
    return CompanyOverview.STAGE_TONES[stage] ?? 'brand';
  }

  initials(name: string | null): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
  }
}
