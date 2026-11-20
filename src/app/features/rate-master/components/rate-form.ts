import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import {
  AbstractControl, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors,
  Validators
} from '@angular/forms';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import {
  Rate, RateResponse, RateWeightUnit, RATE_WEIGHT_UNITS, CreateRateRequest, UpdateRateRequest
} from '@core/models/rate.model';
import { RateService } from '../rate.service';
import { WeightSlabGrid } from './weight-slab-grid';

const CODE = /^[A-Za-z0-9][A-Za-z0-9_ -]{1,48}[A-Za-z0-9]$/;

const WEIGHT_UNIT_OPTS: SelectOption[] = RATE_WEIGHT_UNITS.map((u) => ({ value: u, label: u }));

/** Refused when the maximum is not strictly greater than the minimum — the slab is
 *  [min, max), the same rule Rate.applyInvariants enforces server-side. */
function weightRangeValid(group: AbstractControl): ValidationErrors | null {
  const min = Number(group.get('minimumWeight')?.value);
  const max = Number(group.get('maximumWeight')?.value);
  if (Number.isNaN(min) || Number.isNaN(max)) return null;
  return max > min ? null : { weightRange: true };
}

function effectiveRangeValid(group: AbstractControl): ValidationErrors | null {
  const from = group.get('effectiveFrom')?.value;
  const to = group.get('effectiveTo')?.value;
  if (!from || !to) return null;
  return to >= from ? null : { effectiveRange: true };
}

/**
 * Reactive create/edit editor for a rate card row. Validators mirror CreateRateRequest /
 * UpdateRateRequest. `rateCode` is create-only (immutable once assigned, so shown
 * read-only in edit). Route / Service Type / Package Type / Payment Mode options are
 * passed in by the page, already loaded from the master pickers, so this component never
 * talks to Master directly. As soon as all four combination fields and both weight bounds
 * are filled, the Weight Slab Grid loads the sibling rates for that exact combination —
 * the same view a would-be overlap would show as a 422 on save, surfaced before the
 * round-trip instead of after.
 */
