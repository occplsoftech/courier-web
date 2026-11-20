import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import {
  AbstractControl, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors,
  Validators
} from '@angular/forms';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import {
  BranchResponse, BranchType, BRANCH_TYPES,
  BranchUserRequest, CreateBranchRequest, UpdateBranchRequest
} from '@core/models/branch.model';
import { BranchService, GeographyOption, Lookup } from '../branch.service';

function toOptions(rows: GeographyOption[]): SelectOption[] {
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

const CODE = /^[A-Za-z0-9][A-Za-z0-9_ -]{1,48}[A-Za-z0-9]$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+]?[0-9 \-]{7,20}$/;
const GSTIN = /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z]Z[0-9A-Za-z]$/;
const PAN = /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/;
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const TYPE_LABELS: Record<BranchType, string> = {
  CP: 'CP (Channel Partner)', BRANCH: 'Branch', HUB: 'Hub', PICKUP_DELIVERY_PARTNER: 'Pickup-Delivery Partner (PDP)'
};
const TYPE_OPTS: SelectOption[] = BRANCH_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }));
const DAY_OPTS: SelectOption[] = DAYS.map((d) => ({ value: d, label: d }));

/**
 * Email, checked on the trimmed value — the submit trims and so does the server, so
 * rejecting a pasted " a@b.test " would be an error about nothing.
 */
function emailish(control: AbstractControl): ValidationErrors | null {
  const value = (control.value ?? '').trim();
  return !value || EMAIL.test(value) ? null : { email: true };
}

/**
 * Reactive create/edit editor for a branch. Validators mirror CreateBranchRequest /
 * UpdateBranchRequest so a bad body is rejected before the API. `branchCode` is editable in
 * both modes. The manager is set on create but changed through
 * the assign-manager endpoint afterwards, so in edit it is read-only with a pointer to the
 * dialog; `status` likewise has its own lifecycle endpoints. Edit emits UpdateBranchRequest
 * carrying the last-read `version`.
 *
 * On create the form also carries the branch's **login account** (the `branchUser` block):
 * one submit creates the branch, its user and its wallet. Every field there is optional —
 * left empty, the backend derives `<branch-code>@<company>.local` and generates a password
 * it returns once. In edit the section is absent: the account exists and is managed from
 * Users.
 *
 * Honesty: the UI-10 spec's Owner/Contact-Person field has no column on the backend branch;
 * it is omitted rather than faked. "Vendor Type" maps to `branchType`, "Area" to `district`,
 * "Pincode" to `postalCode`. GST/PAN are branch-level fields (a company may run branches
 * under different state GSTINs), editable in both create and edit.
 */
