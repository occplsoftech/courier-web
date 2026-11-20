import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { VendorAuditRow, ShipmentSearchRequest } from '@core/models/shipment.model';
import { TableColumn } from '@shared/components/ui-table/ui-table';
import { UiTable } from '@shared/components/ui-table/ui-table';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { MasterDataService } from '@features/masters/master-data.service';
import { ShipmentService } from '../shipment/shipment.service';
import { excludingCancelled } from './non-cancelled.util';
import { downloadCsv } from '@shared/utils/csv-export.util';

/**
 * Vendor Audit Report — one row per company branch (booking-side or delivery-side), the
 * reconciliation table a franchise/vendor audit reviews: paid/to-pay volumes and amounts,
 * booking and delivery (DRS) commission, ODA charges and other charges.
 * Company-level by design — unlike every other report in this module, it is deliberately
 * not locked to the caller's own branch, since an audit needs every branch side by side.
 * `GET /shipments/vendor-audit`, already grouped server-side — same "unpaged aggregate,
 * single call" shape every other report uses. See backend `VendorAuditRow` for the one
 * known limitation on the delivery-commission figures (recomputed at current DRS rate).
 */
@Component({
  selector: 'app-vendor-audit-report',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, UiTable, UiButton],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Vendor Audit Report</h1>
          <p class="text-caption">{{ rows().length }} branch(es) across the company.</p></div>
        <div class="page__actions">
          <label class="dfld">From <input type="date" [value]="from()" (change)="onFrom($event)" /></label>
          <label class="dfld">To <input type="date" [value]="to()" (change)="onTo($event)" /></label>
          <app-button variant="stroked" icon="download" [loading]="exporting()" (pressed)="exportCsv()">Export</app-button>
        </div>
      </header>

      <div class="stats">
        <div class="stat"><span class="stat__l">Total Booked</span><span class="stat__v">{{ loading() ? '—' : totals().totalBookedOrderCount }}</span></div>
        <div class="stat"><span class="stat__l">Total Delivered</span><span class="stat__v">{{ loading() ? '—' : totals().totalDeliveredOrderCount }}</span></div>
        <div class="stat"><span class="stat__l">Paid Orders</span><span class="stat__v">{{ loading() ? '—' : totals().paidOrderCount }}</span></div>
        <div class="stat"><span class="stat__l">To-Pay Orders</span><span class="stat__v">{{ loading() ? '—' : totals().topayOrderCount }}</span></div>
        <div class="stat"><span class="stat__l">Booking Commission</span><span class="stat__v">{{ loading() ? '—' : ('₹' + (totals().bookingTotalCommission | number: '1.2-2')) }}</span></div>
        <div class="stat"><span class="stat__l">Delivery Commission</span><span class="stat__v">{{ loading() ? '—' : ('₹' + (totals().deliveryTotalCommission | number: '1.2-2')) }}</span></div>
        <div class="stat"><span class="stat__l">ODA Charges</span><span class="stat__v">{{ loading() ? '—' : ('₹' + (totals().odaCharges | number: '1.2-2')) }}</span></div>
        <div class="stat"><span class="stat__l">Other Charges</span><span class="stat__v">{{ loading() ? '—' : ('₹' + (totals().otherCharges | number: '1.2-2')) }}</span></div>
      </div>

      <div class="twrap">
        <app-table [columns]="columns" [rows]="rows()" [loading]="loading()"
                   emptyTitle="No shipments" emptyHint="Nothing matches this date range yet.">
          <ng-template #row let-r>
            <td>{{ branchLabel(r.branchId) }}</td>
            <td class="num">{{ r.paidOrderCount }}</td>
            <td class="num">{{ r.paidOrderQuantity }}</td>
            <td class="num">₹{{ r.paidOrderAmount | number: '1.2-2' }}</td>
            <td class="num">{{ r.topayOrderCount }}</td>
            <td class="num">{{ r.topayOrderQuantity }}</td>
            <td class="num">₹{{ r.topayOrderAmount | number: '1.2-2' }}</td>
            <td class="num">₹{{ r.paidCommission | number: '1.2-2' }}</td>
            <td class="num">₹{{ r.deliveryCommission | number: '1.2-2' }}</td>
            <td class="num">{{ r.totalBookedOrderCount }}</td>
            <td class="num">{{ r.totalDeliveredOrderCount }}</td>
            <td class="num strong">₹{{ r.bookingTotalCommission | number: '1.2-2' }}</td>
            <td class="num strong">₹{{ r.deliveryTotalCommission | number: '1.2-2' }}</td>
            <td class="num">₹{{ r.odaCharges | number: '1.2-2' }}</td>
            <td class="num">₹{{ r.otherCharges | number: '1.2-2' }}</td>
          </ng-template>
        </app-table>
      </div>
    </div>
  `,
  styles: [`
    .page__head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:12px; }
    .page__actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .dfld { display:flex; align-items:center; gap:6px; font:500 16px var(--font-sans); color:var(--content-fg); }
    .dfld input { height:38px; padding:0 10px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-field); font:400 16px var(--font-sans); color:var(--content-fg); }
    .stats { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
    .stat { display:flex; flex-direction:column; gap:4px; padding:12px 18px; min-width:140px;
      background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .stat__l { font:500 15px var(--font-sans); color:var(--content-muted); }
    .stat__v { font:700 23px var(--font-sans); color:var(--content-fg); }
    .twrap { overflow-x:auto; }
    .num { text-align:right; }
    .strong { font-weight:700; }
  `]
})
export class VendorAuditReport implements OnInit {
  private readonly service = inject(ShipmentService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);

  protected readonly branchOptions = signal<SelectOption[]>([]);
  protected readonly loading = signal(true);
  protected readonly exporting = signal(false);
  protected readonly rows = signal<VendorAuditRow[]>([]);
  protected readonly from = signal('');
  protected readonly to = signal('');

  protected readonly columns: TableColumn<VendorAuditRow>[] = [
    { key: 'branchId', header: 'Branch' },
    { key: 'paidOrderCount', header: 'Paid Count', align: 'right' },
    { key: 'paidOrderQuantity', header: 'Paid Qty', align: 'right' },
    { key: 'paidOrderAmount', header: 'Paid Amount', align: 'right' },
    { key: 'topayOrderCount', header: 'To-Pay Count', align: 'right' },
    { key: 'topayOrderQuantity', header: 'To-Pay Qty', align: 'right' },
    { key: 'topayOrderAmount', header: 'To-Pay Amount', align: 'right' },
    { key: 'paidCommission', header: 'Commission on Paid', align: 'right' },
    { key: 'deliveryCommission', header: 'Commission on Delivered', align: 'right' },
    { key: 'totalBookedOrderCount', header: 'Total Booked', align: 'right' },
    { key: 'totalDeliveredOrderCount', header: 'Total Delivered', align: 'right' },
    { key: 'bookingTotalCommission', header: 'Booking Total Commission', align: 'right' },
    { key: 'deliveryTotalCommission', header: 'Delivery Total Commission', align: 'right' },
    { key: 'odaCharges', header: 'ODA Charges', align: 'right' },
    { key: 'otherCharges', header: 'Other Charges', align: 'right' }
  ];

  protected readonly totals = computed(() => this.rows().reduce((t, r) => ({
    paidOrderCount: t.paidOrderCount + r.paidOrderCount,
    topayOrderCount: t.topayOrderCount + r.topayOrderCount,
    totalBookedOrderCount: t.totalBookedOrderCount + r.totalBookedOrderCount,
    totalDeliveredOrderCount: t.totalDeliveredOrderCount + r.totalDeliveredOrderCount,
    bookingTotalCommission: t.bookingTotalCommission + r.bookingTotalCommission,
    deliveryTotalCommission: t.deliveryTotalCommission + r.deliveryTotalCommission,
    odaCharges: t.odaCharges + r.odaCharges,
    otherCharges: t.otherCharges + r.otherCharges
  }), {
    paidOrderCount: 0, topayOrderCount: 0, totalBookedOrderCount: 0, totalDeliveredOrderCount: 0,
    bookingTotalCommission: 0, deliveryTotalCommission: 0, odaCharges: 0, otherCharges: 0
  }));

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Reports' }, { label: 'Vendor Audit Report' }]);
    this.masters.options('branches').subscribe((o) => this.branchOptions.set(o));
    this.load();
  }

  /** No branch lock, on purpose — this report is company-level, not scoped to the
   *  caller's own branch like every other report in this module. */
  private filterRequest(): ShipmentSearchRequest {
    return { status: excludingCancelled(), bookingDateFrom: this.from() || undefined, bookingDateTo: this.to() || undefined };
  }

  load(): void {
    this.loading.set(true);
    this.service.vendorAudit(this.filterRequest()).subscribe({
      next: (rows) => { this.rows.set(rows); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  onFrom(e: Event): void { this.from.set((e.target as HTMLInputElement).value); this.load(); }
  onTo(e: Event): void { this.to.set((e.target as HTMLInputElement).value); this.load(); }

  protected branchLabel(id: string): string { return this.branchOptions().find((o) => o.value === id)?.label ?? '—'; }

  exportCsv(): void {
    this.exporting.set(true);
    try {
      this.download(this.rows());
    } finally {
      this.exporting.set(false);
    }
  }

  private download(rows: VendorAuditRow[]): void {
    const header = ['branch', 'paidOrderCount', 'paidOrderQuantity', 'paidOrderAmount',
      'topayOrderCount', 'topayOrderQuantity', 'topayOrderAmount', 'paidCommission', 'deliveryCommission',
      'totalBookedOrderCount', 'totalDeliveredOrderCount', 'bookingTotalCommission', 'deliveryTotalCommission',
      'odaCharges', 'otherCharges'];
    const lines = rows.map((r) => [this.branchLabel(r.branchId), r.paidOrderCount, r.paidOrderQuantity,
      r.paidOrderAmount, r.topayOrderCount, r.topayOrderQuantity, r.topayOrderAmount, r.paidCommission,
      r.deliveryCommission, r.totalBookedOrderCount, r.totalDeliveredOrderCount, r.bookingTotalCommission,
      r.deliveryTotalCommission, r.odaCharges, r.otherCharges]);
    downloadCsv(`vendor-audit-report-${new Date().toISOString().slice(0, 10)}.csv`, header, lines,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    this.notify.info(`Exported ${rows.length} branch row(s).`);
  }
}
