import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { AuthService } from '@core/auth/auth.service';
import { DrsSummary } from '@core/models/shipment.model';
import { TableColumn } from '@shared/components/ui-table/ui-table';
import { UiTable } from '@shared/components/ui-table/ui-table';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { MasterDataService } from '@features/masters/master-data.service';
import { ShipmentMovementService } from '@features/shipment-movement/shipment-movement.service';
import { Lookup } from '@features/users/user.service';

/**
 * DRS Report — one row per DRS "run" (delivery user + delivery branch + calendar day),
 * grouped server-side from `DeliveryAssignment` since a DRS is generated on the fly by
 * Out For Delivery's "Generate DRS" action and never persisted as its own entity (see
 * `MEMORY/modules/shipment-movement.md`). Row click drills into the shipments on that run —
 * the same table `printDrs()` renders — via `drs-detail.ts`. Defaults to every pending run
 * (no date bound, "Pending only" checked) so nothing outstanding falls outside a 30-day
 * window; the date fields and checkbox narrow that down.
 */
@Component({
  selector: 'app-drs-report',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiTable, UiButton],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">DRS Report</h1>
          <p class="text-caption">{{ visibleRows().length }} DRS run(s) {{ myBranchId ? 'at your branch' : 'across the company' }}{{ pendingOnly() ? ', pending' : '' }}.</p></div>
        <div class="page__actions">
          <label class="dfld">From
            <input type="date" [value]="from()" (change)="onFrom($event)" />
          </label>
          <label class="dfld">To
            <input type="date" [value]="to()" (change)="onTo($event)" />
          </label>
          <label class="cfld">
            <input type="checkbox" [checked]="pendingOnly()" (change)="onPendingOnly($event)" />
            Pending only
          </label>
          <app-button variant="stroked" icon="refresh" (pressed)="load()">Refresh</app-button>
        </div>
      </header>

      <app-table [columns]="columns" [rows]="visibleRows()" [loading]="loading()"
                 emptyTitle="No DRS runs" [emptyHint]="pendingOnly() ? 'Nothing pending.' : 'Nothing generated in this date range yet.'"
                 (rowClick)="view($event)">
        <ng-template #row let-r>
          <td class="mono">{{ r.drsNumber ?? '—' }}</td>
          <td>{{ userLabel(r.deliveryUserId) }}</td>
          <td class="mono">{{ userContact(r.deliveryUserId) }}</td>
          <td>{{ branchLabel(r.deliveryBranchId) }}</td>
          <td>{{ r.runDate }}</td>
          <td class="num">{{ r.shipmentCount }}</td>
          <td class="num">{{ r.deliveredCount }}</td>
          <td class="num">{{ r.pendingCount }}</td>
        </ng-template>
      </app-table>
    </div>
  `,
  styles: [`
    .page__head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:12px; }
    .page__actions { display:flex; align-items:flex-end; gap:10px; flex-wrap:wrap; }
    .dfld { display:flex; flex-direction:column; gap:4px; font:500 15px var(--font-sans); color:var(--content-muted); }
    .dfld input { padding:7px 10px; border:1px solid var(--surface-border); border-radius:var(--r-field); font:400 16px var(--font-sans); background:var(--surface); color:var(--content-fg); }
    .cfld { display:flex; align-items:center; gap:6px; font:500 16px var(--font-sans); color:var(--content-fg); padding-bottom:8px; white-space:nowrap; }
    .num { text-align:right; }
    .mono { font:600 16px var(--font-mono, ui-monospace); color:var(--content-fg); }
  `]
})
export class DrsReport implements OnInit {
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly masters = inject(MasterDataService);
  private readonly movementService = inject(ShipmentMovementService);

  protected readonly myBranchId = this.auth.user()?.branchId ?? null;

  protected readonly loading = signal(true);
  protected readonly rows = signal<DrsSummary[]>([]);
  /** No date bound by default — pending shipments can be older than 30 days and must not
   *  silently fall outside the window; narrowing From/To is opt-in. */
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly pendingOnly = signal(true);
  protected readonly visibleRows = computed(() =>
    this.pendingOnly() ? this.rows().filter((r) => r.pendingCount > 0) : this.rows());

  private readonly branches = signal<Map<string, string>>(new Map());
  private readonly users = signal<Map<string, string>>(new Map());
  private readonly userContacts = signal<Map<string, { name: string; mobile: string }>>(new Map());

  protected readonly columns: TableColumn<DrsSummary>[] = [
    { key: 'drsNumber', header: 'DRS No.', width: '120px' },
    { key: 'deliveryUserId', header: 'Employee' },
    { key: 'deliveryUserContact', header: 'Contact No.', width: '130px' },
    { key: 'deliveryBranchId', header: 'Delivery Branch' },
    { key: 'runDate', header: 'Date', width: '130px' },
    { key: 'shipmentCount', header: 'Shipments', align: 'right', width: '110px' },
    { key: 'deliveredCount', header: 'Delivered', align: 'right', width: '110px' },
    { key: 'pendingCount', header: 'Pending', align: 'right', width: '100px' }
  ];

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Reports' }, { label: 'DRS Report' }]);
    this.masters.branchDirectory().subscribe((list) =>
      this.branches.set(new Map(list.map((b) => [b.id, `${b.branchName} (${b.branchCode})`]))));
    this.movementService.userOptions().subscribe((list: Lookup[]) =>
      this.users.set(new Map(list.map((u) => [u.id, u.label]))));
    this.movementService.userDirectory().subscribe((m) => this.userContacts.set(m));
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.movementService.listDrs(this.from() || null, this.to() || null, this.myBranchId).subscribe({
      next: (list) => { this.rows.set(list); this.loading.set(false); },
      error: () => { this.rows.set([]); this.loading.set(false); }
    });
  }

  onFrom(e: Event): void { this.from.set((e.target as HTMLInputElement).value); this.load(); }
  onTo(e: Event): void { this.to.set((e.target as HTMLInputElement).value); this.load(); }
  onPendingOnly(e: Event): void { this.pendingOnly.set((e.target as HTMLInputElement).checked); }

  protected userLabel(id: string): string { return this.users().get(id) ?? id; }
  protected branchLabel(id: string): string { return this.branches().get(id) ?? id; }
  protected userContact(id: string): string { return this.userContacts().get(id)?.mobile ?? '—'; }

  view(r: DrsSummary): void {
    this.router.navigate(['/reports/drs', r.deliveryUserId, r.deliveryBranchId, r.runDate]);
  }
}
