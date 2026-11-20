import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import {
  AbstractControl, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors,
  Validators
} from '@angular/forms';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { LogoPicker } from './logo-picker';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
  BILLING_FREQUENCIES, BILLING_FREQUENCY_LABELS, BillingFrequency, CUSTOMER_PAYMENT_MODES, CUSTOMER_TYPES,
  CreateCustomerRequest, CustomerPaymentMode, CustomerResponse, CustomerType, PAYMENT_MODE_LABELS,
  UpdateCustomerRequest
} from '@core/models/customer.model';

const PINCODE = /^[0-9]{6}$/;
const CODE = /^[A-Za-z0-9][A-Za-z0-9_ -]{1,48}[A-Za-z0-9]$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+]?[0-9 \-]{7,20}$/;
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const WEBSITE = /^https?:\/\/\S{3,245}$/;

const TYPE_OPTS: SelectOption[] = CUSTOMER_TYPES.map((t) => ({
  value: t, label: t.charAt(0) + t.slice(1).toLowerCase()
}));

const PAYMENT_OPTS: SelectOption[] = CUSTOMER_PAYMENT_MODES.map((m) => ({ value: m, label: PAYMENT_MODE_LABELS[m] }));
const FREQUENCY_OPTS: SelectOption[] = BILLING_FREQUENCIES.map((m) => ({ value: m, label: BILLING_FREQUENCY_LABELS[m] }));

/** Checked on the trimmed value, same reasoning as BranchForm's `emailish`. */
function emailish(control: AbstractControl): ValidationErrors | null {
  const value = (control.value ?? '').trim();
  return !value || EMAIL.test(value) ? null : { email: true };
}

function upperPattern(pattern: RegExp) {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = (control.value ?? '').trim().toUpperCase();
    return !value || pattern.test(value) ? null : { pattern: true };
  };
}

/**
 * Reactive create/edit editor for a customer. Validators mirror CreateCustomerRequest /
 * UpdateCustomerRequest. `customerCode` is create-only (blank generates one server-side;
 * shown read-only in edit since it is immutable). GST is required only when `customerType`
 * is BUSINESS — enforced here too so the error surfaces before the API round-trip, mirroring
 * the server's `Customer.applyInvariants()` rule.
 */
