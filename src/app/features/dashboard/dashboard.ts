import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { environment } from '@env/environment';
import { StatisticCard } from '@shared/components/statistic-card/statistic-card';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { DashboardService } from './dashboard.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { DASHBOARD_LAYOUTS, QuickActionDef, StatTileDef, resolveProfile } from './dashboard.roles';
import { DashboardStatistics, DashboardSummary } from './models/dashboard.model';
import { ChartCard } from './components/chart-card';
import { ActivityTimeline } from './components/activity-timeline';
import { RecentShipments } from './components/recent-shipments';
import { QuickActions } from './components/quick-actions';
import { BranchSummary } from './components/branch-summary';
import { CompanyOverview } from './components/company-overview';
import { BranchOverview } from './components/branch-overview';
import { PodStatusPie } from './components/pod-status-pie';
import { DeliveryStatusPie } from './components/delivery-status-pie';
import { TrackBox } from '@features/shipment-movement/components/track-box';
import { PackageIllustration } from '@shared/components/illustrations/package-illustration';
import { FollowUpWidget } from './components/follow-up-widget';
// import { HubSummary } from './components/hub-summary'; // hub module not built yet

const MONEY_KEYS: ReadonlySet<keyof DashboardStatistics> =
  new Set(['totalRevenue', 'walletBalance', 'todayCollection']);
const WEIGHT_KEYS: ReadonlySet<keyof DashboardStatistics> = new Set(['totalActualWeight']);

