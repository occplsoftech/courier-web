import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { NotificationService } from '@core/services/notification.service';
import { AddressType, AddressUsage, ADDRESS_TYPES, ADDRESS_USAGES, CustomerAddress } from '@core/models/customer.model';
import { CustomerService, GeographyOption } from '../customer.service';

export interface AddressFormData {
  customerId: string;
  /** Present in edit mode; absent when adding a new address. */
  address?: CustomerAddress | null;
}

const TYPE_OPTS: SelectOption[] = ADDRESS_TYPES.map((t) => ({
  value: t, label: t.charAt(0) + t.slice(1).toLowerCase()
}));

const USAGE_LABELS: Record<AddressUsage, string> = { PICKUP: 'Pickup', DELIVERY: 'Delivery', BOTH: 'Pickup & Delivery' };
const USAGE_OPTS: SelectOption[] = ADDRESS_USAGES.map((u) => ({ value: u, label: USAGE_LABELS[u] }));

function toOptions(rows: GeographyOption[]): SelectOption[] {
  return rows.map((r) => ({ value: r.id, label: r.label }));
}

/**
 * Add or edit one customer address. Geography (country → state → district → city → area →
 * pincode) is a cascade: picking a level clears and reloads everything beneath it, backed
 * by the shared global masters (see CustomerService). Every level is optional — a counter
 * clerk who only has the pincode in hand can leave the rest blank; the backend validates
 * only what is supplied.
 */
@Component({
  selector: 'app-address-form-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatDialogModule, MatSlideToggleModule, UiInput, UiSelect, UiButton],
  template: `
    <div class="afd">
      <h2 class="text-h2">{{ isEdit() ? 'Edit address' : 'Add address' }}</h2>
      <form [formGroup]="form" (ngSubmit)="save()" class="afd__form">
        <div class="grid">
          <app-select [control]="c('addressType')" label="Address Type" [options]="types" />
          <app-select [control]="c('addressUsage')" label="Used For" [options]="usages" />
        </div>

        <div class="grid">
          <app-select [control]="c('countryId')" label="Country" [options]="countryOpts()"
                      [allowEmpty]="true" emptyLabel="Not set" placeholder="Select a country" />
          <app-select [control]="c('stateId')" label="State" [options]="stateOpts()"
                      [allowEmpty]="true" emptyLabel="Not set" placeholder="Select a country first" />
          <app-select [control]="c('districtId')" label="District" [options]="districtOpts()"
                      [allowEmpty]="true" emptyLabel="Not set" placeholder="Select a state first" />
          <app-select [control]="c('cityId')" label="City" [options]="cityOpts()"
                      [allowEmpty]="true" emptyLabel="Not set" placeholder="Select a district first" />
          <app-select [control]="c('areaId')" label="Area" [options]="areaOpts()"
                      [allowEmpty]="true" emptyLabel="Not set" placeholder="Select a city first" />
          <app-select [control]="c('pincodeId')" label="Pincode" [options]="pincodeOpts()"
                      [allowEmpty]="true" emptyLabel="Not set" placeholder="Select an area first" />
        </div>

        <app-input [control]="c('addressLine1')" label="Address Line 1" [required]="true" placeholder="Building, street" [maxLength]="255" />
        <app-input [control]="c('addressLine2')" label="Address Line 2" placeholder="Landmark, area" [maxLength]="255" />
        <app-input [control]="c('landmark')" label="Landmark" placeholder="Near..." [maxLength]="150" />

        <div class="grid">
          <app-input [control]="c('latitude')" label="Latitude" type="text" placeholder="18.520430" />
          <app-input [control]="c('longitude')" label="Longitude" type="text" placeholder="73.856743" />
        </div>

        <div class="flags">
          <label class="flag"><mat-slide-toggle [formControl]="c('isDefaultPickup')" />
            <span><strong>Default Pickup</strong><em>Clears the flag on any other address of this customer</em></span></label>
          <label class="flag"><mat-slide-toggle [formControl]="c('isDefaultDelivery')" />
            <span><strong>Default Delivery</strong><em>Clears the flag on any other address of this customer</em></span></label>
        </div>

        <div class="afd__actions">
          <app-button variant="stroked" type="button" (pressed)="ref.close(null)">Cancel</app-button>
          <app-button type="submit" icon="save" [loading]="busy()">{{ isEdit() ? 'Save Changes' : 'Add Address' }}</app-button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .afd { padding:24px; width:560px; max-width:92vw; max-height:85vh; overflow-y:auto; display:flex; flex-direction:column; gap:16px; }
    .afd__form { display:flex; flex-direction:column; gap:16px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }
    .flags { display:flex; flex-direction:column; gap:14px; }
    .flag { display:flex; align-items:center; gap:12px; cursor:pointer; }
    .flag span { display:flex; flex-direction:column; }
    .flag strong { font:600 17px var(--font-sans); color:var(--content-fg); }
    .flag em { font:400 15px var(--font-sans); color:var(--content-muted); font-style:normal; }
    .afd__actions { display:flex; justify-content:flex-end; gap:10px; margin-top:4px; }
    @media (max-width:600px){ .grid { grid-template-columns:1fr; } }
  `]
})
export class AddressFormDialog {
  readonly ref = inject(MatDialogRef<AddressFormDialog>);
  readonly data = inject<AddressFormData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(CustomerService);
  private readonly notify = inject(NotificationService);

