import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { NotificationService } from '@core/services/notification.service';
import {
  ChargeSetting, ChargeSlabType, ChargeType, ChargeValueType, CommissionType,
  CreateChargeSettingRequest, UpdateChargeSettingRequest
} from '@core/models/charge.model';
import { ChargeService } from '../charge.service';

export interface ChargeSettingFormData {
  chargeId: string;
  /** Present in edit mode; absent/null when adding a new setting. */
  setting?: ChargeSetting | null;
}

const CHARGE_TYPE_OPTS: SelectOption[] = [
  { value: 'FACTOR', label: 'Factor (flat/percentage, no slab)' },
  { value: 'SLAB', label: 'Slab (banded on KG and/or KM)' }
];
const SLAB_TYPE_OPTS: SelectOption[] = [
  { value: 'KG', label: 'KG only' },
  { value: 'KM', label: 'KM only' },
  { value: 'BOTH', label: 'KG + KM combination' }
];
const VALUE_TYPE_OPTS: SelectOption[] = [{ value: 'AMOUNT', label: 'Amount' }, { value: 'PERCENTAGE', label: 'Percentage' }];

/**
 * Add or edit one Charge Setting under a Charge. Which of fromKm/toKm/fromKg/toKg are
 * shown (and required) follows chargeType/chargeSlabType exactly the way
 * `ChargeSetting.applyInvariants` validates server-side — mirrored here so a mismatch is
 * caught before the round-trip, not only after a 422.
 */
@Component({
  selector: 'app-charge-setting-form-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatDialogModule, UiInput, UiSelect, UiButton],
  template: `
    <div class="csd">
      <h2 class="text-h2">{{ isEdit() ? 'Edit charge setting' : 'Add charge setting' }}</h2>
      <form [formGroup]="form" (ngSubmit)="save()" class="csd__form">
        <div class="grid">
          <app-select [control]="c('chargeType')" label="Charge Type" [options]="chargeTypeOpts" />
          @if (isSlab()) {
            <app-select [control]="c('chargeSlabType')" label="Slab Type" [options]="slabTypeOpts" placeholder="Select a slab type" />
          }
        </div>

        @if (isSlab() && needsKm()) {
          <div class="grid">
            <app-input [control]="c('fromKm')" label="From (km)" type="number" [min]="0" [step]="0.001" placeholder="0" />
            <app-input [control]="c('toKm')" label="To (km)" type="number" [min]="0" [step]="0.001" placeholder="50" />
          </div>
        }
        @if (isSlab() && needsKg()) {
          <div class="grid">
            <app-input [control]="c('fromKg')" label="From (kg)" type="number" [min]="0" [step]="0.001" placeholder="0" />
            <app-input [control]="c('toKg')" label="To (kg)" type="number" [min]="0" [step]="0.001" placeholder="5" />
          </div>
        }
        @if (isSlab()) {
          <p class="csd__hint">Bands are [from, to) — the minimum is included, the maximum excluded.</p>
        }

        <div class="grid">
          <app-input [control]="c('chargeValue')" label="Charge Value" type="number" [min]="0" [step]="0.01" placeholder="100.00" />
          <app-select [control]="c('chargeValueType')" label="Charge Value Type" [options]="valueTypeOpts" />
        </div>

        <div class="grid">
          <app-input [control]="c('commissionValue')" label="Commission Value" type="number" [min]="0" [step]="0.01" placeholder="0.00" />
          <app-select [control]="c('commissionType')" label="Commission Type" [options]="valueTypeOpts" />
        </div>
        <p class="csd__hint">Commission is configuration only — nothing in Shipment Booking applies it yet.</p>

        <div class="csd__actions">
          <app-button variant="stroked" type="button" (pressed)="ref.close(null)">Cancel</app-button>
          <app-button type="submit" icon="save" [loading]="busy()">{{ isEdit() ? 'Save Changes' : 'Add Setting' }}</app-button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .csd { padding:24px; width:560px; max-width:92vw; max-height:85vh; overflow-y:auto; display:flex; flex-direction:column; gap:16px; }
    .csd__form { display:flex; flex-direction:column; gap:16px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }
    .csd__hint { font:400 15px var(--font-sans); color:var(--content-muted); margin:-8px 0 0; }
    .csd__actions { display:flex; justify-content:flex-end; gap:10px; margin-top:4px; }
    @media (max-width:600px){ .grid { grid-template-columns:1fr; } }
  `]
})
export class ChargeSettingFormDialog {
  readonly ref = inject(MatDialogRef<ChargeSettingFormDialog>);
  readonly data = inject<ChargeSettingFormData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(ChargeService);
  private readonly notify = inject(NotificationService);

