import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import {
  DistrictLevelFreight, CreateDistrictLevelFreightRequest, UpdateDistrictLevelFreightRequest, WEIGHT_SLABS
} from '@core/models/district-level-freight.model';

/**
 * Reactive create/edit editor for a District Level Freight rate row. Validators mirror
 * CreateDistrictLevelFreightRequest / UpdateDistrictLevelFreightRequest. From Station and
 * District options are passed in by the page, already loaded from the existing Branch/
 * District masters (`MasterDataService.options('branches')` /
 * `masterOptionsScoped('districts', {stateId})`) — this component never talks to those
 * masters directly, the same separation RateForm keeps.
 *
 * State is this form's own field, not persisted on the rate (the DTO only ever carried
 * `districtId`) — it exists purely to narrow District, the same reason as Cities' own
 * transient Country/State in the master framework: nationally there are 637 active
 * districts against a 100-row page cap, so an unscoped District picker can silently miss
 * the one a company operates in. `stateChanged` tells the page which state to scope by;
 * `initialStateId` lets an edit form re-open already scoped to the row's real state
 * (resolved by the page, since `DistrictLevelFreight` itself only carries `districtId`).
 */
@Component({
  selector: 'app-district-freight-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiSelect, UiButton, MatCheckboxModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="dform">
      <app-card title="Route" subtitle="From Station (booking branch) and the destination district this rate applies to.">
        <div class="grid">
          <app-select [control]="c('branchId')" label="From Station" [options]="branchOptions()" placeholder="Select a branch" />
          <app-select [control]="c('stateId')" label="State" [options]="stateOptions()"
                      [allowEmpty]="true" emptyLabel="Not set" placeholder="Select a state" />
          <app-select [control]="c('districtId')" label="District" [options]="districtOptions()"
                      placeholder="Select a state first" />
        </div>
      </app-card>

      <app-card title="Weight Slab Rates" subtitle="Per-KG rate for each slab. The COMPLETE weight uses exactly one slab's rate — never a progressive split across slabs.">
        <div class="grid3">
          @for (slab of slabs; track slab.key) {
            <label class="fld"><span class="fld__l">{{ slab.label }}<i>*</i></span>
              <input class="fld__i" type="number" step="0.01" min="0" [formControl]="c(slab.key)" /></label>
          }
        </div>
      </app-card>

      <app-card title="ODA (Out of Delivery Area)" subtitle="Configurable per From Station + District — never hardcoded.">
        <div class="grid">
          <mat-checkbox [formControl]="c('odaApplicable')">ODA applicable</mat-checkbox>
          <label class="fld"><span class="fld__l">ODA Charge</span>
            <input class="fld__i" type="number" step="0.01" min="0" [formControl]="c('odaCharge')" /></label>
        </div>
      </app-card>

      <div class="dform__bar">
        <span class="dform__note">@if (form.invalid && form.touched) { Fix the highlighted fields before saving. }</span>
        <div class="dform__actions">
          <app-button variant="stroked" (pressed)="cancelled.emit()">Cancel</app-button>
          <app-button type="submit" icon="save" [loading]="saving()" [disabled]="!isCreate() && form.pristine">
            {{ isCreate() ? 'Create Rate' : 'Save Changes' }}
          </app-button>
        </div>
      </div>
    </form>
  `,
  styles: [`
    .dform { display:flex; flex-direction:column; gap:16px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; align-items:center; }
    .grid3 { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px 20px; }
    .fld { display:flex; flex-direction:column; gap:6px; }
    .fld__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .fld__l i { color:var(--danger); margin-left:2px; font-style:normal; }
    .fld__i { height:42px; padding:0 12px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-field); font:400 17px var(--font-sans); color:var(--content-fg); }
    .fld__i:focus { outline:0; border-color:var(--brand-500); box-shadow:0 0 0 3px var(--brand-100); }
    .dform__bar { position:sticky; bottom:0; display:flex; align-items:center; justify-content:space-between;
      gap:16px; padding:14px 16px; background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .dform__note { font:500 16px var(--font-sans); color:var(--danger); }
    .dform__actions { display:flex; gap:10px; }
    @media (max-width:760px){ .grid, .grid3 { grid-template-columns:1fr; } }
  `]
})
export class DistrictFreightForm {
  private readonly fb = inject(FormBuilder);

  readonly mode = input<'create' | 'edit'>('create');
  readonly row = input<DistrictLevelFreight | null>(null);
  readonly saving = input(false);
  readonly branchOptions = input<SelectOption[]>([]);
  readonly stateOptions = input<SelectOption[]>([]);
  readonly districtOptions = input<SelectOption[]>([]);
  /** Edit mode only: the row's real state, resolved by the page before this input arrives
   *  — see the class doc. Ignored on create, where State starts empty. */
  readonly initialStateId = input<string | null>(null);

  readonly saved = output<CreateDistrictLevelFreightRequest | UpdateDistrictLevelFreightRequest>();
  readonly cancelled = output<void>();
  /** Fires whenever State changes (including the programmatic edit-mode initial set) —
   *  the page owns the scoped District fetch, this form only owns the field. */
  readonly stateChanged = output<string | null>();

  protected readonly slabs = WEIGHT_SLABS;
  protected readonly isCreate = computed(() => this.mode() === 'create');
  private readonly hydrated = signal(false);

  protected readonly form: FormGroup = this.build();

  constructor() {
    effect(() => { const r = this.row(); if (r && this.mode() === 'edit') this.hydrate(r); });
    this.c('stateId').valueChanges.subscribe((v: string | null) => this.stateChanged.emit(v));
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  private hydrate(row: DistrictLevelFreight): void {
    if (this.hydrated()) return;
    this.form.patchValue({
      // The page has already resolved and scoped districtOptions to this state before
      // handing it here (see the class doc) — emitEvent:false so this doesn't fire a
      // redundant second fetch of the very options it was just given.
      stateId: this.initialStateId(),
      branchId: row.branchId, districtId: row.districtId,
      rate1To15: row.rate1To15, rate16To50: row.rate16To50, rate51To100: row.rate51To100,
      rate101To1000: row.rate101To1000, rate1001To1500: row.rate1001To1500, rate1501To2000: row.rate1501To2000,
      odaApplicable: row.odaApplicable, odaCharge: row.odaCharge
    }, { emitEvent: false });
    this.form.markAsPristine();
    this.hydrated.set(true);
  }

  private build(): FormGroup {
    return this.fb.group({
      branchId: [null as string | null, Validators.required],
      stateId: [null as string | null],
      districtId: [null as string | null, Validators.required],
      rate1To15: [null as number | null, [Validators.required, Validators.min(0)]],
      rate16To50: [null as number | null, [Validators.required, Validators.min(0)]],
      rate51To100: [null as number | null, [Validators.required, Validators.min(0)]],
      rate101To1000: [null as number | null, [Validators.required, Validators.min(0)]],
      rate1001To1500: [null as number | null, [Validators.required, Validators.min(0)]],
      rate1501To2000: [null as number | null, [Validators.required, Validators.min(0)]],
      odaApplicable: [true],
      odaCharge: [250, [Validators.min(0)]]
    });
  }

  protected submit(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }

    const v = this.form.getRawValue();
    const num = (x: unknown) => Number(x);
    const common: CreateDistrictLevelFreightRequest = {
      branchId: v.branchId as string, districtId: v.districtId as string,
      rate1To15: num(v.rate1To15), rate16To50: num(v.rate16To50), rate51To100: num(v.rate51To100),
      rate101To1000: num(v.rate101To1000), rate1001To1500: num(v.rate1001To1500), rate1501To2000: num(v.rate1501To2000),
      odaApplicable: !!v.odaApplicable, odaCharge: num(v.odaCharge)
    };

    if (this.isCreate()) {
      this.saved.emit(common);
    } else {
      this.saved.emit({ ...common, version: this.row()!.version });
    }
  }
}
