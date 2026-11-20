import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { Customer, CustomerSearchRequest } from '@core/models/customer.model';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { SortState } from '@shared/components/ui-table/ui-table';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiDrawer } from '@shared/components/ui-drawer/ui-drawer';
import { CustomerTable, CustomerPerms, CustomerAction } from './components/customer-table';
import { CustomerFilter } from './components/customer-filter';
import { CustomerService } from './customer.service';
import { downloadCsv } from '@shared/utils/csv-export.util';

const WRITERS = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER, AppRole.BOOKING_OPERATOR, AppRole.CUSTOMER_SERVICE];
const LIFECYCLE = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER];

/**
 * Customer directory — server pagination, sort, debounced search, advanced filter drawer
 * and CSV export. Row actions (edit, activate/deactivate) route through the list; delete
 * is not offered here — the backend has no `DELETE /customers/{id}`, only address delete.
 */
@Component({
  selector: 'app-customer-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiPagination, UiSearch, UiButton, UiDrawer, CustomerTable, CustomerFilter],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">{{ businessOnly ? 'Business Customers' : 'Customers' }}</h1><p class="text-caption">{{ businessOnly ? 'Business accounts with pickup/delivery addresses, payment terms and zone pricing' : 'Reusable customer master data' }} — {{ page().totalElements }} in all.</p></div>
        <div class="page__actions">
          <app-search placeholder="Search code, name, mobile, email…" (changed)="onSearch($event)" />
          <app-button variant="stroked" icon="filter_list" (pressed)="filterOpen.set(true)">
            Filters@if (activeFilters()) { <span class="fbadge">{{ activeFilters() }}</span> }
          </app-button>
          <app-button variant="stroked" icon="download" [loading]="exporting()" (pressed)="exportCsv()">Export</app-button>
          @if (can().create) { <app-button icon="add" (pressed)="create()">New Customer</app-button> }
        </div>
      </header>

      <app-customer-table [rows]="page().content" [loading]="loading()" [sort]="sort()" [perms]="tablePerms()"
        [startIndex]="page().page * page().size"
                          (sortChange)="onSort($event)" (action)="onAction($event)" />

      <app-pagination [page]="page()" (pageChange)="onPage($event)" />

      <app-drawer [open]="filterOpen()" title="Advanced filters" subtitle="Narrow the customer list." (closed)="filterOpen.set(false)">
        <app-customer-filter (changed)="onFilter($event)" />
      </app-drawer>
    </div>
  `,
  styles: [`
    .fbadge { display:inline-grid; place-items:center; min-width:18px; height:18px; padding:0 5px; margin-left:2px;
      background:var(--brand-600); color:#fff; border-radius:999px; font:700 14px var(--font-sans); }
  `]
})
export class CustomerList implements OnInit {
  private readonly service = inject(CustomerService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly router = inject(Router);
  /** Set by the Business Customer menu route: the list is pinned to BUSINESS customers. */
  protected readonly businessOnly = !!inject(ActivatedRoute).snapshot.data['businessOnly'];

  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly filterOpen = signal(false);
  readonly page = signal<Page<Customer>>(emptyPage<Customer>());
  readonly sort = signal<SortState | null>({ active: 'customerCode', direction: 'asc' });

  private query: PageQuery = { page: 0, size: 20, sort: 'customerCode,asc' };
  private readonly filters = signal<CustomerSearchRequest>({});
  readonly activeFilters = computed(() =>
    Object.values(this.filters()).filter((v) => v != null && (!Array.isArray(v) || v.length)).length);

  readonly can = computed(() => ({
    create: this.perms.canAccess({ roles: WRITERS, permissions: ['CUSTOMER_CREATE'] }),
    update: this.perms.canAccess({ roles: WRITERS, permissions: ['CUSTOMER_UPDATE'] }),
    lifecycle: this.perms.canAccess({ roles: LIFECYCLE, permissions: ['CUSTOMER_ACTIVATE', 'CUSTOMER_DEACTIVATE'] })
  }));
  readonly tablePerms = computed<CustomerPerms>(() => ({ update: this.can().update, lifecycle: this.can().lifecycle }));

  ngOnInit(): void {
    this.breadcrumb.set(this.businessOnly
      ? [{ label: 'Business Customer' }, { label: 'Customer' }]
      : [{ label: 'Customers' }]);
    this.load();
  }

  private buildQuery(size?: number): PageQuery {
    const f = this.filters();
    return {
      ...this.query, ...(size ? { size, page: 0 } : {}),
      customerType: (this.businessOnly ? ['BUSINESS'] : f.customerType) as unknown as string | undefined,
      status: f.status as unknown as string | undefined,
      paymentMode: f.paymentMode as unknown as string | undefined,
      billingFrequency: f.billingFrequency as unknown as string | undefined
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
  onFilter(f: CustomerSearchRequest) { this.filters.set(f); this.query = { ...this.query, page: 0 }; this.filterOpen.set(false); this.load(); }

  create() { this.router.navigate(['/customers/new'], this.businessOnly ? { queryParams: { type: 'BUSINESS' } } : {}); }

  onAction({ type, customer }: { type: CustomerAction; customer: Customer }): void {
    switch (type) {
      case 'view': return void this.router.navigate(['/customers', customer.id]);
      case 'edit': return void this.router.navigate(['/customers', customer.id, 'edit']);
      case 'activate': return this.lifecycle(customer, 'activate');
      case 'deactivate': return this.lifecycle(customer, 'deactivate');
    }
  }

  private lifecycle(customer: Customer, op: 'activate' | 'deactivate'): void {
    this.service[op](customer.id).subscribe({
      next: () => { this.notify.success(`Customer ${op}d.`); this.load(); },
      error: (e) => this.notify.error(e?.error?.message ?? `Could not ${op} the customer.`)
    });
  }

  exportCsv(): void {
    this.exporting.set(true);
    this.service.list(this.buildQuery(100)).subscribe({
      next: (p) => { this.download(p.content); this.exporting.set(false); },
      error: () => { this.exporting.set(false); this.notify.error('Export failed.'); }
    });
  }

  private download(rows: Customer[]): void {
    const header = ['customerCode', 'displayName', 'customerType', 'contactPerson', 'mobile', 'email', 'paymentMode', 'billingFrequency', 'status'];
    const lines = rows.map((r) => [r.customerCode, r.displayName, r.customerType, r.contactPerson, r.mobile, r.email,
      r.defaultPaymentMode, r.billingFrequency, r.status]);
    downloadCsv(`customers-${new Date().toISOString().slice(0, 10)}.csv`, header, lines);
    this.notify.info(`Exported ${rows.length} customer(s).`);
  }
}
