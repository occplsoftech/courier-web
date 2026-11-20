import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { Rate, RateSearchRequest } from '@core/models/rate.model';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { SortState } from '@shared/components/ui-table/ui-table';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiDrawer } from '@shared/components/ui-drawer/ui-drawer';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { MasterDataService } from '@features/masters/master-data.service';
import { RateTable, RatePerms, RateAction } from './components/rate-table';
import { RateFilter } from './components/rate-filter';
import { RateCalculatorDialog } from './components/rate-calculator-dialog';
import { RateService } from './rate.service';
import { downloadCsv } from '@shared/utils/csv-export.util';

const WRITERS = [AppRole.COMPANY_ADMIN];
const LIFECYCLE = [AppRole.COMPANY_ADMIN];

/**
 * Rate card directory — server pagination, sort, debounced search, advanced filter drawer
 * and CSV export, plus a one-click "Calculate Rate" lookup. Route/Service Type/Package
 * Type/Payment Mode ids are resolved to names once, from the same master pickers the form
 * uses, and handed to the table as lookup maps.
 */
@Component({
  selector: 'app-rate-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiPagination, UiSearch, UiButton, UiDrawer, RateTable, RateFilter],
  template: `
    <div class="page">
      <header class="page__head" data-tour="rates-head">
        <div><h1 class="text-h1">Rate Master</h1><p class="text-caption">Company rate cards — {{ page().totalElements }} in all.</p></div>
        <div class="page__actions">
          <app-search placeholder="Search rate code, name…" (changed)="onSearch($event)" />
          <app-button variant="stroked" icon="calculate" (pressed)="openCalculator()">Calculate Rate</app-button>
          <app-button variant="stroked" icon="filter_list" (pressed)="filterOpen.set(true)">
            Filters@if (activeFilters()) { <span class="fbadge">{{ activeFilters() }}</span> }
          </app-button>
          <app-button variant="stroked" icon="download" [loading]="exporting()" (pressed)="exportCsv()">Export</app-button>
          @if (can().create) { <app-button icon="add" (pressed)="create()">New Rate</app-button> }
        </div>
      </header>

      <app-rate-table [rows]="page().content" [loading]="loading()" [sort]="sort()" [perms]="tablePerms()"
        [startIndex]="page().page * page().size"
                      [routeNames]="routeNames()" [serviceTypeNames]="serviceTypeNames()"
                      [packageTypeNames]="packageTypeNames()" [paymentModeNames]="paymentModeNames()"
                      (sortChange)="onSort($event)" (action)="onAction($event)" />

      <app-pagination [page]="page()" (pageChange)="onPage($event)" />

      <app-drawer [open]="filterOpen()" title="Advanced filters" subtitle="Narrow the rate list." (closed)="filterOpen.set(false)">
        <app-rate-filter [routeOptions]="routeOptions()" [serviceTypeOptions]="serviceTypeOptions()"
                         [packageTypeOptions]="packageTypeOptions()" [paymentModeOptions]="paymentModeOptions()"
                         (changed)="onFilter($event)" />
      </app-drawer>
    </div>
  `,
  styles: [`
    .fbadge { display:inline-grid; place-items:center; min-width:18px; height:18px; padding:0 5px; margin-left:2px;
      background:var(--brand-600); color:#fff; border-radius:999px; font:700 14px var(--font-sans); }
  `]
})
export class RateList implements OnInit {
  private readonly service = inject(RateService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);

  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly filterOpen = signal(false);
  readonly page = signal<Page<Rate>>(emptyPage<Rate>());
  readonly sort = signal<SortState | null>({ active: 'rateCode', direction: 'asc' });

  readonly routeOptions = signal<SelectOption[]>([]);
  readonly serviceTypeOptions = signal<SelectOption[]>([]);
  readonly packageTypeOptions = signal<SelectOption[]>([]);
  readonly paymentModeOptions = signal<SelectOption[]>([]);
  readonly routeNames = computed(() => toNameMap(this.routeOptions()));
  readonly serviceTypeNames = computed(() => toNameMap(this.serviceTypeOptions()));
  readonly packageTypeNames = computed(() => toNameMap(this.packageTypeOptions()));
  readonly paymentModeNames = computed(() => toNameMap(this.paymentModeOptions()));