@Component({
  selector: 'app-branch-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatSlideToggleModule, UiCard, UiInput, UiSelect, UiButton],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="bform">
      <app-card title="Basic Information" subtitle="Identity and classification.">
        <div class="grid">
          <app-input [control]="c('branchCode')" label="Branch Code" [required]="true" placeholder="PUNE_MAIN" [maxLength]="50" />
          <app-input [control]="c('branchName')" label="Branch Name" [required]="true" placeholder="Pune Main Branch" [maxLength]="150" />
          <app-select [control]="c('branchType')" label="Vendor / Branch Type" [options]="types" placeholder="Select a type" />
          @if (isCreate()) {
            <app-select [control]="c('managerId')" label="Manager" [options]="managerOptions()"
                        [allowEmpty]="true" emptyLabel="Unassigned" placeholder="Select a company user" />
          } @else {
            <div class="stat"><span class="stat__l">Manager</span>
              <span class="stat__v">{{ managerName() }}</span><span class="stat__h">Change via “Assign Manager”</span></div>
          }
        </div>
      </app-card>

      <app-card title="Contact" subtitle="How to reach this branch.">
        <div class="grid">
          <app-input [control]="c('email')" label="Email" type="email" placeholder="pune@company.com" [maxLength]="255" />
          <app-input [control]="c('mobile')" label="Mobile" type="tel" placeholder="+91 90000 00000" [maxLength]="20" />
          <app-input [control]="c('alternateMobile')" label="Alternate Mobile" type="tel" placeholder="+91 80 0000 0000" [maxLength]="20" />
        </div>
      </app-card>

      <app-card title="Address" subtitle="Where the branch is located.">
        <div class="grid">
          <app-input [control]="c('addressLine1')" label="Address Line 1" placeholder="Building, street" [maxLength]="255" />
          <app-input [control]="c('addressLine2')" label="Address Line 2" placeholder="Landmark, area" [maxLength]="255" />
          @if (isCreate()) {
            <app-select [control]="c('countryId')" label="Country" [options]="countryOpts()"
                        [allowEmpty]="true" emptyLabel="Not set" placeholder="Select a country" />
            <app-select [control]="c('stateId')" label="State" [options]="stateOpts()"
                        [allowEmpty]="true" emptyLabel="Not set" placeholder="Select a country first" />
            <app-select [control]="c('districtId')" label="Area / District" [options]="districtOpts()"
                        [allowEmpty]="true" emptyLabel="Not set" placeholder="Select a state first" />
            <app-select [control]="c('cityId')" label="City" [options]="cityOpts()"
                        [allowEmpty]="true" emptyLabel="Not set" placeholder="Select a district first" />
          } @else {
            <app-input [control]="c('country')" label="Country" placeholder="India" [maxLength]="100" />
            <app-input [control]="c('state')" label="State" placeholder="Maharashtra" [maxLength]="100" />
            <app-input [control]="c('district')" label="Area / District" placeholder="Shivajinagar" [maxLength]="100" />
            <app-input [control]="c('city')" label="City" placeholder="Pune" [maxLength]="100" />
          }
          <app-input [control]="c('taluka')" label="Taluka" placeholder="Haveli" [maxLength]="100" />
          <app-input [control]="c('postalCode')" label="Pincode" placeholder="411005" [maxLength]="20" />
          <app-input [control]="c('latitude')" label="Latitude" type="number" [step]="0.000001" [min]="-90" [max]="90" placeholder="18.520430" />
          <app-input [control]="c('longitude')" label="Longitude" type="number" [step]="0.000001" [min]="-180" [max]="180" placeholder="73.856743" />
        </div>
        <p class="bform__hint">
          Leave blank to auto-detect from the address above. Set both manually to override or when
          auto-detection can't resolve this location.
        </p>
      </app-card>

      <app-card title="Working Hours" subtitle="Optional — closing must be after opening.">
        <div class="grid">
          <label class="dt"><span class="dt__l">Opening Time</span>
            <input class="dt__i" type="time" [formControl]="c('openingTime')" /></label>
          <label class="dt"><span class="dt__l">Closing Time</span>
            <input class="dt__i" type="time" [formControl]="c('closingTime')" /></label>
          <app-select [control]="c('workingDays')" label="Working Days" [options]="dayOpts" [multiple]="true" placeholder="Any" />
        </div>
      </app-card>

      <app-card title="Operations" subtitle="Which capabilities this branch is allowed.">
        <div class="flags">
          <label class="flag"><mat-slide-toggle [formControl]="c('allowBooking')" />
            <span><strong>Booking</strong><em>Accept new shipment bookings</em></span></label>
          <label class="flag"><mat-slide-toggle [formControl]="c('allowDelivery')" />
            <span><strong>Delivery</strong><em>Deliver shipments to consignees</em></span></label>
          <label class="flag"><mat-slide-toggle [formControl]="c('allowPickup')" />
            <span><strong>Pickup</strong><em>Field pickups from senders</em></span></label>
          <label class="flag"><mat-slide-toggle [formControl]="c('allowManifest')" />
            <span><strong>Manifest</strong><em>Build outbound manifests</em></span></label>
          <label class="flag"><mat-slide-toggle [formControl]="c('allowCashCollection')" />
            <span><strong>Cash Collection</strong><em>Collect COD at counter</em></span></label>
          <label class="flag"><mat-slide-toggle [formControl]="c('allowWallet')" />
            <span><strong>Wallet</strong><em>Prepaid wallet billing</em></span></label>
          <label class="flag"><mat-slide-toggle [formControl]="c('instantCommission')" />
            <span><strong>Instant Commission</strong><em>Credit branch commission the moment a PREPAID booking debits</em></span></label>
        </div>
      </app-card>

      @if (isCreate()) {
        <app-card title="Branch User"
                  subtitle="The login for this branch. Created with it, along with its wallet.">
          <div class="grid">
            <app-input [control]="u('email')" label="Login Email" type="email" [maxLength]="255"
                       placeholder="Defaults to the branch email, then to a derived address" />
            <app-input [control]="u('mobile')" label="Mobile" type="tel" [maxLength]="20"
                       placeholder="Defaults to the branch mobile" />
            <app-input [control]="u('firstName')" label="First Name" [maxLength]="100"
                       placeholder="Defaults to the branch name" />
            <app-input [control]="u('lastName')" label="Last Name" placeholder="Branch" [maxLength]="100" />
            <app-input [control]="u('password')" label="Password" type="password" [maxLength]="128"
                       [togglePassword]="true" autocomplete="new-password"
                       placeholder="Leave blank to generate one" />
          </div>
          <p class="bform__hint">
            The account is created active with the <strong>Branch Manager</strong> role and is
            made this branch's manager unless you picked one above. Leave the password blank
            and the generated one is shown <strong>once</strong>, right after saving — it
            cannot be read back, only reset.
          </p>
        </app-card>
      }

      <app-card title="Tax Details" subtitle="Branch's registration numbers. Optional.">
        <div class="grid">
          <app-input [control]="c('gstNumber')" label="GST Number" placeholder="27AAAAA0000A1Z5" [maxLength]="15" />
          <app-input [control]="c('panNumber')" label="PAN Number" placeholder="AAAAA0000A" [maxLength]="10" />
        </div>
      </app-card>

      <app-card title="Charges" subtitle="Branch-level percentages applied to shipment charges.">
        <div class="grid">
          <app-input [control]="c('gstPercentage')" label="GST %" type="number" [min]="0" [max]="100" [step]="0.01" placeholder="18" />
          <app-input [control]="c('commissionOnOtherCharges')" label="Company Commission on Other Charges %" type="number" [min]="0" [max]="100" [step]="0.01" placeholder="20" />
          <app-input [control]="c('commissionOnBasicFreight')" label="Commission on Basic Freight %" type="number" [min]="0" [max]="100" [step]="0.01" placeholder="10" />
          <app-input [control]="c('companyServiceChargePercentage')" label="Company Service Charge %" type="number" [min]="0" [max]="100" [step]="0.01" placeholder="10" />
          <app-input [control]="c('drsChargePerQty')" label="DRS Charge per Qty" type="number" [min]="0" [step]="0.01" placeholder="2" />
          <app-input [control]="c('deliveryCommissionRatePerKg')" label="Delivery Commission per Kg" type="number" [min]="0" [step]="0.01" placeholder="1.5" />
          <app-input [control]="c('deliveryCommissionMinWeightKg')" label="Delivery Commission Minimum Chargeable Weight (Kg)" type="number" [min]="0" [step]="0.01" placeholder="10" />
        </div>
      </app-card>

      <app-card title="Notes" subtitle="Internal remarks.">
        <app-input [control]="c('remarks')" label="Remarks" placeholder="Any internal note about this branch" [maxLength]="500" />
      </app-card>

      <div class="bform__bar">
        <span class="bform__note">@if (form.invalid && form.touched) { Fix the highlighted fields before saving. }</span>
        <div class="bform__actions">
          <app-button variant="stroked" (pressed)="cancelled.emit()">Cancel</app-button>
          <app-button type="submit" icon="save" [loading]="saving()" [disabled]="!isCreate() && form.pristine">
            {{ isCreate() ? 'Create Branch' : 'Save Changes' }}
          </app-button>
        </div>
      </div>
    </form>
  `,
  styles: [`
    .bform { display:flex; flex-direction:column; gap:16px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }
    .stat { display:flex; flex-direction:column; gap:6px; justify-content:center; }
    .stat__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .stat__v { font:600 17px var(--font-sans); color:var(--content-fg); }
    .stat__h { font:400 15px var(--font-sans); color:var(--content-muted); }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .dt { display:flex; flex-direction:column; gap:6px; }
    .dt__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .dt__i { height:42px; padding:0 12px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-field); font:400 17px var(--font-sans); color:var(--content-fg); }
    .dt__i:focus { outline:0; border-color:var(--brand-500); box-shadow:0 0 0 3px var(--brand-100); }
    .flags { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px 20px; }
    .flag { display:flex; align-items:center; gap:12px; cursor:pointer; }
    .flag span { display:flex; flex-direction:column; }
    .flag strong { font:600 17px var(--font-sans); color:var(--content-fg); }
    .flag em { font:400 15px var(--font-sans); color:var(--content-muted); font-style:normal; }
    .bform__bar { position:sticky; bottom:0; display:flex; align-items:center; justify-content:space-between;
      gap:16px; padding:14px 16px; background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .bform__note { font:500 16px var(--font-sans); color:var(--danger); }
    .bform__hint { margin:14px 0 0; font:400 15px var(--font-sans); color:var(--content-muted); line-height:1.55; }
    .bform__actions { display:flex; gap:10px; }
    @media (max-width:760px){ .grid, .flags { grid-template-columns:1fr; } }
  `]
})
export class BranchForm {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(BranchService);

  readonly mode = input<'create' | 'edit'>('create');
  readonly branch = input<BranchResponse | null>(null);
  readonly managers = input<Lookup[]>([]);
  readonly saving = input(false);
  /** Create mode: preselects (and the caller may rely on) a branch type, e.g. Pickup-Delivery Partner. */
  readonly presetType = input<BranchType | null>(null);

  readonly saved = output<CreateBranchRequest | UpdateBranchRequest>();
  readonly cancelled = output<void>();

  protected readonly types = TYPE_OPTS;
  protected readonly dayOpts = DAY_OPTS;
  protected readonly isCreate = computed(() => this.mode() === 'create');
  private readonly hydrated = signal(false);

  protected readonly form: FormGroup = this.build();

  protected readonly managerOptions = computed<SelectOption[]>(() =>
    this.managers().map((m) => ({ value: m.id, label: m.hint ? `${m.label} · ${m.hint}` : m.label })));

  protected readonly managerName = computed(() => {
    const id = this.branch()?.managerId;
    if (!id) return 'Unassigned';
    return this.managers().find((m) => m.id === id)?.label ?? '—';
  });

  private readonly countries = signal<GeographyOption[]>([]);
  private readonly states = signal<GeographyOption[]>([]);
  private readonly districts = signal<GeographyOption[]>([]);
  private readonly cities = signal<GeographyOption[]>([]);

  protected readonly countryOpts = computed(() => toOptions(this.countries()));
  protected readonly stateOpts = computed(() => toOptions(this.states()));
  protected readonly districtOpts = computed(() => toOptions(this.districts()));
  protected readonly cityOpts = computed(() => toOptions(this.cities()));

  constructor() {
    if (this.isCreate()) {
      this.service.countries().subscribe((rows) => this.countries.set(rows));
      this.c('countryId').valueChanges.subscribe((id) => {
        this.cascade('state', id);
        this.c('country').setValue(this.nameOf(this.countries(), id), { emitEvent: false });
      });
      this.c('stateId').valueChanges.subscribe((id) => {
        this.cascade('district', id);
        this.c('state').setValue(this.nameOf(this.states(), id), { emitEvent: false });
      });
      this.c('districtId').valueChanges.subscribe((id) => {
        this.cascade('city', id);
        this.c('district').setValue(this.nameOf(this.districts(), id), { emitEvent: false });
      });
      this.c('cityId').valueChanges.subscribe((id) => {
        this.c('city').setValue(this.nameOf(this.cities(), id), { emitEvent: false });
      });
    }
    effect(() => { const b = this.branch(); if (b && this.mode() === 'edit') this.hydrate(b); });
    effect(() => { const t = this.presetType(); if (t && this.mode() === 'create') this.form.get('branchType')?.setValue(t); });
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  /** A control inside the create-only `branchUser` group. */
  protected u(name: string): FormControl { return this.form.get(['branchUser', name]) as FormControl; }

  /** Clears and reloads everything beneath the level just changed. */
  private cascade(level: 'state' | 'district' | 'city', parentId: string | null): void {
    const resetLists: Record<string, () => void> = {
      state: () => { this.states.set([]); this.districts.set([]); this.cities.set([]); },
      district: () => { this.districts.set([]); this.cities.set([]); },
      city: () => this.cities.set([])
    };
    resetLists[level]();

    if (!parentId) return;
    switch (level) {
      case 'state': this.service.states(parentId).subscribe((rows) => this.states.set(rows)); break;
      case 'district': this.service.districts(parentId).subscribe((rows) => this.districts.set(rows)); break;
      case 'city': this.service.cities(parentId).subscribe((rows) => this.cities.set(rows)); break;
    }
  }

  /** Resolves the picked id back to the plain name the backend actually stores. */
  private nameOf(rows: GeographyOption[], id: string | null): string | null {
    return id ? (rows.find((r) => r.id === id)?.name ?? null) : null;
  }

  private hydrate(b: BranchResponse): void {
    if (this.hydrated()) return;
    this.form.patchValue({
      branchCode: b.branchCode ?? '', branchName: b.branchName ?? '', branchType: b.branchType,
      email: b.email ?? '', mobile: b.mobile ?? '', alternateMobile: b.alternateMobile ?? '',
      addressLine1: b.addressLine1 ?? '', addressLine2: b.addressLine2 ?? '',
      country: b.country ?? '', state: b.state ?? '', city: b.city ?? '',
      district: b.district ?? '', taluka: b.taluka ?? '', postalCode: b.postalCode ?? '',
      latitude: b.latitude ?? null, longitude: b.longitude ?? null,
      openingTime: hm(b.openingTime), closingTime: hm(b.closingTime),
      workingDays: b.workingDays ? b.workingDays.split(',').map((d) => d.trim().toUpperCase()).filter(Boolean) : [],
      allowBooking: b.allowBooking, allowDelivery: b.allowDelivery, allowPickup: b.allowPickup,
      allowManifest: b.allowManifest, allowCashCollection: b.allowCashCollection, allowWallet: b.allowWallet,
      instantCommission: b.instantCommission,
      remarks: b.remarks ?? '',
      gstNumber: b.gstNumber ?? '', panNumber: b.panNumber ?? '',
      gstPercentage: b.gstPercentage, commissionOnOtherCharges: b.commissionOnOtherCharges,
      commissionOnBasicFreight: b.commissionOnBasicFreight,
      companyServiceChargePercentage: b.companyServiceChargePercentage,
      drsChargePerQty: b.drsChargePerQty,
      deliveryCommissionRatePerKg: b.deliveryCommissionRatePerKg,
      deliveryCommissionMinWeightKg: b.deliveryCommissionMinWeightKg
    }, { emitEvent: false });
    this.form.markAsPristine();
    this.hydrated.set(true);
  }

  private build(): FormGroup {
    return this.fb.group({
      branchCode: ['', [Validators.required, Validators.pattern(CODE)]],
      branchName: ['', [Validators.required, Validators.maxLength(150)]],
      branchType: [null as BranchType | null, Validators.required],
      managerId: [null as string | null],
      email: ['', [emailish, Validators.maxLength(255)]],
      mobile: ['', Validators.pattern(PHONE)],
      alternateMobile: ['', Validators.pattern(PHONE)],
      addressLine1: ['', Validators.maxLength(255)],
      addressLine2: ['', Validators.maxLength(255)],
      country: ['', Validators.maxLength(100)],
      state: ['', Validators.maxLength(100)],
      city: ['', Validators.maxLength(100)],
      district: ['', Validators.maxLength(100)],
      countryId: [null as string | null],
      stateId: [null as string | null],
      districtId: [null as string | null],
      cityId: [null as string | null],
      taluka: ['', Validators.maxLength(100)],
      postalCode: ['', Validators.maxLength(20)],
      latitude: [null as number | null, [Validators.min(-90), Validators.max(90)]],
      longitude: [null as number | null, [Validators.min(-180), Validators.max(180)]],
      openingTime: [''],
      closingTime: [''],
      workingDays: [[] as string[]],
      allowBooking: [true], allowDelivery: [true], allowPickup: [true],
      allowManifest: [true], allowCashCollection: [true], allowWallet: [false],
      instantCommission: [true],
      remarks: ['', Validators.maxLength(500)],
      gstNumber: ['', [Validators.pattern(GSTIN), Validators.maxLength(15)]],
      panNumber: ['', [Validators.pattern(PAN), Validators.maxLength(10)]],
      gstPercentage: [18, [Validators.required, Validators.min(0), Validators.max(100)]],
      commissionOnOtherCharges: [20, [Validators.required, Validators.min(0), Validators.max(100)]],
      commissionOnBasicFreight: [10, [Validators.required, Validators.min(0), Validators.max(100)]],
      companyServiceChargePercentage: [10, [Validators.required, Validators.min(0), Validators.max(100)]],
      drsChargePerQty: [2, [Validators.required, Validators.min(0)]],
      deliveryCommissionRatePerKg: [1.5, [Validators.required, Validators.min(0)]],
      deliveryCommissionMinWeightKg: [10, [Validators.required, Validators.min(0)]],
      // Create-only. Kept as a group so the payload maps straight onto BranchUserRequest;
      // no minimum length on the password — the server's policy owns that rule and its
      // message names the one that failed.
      branchUser: this.fb.group({
        email: ['', [emailish, Validators.maxLength(255)]],
        firstName: ['', Validators.maxLength(100)],
        lastName: ['', Validators.maxLength(100)],
        mobile: ['', Validators.pattern(PHONE)],
        password: ['', Validators.maxLength(128)]
      })
    });
  }

  protected submit(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();
    const trim = (s: string | null) => (s && s.trim() ? s.trim() : null);
    const days: string[] = v.workingDays ?? [];

    const common = {
      branchName: v.branchName.trim(), branchType: v.branchType as BranchType,
      email: trim(v.email), mobile: trim(v.mobile), alternateMobile: trim(v.alternateMobile),
      addressLine1: trim(v.addressLine1), addressLine2: trim(v.addressLine2),
      country: trim(v.country), state: trim(v.state), city: trim(v.city),
      district: trim(v.district), taluka: trim(v.taluka), postalCode: trim(v.postalCode),
      latitude: v.latitude === null || v.latitude === '' ? null : Number(v.latitude),
      longitude: v.longitude === null || v.longitude === '' ? null : Number(v.longitude),
      openingTime: trim(v.openingTime), closingTime: trim(v.closingTime),
      workingDays: days.length ? days.join(',') : null,
      allowBooking: !!v.allowBooking, allowDelivery: !!v.allowDelivery, allowPickup: !!v.allowPickup,
      allowManifest: !!v.allowManifest, allowCashCollection: !!v.allowCashCollection, allowWallet: !!v.allowWallet,
      instantCommission: !!v.instantCommission,
      remarks: trim(v.remarks),
      gstNumber: trim(v.gstNumber)?.toUpperCase() ?? null,
      panNumber: trim(v.panNumber)?.toUpperCase() ?? null,
      gstPercentage: Number(v.gstPercentage),
      commissionOnOtherCharges: Number(v.commissionOnOtherCharges),
      commissionOnBasicFreight: Number(v.commissionOnBasicFreight),
      companyServiceChargePercentage: Number(v.companyServiceChargePercentage),
      drsChargePerQty: Number(v.drsChargePerQty),
      deliveryCommissionRatePerKg: Number(v.deliveryCommissionRatePerKg),
      deliveryCommissionMinWeightKg: Number(v.deliveryCommissionMinWeightKg)
    };

    if (this.isCreate()) {
      this.saved.emit({
        branchCode: v.branchCode.trim(), managerId: v.managerId || null, ...common,
        branchUser: branchUser(v.branchUser, trim)
      });
    } else {
      this.saved.emit({ branchCode: v.branchCode.trim(), ...common, version: this.branch()!.version });
    }
  }
}

/**
 * The user block, or null when the administrator filled none of it in — an all-null object
 * and an absent one mean the same thing to the backend, and sending the object anyway would
 * suggest a choice nobody made.
 */
function branchUser(v: Record<string, string | null>,
                    trim: (s: string | null) => string | null): BranchUserRequest | null {
  const block: BranchUserRequest = {
    email: trim(v['email']), firstName: trim(v['firstName']), lastName: trim(v['lastName']),
    mobile: trim(v['mobile']), password: v['password']?.trim() || null
  };
  return Object.values(block).some((x) => x !== null) ? block : null;
}

/** Backend LocalTime often serialises as HH:mm:ss; the <input type=time> wants HH:mm. */
function hm(t?: string | null): string { return t ? t.slice(0, 5) : ''; }
