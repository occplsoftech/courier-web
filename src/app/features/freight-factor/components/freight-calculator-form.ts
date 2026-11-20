import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { UiAutocomplete } from '@shared/components/ui-autocomplete/ui-autocomplete';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { MasterDataService } from '@features/masters/master-data.service';
import { FreightCalculationResponse } from '@core/models/freight-factor.model';
import { FreightFactorService } from '../freight-factor.service';

/**
 * Freight Factor's own calculate form (branch pair + weight -> matched cell/freight),
 * extracted out of `FreightFactorPage` so it can drop into the Rate Master Calculator
 * page as a tab, self-contained the same way `RateCalculatorForm` is — no host wiring.
 *
 * <p>GST here is calculator-only: the backend `FreightFactor`/calculate response carry
 * no GST percentage at all (unlike a Rate card's own `gstPercentage`), by direct
 * decision — the user typing a rate at calculate time, not a stored per-cell or company
 * setting. `gstAmount`/`total` are computed client-side off the last successful result
 * and whatever the GST field holds right now (not frozen at calculate time), so editing
 * the percentage after calculating updates the total live.
 */
@Component({
  selector: 'app-freight-calculator-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, ReactiveFormsModule, UiAutocomplete, UiInput, UiButton],
  template: `
    <form [formGroup]="form" (ngSubmit)="calculate()" class="calc">
      <div class="grid grid--3">
        <app-autocomplete [control]="c('fromBranchId')" label="From Branch" [options]="branchOptions()" placeholder="Search branch…" />
        <app-autocomplete [control]="c('toBranchId')" label="To Branch" [options]="branchOptions()" placeholder="Search branch…" />
        <app-input [control]="c('weight')" label="Weight (kg)" type="number" [min]="0" [step]="0.001" placeholder="4.000" />
      </div>
      <div class="grid grid--3">
        <app-input [control]="c('gstPercentage')" label="GST %" type="number" [min]="0" [max]="100" [step]="0.01" placeholder="18" />
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
        <dl class="kv">
          <dt>Distance</dt><dd class="mono">{{ r.distanceKm | number: '1.3-3' }} km</dd>
          <dt>Factor</dt><dd class="mono">{{ r.factor | number: '1.2-4' }}</dd>
          <dt>Weight</dt><dd class="mono">{{ r.weight | number: '1.3-3' }} kg</dd>
          <dt>Freight</dt><dd class="mono">{{ r.freight | number: '1.2-2' }}</dd>
          <dt>GST ({{ gstPercentage() }}%)</dt><dd class="mono">{{ gstAmount() | number: '1.2-2' }}</dd>
          <dt class="total">Total Amount</dt><dd class="mono total">{{ total() | number: '1.2-2' }}</dd>
        </dl>
      </div>
    }
  `,
  styles: [`
    .calc { display:flex; flex-direction:column; gap:16px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }
    .grid--3 { grid-template-columns:repeat(3,minmax(0,1fr)); }
    .calc__bar { display:flex; justify-content:flex-end; }
    .calc__err { font:500 16px var(--font-sans); color:var(--danger); padding:10px 12px;
      background:var(--danger-50, rgba(239,68,68,.06)); border-radius:var(--r-field); }
    .result { margin-top:8px; padding:16px; border:1px solid var(--surface-border); border-radius:var(--r-field); background:var(--surface); }
    .kv { display:grid; grid-template-columns:1fr auto; gap:8px 16px; margin:0; }
    .kv dt { font:500 16px var(--font-sans); color:var(--content-muted); }
    .kv dd { font:600 17px var(--font-sans); color:var(--content-fg); margin:0; text-align:right; }
    .kv .total { font-weight:700; font-size:19px; color:var(--brand-600); border-top:1px solid var(--surface-border); padding-top:8px; margin-top:4px; }
    .mono { font-family:var(--font-mono, ui-monospace); }
    @media (max-width:700px){ .grid--3 { grid-template-columns:1fr; } .grid { grid-template-columns:1fr; } }
  `]
})
export class FreightCalculatorForm {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(FreightFactorService);
  private readonly masters = inject(MasterDataService);

  protected readonly branchOptions = signal<SelectOption[]>([]);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<FreightCalculationResponse | null>(null);

  protected readonly form: FormGroup = this.fb.group({
    fromBranchId: [null as string | null, Validators.required],
    toBranchId: [null as string | null, Validators.required],
    weight: [null as number | null, [Validators.required, Validators.min(0.001)]],
    gstPercentage: [0 as number | null, [Validators.min(0), Validators.max(100)]]
  });

  /**
   * Plain methods, not `computed()` — they read the GST field's live `FormControl.value`
   * directly, which isn't itself a signal, so a `computed()` would never see it change
   * after its first read (the same signal-input-timing gotcha `SignalInputTiming`
   * documents elsewhere: a non-signal source needs re-evaluation on every change
   * detection pass, not memoized tracking). OnPush still re-renders these on every
   * keystroke because the reactive-forms directives mark the view dirty on their own
   * `valueChanges`.
   */
  protected gstPercentage(): number {
    const v = this.form.controls['gstPercentage'].value;
    return v === null || v === '' ? 0 : Number(v);
  }
  protected gstAmount(): number {
    const r = this.result();
    return r ? r.freight * (this.gstPercentage() / 100) : 0;
  }
  protected total(): number {
    const r = this.result();
    return r ? r.freight + this.gstAmount() : 0;
  }

  constructor() {
    this.masters.branchDirectory().subscribe((branches) => {
      this.branchOptions.set(branches.map((b) => ({ value: b.id, label: `${b.branchName} (${b.branchCode})` })));
    });
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  protected calculate(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const { fromBranchId, toBranchId, weight } = this.form.getRawValue();
    if (fromBranchId === toBranchId) {
      this.error.set("A branch's freight to itself is not meaningful.");
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    this.result.set(null);
    this.service.calculate({ fromBranchId, toBranchId, weight: Number(weight) }).subscribe({
      next: (r) => { this.busy.set(false); this.result.set(r); },
      error: (e: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(e?.error?.message ?? 'Could not calculate freight for this request.');
      }
    });
  }
}