  private query: PageQuery = { page: 0, size: 20, sort: 'rateCode,asc' };
  private readonly filters = signal<RateSearchRequest>({});
  readonly activeFilters = computed(() =>
    Object.values(this.filters()).filter((v) => v != null && (!Array.isArray(v) || v.length)).length);

  readonly can = computed(() => ({
    create: this.perms.canAccess({ roles: WRITERS, permissions: ['RATE_MASTER_CREATE'] }),
    update: this.perms.canAccess({ roles: WRITERS, permissions: ['RATE_MASTER_UPDATE'] }),
    lifecycle: this.perms.canAccess({ roles: LIFECYCLE, permissions: ['RATE_MASTER_ACTIVATE', 'RATE_MASTER_DEACTIVATE'] })
  }));
  readonly tablePerms = computed<RatePerms>(() => ({ update: this.can().update, lifecycle: this.can().lifecycle }));

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Rate Master' }]);
    this.masters.options('routes').subscribe((o) => this.routeOptions.set(o));
    this.masters.options('service-types').subscribe((o) => this.serviceTypeOptions.set(o));
    this.masters.options('package-types').subscribe((o) => this.packageTypeOptions.set(o));
    this.masters.options('payment-modes').subscribe((o) => this.paymentModeOptions.set(o));
    this.load();
  }

  private buildQuery(size?: number): PageQuery {
    const f = this.filters();
    return {
      ...this.query, ...(size ? { size, page: 0 } : {}),
      routeId: f.routeId as unknown as string | undefined,
      serviceTypeId: f.serviceTypeId as unknown as string | undefined,
      packageTypeId: f.packageTypeId as unknown as string | undefined,
      paymentModeId: f.paymentModeId as unknown as string | undefined,
      status: f.status as unknown as string | undefined
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
  onFilter(f: RateSearchRequest) { this.filters.set(f); this.query = { ...this.query, page: 0 }; this.filterOpen.set(false); this.load(); }

  create() { this.router.navigate(['/rates/new']); }

  openCalculator(): void {
    this.dialog.open(RateCalculatorDialog, { autoFocus: false, panelClass: 'app-dialog' });
  }

  onAction({ type, rate }: { type: RateAction; rate: Rate }): void {
    switch (type) {
      case 'view': return void this.router.navigate(['/rates', rate.id]);
      case 'edit': return void this.router.navigate(['/rates', rate.id, 'edit']);
      case 'activate': return this.lifecycle(rate, 'activate');
      case 'deactivate': return this.lifecycle(rate, 'deactivate');
    }
  }

  private lifecycle(rate: Rate, op: 'activate' | 'deactivate'): void {
    this.service[op](rate.id).subscribe({
      next: () => { this.notify.success(`Rate ${op}d.`); this.load(); },
      error: (e) => this.notify.error(e?.error?.message ?? `Could not ${op} the rate.`)
    });
  }

  exportCsv(): void {
    this.exporting.set(true);
    this.service.list(this.buildQuery(100)).subscribe({
      next: (p) => { this.download(p.content); this.exporting.set(false); },
      error: () => { this.exporting.set(false); this.notify.error('Export failed.'); }
    });
  }

  private download(rows: Rate[]): void {
    const header = ['rateCode', 'rateName', 'route', 'serviceType', 'packageType', 'paymentMode', 'minimumWeight', 'maximumWeight', 'weightUnit', 'baseRate', 'status'];
    const lines = rows.map((r) => [
      r.rateCode, r.rateName, this.routeNames().get(r.routeId), this.serviceTypeNames().get(r.serviceTypeId),
      this.packageTypeNames().get(r.packageTypeId), this.paymentModeNames().get(r.paymentModeId),
      r.minimumWeight, r.maximumWeight, r.weightUnit, r.baseRate, r.status
    ]);
    downloadCsv(`rates-${new Date().toISOString().slice(0, 10)}.csv`, header, lines, [6, 7, 9]);
    this.notify.info(`Exported ${rows.length} rate(s).`);
  }
}

function toNameMap(options: SelectOption[]): Map<string, string> {
  return new Map(options.map((o) => [o.value, o.label]));
}
