import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { Shipment, ShipmentSearchRequest, ShipmentSummaryStats } from '@core/models/shipment.model';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { SortState, TableColumn } from '@shared/components/ui-table/ui-table';
import { UiTable } from '@shared/components/ui-table/ui-table';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { MasterDataService } from '@features/masters/master-data.service';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { ShipmentStatusBadge } from '../shipment/components/shipment-status-badge';
import { ShipmentService } from '../shipment/shipment.service';
import { downloadCsv } from '@shared/utils/csv-export.util';

/**
 * Shipment Exception Report — shipments that ended in `RETURNED` (cancelled ones
 * are in the Cancelled Orders Report; `ShipmentStatus` defines (there is no separate RTO/damaged/
 * lost status in this system). SLA-breach visibility already exists as auto-raised
 * tickets in Ticket Support (category "SLA Breach") — not duplicated here.
 */
const EXCEPTION_STATUSES = ['RETURNED'] as const;

@Component({
  selector: 'app-shipment-exception-report',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, UiTable, UiPagination, UiButton, ShipmentStatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Shipment Exception Report</h1>
          <p class="text-caption">{{ page().totalElements }} returned shipment(s) {{ myBranchId ? 'at your branch' : 'across the company' }}.</p></div>
        <div class="page__actions">
          <label class="dfld">From <input type="date" [value]="from()" (change)="onFrom($event)" /></label>
          <label class="dfld">To <input type="date" [value]="to()" (change)="onTo($event)" /></label>
          <app-button variant="stroked" icon="download" [loading]="exporting()" (pressed)="exportCsv()">Export</app-button>
        </div>
      </header>

      <div class="stats">
        <div class="stat"><span class="stat__l">Total Exceptions</span><span class="stat__v">{{ summary()?.totalCount ?? '—' }}</span></div>
        <div class="stat"><span class="stat__l">Returned</span><span class="stat__v">{{ summary()?.statusCounts?.RETURNED ?? 0 }}</span></div>
        <div class="stat"><span class="stat__l">Chargeable Weight</span>
          <span class="stat__v">{{ summary() ? (summary()!.totalChargeableWeight | number: '1.3-3') + ' kg' : '—' }}</span></div>
        <div class="stat"><span class="stat__l">Amount</span>
          <span class="stat__v">{{ summary() ? '₹' + (summary()!.totalNetAmount | number: '1.2-2') : '—' }}</span></div>
      </div>

      <app-table [columns]="columns" [rows]="page().content" [loading]="loading()" [sort]="sort()"
                 [startIndex]="page().page * page().size"
                 emptyTitle="No exceptions" emptyHint="No returned shipment in this range."
                 (sortChange)="onSort($event)" (rowClick)="view($event)">
        <ng-template #row let-s>
          <td><span class="mono">{{ s.shipmentNumber }}</span></td>
          <td><span class="mono awb">{{ s.trackingNumber }}</span></td>
          <td>{{ s.bookingDate }}</td>
          <td>{{ branchLabel(s.bookingBranchId) }}</td>
          <td>{{ branchLabel(s.deliveryBranchId) }}</td>
          <td>{{ s.senderName }}</td>
          <td>{{ s.receiverName }}</td>
          <td class="num">{{ s.chargeableWeight | number: '1.3-3' }} kg</td>
          <td class="num">{{ s.netAmount != null ? ('₹' + (s.netAmount | number: '1.2-2')) : '—' }}</td>
          <td><app-shipment-status-badge [status]="s.status" /></td>
        </ng-template>
      </app-table>

      <app-pagination [page]="page()" (pageChange)="onPage($event)" />
    </div>
  `,
  styles: [`
    .page__head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:12px; }
    .page__actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .dfld { display:flex; align-items:center; gap:6px; font:500 16px var(--font-sans); color:var(--content-fg); }
    .dfld input { height:38px; padding:0 10px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-field); font:400 16px var(--font-sans); color:var(--content-fg); }
    .stats { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
    .stat { display:flex; flex-direction:column; gap:4px; padding:12px 18px; min-width:150px;
      background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .stat__l { font:500 15px var(--font-sans); color:var(--content-muted); }
    .stat__v { font:700 23px var(--font-sans); color:var(--content-fg); }
    .mono { font:600 16px var(--font-mono, ui-monospace); color:var(--content-fg); }
    .awb { color:var(--brand-600); }
    .num { text-align:right; }
  `]
})
export class ShipmentExceptionReport implements OnInit {
  private readonly service = inject(ShipmentService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly myBranchId = this.auth.user()?.branchId ?? null;

  protected readonly branchOptions = signal<SelectOption[]>([]);
  protected readonly loading = signal(true);
  protected readonly exporting = signal(false);
  protected readonly page = signal<Page<Shipment>>(emptyPage<Shipment>());
  protected readonly sort = signal<SortState | null>({ active: 'bookingDate', direction: 'desc' });
  protected readonly summary = signal<ShipmentSummaryStats | null>(null);
  protected readonly from = signal('');
  protected readonly to = signal('');

  protected readonly columns: TableColumn<Shipment>[] = [
    { key: 'shipmentNumber', header: 'Shipment No.', sortable: true },
    { key: 'trackingNumber', header: 'AWB' },
    { key: 'bookingDate', header: 'Booking Date', sortable: true },
    { key: 'bookingBranchId', header: 'Booking Branch' },
    { key: 'deliveryBranchId', header: 'Delivery Branch' },
    { key: 'senderName', header: 'Sender' },
    { key: 'receiverName', header: 'Receiver' },
    { key: 'chargeableWeight', header: 'Chargeable Wt.', align: 'right' },
    { key: 'netAmount', header: 'Amount', align: 'right' },
    { key: 'status', header: 'Status', width: '140px' }
  ];

  private query: PageQuery = { page: 0, size: 20, sort: 'bookingDate,desc' };

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Reports' }, { label: 'Shipment Exception Report' }]);
    this.masters.options('branches').subscribe((o) => this.branchOptions.set(o));
    this.load();
    this.loadSummary();
  }

  private filterRequest(): ShipmentSearchRequest {
    return {
      status: [...EXCEPTION_STATUSES],
      bookingBranchId: this.myBranchId ?? undefined,
      bookingDateFrom: this.from() || undefined, bookingDateTo: this.to() || undefined
    };
  }

  private buildQuery(size?: number): PageQuery {
    const f = this.filterRequest();
    return {
      ...this.query, ...(size ? { size, page: 0 } : {}),
      status: f.status as unknown as string, bookingBranchId: f.bookingBranchId,
      bookingDateFrom: f.bookingDateFrom, bookingDateTo: f.bookingDateTo
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
  }

  onFrom(e: Event): void { this.from.set((e.target as HTMLInputElement).value); this.query = { ...this.query, page: 0 }; this.load(); this.loadSummary(); }
  onTo(e: Event): void { this.to.set((e.target as HTMLInputElement).value); this.query = { ...this.query, page: 0 }; this.load(); this.loadSummary(); }
  onPage(i: number) { this.query = { ...this.query, page: i }; this.load(); }
  onSort(s: SortState) { this.sort.set(s); this.query = { ...this.query, sort: `${s.active},${s.direction}`, page: 0 }; this.load(); }

  view(s: Shipment): void { this.router.navigate(['/shipments', s.id]); }

  protected branchLabel(id: string | null | undefined): string { return this.branchOptions().find((o) => o.value === id)?.label ?? '—'; }

  exportCsv(): void {
    this.exporting.set(true);
    this.service.list(this.buildQuery(100)).subscribe({
      next: (p) => { this.download(p.content); this.exporting.set(false); },
      error: () => { this.exporting.set(false); this.notify.error('Export failed.'); }
    });
  }

  private download(rows: Shipment[]): void {
    const header = ['shipmentNumber', 'trackingNumber', 'bookingDate', 'bookingBranch', 'deliveryBranch',
      'sender', 'senderContact', 'receiver', 'receiverContact', 'chargeableWeight', 'netAmount', 'status'];
    const lines = rows.map((r) => [r.shipmentNumber, r.trackingNumber, r.bookingDate,
      this.branchLabel(r.bookingBranchId), this.branchLabel(r.deliveryBranchId),
      r.senderName, r.senderContact, r.receiverName, r.receiverContact,
      r.chargeableWeight, r.netAmount ?? '', r.status]);
    downloadCsv(`shipment-exception-report-${new Date().toISOString().slice(0, 10)}.csv`, header, lines, [9, 10]);
    this.notify.info(`Exported ${rows.length} shipment(s).`);
  }
}
