import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { AuthService } from '@core/auth/auth.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { Shipment } from '@core/models/shipment.model';
import { PdpEarning } from '@core/models/pdp.model';
import { ShipmentService } from '@features/shipment/shipment.service';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiTable, TableColumn } from '@shared/components/ui-table/ui-table';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { PdpBillingService } from './pdp-billing.service';
import { PdpService } from './pdp.service';

const STATUSES: SelectOption[] = [
  { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery' }, { value: 'DELIVERED', label: 'Delivered' }, { value: 'IN_SCAN', label: 'In scan (at partner)' }
];

/**
 * Deliveries handled by a Pickup-Delivery Partner, with the POD / earning state of each. A partner
 * must have a POD photo on file to mark a delivery done; the delivery is paid only once the
 * company approves that POD — so a Delivered row with no earning yet is "POD pending approval"
 * (the Missing-POD worklist: filter Delivered and look for the amber rows).
 */
@Component({
  selector: 'app-partner-deliveries',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiSelect, UiTable, UiPagination, StatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Partner Deliveries</h1>
          <p class="text-caption">Shipments delivered by Pickup-Delivery Partners and whether their POD has been approved.</p></div>
      </header>
      <div class="filters">
        @if (isAdmin()) {
          <app-select [control]="partnerCtl" label="Partner" [options]="partnerOpts()" placeholder="Select a partner" />
        }
        <app-select [control]="statusCtl" label="Status" [options]="statuses" [allowEmpty]="true" emptyLabel="All" placeholder="All" />
      </div>
      @if (!partnerId()) {
        <p class="hint">Select a partner to see its deliveries.</p>
      } @else {
        <div class="sum">Delivered without approved POD on this page: <strong [class.warn]="pending() > 0">{{ pending() }}</strong></div>
        <app-table [columns]="columns" [rows]="page().content" [loading]="loading()" [startIndex]="page().page * page().size"
                   emptyTitle="No deliveries" emptyHint="Shipments handed to this partner by Load Sheet appear here." idKey="id" (rowClick)="open($event)">
          <ng-template #row let-s>
            <td><strong>{{ s.shipmentNumber }}</strong><div class="text-caption">{{ s.trackingNumber }}</div></td>
            <td>{{ s.toCity || '—' }}</td>
            <td>{{ s.chargeableWeight }} kg</td>
            <td><app-status-badge [value]="s.status" [label]="s.status" />
              @if (s.deliveredAt) { <div class="text-caption">{{ s.deliveredAt.slice(0, 10) }}</div> }</td>
            <td>
              @if (earningOf(s); as e) { <span class="ok">POD approved</span><div class="text-caption">earned {{ e.totalAmount }}@if (e.status === 'UNRATED') { (unrated) }</div> }
              @else if (s.status === 'DELIVERED') { <span class="warn">POD pending approval</span> }
              @else { <span class="muted">—</span> }
            </td>
          </ng-template>
        </app-table>
        <app-pagination [page]="page()" (pageChange)="onPage($event)" />
      }
    </div>
  `,
  styles: [`
    .filters { display:grid; grid-template-columns:minmax(0,320px) minmax(0,220px); gap:16px; margin:0 0 16px; }
    .hint, .sum { font:400 16px var(--font-sans); color:var(--content-muted); margin:0 0 12px; } .sum strong { color:var(--content-fg); }
    .warn { color:#b45309; font-weight:600; } .ok { color:#047857; font-weight:600; } .muted { color:var(--content-muted); }
  `]
})
export class PartnerDeliveries implements OnInit {
  private readonly shipments = inject(ShipmentService);
  private readonly billing = inject(PdpBillingService);
  private readonly pdp = inject(PdpService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly auth = inject(AuthService);
  private readonly perms = inject(PermissionService);
  private readonly router = inject(Router);

  protected readonly partnerCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly statusCtl = new FormControl<string>('DELIVERED', { nonNullable: true });
  protected readonly partnerOpts = signal<SelectOption[]>([]);
  protected readonly page = signal<Page<Shipment>>(emptyPage());
  /** shipmentNumber -> delivery earning. A signal: filled asynchronously under OnPush. */
  protected readonly earnings = signal<Record<string, PdpEarning>>({});
  protected readonly loading = signal(false);
  protected readonly statuses = STATUSES;
  protected readonly isAdmin = computed(() => this.perms.hasRole(AppRole.COMPANY_ADMIN));
  protected readonly partnerId = signal<string>('');
  protected readonly pending = computed(() => this.page().content.filter((s) => s.status === 'DELIVERED' && !this.earnings()[s.shipmentNumber]).length);
  private query: PageQuery = { page: 0, size: 20 };

  protected readonly columns: TableColumn<Shipment>[] = [
    { key: 'no', header: 'Shipment' }, { key: 'city', header: 'To' }, { key: 'weight', header: 'Weight' },
    { key: 'status', header: 'Status', width: '150px' }, { key: 'pod', header: 'POD / earning' }
  ];

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Pickup Delivery Partner Management' }, { label: 'Partner Deliveries' }]);
    if (this.isAdmin()) {
      this.pdp.partners({ page: 0, size: 200 }).subscribe((r) =>
        this.partnerOpts.set(r.content.map((b) => ({ value: b.id, label: `${b.branchName} (${b.branchCode})` }))));
      this.partnerCtl.valueChanges.subscribe((id) => { this.partnerId.set(id); this.query = { ...this.query, page: 0 }; this.load(); });
    } else {
      this.partnerId.set(this.auth.user()?.branchId ?? '');
      this.load();
    }
    this.statusCtl.valueChanges.subscribe(() => { this.query = { ...this.query, page: 0 }; this.load(); });
  }

  private load(): void {
    const id = this.partnerId();
    if (!id) return;
    this.loading.set(true);
    forkJoin({
      shipments: this.shipments.list({ ...this.query, deliveryBranchId: id, status: this.statusCtl.value || undefined } as PageQuery),
      earned: this.billing.earnings({ page: 0, size: 200, branchId: id, type: 'DELIVERY' })
    }).subscribe({
      next: ({ shipments, earned }) => {
        const m: Record<string, PdpEarning> = {};
        earned.content.forEach((e) => { m[e.referenceNo] = e; });
        this.earnings.set(m);
        this.page.set(shipments);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  protected earningOf(s: Shipment): PdpEarning | undefined { return this.earnings()[s.shipmentNumber]; }
  protected onPage(i: number): void { this.query = { ...this.query, page: i }; this.load(); }
  protected open(s: Shipment): void { this.router.navigate(['/shipments', s.id]); }
}
