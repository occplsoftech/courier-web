import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { AuthService } from '@core/auth/auth.service';
import { BranchCommissionSummary, Shipment } from '@core/models/shipment.model';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { SortState, TableColumn, UiTable } from '@shared/components/ui-table/ui-table';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { MasterDataService } from '@features/masters/master-data.service';
import { ShipmentService } from '../shipment/shipment.service';
import { excludingCancelled } from './non-cancelled.util';
import { currentMonth, monthLabel, monthRange } from './commission-month.util';

/**
 * One branch's commission for one month: summary tiles (from `commission-summary`
 * filtered to that branch) plus the shipment-wise breakdown. Opened from `CommissionReport`.
 */
@Component({
  selector: 'app-commission-branch-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, UiTable, UiPagination, UiButton],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">{{ branchName() }}</h1>
          <p class="text-caption">Commission for {{ label() }}</p></div>
        <div class="page__actions">
          @if (!myBranchId) { <app-button variant="stroked" icon="arrow_back" (pressed)="back()">All branches</app-button> }
        </div>
      </header>

      <div class="stats">
        <div class="stat"><span class="stat__l">Shipments</span><span class="stat__v">{{ s().shipmentCount }}</span></div>
        <div class="stat"><span class="stat__l">Amount</span><span class="stat__v">₹{{ s().totalNetAmount | number: '1.2-2' }}</span></div>
        <div class="stat"><span class="stat__l">Commission on Basic Freight</span><span class="stat__v">₹{{ s().commissionOnBasicFreight | number: '1.2-2' }}</span></div>
        <div class="stat"><span class="stat__l">Branch Commission on Other Amount</span><span class="stat__v">₹{{ s().branchCommissionOnOtherAmount | number: '1.2-2' }}</span></div>
        <div class="stat"><span class="stat__l">Company Commission on Basic Freight</span><span class="stat__v">₹{{ s().companyCommissionOnBasicFreight | number: '1.2-2' }}</span></div>
        <div class="stat"><span class="stat__l">Total Commission</span><span class="stat__v">₹{{ s().totalCommission | number: '1.2-2' }}</span></div>
      </div>

      <h2 class="text-h3">Shipments</h2>
      <app-table [columns]="columns" [rows]="page().content" [loading]="loading()" [sort]="sort()"
                 [startIndex]="page().page * page().size"
                 emptyTitle="No shipments" emptyHint="No shipments booked by this branch in this month."
                 (sortChange)="onSort($event)" (rowClick)="view($event)">
        <ng-template #row let-x>
          <td><span class="mono">{{ x.shipmentNumber }}</span></td>
          <td><span class="mono awb">{{ x.trackingNumber }}</span></td>
          <td>{{ x.bookingDate }}</td>
          <td class="num">{{ x.netAmount != null ? ('₹' + (x.netAmount | number: '1.2-2')) : '—' }}</td>
          <td class="num">{{ x.commissionOnBasicFreight != null ? ('₹' + (x.commissionOnBasicFreight | number: '1.2-2')) : '—' }}</td>
          <td class="num">{{ x.branchCommissionOnOtherAmount != null ? ('₹' + (x.branchCommissionOnOtherAmount | number: '1.2-2')) : '—' }}</td>
          <td class="num">{{ x.companyCommissionOnBasicFreight != null ? ('₹' + (x.companyCommissionOnBasicFreight | number: '1.2-2')) : '—' }}</td>
          <td class="num strong">{{ x.totalCommission != null ? ('₹' + (x.totalCommission | number: '1.2-2')) : '—' }}</td>
        </ng-template>
      </app-table>
      <app-pagination [page]="page()" (pageChange)="onPage($event)" />
    </div>
  `,
  styles: [`
    .page__head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:12px; }
    .stats { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:20px; }
    .stat { display:flex; flex-direction:column; gap:4px; padding:12px 18px; min-width:150px;
      background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .stat__l { font:500 15px var(--font-sans); color:var(--content-muted); }
    .stat__v { font:700 23px var(--font-sans); color:var(--content-fg); }
    h2 { margin: 0 0 10px; }
    .mono { font:600 16px var(--font-mono, ui-monospace); color:var(--content-fg); }
    .awb { color:var(--brand-600); }
    .num { text-align:right; }
    .strong { font-weight:700; }
  `]
})
export class CommissionBranchDetail implements OnInit {
  private readonly service = inject(ShipmentService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly myBranchId = this.auth.user()?.branchId ?? null;
  private branchId = '';
  private readonly month = signal(currentMonth());
  protected readonly label = computed(() => monthLabel(this.month()));
  protected readonly branchName = signal('Branch');
  protected readonly loading = signal(true);
  protected readonly page = signal<Page<Shipment>>(emptyPage<Shipment>());
  protected readonly sort = signal<SortState | null>({ active: 'bookingDate', direction: 'desc' });
  private readonly summary = signal<BranchCommissionSummary | null>(null);
  protected readonly s = computed(() => this.summary() ?? {
    bookingBranchId: this.branchId, shipmentCount: 0, totalNetAmount: 0, commissionOnBasicFreight: 0,
    branchCommissionOnOtherAmount: 0, companyCommissionOnBasicFreight: 0, totalCommission: 0
  });

  protected readonly columns: TableColumn<Shipment>[] = [
    { key: 'shipmentNumber', header: 'Shipment No.', sortable: true },
    { key: 'trackingNumber', header: 'AWB' },
    { key: 'bookingDate', header: 'Booking Date', sortable: true },
    { key: 'netAmount', header: 'Amount', align: 'right' },
    { key: 'commissionOnBasicFreight', header: 'Commission on Basic Freight', align: 'right' },
    { key: 'branchCommissionOnOtherAmount', header: 'Branch Commission on Other Amount', align: 'right' },
    { key: 'companyCommissionOnBasicFreight', header: 'Company Commission on Basic Freight', align: 'right' },
    { key: 'totalCommission', header: 'Total Commission', align: 'right' }
  ];

  private query: PageQuery = { page: 0, size: 20, sort: 'bookingDate,desc' };

  ngOnInit(): void {
    // A branch role may only open its own branch, whatever the URL says.
    this.branchId = this.myBranchId ?? this.route.snapshot.paramMap.get('branchId') ?? '';
    this.month.set(this.route.snapshot.queryParamMap.get('month') ?? currentMonth());
    this.breadcrumb.set([{ label: 'Reports' }, { label: 'Commission Report', route: '/reports/commissions' }, { label: 'Branch' }]);
    this.masters.options('branches').subscribe((o) =>
      this.branchName.set(o.find((x) => x.value === this.branchId)?.label ?? 'Branch'));
    const { from, to } = monthRange(this.month());
    this.service.commissionSummary({
      status: excludingCancelled(undefined), bookingBranchId: this.branchId, bookingDateFrom: from, bookingDateTo: to
    }).subscribe((rows) => this.summary.set(rows[0] ?? null));
    this.load();
  }

  private load(): void {
    const { from, to } = monthRange(this.month());
    this.loading.set(true);
    this.service.list({
      ...this.query, status: excludingCancelled(undefined) as unknown as string,
      bookingBranchId: this.branchId, bookingDateFrom: from, bookingDateTo: to
    }).subscribe({
      next: (p) => { this.page.set(p); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  protected onPage(i: number) { this.query = { ...this.query, page: i }; this.load(); }
  protected onSort(x: SortState) { this.sort.set(x); this.query = { ...this.query, sort: `${x.active},${x.direction}`, page: 0 }; this.load(); }
  protected view(x: Shipment): void { this.router.navigate(['/shipments', x.id]); }
  protected back(): void { this.router.navigate(['/reports/commissions']); }
}
