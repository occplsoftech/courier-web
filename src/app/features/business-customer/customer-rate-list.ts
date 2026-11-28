import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { RateCard } from '@core/models/zone-tariff.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiTable, TableColumn } from '@shared/components/ui-table/ui-table';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { ZoneTariffService } from '@features/zone-tariff/zone-tariff.service';
import { BusinessCustomerService } from './business-customer.service';

/**
 * Business customers' own rate cards (CUST-…), uploaded from their rate sheet. A customer's bookings are priced
 * from their card first, then from the company's card (Zone Tariff → Rate Cards: cash and company-level rates).
 */
@Component({
  selector: 'app-customer-rate-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DatePipe, UiButton, UiSearch, UiSelect, UiTable, StatusBadge, MatMenuModule, MatIconModule],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Customer Rates</h1>
          <p class="text-caption">Each business customer's own rate card, used before the company's card — {{ rows().length }} shown.</p></div>
        <div class="page__actions">
          <app-search placeholder="Search code or name…" (changed)="onSearch($event)" />
          @if (canUpload()) {
            <app-button icon="upload_file" [disabled]="!customerCtl.value" (pressed)="upload(customerCtl.value)">Upload Rates</app-button>
          }
        </div>
      </header>

      <div class="filters">
        <app-select [control]="customerCtl" label="Customer" [options]="customerOpts()" [allowEmpty]="true" emptyLabel="All customers" placeholder="All customers" />
        @if (canUpload() && !customerCtl.value) { <p class="hint">Pick a customer to upload their rate sheet.</p> }
      </div>

      <app-table [columns]="columns" [rows]="rows()" [loading]="loading()"
                 emptyTitle="No customer rate cards" emptyHint="Pick a customer and upload their rate sheet."
                 (rowClick)="open($event)">
        <ng-template #row let-c>
          <td><strong>{{ c.customerName || '—' }}</strong></td>
          <td><div class="zn">{{ c.code }}</div><div class="sub">{{ c.name }}</div></td>
          <td>{{ c.fromZoneCode || '—' }}</td>
          <td>{{ c.effectiveFrom | date: 'dd MMM yyyy' }} – {{ c.effectiveTo ? (c.effectiveTo | date: 'dd MMM yyyy') : 'open' }}</td>
          <td>{{ c.laneCount }} lanes · {{ c.chargeCount }} charges</td>
          <td><app-status-badge [value]="c.status" [label]="c.status === 'ACTIVE' ? 'Active' : 'Inactive'" /></td>
          <td class="col-actions" (click)="$event.stopPropagation()">
            <button class="kebab" [matMenuTriggerFor]="menu" aria-label="Actions"><mat-icon>more_vert</mat-icon></button>
            <mat-menu #menu="matMenu">
              <button mat-menu-item (click)="open(c)"><mat-icon>request_quote</mat-icon><span>Open</span></button>
              @if (canUpload()) {
                <button mat-menu-item (click)="upload(c.customerId)"><mat-icon>upload_file</mat-icon><span>Upload new sheet</span></button>
              }
              @if (canUpdate()) {
                @if (c.status === 'ACTIVE') {
                  <button mat-menu-item (click)="setStatus(c, 'deactivate')"><mat-icon>block</mat-icon><span>Deactivate</span></button>
                } @else {
                  <button mat-menu-item (click)="setStatus(c, 'activate')"><mat-icon>check_circle</mat-icon><span>Activate</span></button>
                }
              }
            </mat-menu>
          </td>
        </ng-template>
      </app-table>
    </div>
  `,
  styles: [`
    .filters { display:flex; align-items:flex-end; gap:16px; margin:0 0 16px; }
    .filters app-select { width:min(100%, 360px); }
    .hint { margin:0 0 10px; color:var(--content-muted); font:400 15px var(--font-sans); }
    .zn { font:600 17px var(--font-sans); } .sub { font:400 15px var(--font-sans); color:var(--content-muted); }
    .col-actions { text-align:right; width:56px; }
    .kebab { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
    @media (max-width:640px){ .filters { flex-direction:column; align-items:stretch; } }
  `]
})
export class CustomerRateList implements OnInit {
  private readonly customers = inject(BusinessCustomerService);
  private readonly tariff = inject(ZoneTariffService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly router = inject(Router);

  protected readonly customerCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly customerOpts = signal<SelectOption[]>([]);
  private readonly cards = signal<RateCard[]>([]);
  private readonly customerId = signal('');
  protected readonly rows = computed(() => {
    const id = this.customerId();
    return id ? this.cards().filter((c) => c.customerId === id) : this.cards();
  });
  protected readonly loading = signal(true);
  private search = '';

  /** Upload is COMPANY_ADMIN on the server, like the Upload Rates page. */
  protected readonly canUpload = computed(() => this.perms.canAccess({ roles: [AppRole.COMPANY_ADMIN] }));
  protected readonly canUpdate = computed(() => this.perms.canAccess({ roles: [AppRole.COMPANY_ADMIN], permissions: ['TARIFF_UPDATE'] }));

  protected readonly columns: TableColumn<RateCard>[] = [
    { key: 'customerName', header: 'Customer' },
    { key: 'code', header: 'Rate card' },
    { key: 'fromZoneCode', header: 'From zone' },
    { key: 'effectiveFrom', header: 'Valid' },
    { key: 'laneCount', header: 'Rates' },
    { key: 'status', header: 'Status', width: '120px' },
    { key: 'actions', header: '', width: '56px', align: 'right' }
  ];

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Business Customer' }, { label: 'Rate' }]);
    this.customers.businessCustomers().subscribe((p) =>
      this.customerOpts.set(p.content.map((c) => ({ value: c.id, label: `${c.displayName} (${c.customerCode})` }))));
    this.customerCtl.valueChanges.subscribe((v) => this.customerId.set(v));
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.tariff.cards({ owner: 'CUSTOMER', search: this.search || undefined }).subscribe({
      // An older server ignores `owner` and returns company cards; keep only customer cards either way.
      next: (c) => { this.cards.set((c ?? []).filter((x) => !!x.customerId)); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  onSearch(t: string): void { this.search = t; this.load(); }
  protected open(c: RateCard): void { this.router.navigate(['/zone-tariff/rate-cards', c.id]); }
  protected upload(customerId?: string | null): void {
    if (customerId) this.router.navigate(['/business-customer/customers', customerId, 'upload-rates']);
  }

  protected setStatus(c: RateCard, op: 'activate' | 'deactivate'): void {
    (op === 'activate' ? this.tariff.activateCard(c.id) : this.tariff.deactivateCard(c.id)).subscribe({
      next: () => { this.notify.success(`Rate card ${op}d.`); this.load(); },
      error: (e: HttpErrorResponse) => this.notify.error(e.error?.message ?? `Could not ${op} the rate card.`)
    });
  }
}
