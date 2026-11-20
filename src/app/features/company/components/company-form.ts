import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { CompanyLogo } from './company-logo';
import { CompanyProfile, CompanyRequest, SubscriptionPlanOption } from '@core/models/company.model';

const PHONE = /^[+]?[0-9 \-]{7,20}$/;
const WEBSITE = /^$|^https?:\/\/.+/;
const GSTIN = /^$|^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][0-9A-Za-z][Zz][0-9A-Za-z]$/;
const PAN = /^$|^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/;
const CURRENCY = /^$|^[A-Za-z]{3}$/;

/**
 * Reactive editor for a company. Validators mirror the backend UpdateCompanyRequest so a
 * submit is rejected client-side before it reaches the API. PUT is a full replacement, so
 * the form carries every editable field plus the pass-through dates and the version.
 */
@Component({
  selector: 'app-company-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiInput, UiSelect, UiButton, CompanyLogo],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="cform">
      <app-card title="General Information" subtitle="Identity and subscription.">
        <div class="grid">
          <app-input [control]="c('companyName')" label="Company Name" [required]="true" placeholder="Legacy Couriers Pvt Ltd" [maxLength]="150" />
          <app-input [control]="c('legalName')" label="Legal Name" placeholder="Registered legal name" [maxLength]="200" />
          <app-input [control]="c('displayName')" label="Display Name" placeholder="Shown across the app" [maxLength]="100" />
          <div class="field-static">
            <span class="field-static__label">Company Code</span>
            <span class="field-static__value">{{ profile().companyCode }}</span>
            <span class="field-static__hint">Immutable</span>
          </div>
          <app-select [control]="c('subscriptionPlanId')" label="Subscription Plan"
                      placeholder="Select a plan" [options]="planOptions()" />
          <div class="field-static">
            <span class="field-static__label">Status</span>
            <span class="field-static__value">{{ profile().status }}</span>
            <span class="field-static__hint">Changed via lifecycle actions</span>
          </div>
        </div>
      </app-card>

      <app-card title="Business Information" subtitle="Statutory registration numbers.">
        <div class="grid">
          <app-input [control]="c('gstNumber')" label="GST Number" placeholder="22AAAAA0000A1Z5" [maxLength]="15" />
          <app-input [control]="c('panNumber')" label="PAN Number" placeholder="AAAAA0000A" [maxLength]="10" />
          <app-input [control]="c('cinNumber')" label="CIN (Optional)" placeholder="U74999KA2020PTC000000" [maxLength]="21" />
        </div>
      </app-card>

      <app-card title="Contact Information" subtitle="How customers and the platform reach you.">
        <div class="grid">
          <app-input [control]="c('email')" label="Email" type="email" [required]="true" placeholder="ops@company.com" [maxLength]="255" />
          <app-input [control]="c('mobile')" label="Mobile" type="tel" [required]="true" placeholder="+91 90000 00000" [maxLength]="20" />
          <app-input [control]="c('alternateMobile')" label="Telephone" type="tel" placeholder="+91 80 0000 0000" [maxLength]="20" />
          <app-input [control]="c('website')" label="Website" placeholder="https://company.com" [maxLength]="255" />
        </div>
      </app-card>

      <app-card title="Address" subtitle="Registered address of the company.">
        <div class="grid">
          <app-input [control]="c('addressLine1')" label="Address Line 1" placeholder="Street, building" [maxLength]="255" />
          <app-input [control]="c('addressLine2')" label="Address Line 2" placeholder="Area, landmark" [maxLength]="255" />
          <app-input [control]="c('country')" label="Country" placeholder="India" [maxLength]="100" />
          <app-input [control]="c('state')" label="State" placeholder="Karnataka" [maxLength]="100" />
          <app-input [control]="c('city')" label="City" placeholder="Bengaluru" [maxLength]="100" />
          <app-input [control]="c('postalCode')" label="Pincode" placeholder="560001" [maxLength]="20" />
        </div>
      </app-card>

      <app-card title="Regional" subtitle="Locale and formatting defaults.">
        <div class="grid">
          <app-input [control]="c('timezone')" label="Timezone" placeholder="Asia/Kolkata" [maxLength]="64" />
          <app-input [control]="c('currency')" label="Currency" placeholder="INR" [maxLength]="3" />
          <app-input [control]="c('language')" label="Language" placeholder="en" [maxLength]="10" />
          <app-input [control]="c('dateFormat')" label="Date Format" placeholder="dd-MM-yyyy" [maxLength]="20" />
          <app-input [control]="c('timeFormat')" label="Time Format" placeholder="HH:mm" [maxLength]="20" />
        </div>
      </app-card>

      <app-card title="Branding" subtitle="Logo and favicon URLs.">
        <app-company-logo [editable]="true" [logoControl]="c('logo')" [faviconControl]="c('favicon')" />
      </app-card>

      <div class="cform__bar">
        <span class="cform__note">
          @if (form.invalid && form.touched) { Fix the highlighted fields before saving. }
        </span>
        <div class="cform__actions">
          <app-button variant="stroked" (pressed)="cancelled.emit()">Cancel</app-button>
          <app-button type="submit" icon="save" [loading]="saving()" [disabled]="form.pristine">Save Changes</app-button>
        </div>
      </div>
    </form>
  `,
  styles: [`
    .cform { display:flex; flex-direction:column; gap:16px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }
    .field-static { display:flex; flex-direction:column; gap:6px; justify-content:center; }
    .field-static__label { font:500 16px var(--font-sans); color:var(--content-fg); }
    .field-static__value { font:600 17px var(--font-sans); color:var(--content-fg); }
    .field-static__hint { font:400 15px var(--font-sans); color:var(--content-muted); }
    .cform__bar { position:sticky; bottom:0; display:flex; align-items:center; justify-content:space-between;
      gap:16px; padding:14px 16px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-field); }
    .cform__note { font:500 16px var(--font-sans); color:var(--danger); }
    .cform__actions { display:flex; gap:10px; }
    @media (max-width:760px){ .grid{ grid-template-columns:1fr; } }
  `]
})
export class CompanyForm {
  private readonly fb = inject(FormBuilder);

  readonly profile = input.required<CompanyProfile>();
  readonly plans = input<SubscriptionPlanOption[]>([]);
  readonly saving = input(false);

  readonly saved = output<CompanyRequest>();
  readonly cancelled = output<void>();

  protected readonly form: FormGroup = this.buildForm();
  private patched = signal(false);

  protected readonly planOptions = computed<SelectOption[]>(() => {
    const opts = this.plans().map((p) => ({ value: p.id, label: `${p.planName} (${p.planCode})` }));
    // Ensure the current plan is selectable even if inactive/absent from the active list.
    const current = this.profile().subscriptionPlanId;
    if (current && !opts.some((o) => o.value === current)) {
      opts.unshift({ value: current, label: 'Current plan' });
    }
    return opts;
  });

  constructor() {
    // Hydrate the form from the profile input once, reactively.
    effect(() => { this.profile(); this.hydrate(); });
  }

  protected c(name: string): FormControl {
    return this.form.get(name) as FormControl;
  }

  private hydrate(): void {
    if (this.patched()) return;
    const p = this.profile();
    this.form.patchValue({
      companyName: p.companyName,
      legalName: p.legalName ?? '',
      displayName: p.displayName ?? '',
      subscriptionPlanId: p.subscriptionPlanId,
      email: p.email,
      mobile: p.mobile,
      alternateMobile: p.alternateMobile ?? '',
      website: p.website ?? '',
      gstNumber: p.gstNumber ?? '',
      panNumber: p.panNumber ?? '',
      cinNumber: p.cinNumber ?? '',
      logo: p.logo ?? '',
      favicon: p.favicon ?? '',
      addressLine1: p.addressLine1 ?? '',
      addressLine2: p.addressLine2 ?? '',
      country: p.country ?? '',
      state: p.state ?? '',
      city: p.city ?? '',
      postalCode: p.postalCode ?? '',
      timezone: p.timezone ?? '',
      currency: p.currency ?? '',
      language: p.language ?? '',
      dateFormat: p.dateFormat ?? '',
      timeFormat: p.timeFormat ?? ''
    }, { emitEvent: false });
    this.form.markAsPristine();
    this.patched.set(true);
  }

  private buildForm(): FormGroup {
    return this.fb.group({
      companyName: ['', [Validators.required, Validators.maxLength(150)]],
      legalName: ['', Validators.maxLength(200)],
      displayName: ['', Validators.maxLength(100)],
      subscriptionPlanId: ['', Validators.required],
      email: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
      mobile: ['', [Validators.required, Validators.pattern(PHONE), Validators.maxLength(20)]],
      alternateMobile: ['', [Validators.pattern(PHONE), Validators.maxLength(20)]],
      website: ['', [Validators.pattern(WEBSITE), Validators.maxLength(255)]],
      gstNumber: ['', [Validators.pattern(GSTIN), Validators.maxLength(15)]],
      panNumber: ['', [Validators.pattern(PAN), Validators.maxLength(10)]],
      cinNumber: ['', Validators.maxLength(21)],
      logo: ['', Validators.maxLength(500)],
      favicon: ['', Validators.maxLength(500)],
      addressLine1: ['', Validators.maxLength(255)],
      addressLine2: ['', Validators.maxLength(255)],
      country: ['', Validators.maxLength(100)],
      state: ['', Validators.maxLength(100)],
      city: ['', Validators.maxLength(100)],
      postalCode: ['', Validators.maxLength(20)],
      timezone: ['', Validators.maxLength(64)],
      currency: ['', [Validators.pattern(CURRENCY), Validators.maxLength(3)]],
      language: ['', Validators.maxLength(10)],
      dateFormat: ['', Validators.maxLength(20)],
      timeFormat: ['', Validators.maxLength(20)]
    });
  }

  protected submit(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();
    const p = this.profile();
    const trim = (s: string) => (s?.trim() ? s.trim() : null);
    this.saved.emit({
      companyName: v.companyName.trim(),
      legalName: trim(v.legalName),
      displayName: trim(v.displayName),
      subscriptionPlanId: v.subscriptionPlanId,
      email: v.email.trim(),
      mobile: v.mobile.trim(),
      alternateMobile: trim(v.alternateMobile),
      website: trim(v.website),
      gstNumber: trim(v.gstNumber),
      panNumber: trim(v.panNumber),
      cinNumber: trim(v.cinNumber),
      logo: trim(v.logo),
      favicon: trim(v.favicon),
      addressLine1: trim(v.addressLine1),
      addressLine2: trim(v.addressLine2),
      country: trim(v.country),
      state: trim(v.state),
      city: trim(v.city),
      postalCode: trim(v.postalCode),
      timezone: trim(v.timezone),
      currency: trim(v.currency),
      language: trim(v.language),
      dateFormat: trim(v.dateFormat),
      timeFormat: trim(v.timeFormat),
      remarks: p.remarks ?? null,
      // Pass-through: full replacement must not wipe the subscription window.
      trialEndDate: p.trialEndDate ?? null,
      subscriptionStartDate: p.subscriptionStartDate ?? null,
      subscriptionEndDate: p.subscriptionEndDate ?? null,
      version: p.version
    });
  }
}
