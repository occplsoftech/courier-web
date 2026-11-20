import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import {
  CreateSubscriptionPlanRequest, UpdateSubscriptionPlanRequest, SubscriptionPlanProfile,
  PlanType, PLAN_TYPES
} from '@core/models/subscription-plan.model';

// Mirrors the backend CreateSubscriptionPlanRequest pattern: 3-50 chars of letters,
// digits, hyphen or underscore, no leading/trailing separator. Saved uppercased.
const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,48}[A-Za-z0-9]$/;
const CURRENCY = /^[A-Za-z]{3}$/;

const TYPE_OPTIONS: SelectOption[] = PLAN_TYPES.map((t) => ({
  value: t, label: t.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}));

interface QuotaField { name: string; label: string; }
const QUOTA_FIELDS: QuotaField[] = [
  { name: 'maxUsers', label: 'Max Users' },
  { name: 'maxBranches', label: 'Max Branches' },
  { name: 'maxHubs', label: 'Max Hubs' },
  { name: 'maxCustomers', label: 'Max Customers' },
  { name: 'maxDrivers', label: 'Max Drivers' },
  { name: 'maxVehicles', label: 'Max Vehicles' },
  { name: 'maxDailyBookings', label: 'Max Daily Bookings' },
  { name: 'maxMonthlyBookings', label: 'Max Monthly Bookings' },
  { name: 'storageLimitGb', label: 'Storage (GB)' },
  { name: 'apiRateLimit', label: 'API Rate Limit (req/min)' }
];

/**
 * Reactive create/edit editor for a subscription plan. Validators mirror
 * CreateSubscriptionPlanRequest / UpdateSubscriptionPlanRequest so a bad body is
 * rejected before the API. Mirrors two backend invariants client-side, the same way
 * Rate Master's weight-slab overlap is shown before saving rather than after a 422:
 * a TRIAL plan's price fields are locked to 0 (the backend rejects a priced trial
 * outright) and an ENTERPRISE plan's quota fields are locked blank (the backend nulls
 * them silently, on the theory that a typed number expresses intent the tier already
 * overrides). In edit mode `planCode` is immutable and shown read-only, and the form
 * emits UpdateSubscriptionPlanRequest carrying the last-read `version`.
 */