  protected readonly isEdit = computed(() => !!this.data.setting);
  readonly busy = signal(false);

  protected readonly chargeTypeOpts = CHARGE_TYPE_OPTS;
  protected readonly slabTypeOpts = SLAB_TYPE_OPTS;
  protected readonly valueTypeOpts = VALUE_TYPE_OPTS;

  private readonly chargeTypeSig = signal<ChargeType>('FACTOR');
  private readonly slabTypeSig = signal<ChargeSlabType | null>(null);
  protected readonly isSlab = computed(() => this.chargeTypeSig() === 'SLAB');
  protected readonly needsKm = computed(() => this.slabTypeSig() === 'KM' || this.slabTypeSig() === 'BOTH');
  protected readonly needsKg = computed(() => this.slabTypeSig() === 'KG' || this.slabTypeSig() === 'BOTH');

  protected readonly form: FormGroup = this.fb.group({
    chargeType: ['FACTOR' as ChargeType, Validators.required],
    chargeSlabType: [null as ChargeSlabType | null],
    fromKm: [null as number | null, [Validators.min(0)]],
    toKm: [null as number | null, [Validators.min(0)]],
    fromKg: [null as number | null, [Validators.min(0)]],
    toKg: [null as number | null, [Validators.min(0)]],
    chargeValue: [null as number | null, [Validators.required, Validators.min(0)]],
    chargeValueType: ['AMOUNT' as ChargeValueType, Validators.required],
    commissionType: ['AMOUNT' as CommissionType, Validators.required],
    commissionValue: [0, [Validators.required, Validators.min(0)]]
  });

  constructor() {
    this.c('chargeType').valueChanges.subscribe((v) => this.chargeTypeSig.set(v));
    this.c('chargeSlabType').valueChanges.subscribe((v) => this.slabTypeSig.set(v));

    const setting = this.data.setting;
    if (setting) {
      this.chargeTypeSig.set(setting.chargeType);
      this.slabTypeSig.set(setting.chargeSlabType);
      this.form.patchValue({
        chargeType: setting.chargeType, chargeSlabType: setting.chargeSlabType,
        fromKm: setting.fromKm, toKm: setting.toKm, fromKg: setting.fromKg, toKg: setting.toKg,
        chargeValue: setting.chargeValue, chargeValueType: setting.chargeValueType,
        commissionType: setting.commissionType, commissionValue: setting.commissionValue
      }, { emitEvent: false });
    }
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  protected save(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();
    const slab = v.chargeType === 'SLAB';

    const body: CreateChargeSettingRequest = {
      chargeType: v.chargeType,
      chargeSlabType: slab ? v.chargeSlabType : null,
      fromKm: slab && (v.chargeSlabType === 'KM' || v.chargeSlabType === 'BOTH') ? Number(v.fromKm) : null,
      toKm: slab && (v.chargeSlabType === 'KM' || v.chargeSlabType === 'BOTH') ? Number(v.toKm) : null,
      fromKg: slab && (v.chargeSlabType === 'KG' || v.chargeSlabType === 'BOTH') ? Number(v.fromKg) : null,
      toKg: slab && (v.chargeSlabType === 'KG' || v.chargeSlabType === 'BOTH') ? Number(v.toKg) : null,
      chargeValue: Number(v.chargeValue),
      chargeValueType: v.chargeValueType,
      commissionType: v.commissionType,
      commissionValue: Number(v.commissionValue)
    };

    this.busy.set(true);
    const request = this.isEdit()
      ? this.service.updateSetting(this.data.chargeId, this.data.setting!.id,
          { ...body, version: this.data.setting!.version } as UpdateChargeSettingRequest)
      : this.service.createSetting(this.data.chargeId, body);

    request.subscribe({
      next: (saved: ChargeSetting) => {
        this.busy.set(false);
        this.notify.success(this.isEdit() ? 'Charge setting updated.' : 'Charge setting added.');
        this.ref.close(saved);
      },
      error: (e) => {
        this.busy.set(false);
        this.notify.error(e?.error?.message ?? 'Could not save the charge setting.');
      }
    });
  }
}
