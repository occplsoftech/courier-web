import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { ChargeResponse, CreateChargeRequest, UpdateChargeRequest } from '@core/models/charge.model';

/**
 * Reactive create/edit editor for a Charge — just a name and a Service Type. Charge
 * Settings are managed separately, on the detail page, once the charge exists (a setting
 * needs a real `chargeId` to be saved against).
 */
@Component({
  selector: 'app-charge-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiInput, UiSelect, UiButton, MatCheckboxModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="cform">
      <app-card title="Identity" subtitle="What this charge is called, and the service type it applies to.">
        <div class="grid">
          <app-input [control]="c('chargeName')" label="Charge Name" [required]="true" placeholder="Fuel Surcharge - Express" [maxLength]="150" />
          <app-select [control]="c('serviceTypeId')" label="Service Type" [options]="serviceTypeOptions()" placeholder="Select a service type" />
        </div>
        <mat-checkbox [formControl]="c('isQtyLevel')" class="cform__qty">
          Qty Level — a SLAB setting here prices on average per-piece weight (actual weight ÷ package count), then pays out per piece
        </mat-checkbox>
      </app-card>

      <div class="cform__bar">
        <span class="cform__note">@if (form.invalid && form.touched) { Fix the highlighted fields before saving. }</span>
        <div class="cform__actions">
          <app-button variant="stroked" (pressed)="cancelled.emit()">Cancel</app-button>
          <app-button type="submit" icon="save" [loading]="saving()" [disabled]="!isCreate() && form.pristine">
            {{ isCreate() ? 'Create Charge' : 'Save Changes' }}
          </app-button>
        </div>
      </div>
    </form>
  `,
  styles: [`
    .cform { display:flex; flex-direction:column; gap:16px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }
    .cform__qty { display:block; margin-top:14px; font:400 16px var(--font-sans); }
    .cform__bar { position:sticky; bottom:0; display:flex; align-items:center; justify-content:space-between;
      gap:16px; padding:14px 16px; background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .cform__note { font:500 16px var(--font-sans); color:var(--danger); }
    .cform__actions { display:flex; gap:10px; }
    @media (max-width:760px){ .grid { grid-template-columns:1fr; } }
  `]
})
export class ChargeForm {
  private readonly fb = inject(FormBuilder);

  readonly mode = input<'create' | 'edit'>('create');
  readonly charge = input<ChargeResponse | null>(null);
  readonly saving = input(false);
  readonly serviceTypeOptions = input<SelectOption[]>([]);

  readonly saved = output<CreateChargeRequest | UpdateChargeRequest>();
  readonly cancelled = output<void>();

  protected readonly isCreate = computed(() => this.mode() === 'create');
  private readonly hydrated = signal(false);

  protected readonly form: FormGroup = this.fb.group({
    chargeName: ['', [Validators.required, Validators.maxLength(150)]],
    serviceTypeId: [null as string | null, Validators.required],
    isQtyLevel: [false]
  });

  constructor() {
    effect(() => { const c = this.charge(); if (c && this.mode() === 'edit') this.hydrate(c); });
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  private hydrate(charge: ChargeResponse): void {
    if (this.hydrated()) return;
    this.form.patchValue({ chargeName: charge.chargeName, serviceTypeId: charge.serviceTypeId,
      isQtyLevel: charge.isQtyLevel }, { emitEvent: false });
    this.form.markAsPristine();
    this.hydrated.set(true);
  }

  protected submit(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();
    const common = { chargeName: (v.chargeName as string).trim(), serviceTypeId: v.serviceTypeId as string,
      isQtyLevel: v.isQtyLevel as boolean };

    if (this.isCreate()) {
      this.saved.emit(common);
    } else {
      this.saved.emit({ ...common, version: this.charge()!.version });
    }
  }
}
