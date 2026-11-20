import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { AuthService } from '@core/auth/auth.service';
import { Manifest, ManifestSummaryStats } from '@core/models/shipment.model';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { TableColumn } from '@shared/components/ui-table/ui-table';
import { UiTable } from '@shared/components/ui-table/ui-table';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { MasterDataService } from '@features/masters/master-data.service';
import { ManifestService } from '@features/manifest/manifest.service';
import { VehicleService } from '@features/manifest/vehicle.service';
import { ShipmentMovementService } from '@features/shipment-movement/shipment-movement.service';
import { Lookup } from '@features/users/user.service';

/**
 * Trip Hire Challan (THC) Report — every dispatched manifest, company-wide for a
 * COMPANY_ADMIN or locked to the caller's own booking branch for a BRANCH_MANAGER, the
 * same branch-scoping `DrsReport` uses. Reads GET /manifests?status=DISPATCHED — a
 * manifest already carries its vehicle/driver/dispatchedAt once THC dispatches it
 * (see `Manifest.dispatch`), so no new backend endpoint is needed.
 */
@Component({
  selector: 'app-thc-report',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, UiTable, UiPagination, UiButton],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Trip Hire Challan Report</h1>
          <p class="text-caption">{{ page().totalElements }} THC(s) {{ myBranchId ? 'at your branch' : 'across the company' }}.</p></div>
        <app-button variant="stroked" icon="refresh" (pressed)="load()">Refresh</app-button>
      </header>

      <div class="stats">
        <div class="stat"><span class="stat__l">Manifests</span><span class="stat__v">{{ summary()?.totalManifests ?? '—' }}</span></div>
        <div class="stat"><span class="stat__l">Shipments</span><span class="stat__v">{{ summary()?.totalShipments ?? '—' }}</span></div>
        <div class="stat"><span class="stat__l">Total Weight</span>
          <span class="stat__v">{{ summary() ? (summary()!.totalWeight | number: '1.3-3') + ' kg' : '—' }}</span></div>
        <div class="stat"><span class="stat__l">Total Packages</span><span class="stat__v">{{ summary()?.totalPackages ?? '—' }}</span></div>
        <div class="stat"><span class="stat__l">Trip Expenses</span>
          <span class="stat__v">{{ summary() ? '₹' + (summary()!.totalTripExpenses | number: '1.2-2') : '—' }}</span></div>
      </div>

      <app-table [columns]="columns" [rows]="page().content" [loading]="loading()"
                 [startIndex]="page().page * page().size"
                 emptyTitle="No THCs" emptyHint="No manifest has been dispatched yet."
                 (rowClick)="view($event)">
        <ng-template #row let-m>
          <td class="mono">{{ m.manifestNumber }}</td>
          <td>{{ branchLabel(m.bookingBranchId) }}</td>
          <td>{{ branchLabel(m.deliveryBranchId) }}</td>
          <td>{{ vehicleLabel(m.vehicleId) }}</td>
          <td>{{ driverLabel(m.driverUserId) }}</td>
          <td class="num">{{ m.shipmentCount }}</td>
          <td class="num">{{ m.totalWeight | number: '1.3-3' }} kg</td>
          <td class="num">{{ m.totalPackages }}</td>
          <td class="num">{{ tripExpenseTotal(m) > 0 ? ('₹' + (tripExpenseTotal(m) | number: '1.2-2')) : '—' }}</td>
          <td>{{ m.dispatchedAt ? (m.dispatchedAt | date: 'mediumDate') : '—' }}</td>
        </ng-template>
      </app-table>

      <app-pagination [page]="page()" (pageChange)="onPage($event)" />
    </div>
  `,
  styles: [`
    .page__head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:12px; }
    .stats { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
    .stat { display:flex; flex-direction:column; gap:4px; padding:12px 18px; min-width:150px;
      background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .stat__l { font:500 15px var(--font-sans); color:var(--content-muted); }
    .stat__v { font:700 23px var(--font-sans); color:var(--content-fg); }
    .num { text-align:right; }
    .mono { font:600 16px var(--font-mono, ui-monospace); color:var(--content-fg); }
  `]
})
export class ThcReport implements OnInit {
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly masters = inject(MasterDataService);
  private readonly manifestService = inject(ManifestService);
  private readonly vehicleService = inject(VehicleService);
  private readonly movementService = inject(ShipmentMovementService);

  protected readonly myBranchId = this.auth.user()?.branchId ?? null;

  protected readonly loading = signal(true);
  protected readonly page = signal<Page<Manifest>>(emptyPage<Manifest>());
  protected readonly summary = signal<ManifestSummaryStats | null>(null);

  private readonly branches = signal<Map<string, string>>(new Map());
  private readonly vehicles = signal<Map<string, string>>(new Map());
  private readonly drivers = signal<Map<string, string>>(new Map());

  protected readonly columns: TableColumn<Manifest>[] = [
    { key: 'manifestNumber', header: 'THC No.', width: '150px' },
    { key: 'bookingBranchId', header: 'Booking Branch' },
    { key: 'deliveryBranchId', header: 'Delivery Branch' },
    { key: 'vehicleId', header: 'Vehicle' },
    { key: 'driverUserId', header: 'Driver' },
    { key: 'shipmentCount', header: 'Shipments', align: 'right', width: '100px' },
    { key: 'totalWeight', header: 'Weight', align: 'right', width: '110px' },
    { key: 'totalPackages', header: 'Packages', align: 'right', width: '100px' },
    { key: 'tripExpenses', header: 'Trip Expenses', align: 'right', width: '120px' },
    { key: 'dispatchedAt', header: 'Dispatched', width: '130px' }
  ];

  private query: PageQuery = { page: 0, size: 20, sort: 'dispatchedAt,desc' };

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Reports' }, { label: 'Trip Hire Challan Report' }]);
    this.masters.branchDirectory().subscribe((list) =>
      this.branches.set(new Map(list.map((b) => [b.id, `${b.branchName} (${b.branchCode})`]))));
    this.vehicleService.list(false).subscribe((list) =>
      this.vehicles.set(new Map(list.map((v) => [v.id, v.vehicleNumber]))));
    this.movementService.userOptions().subscribe((list: Lookup[]) =>
      this.drivers.set(new Map(list.map((u) => [u.id, u.label]))));
    this.load();
  }

  load(): void {
    this.loading.set(true);
    const params: PageQuery = { ...this.query, status: 'DISPATCHED' };
    if (this.myBranchId) params['bookingBranchId'] = this.myBranchId;
    this.manifestService.list(params).subscribe({
      next: (p) => { this.page.set(p); this.loading.set(false); },
      error: () => { this.page.set(emptyPage<Manifest>()); this.loading.set(false); }
    });
    this.manifestService.summary({ status: 'DISPATCHED', bookingBranchId: this.myBranchId ?? undefined })
      .subscribe({ next: (s) => this.summary.set(s), error: () => this.summary.set(null) });
  }

  onPage(i: number): void { this.query = { ...this.query, page: i }; this.load(); }

  protected branchLabel(id: string): string { return this.branches().get(id) ?? id; }
  protected vehicleLabel(id: string | null | undefined): string { return id ? (this.vehicles().get(id) ?? id) : '—'; }
  protected driverLabel(id: string | null | undefined): string { return id ? (this.drivers().get(id) ?? id) : '—'; }

  protected tripExpenseTotal(m: Manifest): number {
    return (m.fuelCost ?? 0) + (m.driverAdvance ?? 0) + (m.tollAmount ?? 0) + (m.otherAmount ?? 0);
  }

  view(m: Manifest): void {
    this.router.navigate(['/movement/trip-hire-challan'], { queryParams: { manifestNumber: m.manifestNumber } });
  }
}