@Component({
  selector: 'app-customer-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiInput, UiSelect, UiButton, MatCheckboxModule, LogoPicker],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="cform">
      <app-card title="Basic Information" subtitle="Identity and classification.">
        <div class="grid">
          @if (isCreate()) {
            <app-input [control]="c('customerCode')" label="Customer Code" placeholder="Blank generates one" [maxLength]="50" />
          } @else {
            <div class="stat"><span class="stat__l">Customer Code</span>
              <span class="stat__v mono">{{ customer()?.customerCode || '—' }}</span><span class="stat__h">Immutable</span></div>
          }
          <app-select [control]="c('customerType')" label="Customer Type" [options]="types" placeholder="Select a type" />
          @if (isBusiness()) {
            <app-input [control]="c('companyName')" label="Company Name" placeholder="Acme Traders" [maxLength]="150" />
          }
        </div>
      </app-card>

      <app-card title="Contact Person" subtitle="Who to reach for this customer.">
        <div class="grid">
          <app-input [control]="c('firstName')" label="First Name" [required]="true" placeholder="Asha" [maxLength]="100" />
          <app-input [control]="c('middleName')" label="Middle Name" placeholder="" [maxLength]="100" />
          <app-input [control]="c('lastName')" label="Last Name" [required]="true" placeholder="Shah" [maxLength]="100" />
        </div>
      </app-card>

      <app-card title="Contact" subtitle="How to reach this customer.">
        <div class="grid">
          <app-input [control]="c('mobile')" label="Mobile" type="tel" [required]="true" placeholder="+91 90000 00000" [maxLength]="20" />
          <app-input [control]="c('alternateMobile')" label="Alternate Mobile" type="tel" placeholder="+91 80 0000 0000" [maxLength]="20" />
          <app-input [control]="c('email')" label="Email" type="email" placeholder="asha@company.com" [maxLength]="255" />
        </div>
      </app-card>

      <app-card title="Brand" subtitle="Shown to this customer in the shipping portal, next to their name.">
        <div class="grid">
          <app-input [control]="c('website')" label="Website" placeholder="https://www.example.com" [maxLength]="250" />
          <app-logo-picker label="Brand logo" [current]="logoUrl()" (picked)="logoPicked.emit($event)" />
        </div>
      </app-card>

      <app-card title="Tax Details" [subtitle]="isBusiness() ? 'GST is mandatory for a business customer.' : 'Optional for an individual customer.'">
        <div class="grid">
          <app-input [control]="c('gstNumber')" label="GST Number" [required]="isBusiness()" placeholder="27ABCDE1234F1Z5" [maxLength]="15" />
          <app-input [control]="c('panNumber')" label="PAN Number" placeholder="ABCDE1234F" [maxLength]="10" />
        </div>
      </app-card>

      <app-card title="Payment &amp; Billing" subtitle="Default payment mode (a booking can still override it) and how often this customer is invoiced.">
        <div class="grid">
          <app-input [control]="c('contactPerson')" label="Contact Person" placeholder="Asha Shah" [maxLength]="150" />
          <div></div>
          <app-select [control]="c('defaultPaymentMode')" label="Payment Mode" [options]="paymentModes" />
          <app-select [control]="c('billingFrequency')" label="Billing Frequency" [options]="frequencies" />
        </div>
      </app-card>

      <app-card title="Billing Address" subtitle="Where invoices are addressed. Pickup and delivery addresses are added after the customer is created.">
        <div class="grid">
          <app-input [control]="c('billingAddressLine1')" label="Address Line 1" [maxLength]="255" />
          <app-input [control]="c('billingAddressLine2')" label="Address Line 2" [maxLength]="255" />
          <app-input [control]="c('billingCity')" label="City" [maxLength]="100" />
          <app-input [control]="c('billingState')" label="State" [maxLength]="100" />
          <app-input [control]="c('billingPincode')" label="Pincode" [maxLength]="6" placeholder="411001" />
        </div>
      </app-card>

      <app-card title="Communication Preferences" subtitle="Which channels this customer may be notified on — off by request, on by default.">
        <div class="cform__prefs">
          <mat-checkbox [formControl]="c('whatsappEnabled')">WhatsApp</mat-checkbox>
          <mat-checkbox [formControl]="c('smsEnabled')">SMS</mat-checkbox>
          <mat-checkbox [formControl]="c('emailEnabled')">Email</mat-checkbox>
        </div>
      </app-card>

      <div class="cform__bar">
        <span class="cform__note">@if (form.invalid && form.touched) { Fix the highlighted fields before saving. }</span>
        <div class="cform__actions">
          <app-button variant="stroked" (pressed)="cancelled.emit()">Cancel</app-button>
          <app-button type="submit" icon="save" [loading]="saving()" [disabled]="!isCreate() && form.pristine">
            {{ isCreate() ? 'Create Customer' : 'Save Changes' }}
          </app-button>
        </div>
      </div>
    </form>
  `,
  styles: [`
    /* padding-bottom clears the sticky action bar below: with enough cards, the form's
       total height can end up short enough that .cform__bar's sticky bottom:0 position
       visually overlaps the last card's own tail content instead of sitting below it
       (found live: the Communication Preferences checkboxes were painted, but hidden
       under the sticky bar's opaque background). */
    .cform { display:flex; flex-direction:column; gap:16px; padding-bottom:88px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }
    .cform__prefs { display:flex; gap:24px; flex-wrap:wrap; }
    .stat { display:flex; flex-direction:column; gap:6px; justify-content:center; }
    .stat__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .stat__v { font:600 17px var(--font-sans); color:var(--content-fg); }
    .stat__h { font:400 15px var(--font-sans); color:var(--content-muted); }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .cform__bar { position:sticky; bottom:0; display:flex; align-items:center; justify-content:space-between;
      gap:16px; padding:14px 16px; background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .cform__note { font:500 16px var(--font-sans); color:var(--danger); }
    .cform__actions { display:flex; gap:10px; }
    @media (max-width:760px){ .grid { grid-template-columns:1fr; } }
  `]
})
export class CustomerForm {
  private readonly fb = inject(FormBuilder);

  readonly mode = input<'create' | 'edit'>('create');
  readonly customer = input<CustomerResponse | null>(null);
  readonly saving = input(false);
  /** Pre-selected type when creating (the Business Customer menu starts at BUSINESS). */
  readonly initialType = input<CustomerType>('INDIVIDUAL');

  readonly saved = output<CreateCustomerRequest | UpdateCustomerRequest>();
  /** The brand logo already saved (a data URL), when editing. */
  readonly logoUrl = input<string | null>(null);
  /** The logo the user chose (a File) or removed (null); the page uploads it after saving the customer. */
  readonly logoPicked = output<File | null>();
  readonly cancelled = output<void>();

  protected readonly types = TYPE_OPTS;
  protected readonly paymentModes = PAYMENT_OPTS;
  protected readonly frequencies = FREQUENCY_OPTS;
  protected readonly isCreate = computed(() => this.mode() === 'create');
  private readonly hydrated = signal(false);

  protected readonly form: FormGroup = this.build();
  private readonly typeValue = signal<CustomerType>('INDIVIDUAL');
  protected readonly isBusiness = computed(() => this.typeValue() === 'BUSINESS');

  constructor() {
    effect(() => { const c = this.customer(); if (c && this.mode() === 'edit') this.hydrate(c); });
    this.form.get('customerType')!.valueChanges.subscribe((v) => this.typeValue.set(v));
    effect(() => {
      const t = this.initialType();
      if (this.mode() === 'create' && this.form.get('customerType')!.pristine) {
        this.form.get('customerType')!.setValue(t);
      }
    });
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  private hydrate(cust: CustomerResponse): void {
    if (this.hydrated()) return;
    this.form.patchValue({
      customerType: cust.customerType, companyName: cust.companyName ?? '',
      firstName: cust.firstName, middleName: cust.middleName ?? '', lastName: cust.lastName,
      mobile: cust.mobile, alternateMobile: cust.alternateMobile ?? '', email: cust.email ?? '',
      gstNumber: cust.gstNumber ?? '', panNumber: cust.panNumber ?? '', website: cust.website ?? '',
      whatsappEnabled: cust.whatsappEnabled, smsEnabled: cust.smsEnabled, emailEnabled: cust.emailEnabled,
      contactPerson: cust.contactPerson ?? '',
      defaultPaymentMode: cust.defaultPaymentMode ?? 'PAID', billingFrequency: cust.billingFrequency ?? 'MONTHLY',
      billingAddressLine1: cust.billingAddressLine1 ?? '', billingAddressLine2: cust.billingAddressLine2 ?? '',
      billingCity: cust.billingCity ?? '', billingState: cust.billingState ?? '', billingPincode: cust.billingPincode ?? ''
    }, { emitEvent: true });
    this.typeValue.set(cust.customerType);
    this.form.markAsPristine();
    this.hydrated.set(true);
  }

  private build(): FormGroup {
    return this.fb.group({
      customerCode: ['', [Validators.pattern(CODE), Validators.maxLength(50)]],
      customerType: ['INDIVIDUAL' as CustomerType, Validators.required],
      companyName: ['', Validators.maxLength(150)],
      firstName: ['', [Validators.required, Validators.maxLength(100)]],
      middleName: ['', Validators.maxLength(100)],
      lastName: ['', [Validators.required, Validators.maxLength(100)]],
      mobile: ['', [Validators.required, Validators.pattern(PHONE), Validators.maxLength(20)]],
      alternateMobile: ['', [Validators.pattern(PHONE), Validators.maxLength(20)]],
      email: ['', [emailish, Validators.maxLength(255)]],
      gstNumber: ['', [upperPattern(GSTIN), Validators.maxLength(15)]],
      panNumber: ['', [upperPattern(PAN), Validators.maxLength(10)]],
      website: ['', [Validators.pattern(WEBSITE), Validators.maxLength(255)]],
      whatsappEnabled: [true],
      smsEnabled: [true],
      emailEnabled: [true],
      contactPerson: ['', Validators.maxLength(150)],
      defaultPaymentMode: ['PAID' as CustomerPaymentMode, Validators.required],
      billingFrequency: ['MONTHLY' as BillingFrequency, Validators.required],
      billingAddressLine1: ['', Validators.maxLength(255)],
      billingAddressLine2: ['', Validators.maxLength(255)],
      billingCity: ['', Validators.maxLength(100)],
      billingState: ['', Validators.maxLength(100)],
      billingPincode: ['', Validators.pattern(PINCODE)]
    });
  }

  protected submit(): void {
    if (this.isBusiness() && !this.c('gstNumber').value?.trim()) {
      this.c('gstNumber').setErrors({ required: true });
    }
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }

    const v = this.form.getRawValue();
    const trim = (s: string | null) => (s && s.trim() ? s.trim() : null);
    const upper = (s: string | null) => (s && s.trim() ? s.trim().toUpperCase() : null);

    const common = {
      customerType: v.customerType as CustomerType,
      companyName: trim(v.companyName),
      firstName: v.firstName.trim(), middleName: trim(v.middleName), lastName: v.lastName.trim(),
      mobile: v.mobile.trim(), alternateMobile: trim(v.alternateMobile), email: trim(v.email),
      gstNumber: upper(v.gstNumber), panNumber: upper(v.panNumber), website: trim(v.website),
      whatsappEnabled: !!v.whatsappEnabled, smsEnabled: !!v.smsEnabled, emailEnabled: !!v.emailEnabled,
      contactPerson: trim(v.contactPerson),
      defaultPaymentMode: v.defaultPaymentMode as CustomerPaymentMode,
      billingFrequency: v.billingFrequency as BillingFrequency,
      billingAddressLine1: trim(v.billingAddressLine1), billingAddressLine2: trim(v.billingAddressLine2),
      billingCity: trim(v.billingCity), billingState: trim(v.billingState), billingPincode: trim(v.billingPincode)
    };

    if (this.isCreate()) {
      this.saved.emit({ customerCode: trim(v.customerCode), ...common });
    } else {
      this.saved.emit({ ...common, version: this.customer()!.version });
    }
  }
}
