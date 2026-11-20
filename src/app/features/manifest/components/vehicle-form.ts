import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiAutocomplete } from '@shared/components/ui-autocomplete/ui-autocomplete';
import { UiButton } from '@shared/components/ui-button/ui-button';
import {
  CreateVehicleRequest, FuelType, UpdateVehicleRequest, Vehicle, VehicleStatus, VehicleType
} from '@core/models/shipment.model';

const VEHICLE_TYPE_OPTIONS: SelectOption[] = ['BIKE', 'SCOOTER', 'AUTO', 'VAN', 'PICKUP', 'TRUCK', 'TEMPO', 'OTHER']
  .map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }));
const FUEL_TYPE_OPTIONS: SelectOption[] = ['PETROL', 'DIESEL', 'CNG', 'EV', 'OTHER']
  .map((v) => ({ value: v, label: v }));
const STATUS_OPTIONS: SelectOption[] = ['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'INACTIVE']
  .map((v) => ({ value: v, label: v.replace('_', ' ') }));

/**
 * Full-page create/edit editor for a fleet vehicle — a routed page, not a dialog,
 * since seventeen fields cramped into a modal read poorly (direct user feedback).
 * Mirrors `branch-form.ts`'s own mode/hydrate shape. Status is edit-only — a new
 * vehicle always starts AVAILABLE server-side, same convention as Branch's own
 * lifecycle fields.
 */
@Component({
  selector: 'app-vehicle-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiInput, UiSelect, UiAutocomplete, UiButton],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="vform">
      <app-card title="Basic Information" subtitle="Identity and classification.">
        <div class="grid">
          <app-input [control]="c('vehicleNumber')" label="Vehicle Number" [required]="true" placeholder="MH12AB1234" [maxLength]="30" />
          <app-input [control]="c('ownerName')" label="Owner Name" placeholder="Owner or fleet company name" [maxLength]="150" />
          <app-select [control]="c('vehicleType')" label="Vehicle Type" [options]="VEHICLE_TYPE_OPTIONS" />
          <app-input [control]="c('make')" label="Make" placeholder="Tata" [maxLength]="50" />
          <app-input [control]="c('model')" label="Model" placeholder="407" [maxLength]="50" />
          <app-input [control]="c('modelVariant')" label="Model Variant" placeholder="MAXX PUB HD 1.7 LX BSVI" [maxLength]="50" />
          <app-input [control]="c('series')" label="Series" placeholder="YQ" [maxLength]="30" />
          <app-select [control]="c('fuelType')" label="Fuel Type" [options]="FUEL_TYPE_OPTIONS" [allowEmpty]="true" emptyLabel="Not set" />
          <app-autocomplete [control]="c('branchId')" label="Base Branch" [options]="branchOptions()" placeholder="Search branch…" />
        </div>
      </app-card>

      <app-card title="Identification" subtitle="Chassis, engine and dealer records.">
        <div class="grid">
          <app-input [control]="c('chassisNumber')" label="Chassis Number" placeholder="MA1RE2TTKS6J37720" [maxLength]="50" />
          <app-input [control]="c('engineNumber')" label="Engine Number" placeholder="TTS4J18108" [maxLength]="50" />
          <app-input [control]="c('dealerName')" label="Dealer Name" placeholder="Dealer or seller name" [maxLength]="150" />
        </div>
      </app-card>

      <app-card title="Capacity &amp; Odometer" subtitle="Payload and current reading.">
        <div class="grid">
          <app-input [control]="c('capacityKg')" label="Capacity (kg)" type="number" [min]="0" [step]="0.001" placeholder="2500" />
          <app-input [control]="c('currentOdometer')" label="Current Odometer (km)" type="number" [min]="0" [step]="0.01" placeholder="15230.5" />
        </div>
      </app-card>

      <app-card title="Ownership" subtitle="When it was bought and registered.">
        <div class="grid">
          <app-input [control]="c('purchaseDate')" label="Purchase Date" type="date" />
          <app-input [control]="c('registrationDate')" label="Registration Date" type="date" />
        </div>
      </app-card>

      <app-card title="Statutory Expiries" subtitle="Insurance, PUC, fitness and permit renewal dates.">
        <div class="grid">
          <app-input [control]="c('insuranceExpiry')" label="Insurance Expiry" type="date" />
          <app-input [control]="c('pucExpiry')" label="PUC Expiry" type="date" />
          <app-input [control]="c('fitnessExpiry')" label="Fitness Expiry" type="date" />
          <app-input [control]="c('permitExpiry')" label="Permit Expiry" type="date" />
        </div>
      </app-card>

      @if (isEdit()) {
        <app-card title="Status" subtitle="Current operational state. Active/inactive has its own action on the list.">
          <div class="grid">
            <app-select [control]="c('status')" label="Status" [options]="STATUS_OPTIONS" />
          </div>
        </app-card>
      }

      <app-card title="Notes" subtitle="Internal remarks.">
        <app-input [control]="c('remarks')" label="Remarks" placeholder="Any internal note about this vehicle" [maxLength]="500" />
      </app-card>

      <div class="vform__bar">
        <span class="vform__note">@if (form.invalid && form.touched) { Fix the highlighted fields before saving. }</span>
        <div class="vform__actions">
          <app-button variant="stroked" type="button" (pressed)="cancelled.emit()">Cancel</app-button>
          <app-button type="submit" icon="save" [loading]="saving()" [disabled]="!isCreate() && form.pristine">
            {{ isCreate() ? 'Add Vehicle' : 'Save Changes' }}
          </app-button>
        </div>
      </div>
    </form>
  `,
  styles: [`
    .vform { display:flex; flex-direction:column; gap:16px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }
    .vform__bar { position:sticky; bottom:0; display:flex; align-items:center; justify-content:space-between;
      gap:16px; padding:14px 16px; background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .vform__note { font:500 16px var(--font-sans); color:var(--danger); }
    .vform__actions { display:flex; gap:10px; }
    @media (max-width:760px){ .grid { grid-template-columns:1fr; } }
  `]
})
export class VehicleForm {
  private readonly fb = inject(FormBuilder);

  readonly mode = input<'create' | 'edit'>('create');
  readonly vehicle = input<Vehicle | null>(null);
  readonly branchOptions = input<SelectOption[]>([]);
  readonly saving = input(false);

  readonly saved = output<CreateVehicleRequest | UpdateVehicleRequest>();
  readonly cancelled = output<void>();

  protected readonly VEHICLE_TYPE_OPTIONS = VEHICLE_TYPE_OPTIONS;
  protected readonly FUEL_TYPE_OPTIONS = FUEL_TYPE_OPTIONS;
  protected readonly STATUS_OPTIONS = STATUS_OPTIONS;
  protected readonly isCreate = computed(() => this.mode() === 'create');
  protected readonly isEdit = computed(() => this.mode() === 'edit');
  private readonly hydrated = signal(false);

  protected readonly form: FormGroup = this.build();

  constructor() {
    effect(() => { const v = this.vehicle(); if (v && this.mode() === 'edit') this.hydrate(v); });
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  private hydrate(v: Vehicle): void {
    if (this.hydrated()) return;
    this.form.patchValue({
      vehicleNumber: v.vehicleNumber, ownerName: v.ownerName ?? '', vehicleType: v.vehicleType,
      make: v.make ?? '', model: v.model ?? '', modelVariant: v.modelVariant ?? '', series: v.series ?? '',
      chassisNumber: v.chassisNumber ?? '', engineNumber: v.engineNumber ?? '', dealerName: v.dealerName ?? '',
      fuelType: v.fuelType ?? null, branchId: v.branchId ?? null,
      capacityKg: v.capacityKg ?? null, currentOdometer: v.currentOdometer ?? null,
      purchaseDate: v.purchaseDate ?? null, registrationDate: v.registrationDate ?? null,
      insuranceExpiry: v.insuranceExpiry ?? null, pucExpiry: v.pucExpiry ?? null,
      fitnessExpiry: v.fitnessExpiry ?? null, permitExpiry: v.permitExpiry ?? null,
      status: v.status, remarks: v.remarks ?? ''
    }, { emitEvent: false });
    this.form.markAsPristine();
    this.hydrated.set(true);
  }

  private build(): FormGroup {
    return this.fb.group({
      vehicleNumber: ['', [Validators.required, Validators.maxLength(30)]],
      ownerName: ['', Validators.maxLength(150)],
      vehicleType: ['OTHER' as VehicleType, Validators.required],
      make: ['', Validators.maxLength(50)],
      model: ['', Validators.maxLength(50)],
      modelVariant: ['', Validators.maxLength(50)],
      series: ['', Validators.maxLength(30)],
      chassisNumber: ['', Validators.maxLength(50)],
      engineNumber: ['', Validators.maxLength(50)],
      dealerName: ['', Validators.maxLength(150)],
      fuelType: [null as FuelType | null],
      branchId: [null as string | null],
      capacityKg: [null as number | null, [Validators.min(0)]],
      currentOdometer: [null as number | null, [Validators.min(0)]],
      purchaseDate: [null as string | null],
      registrationDate: [null as string | null],
      insuranceExpiry: [null as string | null],
      pucExpiry: [null as string | null],
      fitnessExpiry: [null as string | null],
      permitExpiry: [null as string | null],
      status: ['AVAILABLE' as VehicleStatus],
      remarks: ['', Validators.maxLength(500)]
    });
  }

  protected submit(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();

    const shared = {
      vehicleNumber: v.vehicleNumber, ownerName: v.ownerName || null, vehicleType: v.vehicleType,
      make: v.make || null, model: v.model || null, modelVariant: v.modelVariant || null,
      series: v.series || null, chassisNumber: v.chassisNumber || null, engineNumber: v.engineNumber || null,
      dealerName: v.dealerName || null,
      fuelType: v.fuelType || null, capacityKg: v.capacityKg !== null ? Number(v.capacityKg) : null,
      currentOdometer: v.currentOdometer !== null ? Number(v.currentOdometer) : null,
      purchaseDate: v.purchaseDate || null, registrationDate: v.registrationDate || null,
      insuranceExpiry: v.insuranceExpiry || null, pucExpiry: v.pucExpiry || null,
      fitnessExpiry: v.fitnessExpiry || null, permitExpiry: v.permitExpiry || null,
      branchId: v.branchId || null, remarks: v.remarks || null
    };

    if (this.isEdit()) {
      this.saved.emit({ ...shared, status: v.status, version: this.vehicle()!.version });
    } else {
      this.saved.emit(shared);
    }
  }
}