@Component({
  selector: 'app-plan-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiInput, UiSelect, UiButton],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="pform">
      <app-card title="Plan Details" subtitle="Identity and commercial tier.">
        <div class="grid">
          @if (isCreate()) {
            <app-input [control]="c('planCode')" label="Plan Code" [required]="true" placeholder="STANDARD_MONTHLY" [maxLength]="50" />
            <div class="hint-cell">
              <span class="hint">Saved uppercased. Immutable afterwards.</span>
              @if (codePreview()) { <span class="preview">Will save as <b>{{ codePreview() }}</b></span> }
            </div>
          } @else {
            <div class="stat"><span class="stat__l">Plan Code</span>
              <span class="stat__v mono">{{ plan()?.planCode }}</span><span class="stat__h">Immutable</span></div>
            <div></div>
          }
          <app-input [control]="c('planName')" label="Plan Name" [required]="true" placeholder="Standard" [maxLength]="100" />
          <app-select [control]="c('planType')" label="Tier" [options]="typeOptions" placeholder="Select a tier" />
        </div>
        <div class="full">
          <app-input [control]="c('description')" label="Description" placeholder="What this plan is for." [maxLength]="500" />
        </div>
      </app-card>

      <app-card title="Pricing" subtitle="Recurring price and trial length.">
        @if (isTrial()) {
          <p class="rule">A <b>TRIAL</b> plan must be free — price fields are locked to 0, and at least
            one trial day is required.</p>
        }
        <div class="grid grid--3">
          <label class="nf"><span>Monthly Price</span>
            <input type="number" min="0" step="0.01" [formControl]="c('monthlyPrice')" placeholder="0.00" /></label>
          <label class="nf"><span>Yearly Price</span>
            <input type="number" min="0" step="0.01" [formControl]="c('yearlyPrice')" placeholder="0.00" /></label>
          <app-input [control]="c('currency')" label="Currency" placeholder="INR" [maxLength]="3" />
        </div>
        <div class="grid grid--3">
          <label class="nf"><span>Trial Days</span>
            <input type="number" min="0" max="365" step="1" [formControl]="c('trialDays')" placeholder="0" /></label>
          <label class="nf"><span>Display Order</span>
            <input type="number" min="0" step="1" [formControl]="c('displayOrder')" placeholder="0" /></label>
          <div></div>
        </div>
      </app-card>

      <app-card title="Quotas" subtitle="Blank means unlimited.">
        @if (isEnterprise()) {
          <p class="rule">An <b>ENTERPRISE</b> plan has every quota forced unlimited — the fields
            below are locked blank regardless of what's typed.</p>
        }
        <div class="grid grid--3">
          @for (f of quotaFields; track f.name) {
            <label class="nf"><span>{{ f.label }}</span>
              <input type="number" min="1" step="1" [formControl]="c(f.name)" placeholder="Unlimited" /></label>
          }
        </div>
      </app-card>

      <div class="pform__bar">
        <span class="pform__note">
          @if (form.invalid && form.touched) { Fix the highlighted fields before saving. }
        </span>
        <div class="pform__actions">
          <app-button variant="stroked" (pressed)="cancelled.emit()">Cancel</app-button>
          <app-button type="submit" icon="save" [loading]="saving()"
                      [disabled]="!isCreate() && form.pristine">
            {{ isCreate() ? 'Create Plan' : 'Save Changes' }}
          </app-button>
        </div>
      </div>
    </form>
  `,
  styles: [`
    .pform { display:flex; flex-direction:column; gap:16px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }
    .grid--3 { grid-template-columns:repeat(3,minmax(0,1fr)); margin-top:14px; }
    .full { margin-top:16px; }
    .hint-cell { display:flex; flex-direction:column; gap:4px; justify-content:center; }
    .hint { font:400 15px var(--font-sans); color:var(--content-muted); }
    .preview { font:400 15px var(--font-sans); color:var(--content-fg); }
    .preview b { font-family:var(--font-mono, var(--font-sans)); }
    .stat { display:flex; flex-direction:column; gap:6px; justify-content:center; }
    .stat__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .stat__v { font:600 17px var(--font-sans); color:var(--content-fg); }
    .stat__v.mono { font-family:var(--font-mono, var(--font-sans)); }
    .stat__h { font:400 15px var(--font-sans); color:var(--content-muted); }
    .rule { margin:0 0 10px; font:400 16px var(--font-sans); color:var(--warning); }
    .nf { display:flex; flex-direction:column; gap:6px; font:500 16px var(--font-sans); color:var(--content-fg); }
    .nf input { height:40px; padding:0 12px; border:1px solid var(--surface-border); border-radius:var(--r-field);
      background:var(--surface); color:var(--content-fg); font:400 17px var(--font-sans); }
    .nf input:disabled { background:var(--surface-muted); color:var(--content-muted); }
    .nf input:focus { outline:none; border-color:var(--brand-400); }
    .pform__bar { position:sticky; bottom:0; display:flex; align-items:center; justify-content:space-between;
      gap:16px; padding:14px 16px; background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .pform__note { font:500 16px var(--font-sans); color:var(--danger); }
    .pform__actions { display:flex; gap:10px; }
    @media (max-width:900px){ .grid--3{ grid-template-columns:1fr 1fr; } }
    @media (max-width:760px){ .grid, .grid--3{ grid-template-columns:1fr; } }
  `]
})
export class PlanForm {
  private readonly fb = inject(FormBuilder);

  readonly mode = input<'create' | 'edit'>('create');
  readonly plan = input<SubscriptionPlanProfile | null>(null);
  readonly saving = input(false);

  readonly saved = output<CreateSubscriptionPlanRequest | UpdateSubscriptionPlanRequest>();
  readonly cancelled = output<void>();

  protected readonly typeOptions = TYPE_OPTIONS;
  protected readonly quotaFields = QUOTA_FIELDS;
  protected readonly isCreate = computed(() => this.mode() === 'create');
  private hydrated = signal(false);

  protected readonly form: FormGroup = this.build();
  protected readonly codePreview = signal('');

  private readonly planTypeValue = signal<PlanType | null>(null);
  protected readonly isTrial = computed(() => this.planTypeValue() === 'TRIAL');
  protected readonly isEnterprise = computed(() => this.planTypeValue() === 'ENTERPRISE');

  constructor() {
    effect(() => { const p = this.plan(); if (p && this.mode() === 'edit') this.hydrate(p); });
    this.c('planCode').valueChanges.subscribe((v: string) => this.codePreview.set(this.normaliseCode(v)));
    this.c('planType').valueChanges.subscribe((v: PlanType | null) => {
      this.planTypeValue.set(v);
      this.applyTierLock(v);
    });
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  private normaliseCode(v: string): string { return (v || '').trim().toUpperCase(); }

  /** Mirrors the backend's TRIAL/ENTERPRISE invariants so the form doesn't invite a 422. */
  private applyTierLock(type: PlanType | null): void {
    const price = ['monthlyPrice', 'yearlyPrice'];
    const trialLock = type === 'TRIAL';
    price.forEach((name) => {
      const ctrl = this.c(name);
      if (trialLock) { ctrl.setValue(0, { emitEvent: false }); ctrl.disable({ emitEvent: false }); }
      else ctrl.enable({ emitEvent: false });
    });

    const enterpriseLock = type === 'ENTERPRISE';
    this.quotaFields.forEach((f) => {
      const ctrl = this.c(f.name);
      if (enterpriseLock) { ctrl.setValue('', { emitEvent: false }); ctrl.disable({ emitEvent: false }); }
      else ctrl.enable({ emitEvent: false });
    });
  }

  private hydrate(p: SubscriptionPlanProfile): void {
    if (this.hydrated()) return;
    this.form.patchValue({
      planName: p.planName ?? '', description: p.description ?? '',
      planType: p.planType ?? null, monthlyPrice: p.monthlyPrice, yearlyPrice: p.yearlyPrice,
      currency: p.currency ?? 'INR', trialDays: p.trialDays ?? 0, displayOrder: p.displayOrder ?? 0,
      maxUsers: p.maxUsers ?? '', maxBranches: p.maxBranches ?? '', maxHubs: p.maxHubs ?? '',
      maxCustomers: p.maxCustomers ?? '', maxDrivers: p.maxDrivers ?? '', maxVehicles: p.maxVehicles ?? '',
      maxDailyBookings: p.maxDailyBookings ?? '', maxMonthlyBookings: p.maxMonthlyBookings ?? '',
      storageLimitGb: p.storageLimitGb ?? '', apiRateLimit: p.apiRateLimit ?? ''
    }, { emitEvent: false });
    this.planTypeValue.set(p.planType);
    this.applyTierLock(p.planType);
    this.form.markAsPristine();
    this.hydrated.set(true);
  }

  private build(): FormGroup {
    const quotaGroup: Record<string, FormControl> = {};
    this.quotaFields.forEach((f) => { quotaGroup[f.name] = new FormControl(''); });

    return this.fb.group({
      planCode: ['', [Validators.required, Validators.maxLength(50), Validators.pattern(CODE)]],
      planName: ['', [Validators.required, Validators.maxLength(100)]],
      description: ['', Validators.maxLength(500)],
      planType: [null as PlanType | null, Validators.required],
      monthlyPrice: [0, [Validators.required, Validators.min(0)]],
      yearlyPrice: [0, [Validators.required, Validators.min(0)]],
      currency: ['INR', [Validators.pattern(CURRENCY), Validators.maxLength(3)]],
      trialDays: [0, [Validators.min(0), Validators.max(365)]],
      displayOrder: [0, [Validators.min(0)]],
      ...quotaGroup
    });
  }

  private num(v: unknown): number | undefined {
    if (v === '' || v === null || v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  protected submit(): void {
    if (this.isCreate()) this.c('planCode').markAsTouched();
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();
    const trim = (s: string) => (s && s.trim() ? s.trim() : null);

    const quotas = Object.fromEntries(
      this.quotaFields.map((f) => [f.name, this.num(v[f.name])])
    );

    if (this.isCreate()) {
      this.saved.emit({
        planCode: this.normaliseCode(v.planCode), planName: v.planName.trim(),
        description: trim(v.description), planType: v.planType as PlanType,
        monthlyPrice: Number(v.monthlyPrice), yearlyPrice: Number(v.yearlyPrice),
        currency: v.currency?.trim().toUpperCase() || undefined,
        trialDays: this.num(v.trialDays), displayOrder: this.num(v.displayOrder),
        ...quotas
      } as CreateSubscriptionPlanRequest);
    } else {
      this.saved.emit({
        planName: v.planName.trim(), description: trim(v.description), planType: v.planType as PlanType,
        monthlyPrice: Number(v.monthlyPrice), yearlyPrice: Number(v.yearlyPrice),
        currency: v.currency?.trim().toUpperCase() || undefined,
        trialDays: this.num(v.trialDays), displayOrder: this.num(v.displayOrder),
        ...quotas, version: this.plan()!.version
      } as UpdateSubscriptionPlanRequest);
    }
  }
}
