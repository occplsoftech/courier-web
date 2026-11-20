import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { PricingZone, ZoneLocation } from '@core/models/pricing-zone.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { CustomerService } from '@features/customer/customer.service';
import { BusinessCustomerService } from './business-customer.service';

/** A location chosen in the create flow, before the zone exists to post it to. */
interface PendingLocation { districtId: string; cityId: string | null; label: string; }

/**
 * Create / manage one pricing zone. Create posts the zone with its locations in one call.
 * Manage edits name/description and adds/removes locations live — each location change is
 * its own request, so the server's duplicate / overlap rules answer immediately.
 *
 * A location is a district, or a city inside one (blank city = whole district). The
 * server refuses a location already in any other zone of the same customer.
 */
@Component({
  selector: 'app-pricing-zone-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiInput, UiSelect, UiButton, UiLoader, MatIconModule],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">{{ isCreate() ? 'New Pricing Zone' : (zone()?.zoneName || 'Pricing Zone') }}</h1>
          <p class="text-caption">{{ isCreate() ? 'Group districts and cities a business customer is priced by.' : 'Rename the zone and manage its districts and cities.' }}</p>
        </div>
        @if (!isCreate() && zone()) {
          <div class="page__actions"><app-button variant="stroked" icon="request_quote" (pressed)="openRate()">{{ zone()!.hasRate ? 'Edit rate' : 'Set rate' }}</app-button></div>
        }
      </header>

      @if (loading()) {
        <app-loader [minHeight]="240" caption="Loading…" />
      } @else if (!isCreate() && !zone()) {
        <app-card><p class="empty">Zone not found or outside your scope.</p></app-card>
      } @else {
        <app-card title="Zone" subtitle="The name must be unique among this customer's zones.">
          <div class="grid">
            @if (isCreate()) {
              <app-select [control]="customerCtl" label="Business Customer" [options]="customerOpts()" placeholder="Select a customer" />
            } @else {
              <div class="stat"><span class="stat__l">Customer</span><span class="stat__v">{{ zone()!.customerName || '—' }}</span></div>
            }
            <app-input [control]="nameCtl" label="Zone Name" [required]="true" placeholder="e.g. West Maharashtra" [maxLength]="100" />
            <app-input [control]="descCtl" label="Description" placeholder="Optional" [maxLength]="255" />
          </div>
        </app-card>

        <app-card title="Districts &amp; Cities" subtitle="Add where this zone applies. Leave City empty to cover the whole district.">
          @if (canWrite()) {
            <div class="picker">
              <app-select [control]="stateCtl" label="State" [options]="stateOpts()" placeholder="Select a state" />
              <app-select [control]="districtCtl" label="District" [options]="districtOpts()" placeholder="Select a district" />
              <app-select [control]="cityCtl" label="City (optional)" [options]="cityOpts()" [allowEmpty]="true" emptyLabel="Whole district" placeholder="Whole district" />
              <app-button icon="add" [disabled]="!districtCtl.value || adding()" [loading]="adding()" (pressed)="addLocation()">Add</app-button>
            </div>
          }

          @if (rows().length === 0) {
            <p class="empty">No locations yet.</p>
          } @else {
            <ul class="locs">
              @for (l of rows(); track l.key) {
                <li class="loc">
                  <mat-icon>{{ l.cityId ? 'location_city' : 'map' }}</mat-icon>
                  <span class="loc__name">{{ l.label }}</span>
                  <span class="loc__tag">{{ l.cityId ? 'City' : 'Whole district' }}</span>
                  @if (canWrite()) {
                    <button class="loc__rm" type="button" aria-label="Remove" (click)="removeRow(l.key)"><mat-icon>close</mat-icon></button>
                  }
                </li>
              }
            </ul>
          }
        </app-card>

        <div class="bar">
          <app-button variant="stroked" (pressed)="back()">{{ isCreate() ? 'Cancel' : 'Back' }}</app-button>
          @if (canWrite()) {
            <app-button icon="save" [loading]="saving()" (pressed)="save()">{{ isCreate() ? 'Create Zone' : 'Save Changes' }}</app-button>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }
    .picker { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)) auto; gap:12px 16px; align-items:end; margin-bottom:16px; }
    .stat { display:flex; flex-direction:column; gap:6px; justify-content:center; }
    .stat__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .stat__v { font:600 17px var(--font-sans); color:var(--content-fg); }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:16px; }
    .locs { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
    .loc { display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid var(--surface-border); border-radius:var(--r-field); background:var(--surface); }
    .loc mat-icon { color:var(--content-muted); }
    .loc__name { font:600 17px var(--font-sans); flex:1; }
    .loc__tag { font:500 15px var(--font-sans); color:var(--content-muted); }
    .loc__rm { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .loc__rm:hover { background:var(--surface-muted); color:var(--danger); }
    .bar { display:flex; justify-content:flex-end; gap:10px; margin-top:8px; }
    @media (max-width:760px){ .grid, .picker { grid-template-columns:1fr; } }
  `]
})
export class PricingZoneForm implements OnInit {
  private readonly service = inject(BusinessCustomerService);
  private readonly geo = inject(CustomerService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly zoneId = this.route.snapshot.paramMap.get('id');
  protected readonly isCreate = computed(() => !this.zoneId);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly adding = signal(false);
  protected readonly zone = signal<PricingZone | null>(null);
  private readonly pending = signal<PendingLocation[]>([]);

  protected readonly customerCtl = new FormControl<string>('', { nonNullable: true, validators: [Validators.required] });
  protected readonly nameCtl = new FormControl<string>('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] });
  protected readonly descCtl = new FormControl<string>('', { nonNullable: true, validators: [Validators.maxLength(255)] });
  protected readonly stateCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly districtCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly cityCtl = new FormControl<string>('', { nonNullable: true });

  protected readonly customerOpts = signal<SelectOption[]>([]);
  protected readonly stateOpts = signal<SelectOption[]>([]);
  protected readonly districtOpts = signal<SelectOption[]>([]);
  protected readonly cityOpts = signal<SelectOption[]>([]);

  protected readonly canWrite = computed(() => this.perms.canAccess({
    roles: [AppRole.COMPANY_ADMIN], permissions: [this.isCreate() ? 'PRICING_ZONE_CREATE' : 'PRICING_ZONE_UPDATE']
  }));

  /** One display model for both modes: saved locations (edit) or pending ones (create). */
  protected readonly rows = computed(() => this.isCreate()
    ? this.pending().map((p, i) => ({ key: `p${i}`, cityId: p.cityId, label: p.label }))
    : (this.zone()?.locations ?? []).map((l) => ({ key: l.id, cityId: l.cityId ?? null, label: this.label(l) })));

  ngOnInit(): void {
    this.breadcrumb.set([
      { label: 'Business Customer' }, { label: 'Pricing Zone', route: '/business-customer/pricing-zones' },
      { label: this.isCreate() ? 'New' : 'Manage' }
    ]);
    if (this.isCreate()) {
      this.service.businessCustomers().subscribe((p) =>
        this.customerOpts.set(p.content.map((c) => ({ value: c.id, label: `${c.displayName} (${c.customerCode})` }))));
      this.loading.set(false);
    } else {
      this.reload(true);
    }
    // Cascading geography pickers: first country (the platform catalogue is India-only today).
    this.geo.countries().subscribe((cs) => {
      if (cs.length) this.geo.states(cs[0].id).subscribe((s) => this.stateOpts.set(s.map((o) => ({ value: o.id, label: o.label }))));
    });
    this.stateCtl.valueChanges.subscribe((id) => {
      this.districtCtl.setValue(''); this.cityCtl.setValue(''); this.districtOpts.set([]); this.cityOpts.set([]);
      if (id) this.geo.districts(id).subscribe((d) => this.districtOpts.set(d.map((o) => ({ value: o.id, label: o.label }))));
    });
    this.districtCtl.valueChanges.subscribe((id) => {
      this.cityCtl.setValue(''); this.cityOpts.set([]);
      if (id) this.geo.cities(id).subscribe((c) => this.cityOpts.set(c.map((o) => ({ value: o.id, label: o.label }))));
    });
  }

  private reload(first = false): void {
    this.service.zone(this.zoneId!).subscribe({
      next: (z) => {
        this.zone.set(z);
        if (first) { this.nameCtl.setValue(z.zoneName); this.descCtl.setValue(z.description ?? ''); }
        this.loading.set(false);
      },
      error: () => { this.zone.set(null); this.loading.set(false); }
    });
  }

  private label(l: ZoneLocation): string { return l.cityName ? `${l.cityName}, ${l.districtName}` : (l.districtName ?? l.districtId); }
  private optionLabel(opts: SelectOption[], id: string): string { return (opts.find((o) => o.value === id)?.label ?? id).replace(/\s*\([^)]*\)$/, ''); }

  protected addLocation(): void {
    const districtId = this.districtCtl.value;
    const cityId = this.cityCtl.value || null;
    if (!districtId) return;
    if (this.isCreate()) {
      const dist = this.optionLabel(this.districtOpts(), districtId);
      const label = cityId ? `${this.optionLabel(this.cityOpts(), cityId)}, ${dist}` : dist;
      const clash = this.pending().some((p) => p.districtId === districtId && (p.cityId === null || cityId === null || p.cityId === cityId));
      if (clash) { this.notify.error('That location is already in this zone.'); return; }
      this.pending.update((l) => [...l, { districtId, cityId, label }]);
      this.cityCtl.setValue('');
      return;
    }
    this.adding.set(true);
    this.service.addLocation(this.zoneId!, { districtId, cityId }).subscribe({
      next: (z) => { this.zone.set(z); this.adding.set(false); this.cityCtl.setValue(''); this.notify.success('Location added.'); },
      error: (e: HttpErrorResponse) => { this.adding.set(false); this.notify.error(e.error?.message ?? 'Could not add the location.'); }
    });
  }

  protected removeRow(key: string): void {
    if (this.isCreate()) {
      const idx = Number(key.slice(1));
      this.pending.update((l) => l.filter((_, i) => i !== idx));
      return;
    }
    this.service.removeLocation(this.zoneId!, key).subscribe({
      next: (z) => { this.zone.set(z); this.notify.success('Location removed.'); },
      error: (e: HttpErrorResponse) => this.notify.error(e.error?.message ?? 'Could not remove the location.')
    });
  }

  protected save(): void {
    this.nameCtl.markAsTouched();
    if (this.nameCtl.invalid || (this.isCreate() && this.customerCtl.invalid)) {
      this.customerCtl.markAsTouched();
      return;
    }
    const zoneName = this.nameCtl.value.trim();
    const description = this.descCtl.value.trim() || null;
    this.saving.set(true);
    const done = (z: PricingZone, msg: string) => { this.saving.set(false); this.notify.success(msg); this.router.navigate(['/business-customer/pricing-zones', z.id]); };
    const fail = (e: HttpErrorResponse) => {
      this.saving.set(false);
      if (e.status === 409) this.notify.error(e.error?.message ?? 'A zone with that name already exists for this customer.');
      else this.notify.error(e.error?.message ?? 'Could not save the zone.');
    };
    if (this.isCreate()) {
      this.service.createZone({
        customerId: this.customerCtl.value, zoneName, description,
        locations: this.pending().map((p) => ({ districtId: p.districtId, cityId: p.cityId }))
      }).subscribe({ next: (z) => done(z, 'Zone created.'), error: fail });
    } else {
      this.service.updateZone(this.zoneId!, { zoneName, description, version: this.zone()!.version })
        .subscribe({ next: (z) => { this.zone.set(z); this.saving.set(false); this.notify.success('Zone updated.'); }, error: fail });
    }
  }

  protected openRate(): void { this.router.navigate(['/business-customer/rates', this.zoneId]); }
  protected back(): void { this.router.navigate(['/business-customer/pricing-zones']); }
}
