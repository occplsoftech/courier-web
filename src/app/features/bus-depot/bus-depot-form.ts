import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, of } from 'rxjs';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { BUS_DEPOT_TYPE_LABEL, BusDepot, BusDepotType, SaveBusDepotRequest } from '@core/models/bus-depot.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { MasterDataService } from '@features/masters/master-data.service';
import { BusDepotService } from './bus-depot.service';

const TYPE_OPTS: SelectOption[] = (Object.keys(BUS_DEPOT_TYPE_LABEL) as BusDepotType[])
  .map((v) => ({ value: v, label: BUS_DEPOT_TYPE_LABEL[v] }));

/**
 * Create / edit one MSRTC bus depot or station. "Assigned Branch / Vendor" is optional: any
 * active branch of the company, including Pickup-Delivery Partners (vendors), or none.
 */
@Component({
  selector: 'app-bus-depot-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiInput, UiSelect, UiButton, UiLoader],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">{{ isCreate() ? 'New Bus Depot / Station' : (depot()?.depotName || 'Bus Depot / Station') }}</h1>
          <p class="text-caption">Define the depot or station and, optionally, the branch or vendor that handles it.</p>
        </div>
      </header>

      @if (loading()) {
        <app-loader [minHeight]="240" caption="Loading…" />
      } @else if (!isCreate() && !depot()) {
        <app-card><p class="empty">Depot not found.</p></app-card>
      } @else {
        <app-card title="Depot / Station">
          <div class="grid">
            <app-input [control]="codeCtl" label="Code" [required]="true" placeholder="e.g. PUNE-SWG" [maxLength]="30" />
            <app-input [control]="nameCtl" label="Name" [required]="true" placeholder="e.g. Swargate Bus Station" [maxLength]="150" />
            <app-select [control]="typeCtl" label="Type" [options]="typeOpts" />
            <app-select [control]="divisionCtl" label="Division" [options]="divisionOpts()" [allowEmpty]="true" emptyLabel="No division" placeholder="No division" />
            @if (typeCtl.value === 'BUS_STATION') {
              <app-select [control]="parentCtl" label="Served by Depot" [options]="parentOpts()" [allowEmpty]="true" emptyLabel="Not set" placeholder="Not set" />
            }
            <app-select [control]="branchCtl" label="Assigned Branch / Vendor" [options]="branchOpts()" [allowEmpty]="true"
                        emptyLabel="Not assigned" placeholder="Not assigned" />
          </div>
        </app-card>

        <app-card title="Location &amp; Contact">
          <div class="grid">
            <app-input [control]="addressCtl" label="Address" [maxLength]="255" />
            <app-input [control]="cityCtl" label="City" [maxLength]="100" />
            <app-input [control]="districtCtl" label="District" [maxLength]="100" />
            <app-input [control]="stateCtl" label="State" [maxLength]="100" />
            <app-input [control]="pincodeCtl" label="Pincode" [maxLength]="10" />
            <app-input [control]="personCtl" label="Contact Person" [maxLength]="150" />
            <app-input [control]="mobileCtl" label="Contact Mobile" [maxLength]="20" />
          </div>
        </app-card>

        <div class="bar">
          <app-button variant="stroked" (pressed)="back()">Cancel</app-button>
          <app-button icon="save" [loading]="saving()" (pressed)="save()">{{ isCreate() ? 'Create' : 'Save Changes' }}</app-button>
        </div>
      }
    </div>
  `,
  styles: [`
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:16px; }
    .bar { display:flex; justify-content:flex-end; gap:10px; margin-top:8px; }
    @media (max-width:760px){ .grid { grid-template-columns:1fr; } }
  `]
})
export class BusDepotForm implements OnInit {
  private readonly service = inject(BusDepotService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly depotId = this.route.snapshot.paramMap.get('id');
  protected readonly isCreate = computed(() => !this.depotId);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly depot = signal<BusDepot | null>(null);
  protected readonly branchOpts = signal<SelectOption[]>([]);
  protected readonly divisionOpts = signal<SelectOption[]>([]);
  private readonly allDepots = signal<BusDepot[]>([]);
  /** Depots of the chosen division, for a station's "Served by". */
  protected readonly parentOpts = computed(() => this.allDepots()
    .filter((d) => d.depotType === 'BUS_DEPOT' && d.id !== this.depotId && (d.divisionId ?? '') === this.divisionValue())
    .map((d) => ({ value: d.id, label: d.depotName })));
  private readonly divisionValue = signal('');
  protected readonly typeOpts = TYPE_OPTS;

  protected readonly codeCtl = new FormControl<string>('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(30)] });
  protected readonly nameCtl = new FormControl<string>('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(150)] });
  protected readonly typeCtl = new FormControl<string>('BUS_DEPOT', { nonNullable: true });
  protected readonly divisionCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly parentCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly branchCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly addressCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly cityCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly districtCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly stateCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly pincodeCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly personCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly mobileCtl = new FormControl<string>('', { nonNullable: true });

  ngOnInit(): void {
    this.breadcrumb.set([
      { label: 'MSRTC' }, { label: 'Bus Depot / Station', route: '/msrtc/bus-depots' },
      { label: this.isCreate() ? 'New' : 'Edit' }
    ]);
    this.masters.branchDirectory().pipe(catchError(() => of([]))).subscribe((list) =>
      this.branchOpts.set(list.map((b) => ({
        value: b.id,
        label: `${b.branchName} (${b.branchCode})${b.branchType === 'PICKUP_DELIVERY_PARTNER' ? ' — Vendor' : ''}`
      }))));
    this.service.divisions({ status: 'ACTIVE' }).subscribe((d) => this.divisionOpts.set(d.map((x) => ({ value: x.id, label: x.divisionName }))));
    this.service.list({ type: 'BUS_DEPOT', status: 'ACTIVE' }).subscribe((d) => this.allDepots.set(d ?? []));
    this.divisionCtl.valueChanges.subscribe((v) => { this.divisionValue.set(v); this.parentCtl.setValue(''); });
    if (!this.depotId) { this.loading.set(false); return; }
    this.service.get(this.depotId).subscribe({
      next: (d) => {
        this.depot.set(d);
        this.codeCtl.setValue(d.depotCode); this.nameCtl.setValue(d.depotName);
        this.typeCtl.setValue(d.depotType); this.branchCtl.setValue(d.branchId ?? '');
        this.divisionCtl.setValue(d.divisionId ?? ''); this.parentCtl.setValue(d.parentDepotId ?? '');
        this.addressCtl.setValue(d.address ?? ''); this.cityCtl.setValue(d.city ?? '');
        this.districtCtl.setValue(d.district ?? ''); this.stateCtl.setValue(d.state ?? '');
        this.pincodeCtl.setValue(d.pincode ?? ''); this.personCtl.setValue(d.contactPerson ?? '');
        this.mobileCtl.setValue(d.contactMobile ?? '');
        this.loading.set(false);
      },
      error: () => { this.depot.set(null); this.loading.set(false); }
    });
  }

  protected save(): void {
    this.codeCtl.markAsTouched(); this.nameCtl.markAsTouched();
    if (this.codeCtl.invalid || this.nameCtl.invalid) return;
    const orNull = (v: string) => v.trim() || null;
    const body: SaveBusDepotRequest = {
      depotCode: this.codeCtl.value.trim(), depotName: this.nameCtl.value.trim(),
      depotType: this.typeCtl.value as BusDepotType, branchId: this.branchCtl.value || null,
      divisionId: this.divisionCtl.value || null,
      parentDepotId: this.typeCtl.value === 'BUS_STATION' ? (this.parentCtl.value || null) : null,
      address: orNull(this.addressCtl.value), city: orNull(this.cityCtl.value),
      district: orNull(this.districtCtl.value), state: orNull(this.stateCtl.value),
      pincode: orNull(this.pincodeCtl.value), contactPerson: orNull(this.personCtl.value),
      contactMobile: orNull(this.mobileCtl.value)
    };
    this.saving.set(true);
    const req = this.isCreate()
      ? this.service.create(body)
      : this.service.update(this.depotId!, { ...body, version: this.depot()!.version });
    req.subscribe({
      next: () => { this.saving.set(false); this.notify.success(this.isCreate() ? 'Depot created.' : 'Depot updated.'); this.back(); },
      error: (e: HttpErrorResponse) => { this.saving.set(false); this.notify.error(e.error?.message ?? 'Could not save the depot.'); }
    });
  }

  protected back(): void { this.router.navigate(['/msrtc/bus-depots']); }
}
