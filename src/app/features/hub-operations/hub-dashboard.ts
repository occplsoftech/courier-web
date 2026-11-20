import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { StatisticCard } from '@shared/components/statistic-card/statistic-card';
import { ShipmentService } from '@features/shipment/shipment.service';
import { ManifestService } from '@features/manifest/manifest.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { Manifest, Shipment } from '@core/models/shipment.model';
import { HubOperationsService } from './hub-operations.service';
import { HubDashboardStats } from './hub-operations.model';

/**
 * Hub Dashboard — the nine figures `HubOperationsService.dashboard()` returns, plus the
 * quick actions the spec asks for (In Scan / Sort / Create Load Sheet / Out Scan /
 * Dispatch / Exceptions). Scoped to the signed-in user's own hub branch, the same
 * "no picker, my own branch" pattern every other Hub Operations screen uses.
 */
@Component({
  selector: 'app-hub-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiButton, StatisticCard],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Hub Dashboard</h1><p class="text-caption">Today's figures for your hub.</p></div>
        <app-button variant="stroked" icon="refresh" (pressed)="load()">Refresh</app-button>
      </header>

      @if (!myBranchId) {
        <app-card><p class="empty">No hub assigned — ask an admin.</p></app-card>
      } @else {
        <div class="grid">
          <app-statistic-card label="Today's Inbound" icon="call_received" tone="info" [value]="s().todaysInbound" [loading]="loading()" />
          <app-statistic-card label="Pending In Scan" icon="pending_actions" tone="warning" [value]="s().pendingInScan" [loading]="loading()" />
          <app-statistic-card label="Shipments At Hub" icon="inventory_2" tone="brand" [value]="s().shipmentsAtHub" [loading]="loading()" />
          <app-statistic-card label="Pending Sorting" icon="sort" tone="warning" [value]="s().pendingSorting" [loading]="loading()" />
          <app-statistic-card label="Ready For Dispatch" icon="local_shipping" tone="success" [value]="s().readyForDispatch" [loading]="loading()" />
          <app-statistic-card label="Dispatched Today" icon="send" tone="success" [value]="s().dispatchedToday" [loading]="loading()" />
          <app-statistic-card label="Pending Exceptions" icon="report_problem" tone="danger" [value]="s().pendingExceptions" [loading]="loading()" />
          <app-statistic-card label="Today's Load Sheets" icon="qr_code_scanner" tone="info" [value]="s().todaysLoadSheets" [loading]="loading()" />
        </div>

        <div class="two">
          <app-card [title]="'Incoming to your hub (' + incomingTotal() + ')'" subtitle="Dispatched and on the way — receive them at In Scan.">
            @if (!incoming().length) { <p class="empty">Nothing is on its way to this hub.</p> } @else {
              <div class="tbl__wrap"><table class="tbl">
                <thead><tr><th>AWB</th><th>From</th><th>Route</th><th class="r">Weight</th></tr></thead>
                <tbody>
                  @for (x of incoming(); track x.id) {
                    <tr><td class="b">{{ x.trackingNumber }}</td><td>{{ name(x.bookingBranchId) }}</td>
                      <td>{{ x.fromCity || '—' }} → {{ x.toCity || '—' }}</td><td class="r">{{ x.chargeableWeight }} kg</td></tr>
                  }
                </tbody></table></div>
              <div class="more"><app-button variant="stroked" (pressed)="go('/hub-operations/in-scan')">Go to In Scan</app-button></div>
            }
          </app-card>

          <app-card [title]="'At your hub — awaiting action (' + atHubTotal() + ')'" subtitle="Received and not yet on a Load Sheet or DRS.">
            @if (!atHub().length) { <p class="empty">No shipment is waiting at this hub.</p> } @else {
              <div class="tbl__wrap"><table class="tbl">
                <thead><tr><th>AWB</th><th>From</th><th>To</th><th class="r">Weight</th></tr></thead>
                <tbody>
                  @for (x of atHub(); track x.id) {
                    <tr><td class="b">{{ x.trackingNumber }}</td><td>{{ name(x.bookingBranchId) }}</td>
                      <td>{{ x.toCity || '—' }}</td><td class="r">{{ x.chargeableWeight }} kg</td></tr>
                  }
                </tbody></table></div>
              <div class="more">
                <app-button icon="add_box" (pressed)="go('/hub-operations/load-sheet')">Create Loading Sheet</app-button>
                <app-button variant="stroked" icon="directions_run" (pressed)="goDrs()">Generate DRS</app-button>
              </div>
            }
          </app-card>
        </div>

        <app-card [title]="'Load Sheets from your hub — ready to out-scan / dispatch (' + openSheets().length + ')'">
          @if (!openSheets().length) { <p class="empty">No open Load Sheet from this hub.</p> } @else {
            <div class="tbl__wrap"><table class="tbl">
              <thead><tr><th>Load Sheet</th><th>To</th><th class="r">Parcels</th><th class="r">Weight</th></tr></thead>
              <tbody>
                @for (m of openSheets(); track m.id) {
                  <tr><td class="b">{{ m.manifestNumber }}</td><td>{{ name(m.deliveryBranchId) }}</td>
                    <td class="r">{{ m.shipmentCount }}</td><td class="r">{{ m.totalWeight }} kg</td></tr>
                }
              </tbody></table></div>
            <div class="more">
              <app-button variant="stroked" icon="outbox" (pressed)="go('/hub-operations/out-scan')">Out Scan</app-button>
              <app-button variant="stroked" icon="outbound" (pressed)="go('/hub-operations/dispatch')">Dispatch</app-button>
            </div>
          }
        </app-card>

        <app-card title="Quick Actions">
          <div class="qa">
            <app-button icon="move_to_inbox" (pressed)="go('/hub-operations/in-scan')">In Scan</app-button>
            <app-button icon="sort" (pressed)="go('/hub-operations/sorting')">Sort Shipments</app-button>
            <app-button icon="qr_code_scanner" (pressed)="go('/hub-operations/load-sheet')">Create Load Sheet</app-button>
            <app-button icon="outbox" (pressed)="go('/hub-operations/out-scan')">Out Scan</app-button>
            <app-button icon="outbound" (pressed)="go('/hub-operations/dispatch')">Dispatch</app-button>
            <app-button icon="report_problem" (pressed)="go('/hub-operations/exceptions')">Exceptions</app-button>
          </div>
        </app-card>
      }
    </div>
  `,
  styles: [`
    .page__head { display:flex; justify-content:space-between; align-items:flex-start; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:16px; }
    .two { display:grid; grid-template-columns:repeat(auto-fit, minmax(420px, 1fr)); gap:16px; }
    .tbl__wrap { overflow-x:auto; }
    .tbl { width:100%; border-collapse:collapse; font:400 16px var(--font-sans); }
    .tbl th { text-align:left; font:500 14px var(--font-sans); color:var(--content-muted); text-transform:uppercase; letter-spacing:.04em; padding:0 10px 8px; }
    .tbl td { padding:8px 10px; border-top:1px solid var(--surface-border); white-space:nowrap; }
    .tbl .b { font-weight:600; }
    .tbl .r { text-align:right; }
    .more { display:flex; gap:10px; margin-top:12px; flex-wrap:wrap; }
    .qa { display:flex; flex-wrap:wrap; gap:10px; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:20px; }
  `]
})
export class HubDashboard implements OnInit {
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly service = inject(HubOperationsService);
  private readonly shipmentService = inject(ShipmentService);
  private readonly manifestService = inject(ManifestService);
  private readonly masterData = inject(MasterDataService);

  protected readonly myBranchId = this.auth.user()?.branchId ?? null;
  readonly loading = signal(true);
  readonly s = signal<HubDashboardStats>({
    todaysInbound: 0, pendingInScan: 0, shipmentsAtHub: 0, pendingSorting: 0,
    readyForDispatch: 0, dispatchedToday: 0, pendingExceptions: 0, todaysLoadSheets: 0
  });

  readonly incoming = signal<Shipment[]>([]);
  readonly incomingTotal = signal(0);
  readonly atHub = signal<Shipment[]>([]);
  readonly atHubTotal = signal(0);
  readonly openSheets = signal<Manifest[]>([]);
  private readonly names = signal<Map<string, string>>(new Map());

  protected name(id?: string | null): string { return (id && this.names().get(id)) || '—'; }

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Hub Operations' }, { label: 'Dashboard' }]);
    this.masterData.branchDirectory().subscribe((list) =>
      this.names.set(new Map(list.map((b) => [b.id, `${b.branchName} (${b.branchCode})`]))));
    this.load();
  }

  load(): void {
    if (!this.myBranchId) return;
    this.loading.set(true);
    this.service.dashboard(this.myBranchId).subscribe({
      next: (stats) => { this.s.set(stats); this.loading.set(false); },
      error: () => { this.loading.set(false); this.notify.error('Could not load the hub dashboard.'); }
    });
    const hub = this.myBranchId;
    this.shipmentService.list({ page: 0, size: 8, nextLocationId: hub, status: 'DISPATCHED' }).subscribe({
      next: (p) => { this.incoming.set(p.content); this.incomingTotal.set(p.totalElements); },
      error: () => { this.incoming.set([]); this.incomingTotal.set(0); }
    });
    this.shipmentService.list({ page: 0, size: 8, currentLocationId: hub, status: 'READY_FOR_MANIFEST' }).subscribe({
      next: (p) => { this.atHub.set(p.content); this.atHubTotal.set(p.totalElements); },
      error: () => { this.atHub.set([]); this.atHubTotal.set(0); }
    });
    this.manifestService.list({ page: 0, size: 50, status: 'CREATED', sort: 'createdAt,desc', flowType: 'STANDARD' }).subscribe({
      next: (p) => this.openSheets.set(p.content.filter((m) => m.bookingBranchId === hub)),
      error: () => this.openSheets.set([])
    });
  }

  protected goDrs(): void {
    this.router.navigate(['/movement/out-for-delivery'], { queryParams: { tab: 'hub' } });
  }

  protected go(path: string): void {
    this.router.navigateByUrl(path);
  }
}
