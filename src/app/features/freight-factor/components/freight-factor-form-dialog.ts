import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { NotificationService } from '@core/services/notification.service';
import { FreightFactor } from '@core/models/freight-factor.model';
import { FreightFactorService } from '../freight-factor.service';

export interface FreightFactorFormData {
  /** Present in edit mode; absent/null when adding a new cell. */
  cell?: FreightFactor | null;
}

/** Add or edit one freight factor grid cell — five numeric fields, directly mirrors
 *  `customer/components/address-form-dialog.ts`'s create/edit-in-dialog shape. */
@Component({
  selector: 'app-freight-factor-form-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatDialogModule, UiInput, UiButton],
  template: `
    <div class="ffd">
      <h2 class="text-h2">{{ isEdit() ? 'Edit freight factor' : 'Add freight factor' }}</h2>
      <form [formGroup]="form" (ngSubmit)="save()" class="ffd__form">
        <div class="grid">
          <app-input [control]="c('fromKm')" label="From (km)" type="number" [min]="0" [step]="0.001" placeholder="0" />
          <app-input [control]="c('toKm')" label="To (km)" type="number" [min]="0" [step]="0.001" placeholder="100" />
        </div>
        <div class="grid">
          <app-input [control]="c('fromWeight')" label="From (kg)" type="number" [min]="0" [step]="0.001" placeholder="0" />
          <app-input [control]="c('toWeight')" label="To (kg)" type="number" [min]="0" [step]="0.001" placeholder="10" />
        </div>
        <app-input [control]="c('factor')" label="Factor" type="number" [min]="0" [step]="0.01" placeholder="12.50" />
        <p class="ffd__hint">Ranges are [from, to) — the minimum is included, the maximum excluded. Freight = factor x weight.</p>

        <div class="ffd__actions">
          <app-button variant="stroked" type="button" (pressed)="ref.close(null)">Cancel</app-button>
          <app-button type="submit" icon="save" [loading]="busy()">{{ isEdit() ? 'Save Changes' : 'Add Cell' }}</app-button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .ffd { padding:24px; width:480px; max-width:92vw; max-height:85vh; overflow-y:auto; display:flex; flex-direction:column; gap:16px; }
    .ffd__form { display:flex; flex-direction:column; gap:16px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }
    .ffd__hint { font:400 15px var(--font-sans); color:var(--content-muted); margin:0; }
    .ffd__actions { display:flex; justify-content:flex-end; gap:10px; margin-top:4px; }
    @media (max-width:520px){ .grid { grid-template-columns:1fr; } }
  `]
})
export class FreightFactorFormDialog {
  readonly ref = inject(MatDialogRef<FreightFactorFormDialog>);
  readonly data = inject<FreightFactorFormData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(FreightFactorService);
  private readonly notify = inject(NotificationService);

  protected readonly isEdit = computed(() => !!this.data.cell);
  readonly busy = signal(false);

  protected readonly form: FormGroup = this.fb.group({
    fromKm: [null as number | null, [Validators.required, Validators.min(0)]],
    toKm: [null as number | null, [Validators.required, Validators.min(0)]],
    fromWeight: [null as number | null, [Validators.required, Validators.min(0)]],
    toWeight: [null as number | null, [Validators.required, Validators.min(0)]],
    factor: [null as number | null, [Validators.required, Validators.min(0.0001)]]
  });

  constructor() {
    const cell = this.data.cell;
    if (cell) {
      this.form.patchValue({
        fromKm: cell.fromKm, toKm: cell.toKm,
        fromWeight: cell.fromWeight, toWeight: cell.toWeight,
        factor: cell.factor
      }, { emitEvent: false });
    }
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  protected save(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();

    const body = {
      fromKm: Number(v.fromKm), toKm: Number(v.toKm),
      fromWeight: Number(v.fromWeight), toWeight: Number(v.toWeight),
      factor: Number(v.factor)
    };

    this.busy.set(true);
    const request = this.isEdit()
      ? this.service.update(this.data.cell!.id, { ...body, version: this.data.cell!.version })
      : this.service.create(body);

    request.subscribe({
      next: (cell: FreightFactor) => {
        this.busy.set(false);
        this.notify.success(this.isEdit() ? 'Freight factor updated.' : 'Freight factor added.');
        this.ref.close(cell);
      },
      error: (e) => {
        this.busy.set(false);
        this.notify.error(e?.error?.message ?? 'Could not save the freight factor.');
      }
    });
  }
}
