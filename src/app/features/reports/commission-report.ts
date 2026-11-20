import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { BranchCommissionSummary } from '@core/models/shipment.model';
import { TableColumn, UiTable } from '@shared/components/ui-table/ui-table';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { MasterDataService } from '@features/masters/master-data.service';
import { ShipmentService } from '../shipment/shipment.service';
import { excludingCancelled } from './non-cancelled.util';
import { downloadCsv } from '@shared/utils/csv-export.util';
import { currentMonth, monthLabel, monthRange } from './commission-month.util';

/**
 * Commission Report — month-wise list of branches with the commission each earned
 * (`GET /shipments/commission-summary` over the month's booking dates). Clicking a branch
 * opens `CommissionBranchDetail` with that branch's summary and shipment list. A branch role
 * keeps its own `bookingBranchId` lock, so it sees only its own row.
 */
@Component({
  selector: 'app-commission-report',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, UiTable, UiButton],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Commission Report</h1>
          <p class="text-caption">Commission for {{ label() }} {{ myBranchId ? 'for your branch' : 'by branch' }}. Click a branch for its shipments.</p></div>
        <div class="page__actions">
          <label class="month">Month
            <input type="month" [value]="month()" [max]="maxMonth" (change)="onMonth($any($event.target).value)" />
          </label>
          <app-button variant="stroked" icon="download" [loading]="exporting()" (pressed)="exportCsv()">Export</app-button>
        </div>
      </header>

      <div class="stats">
        <div class="stat"><span class="stat__l">Branches</span><span class="stat__v">{{ loading() ? '—' : rows().length }}</span></div>
        <div class="stat"><span class="stat__l">Shipments</span><span class="stat__v">{{ loading() ? '—' : totals().shipmentCount }}</span></div>
        <div class="stat"><span class="stat__l">Amount</span><span class="stat__v">{{ loading() ? '—' : ('₹' + (totals().totalNetAmount | number: '1.2-2')) }}</span></div>
        <div class="stat"><span class="stat__l">Total Commission</span><span class="stat__v">{{ loading() ? '—' : ('₹' + (totals().totalCommission | number: '1.2-2')) }}</span></div>
      </div>

      <app-table [columns]="columns" [rows]="rows()" [loading]="loading()"
                 emptyTitle="No commission" emptyHint="No shipments booked in this month."
                 (rowClick)="open($event)">
        <ng-template #row let-r>
          <td><span class="branch">{{ branchLabel(r.bookingBranchId) }}</span></td>
          <td class="num">{{ r.shipmentCount }}</td>
          <td class="num">₹{{ r.totalNetAmount | number: '1.2-2' }}</td>
          <td class="num">₹{{ r.commissionOnBasicFreight | number: '1.2-2' }}</td>
          <td class="num">₹{{ r.branchCommissionOnOtherAmount | number: '1.2-2' }}</td>
          <td class="num">₹{{ r.companyCommissionOnBasicFreight | number: '1.2-2' }}</td>
          <td class="num strong">₹{{ r.totalCommission | number: '1.2-2' }}</td>
        </ng-template>
      </app-table>
    </div>
  `,
  styles: [`
    .page__head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:12px; }
    .page__actions { display:flex; align-items:flex-end; gap:10px; flex-wrap:wrap; }
    .month { display:flex; flex-direction:column; gap:2px; font:500 15px var(--font-sans); color:var(--content-muted); }
    .month input { padding:7px 10px; border:1px solid var(--surface-border); border-radius:var(--r-field);
      background:var(--surface); color:var(--content-fg); font:500 17px var(--font-sans); }
    .stats { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:20px; }
    .stat { display:flex; flex-direction:column; gap:4px; padding:12px 18px; min-width:150px;
      background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .stat__l { font:500 15px var(--font-sans); color:var(--content-muted); }
    .stat__v { font:700 23px var(--font-sans); color:var(--content-fg); }
    .branch { font-weight:600; color:var(--brand-600); }
    .num { text-align:right; }
    .strong { font-weight:700; }
  `]
})
export class CommissionReport implements OnInit {
  private readonly service = inject(ShipmentService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly myBranchId = this.auth.user()?.branchId ?? null;
  protected readonly maxMonth = currentMonth();

  protected readonly month = signal(currentMonth());
  protected readonly label = computed(() => monthLabel(this.month()));
  protected readonly branchOptions = signal<SelectOption[]>([]);
  protected readonly loading = signal(true);
  protected readonly exporting = signal(false);
  protected readonly rows = signal<BranchCommissionSummary[]>([]);
  protected readonly totals = computed(() => this.rows().reduce((t, r) => ({
    shipmentCount: t.shipmentCount + r.shipmentCount,
    totalNetAmount: t.totalNetAmount + r.totalNetAmount,
    totalCommission: t.totalCommission + r.totalCommission
  }), { shipmentCount: 0, totalNetAmount: 0, totalCommission: 0 }));

  protected readonly columns: TableColumn<BranchCommissionSummary>[] = [
    { key: 'bookingBranchId', header: 'Branch' },
    { key: 'shipmentCount', header: 'Shipments', align: 'right' },
    { key: 'totalNetAmount', header: 'Amount', align: 'right' },
    { key: 'commissionOnBasicFreight', header: 'Commission on Basic Freight', align: 'right' },
    { key: 'branchCommissionOnOtherAmount', header: 'Branch Commission on Other Amount', align: 'right' },
    { key: 'companyCommissionOnBasicFreight', header: 'Company Commission on Basic Freight', align: 'right' },
    { key: 'totalCommission', header: 'Total Commission', align: 'right' }
  ];

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Reports' }, { label: 'Commission Report' }]);
    this.masters.options('branches').subscribe((o) => this.branchOptions.set(o));
    this.load();
  }

  private request() {
    const { from, to } = monthRange(this.month());
    return {
      status: excludingCancelled(undefined),
      bookingBranchId: this.myBranchId ?? undefined,
      bookingDateFrom: from, bookingDateTo: to
    };
  }

  private load(): void {
    this.loading.set(true);
    this.service.commissionSummary(this.request()).subscribe({
      next: (rows) => { this.rows.set(rows); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  protected onMonth(value: string): void {
    if (!value) { return; }
    this.month.set(value);
    this.load();
  }

  protected open(r: BranchCommissionSummary): void {
    this.router.navigate(['/reports/commissions', r.bookingBranchId], { queryParams: { month: this.month() } });
  }

  protected branchLabel(id: string): string { return this.branchOptions().find((o) => o.value === id)?.label ?? '—'; }

  protected exportCsv(): void {
    this.exporting.set(true);
    this.service.commissionSummary(this.request()).subscribe({
      next: (rows) => {
        const header = ['branch', 'shipmentCount', 'totalNetAmount', 'commissionOnBasicFreight',
          'branchCommissionOnOtherAmount', 'companyCommissionOnBasicFreight', 'totalCommission'];
        const lines = rows.map((r) => [this.branchLabel(r.bookingBranchId), r.shipmentCount,
          r.totalNetAmount, r.commissionOnBasicFreight, r.branchCommissionOnOtherAmount,
          r.companyCommissionOnBasicFreight, r.totalCommission]);
        downloadCsv(`commission-report-${this.month()}.csv`, header, lines, [1, 2, 3, 4, 5, 6]);
        this.notify.info(`Exported ${rows.length} branch row(s).`);
        this.exporting.set(false);
      },
      error: () => { this.exporting.set(false); this.notify.error('Export failed.'); }
    });
  }
}
