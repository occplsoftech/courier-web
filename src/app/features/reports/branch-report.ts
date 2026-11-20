import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { forkJoin } from 'rxjs';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { BranchCommissionSummary, BranchPerformanceSummary, ShipmentSearchRequest } from '@core/models/shipment.model';
import { TableColumn } from '@shared/components/ui-table/ui-table';
import { UiTable } from '@shared/components/ui-table/ui-table';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { MasterDataService } from '@features/masters/master-data.service';
import { ShipmentService } from '../shipment/shipment.service';
import { excludingCancelled } from './non-cancelled.util';
import { downloadCsv } from '@shared/utils/csv-export.util';

interface BranchRow extends BranchPerformanceSummary {
  totalCommission: number;
}

/**
 * Branch Performance Report — one row per booking branch: shipment volume, delivered/
 * in-transit/returned outcomes, chargeable weight, amount and total commission
 * over the date range. Joins `GET /shipments/branch-performance` and
 * `GET /shipments/commission-summary` client-side, both already grouped server-side by
 * `bookingBranchId` — same "unpaged aggregate, single call" shape every other report uses.
 */
@Component({
  selector: 'app-branch-report',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, UiTable, UiButton],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Branch Performance Report</h1>
          <p class="text-caption">{{ rows().length }} branch(es) {{ myBranchId ? '(your branch)' : 'across the company' }}.</p></div>
        <div class="page__actions">
          <label class="dfld">From <input type="date" [value]="from()" (change)="onFrom($event)" /></label>
          <label class="dfld">To <input type="date" [value]="to()" (change)="onTo($event)" /></label>
          <app-button variant="stroked" icon="download" [loading]="exporting()" (pressed)="exportCsv()">Export</app-button>
        </div>
      </header>

      <div class="stats">
        <div class="stat"><span class="stat__l">Shipments</span><span class="stat__v">{{ loading() ? '—' : totals().shipmentCount }}</span></div>
        <div class="stat"><span class="stat__l">Delivered</span><span class="stat__v">{{ loading() ? '—' : totals().deliveredCount }}</span></div>
        <div class="stat"><span class="stat__l">In Transit</span><span class="stat__v">{{ loading() ? '—' : totals().inTransitCount }}</span></div>
        <div class="stat"><span class="stat__l">Returned</span>
          <span class="stat__v">{{ loading() ? '—' : totals().returnedCount }}</span></div>
        <div class="stat"><span class="stat__l">Total Commission</span>
          <span class="stat__v">{{ loading() ? '—' : ('₹' + (totals().totalCommission | number: '1.2-2')) }}</span></div>
      </div>

      <app-table [columns]="columns" [rows]="rows()" [loading]="loading()"
                 emptyTitle="No shipments" emptyHint="Nothing matches this date range yet.">
        <ng-template #row let-r>
          <td>{{ branchLabel(r.bookingBranchId) }}</td>
          <td class="num">{{ r.shipmentCount }}</td>
          <td class="num">{{ r.deliveredCount }}</td>
          <td class="num">{{ r.inTransitCount }}</td>
          <td class="num">{{ r.returnedCount }}</td>
          <td class="num">{{ r.totalChargeableWeight | number: '1.3-3' }} kg</td>
          <td class="num">₹{{ r.totalNetAmount | number: '1.2-2' }}</td>
          <td class="num strong">₹{{ r.totalCommission | number: '1.2-2' }}</td>
        </ng-template>
      </app-table>
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
    .num { text-align:right; }
    .strong { font-weight:700; }
  `]
})
export class BranchReport implements OnInit {
  private readonly service = inject(ShipmentService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);

  protected readonly myBranchId = this.auth.user()?.branchId ?? null;
  protected readonly branchOptions = signal<SelectOption[]>([]);
  protected readonly loading = signal(true);
  protected readonly exporting = signal(false);
  protected readonly rows = signal<BranchRow[]>([]);
  protected readonly from = signal('');
  protected readonly to = signal('');

  protected readonly columns: TableColumn<BranchRow>[] = [
    { key: 'bookingBranchId', header: 'Branch' },
    { key: 'shipmentCount', header: 'Shipments', align: 'right' },
    { key: 'deliveredCount', header: 'Delivered', align: 'right' },
    { key: 'inTransitCount', header: 'In Transit', align: 'right' },
    { key: 'returnedCount', header: 'Returned', align: 'right' },
    { key: 'totalChargeableWeight', header: 'Weight', align: 'right' },
    { key: 'totalNetAmount', header: 'Amount', align: 'right' },
    { key: 'totalCommission', header: 'Total Commission', align: 'right' }
  ];

  protected readonly totals = computed(() => this.rows().reduce((t, r) => ({
    shipmentCount: t.shipmentCount + r.shipmentCount, deliveredCount: t.deliveredCount + r.deliveredCount,
    inTransitCount: t.inTransitCount + r.inTransitCount, returnedCount: t.returnedCount + r.returnedCount,
    totalCommission: t.totalCommission + r.totalCommission
  }), { shipmentCount: 0, deliveredCount: 0, inTransitCount: 0, returnedCount: 0, totalCommission: 0 }));

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Reports' }, { label: 'Branch Performance Report' }]);
    this.masters.options('branches').subscribe((o) => this.branchOptions.set(o));
    this.load();
  }

  private filterRequest(): ShipmentSearchRequest {
    return {
      status: excludingCancelled(),
      bookingBranchId: this.myBranchId ?? undefined,
      bookingDateFrom: this.from() || undefined, bookingDateTo: this.to() || undefined
    };
  }

  load(): void {
    this.loading.set(true);
    const f = this.filterRequest();
    forkJoin({
      performance: this.service.branchPerformance(f),
      commission: this.service.commissionSummary(f)
    }).subscribe({
      next: ({ performance, commission }) => { this.rows.set(this.merge(performance, commission)); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  private merge(performance: BranchPerformanceSummary[], commission: BranchCommissionSummary[]): BranchRow[] {
    const byBranch = new Map(commission.map((c) => [c.bookingBranchId, c.totalCommission]));
    return performance.map((p) => ({ ...p, totalCommission: byBranch.get(p.bookingBranchId) ?? 0 }));
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

  private download(rows: BranchRow[]): void {
    const header = ['branch', 'shipmentCount', 'deliveredCount', 'inTransitCount', 'returnedCount',
      'totalChargeableWeight', 'totalNetAmount', 'totalCommission'];
    const lines = rows.map((r) => [this.branchLabel(r.bookingBranchId), r.shipmentCount, r.deliveredCount,
      r.inTransitCount, r.returnedCount, r.totalChargeableWeight, r.totalNetAmount,
      r.totalCommission]);
    downloadCsv(`branch-performance-report-${new Date().toISOString().slice(0, 10)}.csv`, header, lines,
      [1, 2, 3, 4, 5, 6, 7]);
    this.notify.info(`Exported ${rows.length} branch row(s).`);
  }
}
