import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { SubscriptionPlan, SubscriptionPlanSearchRequest } from '@core/models/subscription-plan.model';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { SortState } from '@shared/components/ui-table/ui-table';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiDrawer } from '@shared/components/ui-drawer/ui-drawer';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { PlanTable, PlanPerms, PlanAction } from './components/plan-table';
import { PlanFilter } from './components/plan-filter';
import { SubscriptionPlanService } from './subscription-plan.service';
import { downloadCsv } from '@shared/utils/csv-export.util';

const WRITERS = [AppRole.SUPER_ADMIN];

/**
 * Subscription plan catalogue — server pagination, sort, debounced search, advanced
 * filter drawer and CSV export. Row actions (lifecycle, delete) route through confirms.
 * SUPER_ADMIN only, matching the backend's class-level @PreAuthorize. No mock data.
 */
@Component({
  selector: 'app-plan-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiPagination, UiSearch, UiButton, UiDrawer, PlanTable, PlanFilter],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Subscription Plans</h1><p class="text-caption">The catalogue companies subscribe to.</p></div>
        <div class="page__actions">
          <app-search placeholder="Search code, name, description…" (changed)="onSearch($event)" />
          <app-button variant="stroked" icon="filter_list" (pressed)="filterOpen.set(true)">
            Filters@if (activeFilters()) { <span class="fbadge">{{ activeFilters() }}</span> }
          </app-button>
          <app-button variant="stroked" icon="download" [loading]="exporting()" (pressed)="exportCsv()">Export</app-button>
          @if (can().create) { <app-button icon="add" (pressed)="create()">New Plan</app-button> }
        </div>
      </header>

      <app-plan-table [rows]="page().content" [loading]="loading()" [sort]="sort()" [perms]="tablePerms()"
        [startIndex]="page().page * page().size"
                      (sortChange)="onSort($event)" (action)="onAction($event)" />

      <app-pagination [page]="page()" (pageChange)="onPage($event)" />

      <app-drawer [open]="filterOpen()" title="Advanced filters" subtitle="Narrow the catalogue." (closed)="filterOpen.set(false)">
        <app-plan-filter (changed)="onFilter($event)" />
      </app-drawer>
    </div>
  `,
  styles: [`
    .fbadge { display:inline-grid; place-items:center; min-width:18px; height:18px; padding:0 5px; margin-left:2px;
      background:var(--brand-600); color:#fff; border-radius:999px; font:700 14px var(--font-sans); }
  `]
})
export class PlanList implements OnInit {
  private readonly service = inject(SubscriptionPlanService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly router = inject(Router);
  private readonly confirm = inject(DialogService);

  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly filterOpen = signal(false);
  readonly page = signal<Page<SubscriptionPlan>>(emptyPage<SubscriptionPlan>());
  readonly sort = signal<SortState | null>({ active: 'displayOrder', direction: 'asc' });

  private query: PageQuery = { page: 0, size: 20, sort: 'displayOrder,asc' };
  private filters = signal<SubscriptionPlanSearchRequest>({});
  readonly activeFilters = computed(() =>
    Object.values(this.filters()).filter((v) => v != null).length);

  readonly can = computed(() => ({
    create: this.perms.canAccess({ roles: WRITERS }),
    update: this.perms.canAccess({ roles: WRITERS }),
    delete: this.perms.canAccess({ roles: WRITERS })
  }));
  readonly tablePerms = computed<PlanPerms>(() => this.can());

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Platform' }, { label: 'Subscription Plans' }]);
    this.load();
  }

  private buildQuery(size?: number): PageQuery {
    const f = this.filters();
    return {
      ...this.query, ...(size ? { size, page: 0 } : {}),
      planType: f.planType, isActive: f.isActive, currency: f.currency,
      minPrice: f.minPrice, maxPrice: f.maxPrice
    };
  }

  private load(): void {
    this.loading.set(true);
    this.service.list(this.buildQuery()).subscribe({
      next: (p) => { this.page.set(p); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  onSearch(t: string) { this.query = { ...this.query, search: t || undefined, page: 0 }; this.load(); }
  onPage(i: number) { this.query = { ...this.query, page: i }; this.load(); }
  onSort(s: SortState) { this.sort.set(s); this.query = { ...this.query, sort: `${s.active},${s.direction}`, page: 0 }; this.load(); }
  onFilter(f: SubscriptionPlanSearchRequest) { this.filters.set(f); this.query = { ...this.query, page: 0 }; this.filterOpen.set(false); this.load(); }

  create() { this.router.navigate(['/subscription-plans/new']); }

  onAction({ type, plan }: { type: PlanAction; plan: SubscriptionPlan }): void {
    switch (type) {
      case 'view': return void this.router.navigate(['/subscription-plans', plan.id]);
      case 'edit': return void this.router.navigate(['/subscription-plans', plan.id, 'edit']);
      case 'activate': return this.lifecycle(plan, 'activate');
      case 'deactivate': return this.confirmDeactivate(plan);
      case 'delete': return this.deletePlan(plan);
    }
  }

  private lifecycle(plan: SubscriptionPlan, op: 'activate' | 'deactivate'): void {
    this.service[op](plan.id).subscribe({
      next: () => { this.notify.success(`Plan ${op}d.`); this.load(); },
      error: (e) => this.notify.error(e?.error?.message ?? `Could not ${op} the plan.`)
    });
  }

  private confirmDeactivate(plan: SubscriptionPlan): void {
    this.confirm.confirm({
      title: 'Deactivate plan',
      message: `"${plan.planName}" will be withdrawn from the catalogue offered to new companies. Companies already on it are unaffected.`,
      confirmLabel: 'Deactivate', danger: true
    }).subscribe((ok) => { if (ok) this.lifecycle(plan, 'deactivate'); });
  }

  private deletePlan(plan: SubscriptionPlan): void {
    this.confirm.confirm({
      title: 'Delete plan',
      message: `"${plan.planName}" will be removed. Its code and name stay reserved so a later plan cannot reuse them.`,
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.remove(plan.id).subscribe({
        next: () => { this.notify.success('Plan deleted.'); this.load(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not delete the plan.')
      });
    });
  }

  exportCsv(): void {
    this.exporting.set(true);
    this.service.list(this.buildQuery(100)).subscribe({
      next: (p) => { this.download(p.content); this.exporting.set(false); },
      error: () => { this.exporting.set(false); this.notify.error('Export failed.'); }
    });
  }

  private download(rows: SubscriptionPlan[]): void {
    const cols: (keyof SubscriptionPlan)[] = ['planCode', 'planName', 'planType', 'monthlyPrice', 'yearlyPrice', 'currency', 'trialDays', 'isActive', 'displayOrder'];
    const lines = rows.map((r) => cols.map((c) => r[c] as string | number | boolean));
    // displayOrder (index 8) is an ordinal rank, not additive — excluded from the total.
    downloadCsv(`subscription-plans-${new Date().toISOString().slice(0, 10)}.csv`, cols, lines, [3, 4, 6]);
    this.notify.info(`Exported ${rows.length} plan(s).`);
  }
}