  protected readonly types = TYPE_OPTS;
  protected readonly usages = USAGE_OPTS;
  protected readonly isEdit = computed(() => !!this.data.address);
  readonly busy = signal(false);

  private readonly countries = signal<GeographyOption[]>([]);
  private readonly states = signal<GeographyOption[]>([]);
  private readonly districts = signal<GeographyOption[]>([]);
  private readonly cities = signal<GeographyOption[]>([]);
  private readonly areas = signal<GeographyOption[]>([]);
  private readonly pincodes = signal<GeographyOption[]>([]);

  protected readonly countryOpts = computed(() => toOptions(this.countries()));
  protected readonly stateOpts = computed(() => toOptions(this.states()));
  protected readonly districtOpts = computed(() => toOptions(this.districts()));
  protected readonly cityOpts = computed(() => toOptions(this.cities()));
  protected readonly areaOpts = computed(() => toOptions(this.areas()));
  protected readonly pincodeOpts = computed(() => toOptions(this.pincodes()));

  protected readonly form: FormGroup = this.fb.group({
    addressType: ['HOME' as AddressType, Validators.required],
    addressUsage: ['BOTH' as AddressUsage, Validators.required],
    countryId: [null as string | null],
    stateId: [null as string | null],
    districtId: [null as string | null],
    cityId: [null as string | null],
    areaId: [null as string | null],
    pincodeId: [null as string | null],
    addressLine1: ['', [Validators.required, Validators.maxLength(255)]],
    addressLine2: ['', Validators.maxLength(255)],
    landmark: ['', Validators.maxLength(150)],
    latitude: [''],
    longitude: [''],
    isDefaultPickup: [false],
    isDefaultDelivery: [false]
  });