/**
 * Role-based enterprise dashboard. The layout (which KPI tiles, charts, cards and quick
 * actions) is resolved from the signed-in user's role + scope (dashboard.roles.ts); the
 * figures come exclusively from DashboardService (API only). Loading, empty and error
 * states are all handled — no mock data anywhere.
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, MatIconModule, StatisticCard, UiCard, ChartCard, ActivityTimeline,
    RecentShipments, QuickActions, BranchSummary, CompanyOverview, BranchOverview, TrackBox,
    PackageIllustration, FollowUpWidget, PodStatusPie, DeliveryStatusPie /*, HubSummary */
  ],
  template: `
    <div class="dash">
      <!-- welcome + track shipment, paired in one row to save vertical space -->
      <section class="dash__hero">
        <header class="dash__welcome clay-surface">
          <div class="dash__welcome-text">
            <h1 class="text-h1">{{ greeting() }}, {{ auth.displayName() || 'there' }}</h1>
            <p class="text-caption">{{ companyName }} · {{ scopeLabel() }}</p>
            @if (ownProfile() === 'COMPANY') {
              <label class="dash__view">View
                <select [value]="viewBranchId()" (change)="viewBranch($any($event.target).value)" aria-label="Dashboard of">
                  <option value="">Whole company</option>
                  @for (b of branches(); track b.id) { <option [value]="b.id">{{ b.label }}</option> }
                </select>
              </label>
            }
            <div class="dash__date">
              <mat-icon>calendar_today</mat-icon>
              <span>{{ now | date:'EEEE, d MMM y' }}</span>
            </div>
          </div>
          <app-package-illustration class="dash__welcome-ill" [size]="88" />
        </header>

        @if (profile() !== 'PLATFORM') {
          <app-card class="dash__track" title="Track Shipment" subtitle="Enter an AWB (Tracking No.) or Shipment No.">
            <app-track-box />
          </app-card>
        }
      </section>

      @if (error()) {
        <app-card>
          <div class="dash__error">
            <mat-icon>cloud_off</mat-icon>
            <div>
              <p class="text-h3">Couldn't load the dashboard</p>
              <p class="text-caption">The service is unreachable. Check your connection and try again.</p>
            </div>
            <button type="button" class="dash__retry" (click)="reload()">Retry</button>
          </div>
        </app-card>
      } @else {
        <!-- KPI tiles -->
        <section class="dash__grid" data-tour="dash-stats">
          @for (t of layout().stats; track t.key) {
            <app-statistic-card
              [label]="t.label" [icon]="t.icon" [tone]="t.tone" [prefix]="t.prefix ?? ''"
              [loading]="loading()" [value]="statValue(t)" />
          }
        </section>

        @if (layout().quickActions.length > 0) {
          <app-quick-actions data-tour="dash-quick-actions" [actions]="layout().quickActions" (pick)="onAction($event)" />
        }

        <!-- charts, POD review first so approvals surface before the trend reading —
             same grid as the charts so it matches their card size exactly -->
        @if (hasCharts() || layout().sections.companyOverview || layout().sections.branchOverview) {
          <section class="dash__charts" [style.grid-template-columns]="'repeat(' + chartCols() + ', minmax(0,1fr))'">
            @if (layout().sections.companyOverview) {
              <app-pod-status-pie title="POD Overview — All Branches"
                subtitle="Every branch, current state"
                [loading]="loading()" [data]="data()?.companyOverview?.podOverview ?? null" />
              <app-delivery-status-pie title="Delivery Status — All Branches"
                subtitle="This month, delivered vs pending"
                [loading]="loading()"
                [delivered]="data()?.statistics?.delivered ?? 0"
                [pending]="data()?.statistics?.pending ?? 0" />
            } @else if (layout().sections.branchOverview) {
              <app-pod-status-pie title="POD Overview — This Branch"
                subtitle="This branch, current state"
                [loading]="loading()" [data]="data()?.branchOverview?.podOverview ?? null" />
            }
            @if (layout().sections.shipmentTrend) {
              <app-chart-card title="Shipment Trend" subtitle="Bookings over time" type="area"
                [colorKeys]="['brand']" [loading]="loading()" [data]="data()?.charts?.shipmentTrend ?? []" />
            }
            @if (layout().sections.deliveryPerformance) {
              <app-chart-card title="Delivery Performance" subtitle="Delivered vs in-transit vs pending" type="bar"
                [stacked]="true" [colorKeys]="['success','info','warning']"
                [loading]="loading()" [data]="data()?.charts?.deliveryPerformance ?? []" />
            }
            @if (layout().sections.revenueTrend) {
              <app-chart-card title="Revenue Trend" subtitle="Collections over time" type="area"
                [colorKeys]="['success']" valuePrefix="₹"
                [loading]="loading()" [data]="data()?.charts?.revenueTrend ?? []" />
            }
          </section>
        }

        @if (profile() !== 'PLATFORM') {
          <app-follow-up-widget data-tour="dash-follow-ups" />
        }

        <!-- company-wide overview (COMPANY_ADMIN only) -->
        @if (layout().sections.companyOverview) {
          <section class="dash__overview" data-tour="dash-company-overview">
            <app-company-overview [loading]="loading()" [data]="data()?.companyOverview ?? null" />
          </section>
        }

        <!-- branch-scoped overview (BRANCH_MANAGER / BRANCH_OPERATOR only) -->
        @if (layout().sections.branchOverview) {
          <section class="dash__branch-overview" data-tour="dash-branch-overview">
            <app-branch-overview [loading]="loading()" [data]="data()?.branchOverview ?? null" />
          </section>
        }

        <!-- content columns — the side column only exists (and only then does the row
             split in two) when there's actually something to put in it; otherwise an
             empty <aside> would still claim the grid's second track as dead space. -->
        <section class="dash__cols" [class.dash__cols--single]="!layout().sections.branchSummary">
          <div class="dash__main">
            @if (layout().sections.recentShipments) {
              <app-recent-shipments [loading]="loading()" [rows]="data()?.recentShipments ?? []" />
            }
            @if (layout().sections.recentActivity) {
              <app-activity-timeline [loading]="loading()" [rows]="data()?.recentActivity ?? []" />
            }
          </div>

          @if (layout().sections.branchSummary) {
            <aside class="dash__side">
              <app-branch-summary [loading]="loading()" [rows]="data()?.branchSummary ?? []"
                [pendingDelivery]="data()?.companyOverview?.pendingDelivery ?? null"
                [activeBranches]="data()?.statistics?.activeBranches ?? null"
                [totalBranches]="data()?.statistics?.totalBranches ?? null" />
            </aside>
          }
        </section>
      }
    </div>
  `,
  styles: [`
    /* Ambient color wash behind the whole page — sits under the (globally clay-styled)
       cards, doesn't override any surface/shadow token itself so light/dark both hold. */
    .dash {
      display:flex; flex-direction:column; gap:22px; width:100%;
      background:
        radial-gradient(720px 320px at 8% 0%, rgba(129,140,248,.14), transparent 60%),
        radial-gradient(640px 300px at 92% 12%, rgba(52,211,153,.1), transparent 60%),
        radial-gradient(680px 340px at 50% 100%, rgba(251,191,36,.08), transparent 60%);
    }
    .dash__hero { display:grid; grid-template-columns:1fr 1fr; gap:18px; align-items:stretch; }
    @media (max-width:900px){ .dash__hero { grid-template-columns:1fr; } }
    .dash__welcome { display:flex; align-items:center; justify-content:space-between; gap:16px;
      flex-wrap:wrap; padding:20px 26px; }
    .dash__welcome-text { display:flex; flex-direction:column; gap:10px; align-items:flex-start; }
    .dash__welcome-ill { flex-shrink:0; }
    @media (max-width:560px){ .dash__welcome-ill { display:none; } }
    .dash__view { display:flex; align-items:center; gap:8px; font:600 13px var(--font-sans); color:var(--content-muted); }
    .dash__view select { height:36px; border:1px solid var(--surface-border); border-radius:var(--r-pill); padding:0 12px;
      background:var(--surface-card, #fff); color:var(--content-fg); font:500 13px var(--font-sans); max-width:260px; }
    .dash__track { display:flex; flex-direction:column; }
    .dash__track ::ng-deep .ac__body { flex:1; display:flex; align-items:center; }
    .dash__track ::ng-deep .ac__body > * { width:100%; }
    .dash__date { display:inline-flex; align-items:center; gap:8px; padding:8px 16px; border-radius:var(--r-pill);
      background:var(--surface-muted); box-shadow:var(--shadow-clay-inset); font:600 13px var(--font-sans); color:var(--content-muted); }
    .dash__date mat-icon { font-size:18px; width:18px; height:18px; }
    .dash__grid { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:18px; }
    .dash__charts { display:grid; gap:18px; }
    /* A lone odd-one-out in the final row (3 cards in a 2-up grid, say) spans both
       columns instead of sitting alone at half width with empty track beside it. */
    .dash__charts > *:last-child:nth-child(odd) { grid-column:1 / -1; }
    @media (max-width:640px){ .dash__charts{ grid-template-columns:1fr !important; } }
    .dash__overview { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:18px; align-items:start; }
    @media (max-width:900px){ .dash__overview{ grid-template-columns:1fr; } }
    /* Stacked full-width, not a grid — only two cards of very different natural height
       (a short stepper, a variable-length backlog list), so pairing them side by side
       risks the exact same dead-space-under-the-shorter-card issue .dash__overview's
       own 2-column layout was built to avoid. */
    .dash__branch-overview { display:flex; flex-direction:column; gap:18px; }
    .dash__cols { display:grid; grid-template-columns:1.6fr 1fr; gap:18px; align-items:start; }
    .dash__cols--single { grid-template-columns:1fr; }
    .dash__main, .dash__side { display:flex; flex-direction:column; gap:18px; min-width:0; }
    .dash__error { display:flex; align-items:center; gap:16px; padding:8px; }
    .dash__error mat-icon { font-size:36px; width:36px; height:36px; color:var(--danger); }
    .dash__error div { flex:1; }
    .dash__retry { padding:10px 20px; border-radius:var(--r-pill); border:0; cursor:pointer;
      background:linear-gradient(155deg, var(--brand-500), var(--brand-600)); color:#fff; font:600 13px var(--font-sans);
      box-shadow:var(--shadow-clay-sm); }
    .dash__retry:active { box-shadow:var(--shadow-clay-inset); }
    @media (max-width:1100px){ .dash__grid{grid-template-columns:repeat(2,1fr)} .dash__cols{grid-template-columns:1fr} }
    @media (max-width:560px){ .dash__grid{grid-template-columns:1fr} }
  `]
})
export class Dashboard implements OnInit {
  private readonly dashboard = inject(DashboardService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly masterData = inject(MasterDataService);
  protected readonly auth = inject(AuthService);

  readonly now = new Date();
  readonly companyName = environment.appName;

  readonly loading = signal(true);
  readonly error = signal(false);
  readonly data = signal<DashboardSummary | null>(null);

  /** The signed-in user's own dashboard profile. */
  protected readonly ownProfile = computed(() =>
    resolveProfile(this.auth.roles(), {
      branchId: this.auth.user()?.branchId, hubId: this.auth.user()?.hubId
    })
  );
  /** A company admin may look at one branch's dashboard (13.4): the branch manager's layout, that branch's figures. */
  readonly viewBranchId = signal('');
  readonly branches = signal<{ id: string; label: string }[]>([]);
  protected readonly profile = computed(() =>
    this.ownProfile() === 'COMPANY' && this.viewBranchId() ? 'BRANCH_MANAGER' : this.ownProfile());
  readonly layout = computed(() => DASHBOARD_LAYOUTS[this.profile()]);
  readonly hasCharts = computed(() => {
    const s = this.layout().sections;
    return s.shipmentTrend || s.deliveryPerformance || s.revenueTrend;
  });
  /** Exact card count for the chart row (POD + whichever trend charts the role gets) —
   *  an explicit column count so the row always divides evenly, instead of `auto-fit`
   *  leaving a lone trailing card stranded at its minmax width with empty track beside it. */
  readonly chartCols = computed(() => {
    const s = this.layout().sections;
    // Company overview gets two pies (POD + Delivery Status), branch overview just the one.
    let n = s.companyOverview ? 2 : (s.branchOverview ? 1 : 0);
    if (s.shipmentTrend) n++;
    if (s.deliveryPerformance) n++;
    if (s.revenueTrend) n++;
    return Math.min(n || 1, 2);
  });

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Dashboard' }]);
    if (this.ownProfile() === 'COMPANY') {
      this.masterData.branchDirectory().subscribe({
        next: (list) => this.branches.set(list.filter((b) => b.branchType !== 'PICKUP_DELIVERY_PARTNER')
          .map((b) => ({ id: b.id, label: `${b.branchName} (${b.branchCode})` })).sort((a, b) => a.label.localeCompare(b.label))),
        error: () => undefined
      });
    }
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.error.set(false);
    this.dashboard.load(this.profile(), this.viewBranchId() || undefined).subscribe({
      next: (d) => { this.data.set(d); this.loading.set(false); },
      error: () => { this.error.set(true); this.loading.set(false); }
    });
  }

