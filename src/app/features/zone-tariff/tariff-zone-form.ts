import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import {
  LocationScope, SCOPE_LABELS, TariffLocationRequest, TariffZone, ZONE_USAGE_LABELS, ZoneUsage
} from '@core/models/zone-tariff.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { CustomerService } from '@features/customer/customer.service';
import { ZoneTariffService } from './zone-tariff.service';

/** A location chosen in the create flow, before the zone exists to post it to. */
interface PendingLocation { request: TariffLocationRequest; key: string; label: string; scope: LocationScope; }

const USAGE_OPTS: SelectOption[] = (Object.keys(ZONE_USAGE_LABELS) as ZoneUsage[]).map((u) => ({ value: u, label: ZONE_USAGE_LABELS[u] }));
const SCOPE_OPTS: SelectOption[] = (Object.keys(SCOPE_LABELS) as LocationScope[]).map((s) => ({ value: s, label: SCOPE_LABELS[s] }));
const SCOPE_ICONS: Record<LocationScope, string> = { STATE: 'public', DISTRICT: 'map', CITY: 'location_city', PINCODE: 'pin_drop' };

/**
 * Create / manage one tariff zone. Create posts the zone with its locations in one call; manage edits the zone and
 * adds/removes locations live, so the server's "already in zone X" rule answers immediately.
 *
 * A location is a whole state, a district, a city, or pincodes (several at once, separated by commas or spaces).
 * A city can sit in METRO while its state sits in another zone: the most specific location wins.
 */
