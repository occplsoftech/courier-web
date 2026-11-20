import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiAutocomplete } from '@shared/components/ui-autocomplete/ui-autocomplete';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { AuthService } from '@core/auth/auth.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { MASTER_DEFINITIONS } from '@features/masters/master.config';
import { FreightCalculationService } from '@features/shipment/freight-calculation.service';
import { FreightCalculationResponse } from '@core/models/district-level-freight.model';

/**
 * Prices a lane by From Pincode -> To Pincode with the same District Level Freight call
 * Shipment Booking's freight card makes (`POST /district-level-freight/calculate`) — not
 * the Pricing Engine preview, which returns 0 freight for any lane with no route/rate.
 * That call's origin is the booking *branch*, not a pincode, so From Pincode picks the
 * branch whose own postal code matches it (and Booking Branch can be set directly); the
 * destination is the To Pincode, narrowed to one of its Areas the way booking does.
 */
@Component({
  selector: 'app-pincode-rate-calculator-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, ReactiveFormsModule, UiSelect, UiAutocomplete, UiButton],
  template: `
    <form [formGroup]="form" (ngSubmit)="calculate()" class="calc">
      <div class="grid">
        <label class="fld"><span class="fld__l">From Pincode</span>
          <input class="fld__i" [formControl]="c('fromPincode')" placeholder="e.g. 411001" maxlength="6" inputmode="numeric" />
          <span class="fld__hint">{{ fromHint() ?? 'Picks the branch with this postal code' }}</span></label>
        <app-autocomplete [control]="c('bookingBranchId')" label="Booking Branch" [options]="branchOptions()" placeholder="Search booking branch…" />
        <label class="fld"><span class="fld__l">To Pincode<i>*</i></span>
          <input class="fld__i" [formControl]="c('toPincode')" placeholder="e.g. 415001" maxlength="6" inputmode="numeric" /></label>
        <div class="fld">
          @if (areaOptions().length) {
            <app-select [control]="c('destinationAreaId')" label="Destination Area" [options]="areaOptions()" placeholder="Select an area" />
          } @else {
            <span class="fld__l">Destination Area</span>
            <span class="fld__i fld__i--hint">{{ areaHint() ?? 'Enter a 6-digit To Pincode' }}</span>
          }
        </div>
        <label class="fld"><span class="fld__l">Chargeable Weight (kg)<i>*</i></span>
          <input class="fld__i" type="number" step="0.001" min="0.001" [formControl]="c('weight')" /></label>
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
          <span class="result__code mono">{{ r.bookingBranchCode }} → {{ r.destinationPincode }}</span>
          <span class="result__name">{{ r.districtName }}{{ r.destinationCityName ? ' · ' + r.destinationCityName : '' }}</span>
        </header>
        <dl class="kv">
          <dt>Weight Slab</dt><dd class="mono">{{ r.weightSlabLabel }}</dd>
          <dt>Chargeable Weight</dt><dd class="mono">{{ r.chargeableWeight | number: '1.3-3' }} kg</dd>
          <dt>Rate per Kg</dt><dd class="mono">{{ r.ratePerKg | number: '1.2-2' }}</dd>
          <dt>Base Freight</dt><dd class="mono">{{ r.baseFreight | number: '1.2-2' }}</dd>
          <dt>ODA{{ r.odaApplicable ? '' : ' (not applicable)' }}</dt><dd class="mono">{{ r.odaCharge | number: '1.2-2' }}</dd>
          <dt class="total">Total Freight</dt><dd class="mono total">{{ r.totalFreight | number: '1.2-2' }}</dd>
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
    .fld__i--hint { display:flex; align-items:center; color:var(--content-muted); }
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
export class PincodeRateCalculatorForm {
  private readonly fb = inject(FormBuilder);
  private readonly freight = inject(FreightCalculationService);
  private readonly masters = inject(MasterDataService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<FreightCalculationResponse | null>(null);

  protected readonly branchOptions = signal<SelectOption[]>([]);
  protected readonly areaOptions = signal<SelectOption[]>([]);
  protected readonly areaHint = signal<string | null>(null);
  protected readonly fromHint = signal<string | null>(null);
  private branches: { id: string; branchName: string; branchCode: string; postalCode?: string | null }[] = [];

  protected readonly form: FormGroup = this.fb.group({
    fromPincode: [''],
    bookingBranchId: [this.auth.user()?.branchId ?? (null as string | null), Validators.required],
    toPincode: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
    destinationAreaId: [null as string | null],
    weight: [null as number | null, [Validators.required, Validators.min(0.001)]]
  });

  constructor() {
    // A shown result describes the inputs it was calculated from — drop it once they change.
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.result() || this.error()) { this.result.set(null); this.error.set(null); }
    });

    this.masters.branchDirectory().subscribe((list) => {
      this.branches = list;
      this.branchOptions.set(list.map((b) => ({ value: b.id, label: `${b.branchName} (${b.branchCode})` })));
    });

    // From Pincode -> the branch whose own postal code it is.
    this.c('fromPincode').valueChanges.pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((v: string) => {
        const code = (v ?? '').trim();
        if (!/^\d{6}$/.test(code)) { this.fromHint.set(null); return; }
        const hit = this.branches.find((b) => b.postalCode === code);
        if (hit) {
          this.c('bookingBranchId').setValue(hit.id);
          this.fromHint.set(`Branch: ${hit.branchName} (${hit.branchCode})`);
        } else {
          this.fromHint.set('No branch has this postal code — pick a Booking Branch');
        }
      });

    // To Pincode -> its Areas (master_pincode_areas), primary preselected, as booking does.
    this.c('toPincode').valueChanges.pipe(
      debounceTime(400), distinctUntilChanged(),
      switchMap((v: string) => {
        const code = (v ?? '').trim();
        this.areaOptions.set([]);
        this.areaHint.set(null);
        this.c('destinationAreaId').setValue(null);
        if (!/^\d{6}$/.test(code)) return of(null);
        return this.masters.list(MASTER_DEFINITIONS['pincodes'], { page: 0, size: 5, search: code }).pipe(
          switchMap((page) => {
            const match = page.content.find((r) => r.code === code);
            return match ? this.masters.pincodeAreas(match.id) : of(null);
          }),
          catchError(() => of(null))
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((rows) => {
      if (!rows || !rows.length) {
        this.areaHint.set(/^\d{6}$/.test((this.c('toPincode').value ?? '').trim()) ? 'No areas found for this pincode.' : null);
        return;
      }
      this.areaOptions.set(rows.map((r) => ({
        value: r.areaId,
        label: r.areaName ? `${r.areaName}${r.cityName ? ', ' + r.cityName : ''}` : r.areaId
      })));
      const primary = rows.find((r) => r.primary);
      if (primary) this.c('destinationAreaId').setValue(primary.areaId);
    });
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  protected calculate(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();

    this.busy.set(true);
    this.error.set(null);
    this.result.set(null);
    this.freight.calculate({
      bookingBranchId: v.bookingBranchId, destinationPincode: v.toPincode.trim(),
      destinationAreaId: v.destinationAreaId, chargeableWeight: Number(v.weight)
    }).subscribe({
      next: (r) => { this.busy.set(false); this.result.set(r); },
      error: (e: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(e?.error?.message ?? 'Could not calculate freight for this lane.');
      }
    });
  }
}