  viewBranch(id: string): void {
    this.viewBranchId.set(id);
    this.data.set(null);
    this.reload();
  }

  greeting(): string {
    const h = this.now.getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  scopeLabel(): string {
    switch (this.profile()) {
      case 'PLATFORM': return 'Platform overview';
      case 'COMPANY': return 'Company-wide';
      case 'BRANCH_MANAGER':
      case 'BRANCH_OPERATOR': {
        const b = this.branches().find((x) => x.id === this.viewBranchId());
        return b ? `Branch: ${b.label}` : 'Branch operations';
      }
      case 'HUB_MANAGER':
      case 'HUB_OPERATOR': return 'Hub operations';
    }
  }

  /** Format a tile's value: money grouped with Intl, null shown as em dash, counts plain. */
  statValue(t: StatTileDef): string | number {
    const v = this.data()?.statistics[t.key];
    if (v == null) return '—';
    if (MONEY_KEYS.has(t.key)) return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(v);
    if (WEIGHT_KEYS.has(t.key)) return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(v);
    return v;
  }

  onAction(a: QuickActionDef): void {
    if (a.route) { this.router.navigate([a.route]); return; }
    // shipment-module actions (book/search/print/manifest/dispatch/receive) have no page yet
    this.notify.info(`${a.label} — available once the shipments module ships.`);
  }
}