@Component({
  selector: 'app-rate-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiInput, UiSelect, UiButton, WeightSlabGrid],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="rform">
      <app-card title="Identity" subtitle="What this rate is called, and the lane it prices.">
        <div class="grid">
          @if (isCreate()) {
            <app-input [control]="c('rateCode')" label="Rate Code" [required]="true" placeholder="RATE-PUNE-MUM-STD" [maxLength]="50" />
          } @else {
            <div class="stat"><span class="stat__l">Rate Code</span>
              <span class="stat__v mono">{{ rate()?.rateCode || '—' }}</span><span class="stat__h">Immutable</span></div>
          }
          <app-input [control]="c('rateName')" label="Rate Name" [required]="true" placeholder="Pune-Mumbai Standard" [maxLength]="150" />
        </div>
      </app-card>

      <app-card title="Combination" subtitle="One Route, Service Type, Package Type and Payment Mode. Only an active route may carry an active rate.">
        <div class="grid">
          <app-select [control]="c('routeId')" label="Route" [options]="routeOptions()" placeholder="Select a route" />
          <app-select [control]="c('serviceTypeId')" label="Service Type" [options]="serviceTypeOptions()" placeholder="Select a service type" />
          <app-select [control]="c('packageTypeId')" label="Package Type" [options]="packageTypeOptions()" placeholder="Select a package type" />
          <app-select [control]="c('paymentModeId')" label="Payment Mode" [options]="paymentModeOptions()" placeholder="Select a payment mode" />
        </div>
      </app-card>

      <app-card title="Weight Slab" subtitle="Half-open [minimum, maximum) — a parcel of exactly the maximum falls in the next slab.">
        <div class="grid3">
          <label class="fld"><span class="fld__l">Minimum Weight<i>*</i></span>
            <input class="fld__i" type="number" step="0.001" min="0" [formControl]="c('minimumWeight')" /></label>
          <label class="fld"><span class="fld__l">Maximum Weight<i>*</i></span>
            <input class="fld__i" type="number" step="0.001" min="0" [formControl]="c('maximumWeight')" /></label>
          <app-select [control]="c('weightUnit')" label="Weight Unit" [options]="unitOptions" />
        </div>
        @if (form.errors?.['weightRange'] && form.touched) {
          <p class="fld__err">Maximum weight must be greater than the minimum.</p>
        }

        @if (showSlabGrid()) {
          <div class="slabs">
            <h3 class="text-caption">Other slabs for this lane</h3>
            @if (loadingSlabs()) {
              <p class="empty">Loading…</p>
            } @else {
              <app-weight-slab-grid [rows]="siblingSlabs()" [currentId]="rate()?.id ?? null" />
            }
          </div>
        }
      </app-card>

      <app-card title="Freight" subtitle="What this slab costs, and how overage beyond the maximum is billed.">
        <div class="grid3">
          <label class="fld"><span class="fld__l">Base Rate<i>*</i></span>
            <input class="fld__i" type="number" step="0.01" min="0" [formControl]="c('baseRate')" /></label>
          <label class="fld"><span class="fld__l">Additional Weight<i>*</i></span>
            <input class="fld__i" type="number" step="0.001" min="0.001" [formControl]="c('additionalWeight')" /></label>
          <label class="fld"><span class="fld__l">Additional Weight Rate<i>*</i></span>
            <input class="fld__i" type="number" step="0.01" min="0" [formControl]="c('additionalWeightRate')" /></label>
        </div>
        <p class="text-caption hint">Weight beyond the maximum is billed at Additional Weight Rate for every Additional Weight increment of overage.</p>
        <div class="grid3">
          <label class="fld"><span class="fld__l">Minimum Charge</span>
            <input class="fld__i" type="number" step="0.01" min="0" [formControl]="c('minimumCharge')" /></label>
          <label class="fld"><span class="fld__l">GST %<i>*</i></span>
            <input class="fld__i" type="number" step="0.01" min="0" max="100" [formControl]="c('gstPercentage')" /></label>
        </div>
      </app-card>

      <app-card title="Surcharges" subtitle="Flat amounts added to the freight before GST.">
        <div class="grid4">
          <label class="fld"><span class="fld__l">Fuel Surcharge</span>
            <input class="fld__i" type="number" step="0.01" min="0" [formControl]="c('fuelSurcharge')" /></label>
          <label class="fld"><span class="fld__l">Handling Charge</span>
            <input class="fld__i" type="number" step="0.01" min="0" [formControl]="c('handlingCharge')" /></label>
          <label class="fld"><span class="fld__l">ODA Charge</span>
            <input class="fld__i" type="number" step="0.01" min="0" [formControl]="c('odaCharge')" /></label>
          <label class="fld"><span class="fld__l">Insurance Charge</span>
            <input class="fld__i" type="number" step="0.01" min="0" [formControl]="c('insuranceCharge')" /></label>
        </div>
      </app-card>

      <app-card title="Effective Window" subtitle="A booking's date must fall within this range for the rate to be used.">
        <div class="grid">
          <label class="fld"><span class="fld__l">Effective From<i>*</i></span>
            <input class="fld__i" type="date" [formControl]="c('effectiveFrom')" /></label>
          <label class="fld"><span class="fld__l">Effective To</span>
            <input class="fld__i" type="date" [formControl]="c('effectiveTo')" />
            <span class="fld__hint">Blank means open-ended</span></label>
        </div>
        @if (form.errors?.['effectiveRange'] && form.touched) {
          <p class="fld__err">Effective-to cannot be before effective-from.</p>
        }
      </app-card>

      <div class="rform__bar">
        <span class="rform__note">@if (form.invalid && form.touched) { Fix the highlighted fields before saving. }</span>
        <div class="rform__actions">
          <app-button variant="stroked" (pressed)="cancelled.emit()">Cancel</app-button>
          <app-button type="submit" icon="save" [loading]="saving()" [disabled]="!isCreate() && form.pristine">
            {{ isCreate() ? 'Create Rate' : 'Save Changes' }}
          </app-button>
        </div>
      </div>
    </form>
  `,
  styles: [`
    .rform { display:flex; flex-direction:column; gap:16px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }
    .grid3 { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px 20px; }
    .grid4 { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:16px 20px; }
    .stat { display:flex; flex-direction:column; gap:6px; justify-content:center; }
    .stat__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .stat__v { font:600 17px var(--font-sans); color:var(--content-fg); }
    .stat__h { font:400 15px var(--font-sans); color:var(--content-muted); }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .fld { display:flex; flex-direction:column; gap:6px; }
    .fld__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .fld__l i { color:var(--danger); margin-left:2px; font-style:normal; }
    .fld__i { height:42px; padding:0 12px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-field); font:400 17px var(--font-sans); color:var(--content-fg); }
    .fld__i:focus { outline:0; border-color:var(--brand-500); box-shadow:0 0 0 3px var(--brand-100); }
    .fld__hint { font:400 15px var(--font-sans); color:var(--content-muted); }
    .fld__err { font:500 15px var(--font-sans); color:var(--danger); margin:-8px 0 0; }
    .hint { margin:-8px 0 8px; }
    .slabs { margin-top:16px; padding-top:16px; border-top:1px solid var(--surface-border); }
    .empty { font:400 16px var(--font-sans); color:var(--content-muted); }
    .rform__bar { position:sticky; bottom:0; display:flex; align-items:center; justify-content:space-between;
      gap:16px; padding:14px 16px; background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .rform__note { font:500 16px var(--font-sans); color:var(--danger); }
    .rform__actions { display:flex; gap:10px; }
    @media (max-width:760px){ .grid, .grid3, .grid4 { grid-template-columns:1fr; } }
  `]
})
export class RateForm {
  private readonly fb = inject(FormBuilder);
  private readonly rateService = inject(RateService);

  readonly mode = input<'create' | 'edit'>('create');
  readonly rate = input<RateResponse | null>(null);
  readonly saving = input(false);
  readonly routeOptions = input<SelectOption[]>([]);
  readonly serviceTypeOptions = input<SelectOption[]>([]);
  readonly packageTypeOptions = input<SelectOption[]>([]);
  readonly paymentModeOptions = input<SelectOption[]>([]);

  readonly saved = output<CreateRateRequest | UpdateRateRequest>();
  readonly cancelled = output<void>();

  protected readonly unitOptions = WEIGHT_UNIT_OPTS;
  protected readonly isCreate = computed(() => this.mode() === 'create');
  private readonly hydrated = signal(false);

  protected readonly loadingSlabs = signal(false);
  protected readonly siblingSlabs = signal<Rate[]>([]);
  private readonly combo = signal<{ route: string; service: string; pkg: string; mode: string } | null>(null);
  protected readonly showSlabGrid = computed(() => this.combo() !== null);

  protected readonly form: FormGroup = this.build();

  constructor() {
    effect(() => { const r = this.rate(); if (r && this.mode() === 'edit') this.hydrate(r); });

    ['routeId', 'serviceTypeId', 'packageTypeId', 'paymentModeId'].forEach((name) =>
      this.c(name).valueChanges.subscribe(() => this.maybeLoadSlabs()));
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  private maybeLoadSlabs(): void {
    const v = this.form.getRawValue();
    if (!v.routeId || !v.serviceTypeId || !v.packageTypeId || !v.paymentModeId) {
      this.combo.set(null);
      this.siblingSlabs.set([]);
      return;
    }
    this.combo.set({ route: v.routeId, service: v.serviceTypeId, pkg: v.packageTypeId, mode: v.paymentModeId });
    this.loadingSlabs.set(true);
    this.rateService.siblings(v.routeId, v.serviceTypeId, v.packageTypeId, v.paymentModeId).subscribe({
      next: (page) => { this.siblingSlabs.set(page.content); this.loadingSlabs.set(false); },
      error: () => { this.siblingSlabs.set([]); this.loadingSlabs.set(false); }
    });
  }

  private hydrate(rate: RateResponse): void {
    if (this.hydrated()) return;
    this.form.patchValue({
      rateName: rate.rateName, routeId: rate.routeId, serviceTypeId: rate.serviceTypeId,
      packageTypeId: rate.packageTypeId, paymentModeId: rate.paymentModeId,
      minimumWeight: rate.minimumWeight, maximumWeight: rate.maximumWeight, weightUnit: rate.weightUnit,
      baseRate: rate.baseRate, additionalWeight: rate.additionalWeight, additionalWeightRate: rate.additionalWeightRate,
      minimumCharge: rate.minimumCharge, fuelSurcharge: rate.fuelSurcharge, handlingCharge: rate.handlingCharge,
      odaCharge: rate.odaCharge, insuranceCharge: rate.insuranceCharge, gstPercentage: rate.gstPercentage,
      effectiveFrom: rate.effectiveFrom, effectiveTo: rate.effectiveTo ?? ''
    }, { emitEvent: true });
    this.form.markAsPristine();
    this.hydrated.set(true);
    this.maybeLoadSlabs();
  }

  private build(): FormGroup {
    return this.fb.group({
      rateCode: ['', [Validators.required, Validators.pattern(CODE), Validators.maxLength(50)]],
      rateName: ['', [Validators.required, Validators.maxLength(150)]],
      routeId: [null as string | null, Validators.required],
      serviceTypeId: [null as string | null, Validators.required],
      packageTypeId: [null as string | null, Validators.required],
      paymentModeId: [null as string | null, Validators.required],
      minimumWeight: [0, [Validators.required, Validators.min(0)]],
      maximumWeight: [null as number | null, [Validators.required, Validators.min(0.001)]],
      weightUnit: ['KG' as RateWeightUnit, Validators.required],
      baseRate: [null as number | null, [Validators.required, Validators.min(0)]],
      additionalWeight: [0.5, [Validators.required, Validators.min(0.001)]],
      additionalWeightRate: [null as number | null, [Validators.required, Validators.min(0)]],
      minimumCharge: [0, [Validators.required, Validators.min(0)]],
      fuelSurcharge: [0, [Validators.required, Validators.min(0)]],
      handlingCharge: [0, [Validators.required, Validators.min(0)]],
      odaCharge: [0, [Validators.required, Validators.min(0)]],
      insuranceCharge: [0, [Validators.required, Validators.min(0)]],
      gstPercentage: [0, [Validators.required, Validators.min(0), Validators.max(100)]],
      effectiveFrom: ['', Validators.required],
      effectiveTo: ['']
    }, { validators: [weightRangeValid, effectiveRangeValid] });
  }

  protected submit(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }

    const v = this.form.getRawValue();
    const num = (x: unknown) => Number(x);
    const common = {
      rateName: v.rateName.trim(),
      routeId: v.routeId as string, serviceTypeId: v.serviceTypeId as string,
      packageTypeId: v.packageTypeId as string, paymentModeId: v.paymentModeId as string,
      minimumWeight: num(v.minimumWeight), maximumWeight: num(v.maximumWeight), weightUnit: v.weightUnit as RateWeightUnit,
      baseRate: num(v.baseRate), additionalWeight: num(v.additionalWeight), additionalWeightRate: num(v.additionalWeightRate),
      minimumCharge: num(v.minimumCharge), fuelSurcharge: num(v.fuelSurcharge), handlingCharge: num(v.handlingCharge),
      odaCharge: num(v.odaCharge), insuranceCharge: num(v.insuranceCharge), gstPercentage: num(v.gstPercentage),
      effectiveFrom: v.effectiveFrom as string, effectiveTo: v.effectiveTo || null
    };

    if (this.isCreate()) {
      this.saved.emit({ rateCode: v.rateCode.trim().toUpperCase(), ...common });
    } else {
      this.saved.emit({ ...common, version: this.rate()!.version });
    }
  }
}
