import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiAutocomplete } from '@shared/components/ui-autocomplete/ui-autocomplete';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { MasterDataService } from '@features/masters/master-data.service';
import { RateCalculationResponse } from '@core/models/rate.model';
import { RateService } from '../rate.service';

/**
 * Prices a shipment without booking it: Booking Branch, Destination Branch, Service Type,
 * Package Type, Payment Mode and Actual Weight in; the matched rate and its full
 * breakdown out. Self-contained — loads its own picker options from Master, so it drops
 * into a dialog (quick lookup from the rate list) or a full page (the Rate Calculator
 * route) with no host wiring.
 */
@Component({
  selector: 'app-rate-calculator-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, ReactiveFormsModule, UiSelect, UiAutocomplete, UiButton],
  template: `
    <form [formGroup]="form" (ngSubmit)="calculate()" class="calc">
      <div class="grid">
        <app-autocomplete [control]="c('bookingBranchId')" label="Booking Branch" [options]="branchOptions()" placeholder="Search booking branch…" />
        <app-autocomplete [control]="c('deliveryBranchId')" label="Destination Branch" [options]="branchOptions()" placeholder="Search destination branch…" />
        <app-select [control]="c('serviceTypeId')" label="Service Type" [options]="serviceTypeOptions()" placeholder="Select a service type" />
        <app-select [control]="c('packageTypeId')" label="Package Type" [options]="packageTypeOptions()" placeholder="Select a package type" />
        <app-select [control]="c('paymentModeId')" label="Payment Mode" [options]="paymentModeOptions()" placeholder="Select a payment mode" />
        <label class="fld"><span class="fld__l">Actual Weight<i>*</i></span>
          <input class="fld__i" type="number" step="0.001" min="0.001" [formControl]="c('actualWeight')" /></label>
        <label class="fld"><span class="fld__l">Booking Date</span>
          <input class="fld__i" type="date" [formControl]="c('bookingDate')" />
          <span class="fld__hint">Blank means today</span></label>
      </div>

      <div class="calc__bar">
        <app-button type="submit" icon="calculate" [loading]="busy()">Calculate</app-button>
      </div>
    </form>

    @if (error()) {
      <p class="calc__err">{{ error() }}</p>
    }

    @if (result(); as r) {
      <div class="result">
        <header class="result__head">
          <span class="result__code mono">{{ r.matchedRateCode }}</span>
          <span class="result__name">{{ r.matchedRateName }}</span>
        </header>
        <dl class="kv">
          <dt>Chargeable Weight</dt><dd class="mono">{{ r.chargeableWeight }} {{ r.weightUnit }}</dd>
          <dt>Freight</dt><dd class="mono">{{ r.freight | number: '1.2-2' }}</dd>
          <dt>Fuel Surcharge</dt><dd class="mono">{{ r.fuelSurcharge | number: '1.2-2' }}</dd>
          <dt>Handling</dt><dd class="mono">{{ r.handlingCharge | number: '1.2-2' }}</dd>
          <dt>ODA</dt><dd class="mono">{{ r.odaCharge | number: '1.2-2' }}</dd>
          <dt>Insurance</dt><dd class="mono">{{ r.insuranceCharge | number: '1.2-2' }}</dd>
          <dt>GST ({{ r.gstPercentage }}%)</dt><dd class="mono">{{ r.gstAmount | number: '1.2-2' }}</dd>
          <dt class="total">Total Amount</dt><dd class="mono total">{{ r.totalAmount | number: '1.2-2' }}</dd>
        </dl>
      </div>
    }
  `,
  styles: [`
    .calc { display:flex; flex-direction:column; gap:16px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }
    .fld { display:flex; flex-direction:column; gap:6px; }
    .fld__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .fld__l i { color:var(--danger); margin-left:2px; font-style:normal; }
    .fld__i { height:42px; padding:0 12px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-field); font:400 17px var(--font-sans); color:var(--content-fg); }
    .fld__i:focus { outline:0; border-color:var(--brand-500); box-shadow:0 0 0 3px var(--brand-100); }
    .fld__hint { font:400 15px var(--font-sans); color:var(--content-muted); }
    .calc__bar { display:flex; justify-content:flex-end; }
    .calc__err { font:500 16px var(--font-sans); color:var(--danger); padding:10px 12px;
      background:var(--danger-50, rgba(239,68,68,.06)); border-radius:var(--r-field); }
    .result { margin-top:8px; padding:16px; border:1px solid var(--surface-border); border-radius:var(--r-field); background:var(--surface); }
    .result__head { display:flex; align-items:baseline; gap:10px; margin-bottom:12px; }
    .result__code { font:700 17px var(--font-mono, ui-monospace); color:var(--brand-600); }
    .result__name { font:600 17px var(--font-sans); color:var(--content-fg); }
    .kv { display:grid; grid-template-columns:1fr auto; gap:8px 16px; margin:0; }
    .kv dt { font:500 16px var(--font-sans); color:var(--content-muted); }
    .kv dd { font:600 17px var(--font-sans); color:var(--content-fg); margin:0; text-align:right; }
    .kv .total { font-weight:700; font-size:19px; color:var(--brand-600); border-top:1px solid var(--surface-border); padding-top:8px; margin-top:4px; }
    .mono { font-family:var(--font-mono, ui-monospace); }
    @media (max-width:600px){ .grid { grid-template-columns:1fr; } }
  `]
})
export class RateCalculatorForm {
  private readonly fb = inject(FormBuilder);
  private readonly rateService = inject(RateService);
  private readonly masters = inject(MasterDataService);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<RateCalculationResponse | null>(null);

  protected readonly branchOptions = signal<SelectOption[]>([]);
  protected readonly serviceTypeOptions = signal<SelectOption[]>([]);
  protected readonly packageTypeOptions = signal<SelectOption[]>([]);
  protected readonly paymentModeOptions = signal<SelectOption[]>([]);

  protected readonly form: FormGroup = this.fb.group({
    bookingBranchId: [null as string | null, Validators.required],
    deliveryBranchId: [null as string | null, Validators.required],
    serviceTypeId: [null as string | null, Validators.required],
    packageTypeId: [null as string | null, Validators.required],
    paymentModeId: [null as string | null, Validators.required],
    actualWeight: [null as number | null, [Validators.required, Validators.min(0.001)]],
    bookingDate: ['']
  });

  constructor() {
    this.masters.options('branches').subscribe((o) => this.branchOptions.set(o));
    this.masters.options('service-types').subscribe((o) => this.serviceTypeOptions.set(o));
    this.masters.options('package-types').subscribe((o) => this.packageTypeOptions.set(o));
    this.masters.options('payment-modes').subscribe((o) => this.paymentModeOptions.set(o));
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  protected calculate(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();

    this.busy.set(true);
    this.error.set(null);
    this.result.set(null);
    this.rateService.calculate({
      bookingBranchId: v.bookingBranchId, deliveryBranchId: v.deliveryBranchId,
      serviceTypeId: v.serviceTypeId, packageTypeId: v.packageTypeId, paymentModeId: v.paymentModeId,
      actualWeight: Number(v.actualWeight), bookingDate: v.bookingDate || null
    }).subscribe({
      next: (r) => { this.busy.set(false); this.result.set(r); },
      error: (e: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(e?.error?.message ?? 'Could not calculate a rate for this combination.');
      }
    });
  }
}
