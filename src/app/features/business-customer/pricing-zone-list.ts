import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { PricingZone, ZoneStatus } from '@core/models/pricing-zone.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiTable, TableColumn } from '@shared/components/ui-table/ui-table';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { BusinessCustomerService } from './business-customer.service';

const STATUS_OPTS: SelectOption[] = [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }];

/**
 * Pricing zones across the company's business customers — filter by customer and status,
 * search by zone name. A zone is the unit a rate card is attached to.
 */
@Component({
  selector: 'app-pricing-zone-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiButton, UiSearch, UiSelect, UiTable, StatusBadge, MatMenuModule, MatIconModule],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Pricing Zones</h1>
          <p class="text-caption">Named groups of districts and cities a business customer is priced by — {{ zones().length }} shown.</p></div>
        <div class="page__actions">
          <app-search placeholder="Search zone name…" (changed)="onSearch($event)" />
          @if (canCreate()) { <app-button icon="add" (pressed)="create()">New Zone</app-button> }
        </div>
      </header>

      <div class="filters">
        <app-select [control]="customerCtl" label="Customer" [options]="customerOpts()" [allowEmpty]="true" emptyLabel="All customers" placeholder="All customers" />
        <app-select [control]="statusCtl" label="Status" [options]="statusOpts" [allowEmpty]="true" emptyLabel="All" placeholder="All" />
      </div>

      @if (customerCtl.value) {
        <section class="source" aria-label="Charges for this customer">
          <div>
            <div class="source__title">Charges applied to this customer</div>
            <p class="text-caption">
              @if (businessRates()) { Business charges: this customer's own rate card (zones below) is used wherever it covers the destination and weight; company charges cover the rest. }
              @else { Company charges: the company's standard rates are used. This customer's rate card is not applied. }
            </p>
          </div>
          <div class="source__opts" role="radiogroup">
            <label><input type="radio" name="src" [checked]="!businessRates()" [disabled]="!canUpdate()" (change)="setSource(false)" /> Company charges</label>
            <label><input type="radio" name="src" [checked]="businessRates()" [disabled]="!canUpdate()" (change)="setSource(true)" /> Business charges</label>
          </div>
        </section>
      }

      <app-table [columns]="columns" [rows]="zones()" [loading]="loading()"
                 emptyTitle="No pricing zones" emptyHint="Create a zone for a business customer to start pricing by destination."
                 (rowClick)="open($event)">
        <ng-template #row let-z>
          <td><div class="zn">{{ z.zoneName }}</div>@if (z.description) { <div class="sub">{{ z.description }}</div> }</td>
          <td>{{ z.customerName || '—' }}</td>
          <td>{{ summary(z) }}</td>
          <td>{{ z.hasRate ? 'Configured' : 'Not set' }}</td>
          <td><app-status-badge [value]="z.status" [label]="z.status === 'ACTIVE' ? 'Active' : 'Inactive'" /></td>
          <td class="col-actions" (click)="$event.stopPropagation()">
            <button class="kebab" [matMenuTriggerFor]="menu" aria-label="Actions"><mat-icon>more_vert</mat-icon></button>
            <mat-menu #menu="matMenu">
              <button mat-menu-item (click)="open(z)"><mat-icon>edit_location</mat-icon><span>Manage zone</span></button>
              <button mat-menu-item (click)="openRate(z)"><mat-icon>request_quote</mat-icon><span>{{ z.hasRate ? 'Edit rate' : 'Set rate' }}</span></button>
              @if (canUpdate()) {
                @if (z.status === 'ACTIVE') {
                  <button mat-menu-item (click)="setStatus(z, 'deactivate')"><mat-icon>block</mat-icon><span>Deactivate</span></button>
                } @else {
                  <button mat-menu-item (click)="setStatus(z, 'activate')"><mat-icon>check_circle</mat-icon><span>Activate</span></button>
                }
              }
              @if (canDelete()) {
                <button mat-menu-item (click)="remove(z)"><mat-icon>delete</mat-icon><span>Delete</span></button>
              }
            </mat-menu>
          </td>
        </ng-template>
      </app-table>
    </div>
  `,
  styles: [`
    .filters { display:grid; grid-template-columns:repeat(2,minmax(0,280px)); gap:16px; margin:0 0 16px; }
    .source { display:flex; justify-content:space-between; gap:16px; align-items:center; flex-wrap:wrap; padding:14px 16px; margin:0 0 16px; border:1px solid var(--border); border-radius:12px; background:var(--surface); }
    .source__title { font:600 14px var(--font-sans); } .source p { margin:4px 0 0; max-width:640px; }
    .source__opts { display:flex; gap:20px; font:500 14px var(--font-sans); } .source__opts label { display:inline-flex; gap:6px; align-items:center; cursor:pointer; }
    .zn { font:600 14px var(--font-sans); } .sub { font:400 12px var(--font-sans); color:var(--content-muted); }
    .col-actions { text-align:right; width:56px; }
    .kebab { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
    @media (max-width:640px){ .filters { grid-template-columns:1fr; } }
  `]
})
export class PricingZoneList implements OnInit {
  private readonly service = inject(BusinessCustomerService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly router = inject(Router);
  private readonly confirm = inject(DialogService);

  protected readonly customerCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly statusCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly statusOpts = STATUS_OPTS;
  protected readonly customerOpts = signal<SelectOption[]>([]);
  protected readonly zones = signal<PricingZone[]>([]);
  protected readonly loading = signal(true);
  protected readonly businessRates = signal(false);
  private search = '';

  protected readonly columns: TableColumn<PricingZone>[] = [
    { key: 'zoneName', header: 'Zone' },
    { key: 'customerName', header: 'Customer' },
    { key: 'locations', header: 'Locations' },
    { key: 'hasRate', header: 'Rate' },
    { key: 'status', header: 'Status', width: '120px' },
    { key: 'actions', header: '', width: '56px', align: 'right' }
  ];

  protected readonly canCreate = computed(() => this.perms.canAccess({ roles: [AppRole.COMPANY_ADMIN], permissions: ['PRICING_ZONE_CREATE'] }));
  protected readonly canUpdate = computed(() => this.perms.canAccess({ roles: [AppRole.COMPANY_ADMIN], permissions: ['PRICING_ZONE_UPDATE'] }));
  protected readonly canDelete = computed(() => this.perms.canAccess({ roles: [AppRole.COMPANY_ADMIN], permissions: ['PRICING_ZONE_DELETE'] }));

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Business Customer' }, { label: 'Pricing Zone' }]);
    this.service.businessCustomers().subscribe((p) =>
      this.customerOpts.set(p.content.map((c) => ({ value: c.id, label: `${c.displayName} (${c.customerCode})` }))));
    this.customerCtl.valueChanges.subscribe(() => { this.load(); this.loadSource(); });
    this.statusCtl.valueChanges.subscribe(() => this.load());
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.zones({
      customerId: this.customerCtl.value || undefined,
      status: (this.statusCtl.value || undefined) as ZoneStatus | undefined,
      search: this.search || undefined
    }).subscribe({
      next: (z) => { this.zones.set(z ?? []); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  private loadSource(): void {
    const id = this.customerCtl.value;
    if (!id) return;
    this.service.rateSource(id).subscribe({ next: (r) => this.businessRates.set(!!r?.useBusinessRates) });
  }

  setSource(useBusinessRates: boolean): void {
    const id = this.customerCtl.value;
    if (!id) return;
    this.service.setRateSource(id, useBusinessRates).subscribe({
      next: (r) => { this.businessRates.set(!!r?.useBusinessRates); this.notify.success(useBusinessRates ? 'Business charges applied to this customer.' : 'Company charges applied to this customer.'); },
      error: (e) => { this.loadSource(); this.notify.error(e?.error?.message ?? 'Could not save.'); }
    });
  }

  onSearch(t: string): void { this.search = t; this.load(); }
  create(): void { this.router.navigate(['/business-customer/pricing-zones/new']); }
  open(z: PricingZone): void { this.router.navigate(['/business-customer/pricing-zones', z.id]); }
  openRate(z: PricingZone): void { this.router.navigate(['/business-customer/rates', z.id]); }

  summary(z: PricingZone): string {
    if (!z.locations.length) return 'None yet';
    const label = (l: PricingZone['locations'][number]) => l.cityName ? `${l.cityName}, ${l.districtName}` : (l.districtName ?? '—');
    const shown = z.locations.slice(0, 2).map(label).join(' · ');
    return z.locations.length > 2 ? `${shown} +${z.locations.length - 2} more` : shown;
  }

  setStatus(z: PricingZone, op: 'activate' | 'deactivate'): void {
    (op === 'activate' ? this.service.activateZone(z.id) : this.service.deactivateZone(z.id)).subscribe({
      next: () => { this.notify.success(`Zone ${op}d.`); this.load(); },
      error: (e) => this.notify.error(e?.error?.message ?? `Could not ${op} the zone.`)
    });
  }

  remove(z: PricingZone): void {
    this.confirm.confirm({
      title: 'Delete pricing zone?',
      message: `"${z.zoneName}" with its locations and rate card will be removed. Past bookings are unaffected.`,
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.deleteZone(z.id).subscribe({
        next: () => { this.notify.success('Zone deleted.'); this.load(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not delete the zone.')
      });
    });
  }
}