@Component({
  selector: 'app-tariff-zone-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiInput, UiSelect, UiButton, UiLoader, StatusBadge, MatIconModule],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">{{ isCreate() ? 'New Tariff Zone' : (zone()?.code || 'Tariff Zone') }}</h1>
          <p class="text-caption">{{ isCreate() ? 'Name the zone, say how it is used, and add the places in it.' : (zone()?.name || '') }}</p>
        </div>
        @if (!isCreate() && zone()) {
          <div class="page__actions"><app-status-badge [value]="zone()!.status" [label]="zone()!.status === 'ACTIVE' ? 'Active' : 'Inactive'" /></div>
        }
      </header>

      @if (loading()) {
        <app-loader [minHeight]="240" caption="Loading…" />
      } @else if (!isCreate() && !zone()) {
        <app-card><p class="empty">Zone not found.</p></app-card>
      } @else {
        <app-card title="Zone" subtitle="The code is unique in your company. A FROM zone is where shipments start (it picks the rate card); a TO zone is where they are delivered.">
          <div class="grid">
            <app-input [control]="codeCtl" label="Code" [required]="true" placeholder="e.g. PUNE, METRO, KERALA" [maxLength]="30" />
            <app-input [control]="nameCtl" label="Name" [required]="true" placeholder="e.g. Pune city" [maxLength]="100" />
            <app-select [control]="usageCtl" label="Used as" [options]="usageOpts" />
            <app-input [control]="orderCtl" label="Display order" type="number" [min]="0" />
            <app-input [control]="descCtl" label="Description" placeholder="Optional" [maxLength]="255" />
          </div>
        </app-card>

        <app-card title="Places in this zone" subtitle="A state, district, city or pincodes. A place can be in only one to zone and one from zone.">
          @if (canWrite()) {
            <div class="picker">
              <app-select [control]="scopeCtl" label="Add a" [options]="scopeOpts" />
              @if (scopeCtl.value === 'PINCODE') {
                <app-input [control]="pinsCtl" label="Pincodes" placeholder="411030, 411031 …" />
              } @else {
                <app-select [control]="stateCtl" label="State" [options]="stateOpts()" placeholder="Select a state" />
                @if (scopeCtl.value !== 'STATE') {
                  <app-select [control]="districtCtl" label="District" [options]="districtOpts()" placeholder="Select a district" />
                }
                @if (scopeCtl.value === 'CITY') {
                  <app-select [control]="cityCtl" label="City" [options]="cityOpts()" placeholder="Select a city" />
                }
              }
              <app-button icon="add" [disabled]="!canAdd() || adding()" [loading]="adding()" (pressed)="addLocation()">Add</app-button>
            </div>
          }

          @if (rows().length === 0) {
            <p class="empty">No places yet.</p>
          } @else {
            <ul class="locs">
              @for (l of rows(); track l.key) {
                <li class="loc">
                  <mat-icon>{{ icon(l.scope) }}</mat-icon>
                  <span class="loc__name">{{ l.label }}</span>
                  <span class="loc__tag">{{ scopeLabel(l.scope) }}</span>
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
    .picker { display:grid; grid-template-columns:minmax(0,160px) repeat(3,minmax(0,1fr)) auto; gap:12px 16px; align-items:end; margin-bottom:16px; }
    .empty { font:400 14px var(--font-sans); color:var(--content-muted); text-align:center; padding:16px; }
    .locs { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
    .loc { display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid var(--surface-border); border-radius:var(--r-field); background:var(--surface); }
    .loc mat-icon { color:var(--content-muted); }
    .loc__name { font:600 14px var(--font-sans); flex:1; }
    .loc__tag { font:500 12px var(--font-sans); color:var(--content-muted); }
    .loc__rm { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .loc__rm:hover { background:var(--surface-muted); color:var(--danger); }
    .bar { display:flex; justify-content:flex-end; gap:10px; margin-top:8px; }
    @media (max-width:860px){ .grid, .picker { grid-template-columns:1fr; } }
  `]
})
export class TariffZoneForm implements OnInit {
  private readonly service = inject(ZoneTariffService);
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
  protected readonly zone = signal<TariffZone | null>(null);
  private readonly pending = signal<PendingLocation[]>([]);

  protected readonly codeCtl = new FormControl<string>('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(30)] });
  protected readonly nameCtl = new FormControl<string>('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] });
  protected readonly usageCtl = new FormControl<string>('TO', { nonNullable: true });
  protected readonly orderCtl = new FormControl<number | null>(0);
  protected readonly descCtl = new FormControl<string>('', { nonNullable: true, validators: [Validators.maxLength(255)] });
  protected readonly scopeCtl = new FormControl<string>('STATE', { nonNullable: true });
  protected readonly stateCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly districtCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly cityCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly pinsCtl = new FormControl<string>('', { nonNullable: true });

  protected readonly usageOpts = USAGE_OPTS;
  protected readonly scopeOpts = SCOPE_OPTS;
  protected readonly stateOpts = signal<SelectOption[]>([]);
  protected readonly districtOpts = signal<SelectOption[]>([]);
  protected readonly cityOpts = signal<SelectOption[]>([]);
  /** Bumped on every picker change so `canAdd` (a computed) re-reads the controls. */
  private readonly pickerTick = signal(0);

  protected readonly canWrite = computed(() => this.perms.canAccess({
    roles: [AppRole.COMPANY_ADMIN], permissions: [this.isCreate() ? 'TARIFF_CREATE' : 'TARIFF_UPDATE']
  }));

  protected readonly canAdd = computed(() => {
    this.pickerTick();
    switch (this.scopeCtl.value as LocationScope) {
      case 'STATE': return !!this.stateCtl.value;
      case 'DISTRICT': return !!this.districtCtl.value;
      case 'CITY': return !!this.cityCtl.value;
      case 'PINCODE': return this.pincodes().length > 0;
    }
  });

  /** One display model for both modes: saved locations (manage) or pending ones (create). */
  protected readonly rows = computed(() => this.isCreate()
    ? this.pending().map((p) => ({ key: p.key, scope: p.scope, label: p.label }))
    : (this.zone()?.locations ?? []).map((l) => ({ key: l.id!, scope: l.scope, label: l.label })));

  ngOnInit(): void {
    this.breadcrumb.set([
      { label: 'Zone Tariff' }, { label: 'Zones', route: '/zone-tariff/zones' }, { label: this.isCreate() ? 'New' : 'Manage' }
    ]);
    if (this.isCreate()) this.loading.set(false); else this.reload(true);

    // Cascading geography pickers: first country (the platform catalogue is India-only today).
    this.geo.countries().subscribe((cs) => {
      if (cs.length) this.geo.states(cs[0].id).subscribe((s) => this.stateOpts.set(s.map((o) => ({ value: o.id, label: o.label }))));
    });
    this.stateCtl.valueChanges.subscribe((id) => {
      this.districtCtl.setValue(''); this.cityCtl.setValue(''); this.districtOpts.set([]); this.cityOpts.set([]);
      if (id) this.geo.districts(id).subscribe((d) => this.districtOpts.set(d.map((o) => ({ value: o.id, label: o.label }))));
      this.pickerTick.update((n) => n + 1);
    });
    this.districtCtl.valueChanges.subscribe((id) => {
      this.cityCtl.setValue(''); this.cityOpts.set([]);
      if (id) this.geo.cities(id).subscribe((c) => this.cityOpts.set(c.map((o) => ({ value: o.id, label: o.label }))));
      this.pickerTick.update((n) => n + 1);
    });
    for (const ctl of [this.cityCtl, this.pinsCtl, this.scopeCtl]) ctl.valueChanges.subscribe(() => this.pickerTick.update((n) => n + 1));
  }

  private reload(first = false): void {
    this.service.zone(this.zoneId!).subscribe({
      next: (z) => {
        this.zone.set(z);
        if (first) {
          this.codeCtl.setValue(z.code); this.nameCtl.setValue(z.name); this.usageCtl.setValue(z.usage);
          this.orderCtl.setValue(z.displayOrder); this.descCtl.setValue(z.description ?? '');
        }
        this.loading.set(false);
      },
      error: () => { this.zone.set(null); this.loading.set(false); }
    });
  }

  protected icon(s: LocationScope): string { return SCOPE_ICONS[s]; }
  protected scopeLabel(s: LocationScope): string { return s === 'STATE' ? 'Whole state' : s === 'DISTRICT' ? 'Whole district' : SCOPE_LABELS[s]; }

  private pincodes(): string[] {
    return this.pinsCtl.value.split(/[\s,;]+/).map((p) => p.trim()).filter((p) => p.length > 0);
  }

  private optionLabel(opts: SelectOption[], id: string): string { return (opts.find((o) => o.value === id)?.label ?? id).replace(/\s*\([^)]*\)$/, ''); }

  /** What the picker currently describes, as requests (pincodes: one per code). */
  private picked(): PendingLocation[] {
    const scope = this.scopeCtl.value as LocationScope;
    const state = this.optionLabel(this.stateOpts(), this.stateCtl.value);
    switch (scope) {
      case 'STATE':
        return [{ scope, key: `S:${this.stateCtl.value}`, label: state, request: { scope, stateId: this.stateCtl.value } }];
      case 'DISTRICT': {
        const d = this.optionLabel(this.districtOpts(), this.districtCtl.value);
        return [{ scope, key: `D:${this.districtCtl.value}`, label: `${d}, ${state}`, request: { scope, districtId: this.districtCtl.value } }];
      }
      case 'CITY': {
        const d = this.optionLabel(this.districtOpts(), this.districtCtl.value);
        const c = this.optionLabel(this.cityOpts(), this.cityCtl.value);
        return [{ scope, key: `C:${this.cityCtl.value}`, label: `${c}, ${d}`, request: { scope, cityId: this.cityCtl.value, districtId: this.districtCtl.value } }];
      }
      case 'PINCODE':
        return this.pincodes().map((p) => ({ scope, key: `P:${p}`, label: p, request: { scope, pincode: p } }));
    }
  }

  protected addLocation(): void {
    const picked = this.picked();
    const bad = picked.find((p) => p.scope === 'PINCODE' && !/^[1-9][0-9]{5}$/.test(p.request.pincode ?? ''));
    if (bad) { this.notify.error(`"${bad.label}" is not a 6-digit pincode.`); return; }
    if (this.isCreate()) {
      const have = new Set(this.pending().map((p) => p.key));
      const dup = picked.find((p) => have.has(p.key));
      if (dup) { this.notify.error(`${dup.label} is already in this zone.`); return; }
      this.pending.update((l) => [...l, ...picked]);
      this.cityCtl.setValue(''); this.pinsCtl.setValue('');
      return;
    }
    this.adding.set(true);
    this.service.addLocations(this.zoneId!, picked.map((p) => p.request)).subscribe({
      next: (z) => { this.zone.set(z); this.adding.set(false); this.cityCtl.setValue(''); this.pinsCtl.setValue(''); this.notify.success(picked.length > 1 ? `${picked.length} places added.` : 'Place added.'); },
      error: (e: HttpErrorResponse) => { this.adding.set(false); this.notify.error(e.error?.message ?? 'Could not add the place.'); }
    });
  }

  protected removeRow(key: string): void {
    if (this.isCreate()) { this.pending.update((l) => l.filter((p) => p.key !== key)); return; }
    this.service.removeLocation(this.zoneId!, key).subscribe({
      next: (z) => { this.zone.set(z); this.notify.success('Place removed.'); },
      error: (e: HttpErrorResponse) => this.notify.error(e.error?.message ?? 'Could not remove the place.')
    });
  }

  protected save(): void {
    this.codeCtl.markAsTouched(); this.nameCtl.markAsTouched();
    if (this.codeCtl.invalid || this.nameCtl.invalid) return;
    const body = {
      code: this.codeCtl.value.trim(), name: this.nameCtl.value.trim(), usage: this.usageCtl.value as ZoneUsage,
      description: this.descCtl.value.trim() || null, displayOrder: this.orderCtl.value ?? 0
    };
    this.saving.set(true);
    const fail = (e: HttpErrorResponse) => { this.saving.set(false); this.notify.error(e.error?.message ?? 'Could not save the zone.'); };
    if (this.isCreate()) {
      this.service.createZone({ ...body, locations: this.pending().map((p) => p.request) }).subscribe({
        next: (z) => { this.saving.set(false); this.notify.success('Zone created.'); this.router.navigate(['/zone-tariff/zones', z.id]); },
        error: fail
      });
    } else {
      this.service.updateZone(this.zoneId!, { ...body, version: this.zone()!.version }).subscribe({
        next: (z) => { this.zone.set(z); this.saving.set(false); this.notify.success('Zone updated.'); },
        error: fail
      });
    }
  }

  protected back(): void { this.router.navigate(['/zone-tariff/zones']); }
}
