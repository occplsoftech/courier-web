import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { Customer, CustomerSearchRequest } from '@core/models/customer.model';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { SortState, TableColumn } from '@shared/components/ui-table/ui-table';
import { UiTable } from '@shared/components/ui-table/ui-table';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiDrawer } from '@shared/components/ui-drawer/ui-drawer';
import { CustomerFilter } from '../customer/components/customer-filter';
import { CustomerStatusBadge } from '../customer/components/customer-status-badge';
import { CustomerService } from '../customer/customer.service';
import { downloadCsv } from '@shared/utils/csv-export.util';

/**
 * Customer Report — read-only (no create/edit/activate — Customer List already owns
 * those). Stat tiles are four cheap `size=1` reads of `totalElements`, since there is no
 * dedicated aggregate endpoint and Customer's own data volumes are a company's own
 * master list, not large enough to need one. Same filter/pagination/export shape as
 * `CustomerList`, plus `createdDate` on the export.
 */
@Component({
  selector: 'app-customer-report',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, UiTable, UiPagination, UiButton, UiDrawer, CustomerFilter, CustomerStatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Customer Report</h1>
          <p class="text-caption">{{ page().totalElements }} customer(s) matching the current filter.</p></div>
        <div class="page__actions">
          <app-button variant="stroked" icon="filter_list" (pressed)="filterOpen.set(true)">
            Filters@if (activeFilters()) { <span class="fbadge">{{ activeFilters() }}</span> }
          </app-button>
          <app-button variant="stroked" icon="download" [loading]="exporting()" (pressed)="exportCsv()">Export</app-button>
        </div>
      </header>

      <div class="stats">
        <div class="stat"><span class="stat__l">Total</span><span class="stat__v">{{ statsLoading() ? '—' : stats().total }}</span></div>
        <div class="stat"><span class="stat__l">Active</span><span class="stat__v">{{ statsLoading() ? '—' : stats().active }}</span></div>
        <div class="stat"><span class="stat__l">Inactive</span><span class="stat__v">{{ statsLoading() ? '—' : stats().inactive }}</span></div>
        <div class="stat"><span class="stat__l">Individual</span><span class="stat__v">{{ statsLoading() ? '—' : stats().individual }}</span></div>
        <div class="stat"><span class="stat__l">Business</span><span class="stat__v">{{ statsLoading() ? '—' : stats().business }}</span></div>
      </div>

      <app-table [columns]="columns" [rows]="page().content" [loading]="loading()" [sort]="sort()"
                 [startIndex]="page().page * page().size"
                 emptyTitle="No customers" emptyHint="Nothing matches this filter yet."
                 (sortChange)="onSort($event)" (rowClick)="view($event)">
        <ng-template #row let-c>
          <td class="mono">{{ c.customerCode }}</td>
          <td>{{ c.displayName }}</td>
          <td>{{ c.customerType === 'INDIVIDUAL' ? 'Individual' : 'Business' }}</td>
          <td>{{ c.mobile }}</td>
          <td>{{ c.email || '—' }}</td>
          <td><app-customer-status-badge [status]="c.status" /></td>
          <td>{{ c.createdDate ? (c.createdDate | date: 'mediumDate') : '—' }}</td>
        </ng-template>
      </app-table>

      <app-pagination [page]="page()" (pageChange)="onPage($event)" />

      <app-drawer [open]="filterOpen()" title="Advanced filters" subtitle="Narrow the customer report." (closed)="filterOpen.set(false)">
        <app-customer-filter (changed)="onFilter($event)" />
      </app-drawer>
    </div>
  `,
  styles: [`
    .page__head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:12px; }
    .page__actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .fbadge { display:inline-grid; place-items:center; min-width:18px; height:18px; padding:0 5px; margin-left:2px;
      background:var(--brand-600); color:#fff; border-radius:999px; font:700 14px var(--font-sans); }
    .stats { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
    .stat { display:flex; flex-direction:column; gap:4px; padding:12px 18px; min-width:120px;
      background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .stat__l { font:500 15px var(--font-sans); color:var(--content-muted); }
    .stat__v { font:700 23px var(--font-sans); color:var(--content-fg); }
    .mono { font:600 16px var(--font-mono, ui-monospace); color:var(--content-fg); }
  `]
})
export class CustomerReport implements OnInit {
  private readonly service = inject(CustomerService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly statsLoading = signal(true);
  protected readonly exporting = signal(false);
  protected readonly filterOpen = signal(false);
  protected readonly page = signal<Page<Customer>>(emptyPage<Customer>());
  protected readonly sort = signal<SortState | null>({ active: 'customerCode', direction: 'asc' });
  protected readonly stats = signal({ total: 0, active: 0, inactive: 0, individual: 0, business: 0 });

  protected readonly columns: TableColumn<Customer>[] = [
    { key: 'customerCode', header: 'Code', sortable: true },
    { key: 'displayName', header: 'Name' },
    { key: 'customerType', header: 'Type' },
    { key: 'mobile', header: 'Mobile' },
    { key: 'email', header: 'Email' },
    { key: 'status', header: 'Status', width: '120px' },
    { key: 'createdDate', header: 'Created', sortable: true }
  ];

  private query: PageQuery = { page: 0, size: 20, sort: 'customerCode,asc' };
  private readonly filters = signal<CustomerSearchRequest>({});
  protected readonly activeFilters = computed(() =>
    Object.values(this.filters()).filter((v) => v != null && (!Array.isArray(v) || v.length)).length);

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Reports' }, { label: 'Customer Report' }]);
    this.load();
    this.loadStats();
  }

  private buildQuery(size?: number): PageQuery {
    const f = this.filters();
    return {
      ...this.query, ...(size ? { size, page: 0 } : {}),
      customerType: f.customerType as unknown as string | undefined,
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

  private loadStats(): void {
    this.statsLoading.set(true);
    const one = { page: 0, size: 1 };
    forkJoin({
      total: this.service.list({ ...one }),
      active: this.service.list({ ...one, status: 'ACTIVE' }),
      inactive: this.service.list({ ...one, status: 'INACTIVE' }),
      individual: this.service.list({ ...one, customerType: 'INDIVIDUAL' }),
      business: this.service.list({ ...one, customerType: 'BUSINESS' })
    }).subscribe({
      next: (r) => {
        this.stats.set({
          total: r.total.totalElements, active: r.active.totalElements, inactive: r.inactive.totalElements,
          individual: r.individual.totalElements, business: r.business.totalElements
        });
        this.statsLoading.set(false);
      },
      error: () => this.statsLoading.set(false)
    });
  }

  onPage(i: number) { this.query = { ...this.query, page: i }; this.load(); }
  onSort(s: SortState) { this.sort.set(s); this.query = { ...this.query, sort: `${s.active},${s.direction}`, page: 0 }; this.load(); }
  onFilter(f: CustomerSearchRequest) {
    this.filters.set(f); this.query = { ...this.query, page: 0 }; this.filterOpen.set(false);
    this.load(); this.loadStats();
  }

  view(c: Customer): void { this.router.navigate(['/customers', c.id]); }

  exportCsv(): void {
    this.exporting.set(true);
    this.service.list(this.buildQuery(100)).subscribe({
      next: (p) => { this.download(p.content); this.exporting.set(false); },
      error: () => { this.exporting.set(false); this.notify.error('Export failed.'); }
    });
  }

  private download(rows: Customer[]): void {
    const header = ['customerCode', 'displayName', 'customerType', 'mobile', 'email', 'status', 'createdDate'];
    const lines = rows.map((r) => [r.customerCode, r.displayName, r.customerType, r.mobile, r.email,
      r.status, r.createdDate]);
    downloadCsv(`customer-report-${new Date().toISOString().slice(0, 10)}.csv`, header, lines);
    this.notify.info(`Exported ${rows.length} customer(s).`);
  }
}
