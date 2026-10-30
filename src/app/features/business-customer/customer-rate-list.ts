import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { CustomerRate, PricingZone } from '@core/models/pricing-zone.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiTable, TableColumn } from '@shared/components/ui-table/ui-table';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { BusinessCustomerService } from './business-customer.service';

/** One list row: a zone and, if it has one, its rate card. */
interface RateRow { zone: PricingZone; rate?: CustomerRate; }

/**
 * Customer rates, one row per pricing zone — rates are configured independently for each
 * zone, so a zone with no rate card yet shows as "Not set" with a Set rate action.
 */
@Component({
  selector: 'app-customer-rate-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiButton, UiSelect, UiTable, StatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Customer Rates</h1>
          <p class="text-caption">Per-kg slab rates and charges for each customer pricing zone, per service type (AIR, SURFACE, CARGO, PREMIUM) — {{ rows().length }} rate row(s).</p></div>
        @if (canWrite()) { <div class="page__actions"><app-button icon="upload_file" (pressed)="importRates()">Import from Excel</app-button></div> }
      </header>

      <div class="filters">
        <app-select [control]="customerCtl" label="Customer" [options]="customerOpts()" [allowEmpty]="true" emptyLabel="All customers" placeholder="All customers" />
      </div>

      <app-table [columns]="columns" [rows]="rows()" [loading]="loading()"
                 emptyTitle="No pricing zones" emptyHint="Create a pricing zone first, then set its rates here."
                 (rowClick)="open($event)">
        <ng-template #row let-r>
          <td>{{ r.zone.customerName || '—' }}</td>
          <td><strong>{{ r.zone.zoneName }}</strong></td>
          <td>{{ r.rate ? (r.rate.serviceTypeName || 'All services') : '—' }}</td>
          <td>{{ r.rate ? r.rate.slabs.length + ' slab(s)' : '—' }}</td>
          <td>{{ r.rate ? (lowest(r.rate) + ' – ' + highest(r.rate) + ' /kg') : '—' }}</td>
          <td>{{ r.rate ? (r.rate.minChargeableWeight + ' kg') : '—' }}</td>
          <td>
            @if (r.rate) { <app-status-badge [value]="r.rate.status" [label]="r.rate.status === 'ACTIVE' ? 'Active' : 'Inactive'" /> }
            @else { <span class="muted">Not set</span> }
          </td>
          <td class="col-actions" (click)="$event.stopPropagation()">
            <app-button variant="stroked" [icon]="r.rate ? 'edit' : 'add'" (pressed)="open(r)">{{ r.rate ? (canWrite() ? 'Edit' : 'View') : 'Set rate' }}</app-button>
          </td>
        </ng-template>
      </app-table>
    </div>
  `,
  styles: [`
    .filters { display:grid; grid-template-columns:minmax(0,320px); gap:16px; margin:0 0 16px; }
    .muted { color:var(--content-muted); font:500 13px var(--font-sans); }
    .col-actions { text-align:right; width:140px; }
  `]
})
export class CustomerRateList implements OnInit {
  private readonly service = inject(BusinessCustomerService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly perms = inject(PermissionService);
  private readonly router = inject(Router);

  protected readonly customerCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly customerOpts = signal<SelectOption[]>([]);
  protected readonly rows = signal<RateRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly canWrite = computed(() => this.perms.canAccess({ roles: [AppRole.COMPANY_ADMIN], permissions: ['CUSTOMER_RATE_UPDATE'] }));

  protected readonly columns: TableColumn<RateRow>[] = [
    { key: 'customer', header: 'Customer' },
    { key: 'zone', header: 'Zone' },
    { key: 'service', header: 'Service' },
    { key: 'slabs', header: 'Weight Slabs' },
    { key: 'range', header: 'Rate Range' },
    { key: 'minWt', header: 'Min Chargeable' },
    { key: 'status', header: 'Status', width: '120px' },
    { key: 'actions', header: '', width: '140px', align: 'right' }
  ];

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Business Customer' }, { label: 'Rate' }]);
    this.service.businessCustomers().subscribe((p) =>
      this.customerOpts.set(p.content.map((c) => ({ value: c.id, label: `${c.displayName} (${c.customerCode})` }))));
    this.customerCtl.valueChanges.subscribe(() => this.load());
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    const customerId = this.customerCtl.value || undefined;
    forkJoin({ zones: this.service.zones({ customerId }), rates: this.service.rates(customerId) }).subscribe({
      next: ({ zones, rates }) => {
        // One row per rate card (a zone can have one per service type); a zone with none still shows once, as "Not set".
        this.rows.set((zones ?? []).flatMap((zone): RateRow[] => {
          const cards = (rates ?? []).filter((r) => r.zoneId === zone.id)
            .sort((a, b) => (a.serviceTypeName ?? '').localeCompare(b.serviceTypeName ?? ''));
          return cards.length ? cards.map((rate) => ({ zone, rate })) : [{ zone, rate: undefined }];
        }));
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  protected lowest(r: CustomerRate): number { return Math.min(...r.slabs.map((s) => s.ratePerKg)); }
  protected highest(r: CustomerRate): number { return Math.max(...r.slabs.map((s) => s.ratePerKg)); }
  protected importRates(): void { this.router.navigate(['/business-customer/rates/import']); }
  protected open(row: RateRow): void { this.router.navigate(['/business-customer/rates', row.zone.id],
      { queryParams: row.rate?.serviceTypeId ? { serviceTypeId: row.rate.serviceTypeId } : {} }); }
}
