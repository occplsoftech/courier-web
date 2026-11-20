import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { Shipment, ShipmentSearchRequest, ShipmentStatus, ShipmentSummaryStats } from '@core/models/shipment.model';
import { totalCommissionOf } from './commission-total.util';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { SortState, TableColumn } from '@shared/components/ui-table/ui-table';
import { UiTable } from '@shared/components/ui-table/ui-table';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiDrawer } from '@shared/components/ui-drawer/ui-drawer';
import { MasterDataService } from '@features/masters/master-data.service';
import { ShipmentFilter } from '../shipment/components/shipment-filter';
import { ShipmentStatusBadge } from '../shipment/components/shipment-status-badge';
import { ShipmentService } from '../shipment/shipment.service';
import { excludingCancelled } from './non-cancelled.util';
import { downloadCsv } from '@shared/utils/csv-export.util';

/** The delivery-flow statuses a Delivery Report opens on — same worklist the delivery
 *  desk itself works off (see delivery.ts), plus DELIVERED/RETURNED as terminal outcomes.
 *  The filter drawer can still widen this to any status. */
const DEFAULT_STATUSES: ShipmentStatus[] = ['IN_SCAN', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED'];

/**
 * Delivery Report — shipments in the delivery pipeline (or resolved out of it), filterable
 * by delivered-date range/branch/status. `deliveredAt` and payment mode (the COD signal —
 * see `PaymentMode.collectAtDelivery`) come from the same list endpoint as Booking Report,
 * just filtered/columned differently; there is no separate "was COD actually collected"
 * field anywhere in the system today, so this shows the payment mode, not a collected flag.
 */
@Component({
  selector: 'app-delivery-report',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, DatePipe, UiTable, UiPagination, UiButton, UiDrawer, ShipmentFilter, ShipmentStatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Delivery Report</h1>
          <p class="text-caption">{{ page().totalElements }} shipment(s) in the delivery pipeline {{ myBranchId ? 'at your branch' : 'across the company' }}.</p></div>
        <div class="page__actions">
          <app-button variant="stroked" icon="filter_list" (pressed)="filterOpen.set(true)">
            Filters@if (activeFilters()) { <span class="fbadge">{{ activeFilters() }}</span> }
          </app-button>
          <app-button variant="stroked" icon="download" [loading]="exporting()" (pressed)="exportCsv()">Export</app-button>
        </div>
      </header>

      <div class="stats">
        <div class="stat"><span class="stat__l">Total</span><span class="stat__v">{{ summary()?.totalCount ?? '—' }}</span></div>
        <div class="stat"><span class="stat__l">Delivered</span><span class="stat__v">{{ summary()?.statusCounts?.DELIVERED ?? 0 }}</span></div>
        <div class="stat"><span class="stat__l">Pending</span><span class="stat__v">{{ pendingCount() }}</span></div>
        <div class="stat"><span class="stat__l">Returned</span><span class="stat__v">{{ summary()?.statusCounts?.RETURNED ?? 0 }}</span></div>
        <div class="stat"><span class="stat__l">Total Amount</span>
          <span class="stat__v">{{ summary() ? '₹' + (summary()!.totalNetAmount | number: '1.2-2') : '—' }}</span></div>
        <div class="stat"><span class="stat__l">Total Commission</span>
          <span class="stat__v">{{ totalCommission() != null ? '₹' + (totalCommission()! | number: '1.2-2') : '—' }}</span></div>
      </div>

      <app-table [columns]="columns" [rows]="page().content" [loading]="loading()" [sort]="sort()"
                 [startIndex]="page().page * page().size"
                 emptyTitle="No deliveries" emptyHint="Nothing matches this filter yet."
                 (sortChange)="onSort($event)" (rowClick)="view($event)">
        <ng-template #row let-s>
          <td><span class="mono">{{ s.shipmentNumber }}</span></td>
          <td><span class="mono awb">{{ s.trackingNumber }}</span></td>
          <td>{{ branchLabel(s.deliveryBranchId) }}</td>
          <td>{{ s.receiverName }}</td>
          <td class="mono">{{ s.receiverContact }}</td>
          <td>{{ paymentModeLabel(s.paymentModeId) }}</td>
          <td class="num">{{ s.netAmount != null ? ('₹' + (s.netAmount | number: '1.2-2')) : '—' }}</td>
          <td><app-shipment-status-badge [status]="s.status" /></td>
          <td>{{ s.deliveredAt ? (s.deliveredAt | date: 'dd MMM y, h:mm a') : '—' }}</td>
        </ng-template>
      </app-table>

      <app-pagination [page]="page()" (pageChange)="onPage($event)" />

      <app-drawer [open]="filterOpen()" title="Advanced filters" subtitle="Narrow the delivery report." (closed)="filterOpen.set(false)">
        <app-shipment-filter mode="delivery" [excludeCancelled]="true" [lockDeliveryBranch]="!!myBranchId" (changed)="onFilter($event)" />
      </app-drawer>
    </div>
  `,
  styles: [`
    .page__head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:12px; }
    .page__actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .fbadge { display:inline-grid; place-items:center; min-width:18px; height:18px; padding:0 5px; margin-left:2px;
      background:var(--brand-600); color:#fff; border-radius:999px; font:700 14px var(--font-sans); }
    .stats { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
    .stat { display:flex; flex-direction:column; gap:4px; padding:12px 18px; min-width:130px;
      background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .stat__l { font:500 15px var(--font-sans); color:var(--content-muted); }
    .stat__v { font:700 23px var(--font-sans); color:var(--content-fg); }
    .mono { font:600 16px var(--font-mono, ui-monospace); color:var(--content-fg); }
    .awb { color:var(--brand-600); }
    .num { text-align:right; }
  `]
})
export class DeliveryReport implements OnInit {
  private readonly service = inject(ShipmentService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly myBranchId = this.auth.user()?.branchId ?? null;

  protected readonly branchOptions = signal<SelectOption[]>([]);
  protected readonly paymentModeOptions = signal<SelectOption[]>([]);
  protected readonly loading = signal(true);
  protected readonly exporting = signal(false);
  protected readonly filterOpen = signal(false);
  protected readonly page = signal<Page<Shipment>>(emptyPage<Shipment>());
  protected readonly sort = signal<SortState | null>({ active: 'createdDate', direction: 'desc' });
  /** Unpaged aggregates over the whole filtered result set — reloaded on filter change only. */
  protected readonly summary = signal<ShipmentSummaryStats | null>(null);
  /** Sum of `totalCommission` across every matching shipment — its own fetch since
   *  `ShipmentSummaryStats` doesn't carry the commission breakdown. */
  protected readonly totalCommission = signal<number | null>(null);
  /** Still moving: scanned in or out for delivery, not yet resolved either way. */
  protected readonly pendingCount = computed(() => {
    const c = this.summary()?.statusCounts;
    return (c?.IN_SCAN ?? 0) + (c?.OUT_FOR_DELIVERY ?? 0);
  });

  protected readonly columns: TableColumn<Shipment>[] = [
    { key: 'shipmentNumber', header: 'Shipment No.', sortable: true },
    { key: 'trackingNumber', header: 'AWB' },
    { key: 'deliveryBranchId', header: 'Delivery Branch' },
    { key: 'receiverName', header: 'Receiver' },
    { key: 'receiverContact', header: 'Receiver Contact' },
    { key: 'paymentModeId', header: 'Payment Mode' },
    { key: 'netAmount', header: 'Amount', align: 'right' },
    { key: 'status', header: 'Status', width: '150px' },
    { key: 'deliveredAt', header: 'Delivered At' }
  ];

  private query: PageQuery = { page: 0, size: 20, sort: 'createdDate,desc' };
  private readonly filters = signal<ShipmentSearchRequest>({ status: DEFAULT_STATUSES });
  protected readonly activeFilters = computed(() =>
    Object.values(this.filters()).filter((v) => v != null && (!Array.isArray(v) || v.length)).length);

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Reports' }, { label: 'Delivery Report' }]);
    this.masters.options('branches').subscribe((o) => this.branchOptions.set(o));
    this.masters.options('payment-modes').subscribe((o) => this.paymentModeOptions.set(o));
    this.load();
    this.loadSummary();
  }

  /** The filter portion shared by the paged list, the summary aggregate, and export —
   *  branch-locks the same way `buildQuery` does. */
  private filterRequest(): ShipmentSearchRequest {
    const f = this.filters();
    return {
      status: excludingCancelled(f.status),
      bookingBranchId: f.bookingBranchId, deliveryBranchId: this.myBranchId ?? f.deliveryBranchId,
      deliveredDateFrom: f.deliveredDateFrom, deliveredDateTo: f.deliveredDateTo
    };
  }

  private buildQuery(size?: number): PageQuery {
    return {
      ...this.query, ...(size ? { size, page: 0 } : {}),
      ...this.filterRequest(), status: this.filterRequest().status as unknown as string | undefined
    };
  }

  private load(): void {
    this.loading.set(true);
    this.service.list(this.buildQuery()).subscribe({
      next: (p) => { this.page.set(p); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  private loadSummary(): void {
    this.service.summary(this.filterRequest()).subscribe({ next: (s) => this.summary.set(s) });
    this.service.commissionSummary(this.filterRequest())
      .subscribe({ next: (rows) => this.totalCommission.set(totalCommissionOf(rows)) });
  }

  onPage(i: number) { this.query = { ...this.query, page: i }; this.load(); }
  onSort(s: SortState) { this.sort.set(s); this.query = { ...this.query, sort: `${s.active},${s.direction}`, page: 0 }; this.load(); }
  onFilter(f: ShipmentSearchRequest) {
    this.filters.set(f); this.query = { ...this.query, page: 0 }; this.filterOpen.set(false);
    this.load(); this.loadSummary();
  }

  view(s: Shipment): void { this.router.navigate(['/shipments', s.id]); }

  protected branchLabel(id: string | null | undefined): string { return this.branchOptions().find((o) => o.value === id)?.label ?? '—'; }
  protected paymentModeLabel(id: string): string { return this.paymentModeOptions().find((o) => o.value === id)?.label ?? '—'; }

  exportCsv(): void {
    this.exporting.set(true);
    this.service.list(this.buildQuery(100)).subscribe({
      next: (p) => { this.download(p.content); this.exporting.set(false); },
      error: () => { this.exporting.set(false); this.notify.error('Export failed.'); }
    });
  }

  private download(rows: Shipment[]): void {
    const header = ['shipmentNumber', 'trackingNumber', 'deliveryBranch', 'receiver', 'receiverContact',
      'paymentMode', 'netAmount', 'totalCommission', 'commissionOnBasicFreight',
      'branchCommissionOnOtherAmount', 'companyCommissionOnBasicFreight', 'status', 'deliveredAt'];
    const lines = rows.map((r) => [r.shipmentNumber, r.trackingNumber, this.branchLabel(r.deliveryBranchId),
      r.receiverName, r.receiverContact, this.paymentModeLabel(r.paymentModeId),
      r.netAmount ?? '', r.totalCommission ?? '', r.commissionOnBasicFreight ?? '',
      r.branchCommissionOnOtherAmount ?? '', r.companyCommissionOnBasicFreight ?? '',
      r.status, r.deliveredAt ?? '']);
    downloadCsv(`delivery-report-${new Date().toISOString().slice(0, 10)}.csv`, header, lines, [6, 7, 8, 9, 10]);
    this.notify.info(`Exported ${rows.length} delivery record(s).`);
  }
}