  constructor() {
    this.service.countries().subscribe((rows) => this.countries.set(rows));

    this.c('countryId').valueChanges.subscribe((id) => this.cascade('state', id));
    this.c('stateId').valueChanges.subscribe((id) => this.cascade('district', id));
    this.c('districtId').valueChanges.subscribe((id) => this.cascade('city', id));
    this.c('cityId').valueChanges.subscribe((id) => this.cascade('area', id));
    this.c('areaId').valueChanges.subscribe((id) => this.cascade('pincode', id));

    const a = this.data.address;
    if (a) {
      this.form.patchValue({
        addressType: a.addressType, addressUsage: a.addressUsage ?? 'BOTH', countryId: a.countryId ?? null, stateId: a.stateId ?? null,
        districtId: a.districtId ?? null, cityId: a.cityId ?? null, areaId: a.areaId ?? null,
        pincodeId: a.pincodeId ?? null, addressLine1: a.addressLine1, addressLine2: a.addressLine2 ?? '',
        landmark: a.landmark ?? '', latitude: a.latitude != null ? String(a.latitude) : '',
        longitude: a.longitude != null ? String(a.longitude) : '',
        isDefaultPickup: a.isDefaultPickup, isDefaultDelivery: a.isDefaultDelivery
      }, { emitEvent: false });
      if (a.countryId) this.service.states(a.countryId).subscribe((rows) => this.states.set(rows));
      if (a.stateId) this.service.districts(a.stateId).subscribe((rows) => this.districts.set(rows));
      if (a.districtId) this.service.cities(a.districtId).subscribe((rows) => this.cities.set(rows));
      if (a.cityId) this.service.areas(a.cityId).subscribe((rows) => this.areas.set(rows));
      if (a.areaId) this.service.pincodes(a.areaId).subscribe((rows) => this.pincodes.set(rows));
    }
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  /** Clears and reloads everything beneath the level just changed. */
  private cascade(level: 'state' | 'district' | 'city' | 'area' | 'pincode', parentId: string | null): void {
    const resetLists: Record<string, () => void> = {
      state: () => { this.states.set([]); this.districts.set([]); this.cities.set([]); this.areas.set([]); this.pincodes.set([]); },
      district: () => { this.districts.set([]); this.cities.set([]); this.areas.set([]); this.pincodes.set([]); },
      city: () => { this.cities.set([]); this.areas.set([]); this.pincodes.set([]); },
      area: () => { this.areas.set([]); this.pincodes.set([]); },
      pincode: () => this.pincodes.set([])
    };
    resetLists[level]?.();

    if (!parentId) return;
    switch (level) {
      case 'state': this.service.states(parentId).subscribe((rows) => this.states.set(rows)); break;
      case 'district': this.service.districts(parentId).subscribe((rows) => this.districts.set(rows)); break;
      case 'city': this.service.cities(parentId).subscribe((rows) => this.cities.set(rows)); break;
      case 'area': this.service.areas(parentId).subscribe((rows) => this.areas.set(rows)); break;
      case 'pincode': this.service.pincodes(parentId).subscribe((rows) => this.pincodes.set(rows)); break;
    }
  }

  protected save(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();
    const trim = (s: string | null) => (s && s.trim() ? s.trim() : null);
    const num = (s: string | null) => (s && s.trim() ? Number(s) : null);

    const body = {
      addressType: v.addressType as AddressType,
      addressUsage: v.addressUsage as AddressUsage,
      countryId: v.countryId || null, stateId: v.stateId || null, districtId: v.districtId || null,
      cityId: v.cityId || null, areaId: v.areaId || null, pincodeId: v.pincodeId || null,
      addressLine1: v.addressLine1.trim(), addressLine2: trim(v.addressLine2), landmark: trim(v.landmark),
      latitude: num(v.latitude), longitude: num(v.longitude),
      isDefaultPickup: !!v.isDefaultPickup, isDefaultDelivery: !!v.isDefaultDelivery
    };

    this.busy.set(true);
    const request = this.isEdit()
      ? this.service.updateAddress(this.data.customerId, this.data.address!.id, { ...body, version: this.data.address!.version })
      : this.service.addAddress(this.data.customerId, body);

    request.subscribe({
      next: (address: CustomerAddress) => {
        this.busy.set(false);
        this.notify.success(this.isEdit() ? 'Address updated.' : 'Address added.');
        this.ref.close(address);
      },
      error: (e) => {
        this.busy.set(false);
        this.notify.error(e?.error?.message ?? 'Could not save the address.');
      }
    });
  }
}
