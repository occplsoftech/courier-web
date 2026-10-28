import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import {
  APPLIES_LABELS, CALC_LABELS, ChargeAppliesWhen, ChargeCalcMethod, ChargeRequest, ROUNDING_LABELS, RateCard,
  RateLane, RateSlab, SlabRateType, TariffCharge, TariffImportResult, TariffStatus, TotalRounding
} from '@core/models/zone-tariff.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { ZoneTariffService } from './zone-tariff.service';

const ROUNDING_OPTS: SelectOption[] = (Object.keys(ROUNDING_LABELS) as TotalRounding[]).map((r) => ({ value: r, label: ROUNDING_LABELS[r] }));
const APPLIES_OPTS: SelectOption[] = (Object.keys(APPLIES_LABELS) as ChargeAppliesWhen[]).map((a) => ({ value: a, label: APPLIES_LABELS[a] }));
const CALC_OPTS: SelectOption[] = (Object.keys(CALC_LABELS) as ChargeCalcMethod[]).map((m) => ({ value: m, label: CALC_LABELS[m] }));
const SLAB_TYPE_OPTS: SelectOption[] = [{ value: 'FIXED', label: 'Fixed' }, { value: 'PER_EXTRA_KG', label: 'Per extra kg' }];
const STATUS_OPTS: SelectOption[] = [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }];

type SlabGroup = FormGroup<{
  weightFromKg: FormControl<number | null>; weightToKg: FormControl<number | null>;
  rateType: FormControl<string>; rate: FormControl<number | null>; stepKg: FormControl<number | null>;
}>;

/** The rows of the sheet's usual lane: up to 250 g, 500 g and 1 kg fixed, then per extra kg. */
function defaultSlabs(): RateSlab[] {
  return [
    { weightFromKg: 0.001, weightToKg: 0.25, rateType: 'FIXED', rate: 0, stepKg: null },
    { weightFromKg: 0.251, weightToKg: 0.5, rateType: 'FIXED', rate: 0, stepKg: null },
    { weightFromKg: 0.501, weightToKg: 1, rateType: 'FIXED', rate: 0, stepKg: null },
    { weightFromKg: 1.001, weightToKg: 99, rateType: 'PER_EXTRA_KG', rate: 0, stepKg: 1 }
  ];
}

/**
 * One rate card: its header (from zone, dates, GST, rounding), its lanes — every weight slab of one to zone × service
 * type × package type, saved together — and its charges. A new card is created inactive; activate it once it has rates.
 *
 * Freight: the first slab whose upper weight reaches the shipment's weight. Fixed is its rate. Per extra kg is the
 * fixed slab before it plus the rate for each extra kg (or part of one) above that slab.
 */
@Component({
  selector: 'app-rate-card-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiInput, UiSelect, UiButton, UiLoader, StatusBadge, MatIconModule],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">{{ isCreate() ? 'New Rate Card' : (card()?.code || 'Rate Card') }}</h1>
          <p class="text-caption">{{ isCreate() ? 'Prices for shipments that start in one from zone.' : card()?.name }}</p>
        </div>
        @if (card(); as c) {
          <div class="page__actions">
            <app-status-badge [value]="c.status" [label]="c.status === 'ACTIVE' ? 'Active' : 'Inactive'" />
            @if (canUpdate()) {
              <app-button variant="stroked" [icon]="c.status === 'ACTIVE' ? 'block' : 'check_circle'" (pressed)="toggle()">
                {{ c.status === 'ACTIVE' ? 'Deactivate' : 'Activate' }}</app-button>
            }
            @if (canDelete()) { <app-button variant="stroked" icon="delete" (pressed)="remove()">Delete</app-button> }
          </div>
        }
      </header>

      @if (loading()) {
        <app-loader [minHeight]="240" caption="Loading…" />
      } @else if (!isCreate() && !card()) {
        <app-card><p class="empty">Rate card not found.</p></app-card>
      } @else {
        <app-card title="Rate card" subtitle="Only one active card per from zone may cover a date. GST is CGST + SGST within a state, IGST across states.">
          <div class="grid">
            <app-input [control]="head.controls.code" label="Code" [required]="true" placeholder="e.g. PUNE_CASH_2025" [maxLength]="30" />
            <app-input [control]="head.controls.name" label="Name" [required]="true" placeholder="e.g. Pune cash booking" [maxLength]="100" />
            <app-select [control]="head.controls.fromZoneId" label="From zone" [options]="fromZoneOpts()" placeholder="Select a from zone" />
            <app-input [control]="head.controls.effectiveFrom" label="Valid from" type="date" [required]="true" />
            <app-input [control]="head.controls.effectiveTo" label="Valid to (empty = open)" type="date" />
            <app-input [control]="head.controls.gstPercent" label="GST %" type="number" [min]="0" [max]="100" [step]="0.5" />
            <app-input [control]="head.controls.volumetricDivisor" label="Volumetric divisor (empty = actual weight only)" type="number" [min]="1" placeholder="e.g. 5000" />
            <app-select [control]="head.controls.totalRounding" label="Round the total" [options]="roundingOpts" />
            <app-input [control]="head.controls.description" label="Description" placeholder="Optional" [maxLength]="255" />
          </div>
          @if (canWriteHead()) {
            <div class="bar"><app-button icon="save" [loading]="saving()" (pressed)="saveHead()">{{ isCreate() ? 'Create Rate Card' : 'Save Card' }}</app-button></div>
          }
        </app-card>

        @if (card(); as c) {
          <app-card title="Rates" [subtitle]="c.laneCount + ' lane(s). A lane is every weight slab of one to zone, service type and package type.'">
            @if (c.lanes.length === 0) {
              <p class="empty">No rates yet. Add the first lane below.</p>
            } @else {
              <table class="tbl">
                <thead><tr><th>To zone</th><th>Service</th><th>Package</th><th>Slabs</th><th></th></tr></thead>
                <tbody>
                  @for (l of c.lanes; track laneKey(l)) {
                    <tr [class.sel]="editingLane() === laneKey(l)">
                      <td>{{ l.toZoneCode }}</td><td>{{ l.serviceTypeCode }}</td><td>{{ l.packageTypeCode }}</td>
                      <td class="slabs">{{ slabSummary(l) }}</td>
                      <td class="act">
                        <button type="button" class="ico" aria-label="Edit lane" (click)="editLane(l)"><mat-icon>edit</mat-icon></button>
                        @if (canUpdate()) { <button type="button" class="ico" aria-label="Remove lane" (click)="removeLane(l)"><mat-icon>delete</mat-icon></button> }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }

            @if (canUpdate()) {
              <div class="editor">
                <h3 class="text-h3">{{ editingLane() ? 'Edit lane' : 'Add a lane' }}</h3>
                <div class="grid grid--3">
                  <app-select [control]="laneTo" label="To zone" [options]="toZoneOpts()" placeholder="Select a to zone" />
                  <app-select [control]="laneService" label="Service type" [options]="serviceOpts()" placeholder="Select" />
                  <app-select [control]="lanePackage" label="Package type" [options]="packageOpts()" placeholder="Select" />
                </div>
                <div class="slab slab--head"><span>From kg</span><span>To kg</span><span>Type</span><span>Rate</span><span>Step kg</span><span></span></div>
                @for (g of slabs.controls; track g; let i = $index) {
                  <div class="slab">
                    <app-input [control]="g.controls.weightFromKg" type="number" [min]="0" [step]="0.001" />
                    <app-input [control]="g.controls.weightToKg" type="number" [min]="0" [step]="0.001" />
                    <app-select [control]="g.controls.rateType" [options]="slabTypeOpts" />
                    <app-input [control]="g.controls.rate" type="number" [min]="0" [step]="1" />
                    @if (g.controls.rateType.value === 'PER_EXTRA_KG') {
                      <app-input [control]="g.controls.stepKg" type="number" [min]="0.001" [step]="0.5" placeholder="1" />
                    } @else { <span class="muted">—</span> }
                    <button type="button" class="ico" aria-label="Remove slab" [disabled]="slabs.length === 1" (click)="slabs.removeAt(i)"><mat-icon>close</mat-icon></button>
                  </div>
                }
                <p class="hint">Fixed: the rate is the freight. Per extra kg: the fixed slab before it, plus the rate for each step (1 kg) or part of one above it.</p>
                <div class="bar">
                  <app-button variant="stroked" icon="add" (pressed)="addSlab()">Add slab</app-button>
                  @if (editingLane()) { <app-button variant="stroked" (pressed)="resetLane()">Cancel</app-button> }
                  <app-button icon="save" [loading]="savingLane()" [disabled]="!laneTo.value || !laneService.value || !lanePackage.value" (pressed)="saveLane()">Save lane</app-button>
                </div>
              </div>
            }
          </app-card>

          @if (canUpdate()) {
            <app-card title="Import from Excel" subtitle="The cash-booking sheet: From zone, To zone, State, City, Mode, Product, Applicable From, Weight From, Weight To, Rate, Rate Type. Preview first; the import is all or nothing and replaces only the lanes in the sheet.">
              <div class="imp">
                <input #fileInput type="file" accept=".xlsx,.xls" (change)="pickFile($event)" hidden />
                <app-button variant="stroked" icon="upload_file" (pressed)="fileInput.click()">{{ importFile() ? importFile()!.name : 'Choose file' }}</app-button>
                <app-button variant="stroked" icon="preview" [disabled]="!importFile()" [loading]="previewing()" (pressed)="previewImport()">Preview</app-button>
                @if (importPreview(); as p) {
                  <app-button icon="file_download_done" [disabled]="p.errors.length > 0 || p.lanes.length === 0" [loading]="importing()" (pressed)="runImport()">Import {{ p.lanes.length }} lane(s)</app-button>
                }
              </div>
              @if (importPreview(); as p) {
                <p class="imp__sum">{{ p.rowsRead }} rows read · {{ p.duplicateRows }} repeated · {{ p.skippedRows }} skipped · <strong>{{ p.lanes.length }} lanes</strong>
                  ({{ newLanes(p) }} new, {{ p.lanes.length - newLanes(p) }} replace existing)@if (p.errors.length) { · <span class="bad">{{ p.errors.length }} problem(s) to fix</span> }</p>
                @for (w of p.warnings; track $index) { <p class="imp__warn"><mat-icon>info</mat-icon> {{ w.message }}</p> }
                @if (p.errors.length) {
                  <table class="tbl">
                    <thead><tr><th>Row</th><th>Problem</th></tr></thead>
                    <tbody>@for (e of p.errors; track $index) { <tr><td>{{ e.row ?? '—' }}</td><td class="bad">{{ e.message }}</td></tr> }</tbody>
                  </table>
                }
                <table class="tbl">
                  <thead><tr><th>To zone</th><th>Service</th><th>Package</th><th>Slabs</th><th></th></tr></thead>
                  <tbody>
                    @for (l of p.lanes; track l.toZoneId + l.serviceTypeId + l.packageTypeId) {
                      <tr><td>{{ l.toZoneCode }}</td><td>{{ l.serviceTypeCode }}</td><td>{{ l.packageTypeCode }}</td><td class="slabs">{{ l.summary }}</td>
                        <td>{{ l.replaces ? 'Replaces' : 'New' }}</td></tr>
                    }
                  </tbody>
                </table>
              }
            </app-card>
          }

          <app-card title="Charges" subtitle="Added on top of freight. Per charge code the most specific rule wins: one for a to zone beats one for a service type, which beats one for all.">
            @if (c.charges.length === 0) {
              <p class="empty">No charges yet — fuel, hamali, docket, COD, FOV, ODA…</p>
            } @else {
              <table class="tbl">
                <thead><tr><th>Code</th><th>Name</th><th>Applies to</th><th>When</th><th>How</th><th>Min / Max</th><th>GST</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  @for (ch of c.charges; track ch.id) {
                    <tr [class.sel]="editingCharge() === ch.id">
                      <td>{{ ch.code }}</td><td>{{ ch.name }}</td><td>{{ chargeScope(ch) }}</td><td>{{ appliesLabel(ch.appliesWhen) }}</td>
                      <td>{{ chargeHow(ch) }}</td>
                      <td>{{ ch.minAmount ?? '—' }} / {{ ch.maxAmount ?? '—' }}</td>
                      <td>{{ ch.taxable ? 'Yes' : 'No' }}</td>
                      <td><app-status-badge [value]="ch.status" [label]="ch.status === 'ACTIVE' ? 'Active' : 'Inactive'" /></td>
                      <td class="act">
                        <button type="button" class="ico" aria-label="Edit charge" (click)="editCharge(ch)"><mat-icon>edit</mat-icon></button>
                        @if (canUpdate()) { <button type="button" class="ico" aria-label="Remove charge" (click)="removeCharge(ch)"><mat-icon>delete</mat-icon></button> }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }

            @if (canUpdate()) {
              <div class="editor">
                <h3 class="text-h3">{{ editingCharge() ? 'Edit charge' : 'Add a charge' }}</h3>
                <div class="grid grid--3">
                  <app-input [control]="charge.controls.code" label="Code" placeholder="FUEL, HAMALI, DOCKET…" [maxLength]="30" />
                  <app-input [control]="charge.controls.name" label="Name (printed)" placeholder="Fuel surcharge" [maxLength]="100" />
                  <app-select [control]="charge.controls.calcMethod" label="Worked out as" [options]="calcOpts" />
                  <app-input [control]="charge.controls.value" [label]="valueLabel()" type="number" [min]="0" [step]="0.5" />
                  <app-input [control]="charge.controls.minAmount" label="Minimum (optional)" type="number" [min]="0" />
                  <app-input [control]="charge.controls.maxAmount" label="Maximum (optional)" type="number" [min]="0" />
                  <app-select [control]="charge.controls.appliesWhen" label="Applies" [options]="appliesOpts" />
                  <app-select [control]="charge.controls.toZoneId" label="Only to zone" [options]="toZoneOpts()" [allowEmpty]="true" emptyLabel="All zones" placeholder="All zones" />
                  <app-select [control]="charge.controls.serviceTypeId" label="Only service type" [options]="serviceOpts()" [allowEmpty]="true" emptyLabel="All" placeholder="All" />
                  <app-select [control]="charge.controls.packageTypeId" label="Only package type" [options]="packageOpts()" [allowEmpty]="true" emptyLabel="All" placeholder="All" />
                  <app-input [control]="charge.controls.displayOrder" label="Print order" type="number" [min]="0" />
                  <app-select [control]="charge.controls.status" label="Status" [options]="statusOpts" />
                </div>
                <label class="chk"><input type="checkbox" [checked]="charge.controls.taxable.value" (change)="charge.controls.taxable.setValue(!charge.controls.taxable.value)" /> GST is charged on this charge</label>
                <div class="bar">
                  @if (editingCharge()) { <app-button variant="stroked" (pressed)="resetCharge()">Cancel</app-button> }
                  <app-button icon="save" [loading]="savingCharge()" (pressed)="saveCharge()">{{ editingCharge() ? 'Save charge' : 'Add charge' }}</app-button>
                </div>
              </div>
            }
          </app-card>
        }

        <div class="bar"><app-button variant="stroked" (pressed)="back()">Back</app-button></div>
      }
    </div>
  `,
  styles: [`
    .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px 20px; align-items:end; }
    .grid--3 { margin-bottom:12px; }
    .bar { display:flex; justify-content:flex-end; gap:10px; margin-top:12px; }
    .empty { font:400 14px var(--font-sans); color:var(--content-muted); text-align:center; padding:16px; }
    .tbl { width:100%; border-collapse:collapse; font:400 13px var(--font-sans); margin-bottom:16px; }
    .tbl th { text-align:left; font-weight:600; color:var(--content-muted); padding:8px; border-bottom:1px solid var(--surface-border); }
    .tbl td { padding:8px; border-bottom:1px solid var(--surface-border); vertical-align:middle; }
    .tbl tr.sel td { background:var(--surface-muted); }
    .tbl .slabs { color:var(--content-muted); }
    .act { text-align:right; white-space:nowrap; }
    .ico { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .ico:hover:not([disabled]) { background:var(--surface-muted); color:var(--content-fg); }
    .ico[disabled] { opacity:.4; cursor:default; }
    .editor { border-top:1px solid var(--surface-border); padding-top:16px; }
    .editor h3 { margin:0 0 12px; }
    .slab { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)) minmax(0,1.2fr) minmax(0,1fr) minmax(0,0.8fr) 32px; gap:10px; align-items:center; margin-bottom:8px; }
    .slab--head { font:600 12px var(--font-sans); color:var(--content-muted); }
    .muted { color:var(--content-muted); text-align:center; }
    .hint { font:400 12px var(--font-sans); color:var(--content-muted); margin:4px 0 0; }
    .imp { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    .imp__sum { font:400 14px var(--font-sans); margin:12px 0 8px; }
    .imp__warn { display:flex; align-items:center; gap:6px; font:400 13px var(--font-sans); color:var(--content-muted); margin:4px 0; }
    .imp__warn mat-icon { font-size:18px; width:18px; height:18px; }
    .bad { color:var(--danger); }
    .chk { display:flex; align-items:center; gap:8px; font:400 14px var(--font-sans); margin-top:8px; }
    @media (max-width:900px){ .grid { grid-template-columns:1fr; } .slab { grid-template-columns:1fr 1fr; } }
  `]
})
export class RateCardForm implements OnInit {
  private readonly service = inject(ZoneTariffService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly confirm = inject(DialogService);

  private readonly cardId = this.route.snapshot.paramMap.get('id');
  protected readonly isCreate = computed(() => !this.cardId);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly savingLane = signal(false);
  protected readonly savingCharge = signal(false);
  protected readonly card = signal<RateCard | null>(null);
  protected readonly editingLane = signal<string | null>(null);
  protected readonly editingCharge = signal<string | null>(null);

  protected readonly fromZoneOpts = signal<SelectOption[]>([]);
  protected readonly toZoneOpts = signal<SelectOption[]>([]);
  protected readonly serviceOpts = signal<SelectOption[]>([]);
  protected readonly packageOpts = signal<SelectOption[]>([]);
  protected readonly roundingOpts = ROUNDING_OPTS;
  protected readonly appliesOpts = APPLIES_OPTS;
  protected readonly calcOpts = CALC_OPTS;
  protected readonly slabTypeOpts = SLAB_TYPE_OPTS;
  protected readonly statusOpts = STATUS_OPTS;

  protected readonly head = new FormGroup({
    code: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(30)] }),
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    fromZoneId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    effectiveFrom: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    effectiveTo: new FormControl('', { nonNullable: true }),
    gstPercent: new FormControl<number | null>(18),
    volumetricDivisor: new FormControl<number | null>(null),
    totalRounding: new FormControl<string>('NEAREST_RUPEE', { nonNullable: true }),
    description: new FormControl('', { nonNullable: true })
  });

  protected readonly laneTo = new FormControl<string>('', { nonNullable: true });
  protected readonly laneService = new FormControl<string>('', { nonNullable: true });
  protected readonly lanePackage = new FormControl<string>('', { nonNullable: true });
  protected readonly slabs = new FormArray<SlabGroup>([]);

  protected readonly charge = new FormGroup({
    code: new FormControl('', { nonNullable: true }),
    name: new FormControl('', { nonNullable: true }),
    calcMethod: new FormControl<string>('PERCENT_OF_FREIGHT', { nonNullable: true }),
    value: new FormControl<number | null>(null),
    minAmount: new FormControl<number | null>(null),
    maxAmount: new FormControl<number | null>(null),
    appliesWhen: new FormControl<string>('ALWAYS', { nonNullable: true }),
    toZoneId: new FormControl<string>('', { nonNullable: true }),
    serviceTypeId: new FormControl<string>('', { nonNullable: true }),
    packageTypeId: new FormControl<string>('', { nonNullable: true }),
    displayOrder: new FormControl<number | null>(0),
    status: new FormControl<string>('ACTIVE', { nonNullable: true }),
    taxable: new FormControl<boolean>(true, { nonNullable: true })
  });
  private readonly calcTick = signal('PERCENT_OF_FREIGHT');
  protected readonly importFile = signal<File | null>(null);
  protected readonly importPreview = signal<TariffImportResult | null>(null);
  protected readonly previewing = signal(false);
  protected readonly importing = signal(false);

  protected readonly canCreate = computed(() => this.perms.canAccess({ roles: [AppRole.COMPANY_ADMIN], permissions: ['TARIFF_CREATE'] }));
  protected readonly canUpdate = computed(() => this.perms.canAccess({ roles: [AppRole.COMPANY_ADMIN], permissions: ['TARIFF_UPDATE'] }));
  protected readonly canDelete = computed(() => this.perms.canAccess({ roles: [AppRole.COMPANY_ADMIN], permissions: ['TARIFF_DELETE'] }));
  protected readonly canWriteHead = computed(() => this.isCreate() ? this.canCreate() : this.canUpdate());

  protected readonly valueLabel = computed(() => {
    switch (this.calcTick() as ChargeCalcMethod) {
      case 'FLAT': return 'Amount';
      case 'PERCENT_OF_FREIGHT': return '% of freight';
      case 'PER_KG': return 'Amount per kg';
      case 'PER_PIECE': return 'Amount per piece';
      case 'PERCENT_OF_VALUE': return '% of declared value';
    }
  });

  ngOnInit(): void {
    this.breadcrumb.set([
      { label: 'Zone Tariff' }, { label: 'Rate Cards', route: '/zone-tariff/rate-cards' }, { label: this.isCreate() ? 'New' : 'Rates' }
    ]);
    this.service.zones().subscribe((zs) => {
      const opt = (z: { id: string; code: string; name: string }) => ({ value: z.id, label: `${z.code} — ${z.name}` });
      this.fromZoneOpts.set(zs.filter((z) => z.usage !== 'TO').map(opt));
      this.toZoneOpts.set(zs.filter((z) => z.usage !== 'FROM').map(opt));
    });
    this.masters.options('service-types').subscribe((o) => this.serviceOpts.set(o));
    this.masters.options('package-types').subscribe((o) => this.packageOpts.set(o));
    this.charge.controls.calcMethod.valueChanges.subscribe((v) => this.calcTick.set(v));
    this.resetLane();
    if (this.isCreate()) {
      this.head.controls.effectiveFrom.setValue(new Date().toISOString().slice(0, 10));
      this.loading.set(false);
    } else {
      this.service.card(this.cardId!).subscribe({
        next: (c) => { this.setCard(c, true); this.loading.set(false); },
        error: () => { this.card.set(null); this.loading.set(false); }
      });
    }
    if (!this.canWriteHead()) this.head.disable();
  }

  private setCard(c: RateCard, fillHead = false): void {
    this.card.set(c);
    if (fillHead) {
      // The API leaves empty fields out of its JSON, so every optional one needs its own default here.
      this.head.setValue({
        code: c.code, name: c.name, fromZoneId: c.fromZoneId, effectiveFrom: c.effectiveFrom, effectiveTo: c.effectiveTo ?? '',
        gstPercent: c.gstPercent ?? null, volumetricDivisor: c.volumetricDivisor ?? null,
        totalRounding: c.totalRounding ?? 'NEAREST_RUPEE', description: c.description ?? ''
      });
    }
  }

  // ---------------------------------------------------------------- header

  protected saveHead(): void {
    this.head.markAllAsTouched();
    if (this.head.invalid) { this.notify.error('Fill in the code, name, from zone and start date.'); return; }
    const v = this.head.getRawValue();
    const body = {
      code: v.code.trim(), name: v.name.trim(), fromZoneId: v.fromZoneId, effectiveFrom: v.effectiveFrom,
      effectiveTo: v.effectiveTo || null, gstPercent: v.gstPercent, volumetricDivisor: v.volumetricDivisor || null,
      totalRounding: v.totalRounding as TotalRounding, description: v.description.trim() || null,
      version: this.card()?.version ?? null
    };
    this.saving.set(true);
    const fail = (e: HttpErrorResponse) => { this.saving.set(false); this.notify.error(e.error?.message ?? 'Could not save the rate card.'); };
    if (this.isCreate()) {
      this.service.createCard(body).subscribe({
        next: (c) => { this.saving.set(false); this.notify.success('Rate card created. Add its rates, then activate it.'); this.router.navigate(['/zone-tariff/rate-cards', c.id]); },
        error: fail
      });
    } else {
      this.service.updateCard(this.cardId!, body).subscribe({
        next: (c) => { this.saving.set(false); this.setCard(c); this.notify.success('Rate card saved.'); },
        error: fail
      });
    }
  }

  protected toggle(): void {
    const c = this.card()!;
    const call = c.status === 'ACTIVE' ? this.service.deactivateCard(c.id) : this.service.activateCard(c.id);
    call.subscribe({
      next: (n) => { this.setCard(n); this.notify.success(n.status === 'ACTIVE' ? 'Rate card activated.' : 'Rate card deactivated.'); },
      error: (e: HttpErrorResponse) => this.notify.error(e.error?.message ?? 'Could not change the status.')
    });
  }

  protected remove(): void {
    const c = this.card()!;
    this.confirm.confirm({
      title: 'Delete rate card?', message: `"${c.code}" with all its rates and charges will be removed.`, confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.deleteCard(c.id).subscribe({
        next: () => { this.notify.success('Rate card deleted.'); this.back(); },
        error: (e: HttpErrorResponse) => this.notify.error(e.error?.message ?? 'Could not delete the rate card.')
      });
    });
  }

  // ----------------------------------------------------------------- lanes

  protected laneKey(l: RateLane): string { return `${l.toZoneId}:${l.serviceTypeId}:${l.packageTypeId}`; }

  protected slabSummary(l: RateLane): string {
    const n = (x: number) => String(Number(x));
    return l.slabs.map((s) => s.rateType === 'FIXED'
      ? `≤${n(s.weightToKg)} kg ${n(s.rate)}`
      : `+${n(s.rate)}/${s.stepKg && Number(s.stepKg) !== 1 ? n(s.stepKg) + ' kg' : 'kg'} to ${n(s.weightToKg)} kg`).join(' · ');
  }

  private slabGroup(s: RateSlab): SlabGroup {
    return new FormGroup({
      weightFromKg: new FormControl<number | null>(s.weightFromKg),
      weightToKg: new FormControl<number | null>(s.weightToKg),
      rateType: new FormControl<string>(s.rateType, { nonNullable: true }),
      rate: new FormControl<number | null>(s.rate),
      stepKg: new FormControl<number | null>(s.stepKg)
    });
  }

  protected addSlab(): void {
    const last = this.slabs.at(this.slabs.length - 1)?.getRawValue();
    const from = last?.weightToKg != null ? Math.round((Number(last.weightToKg) + 0.001) * 1000) / 1000 : 0.001;
    this.slabs.push(this.slabGroup({ weightFromKg: from, weightToKg: from + 1, rateType: 'PER_EXTRA_KG', rate: 0, stepKg: 1 }));
  }

  protected editLane(l: RateLane): void {
    this.editingLane.set(this.laneKey(l));
    this.laneTo.setValue(l.toZoneId); this.laneService.setValue(l.serviceTypeId); this.lanePackage.setValue(l.packageTypeId);
    this.slabs.clear();
    l.slabs.forEach((s) => this.slabs.push(this.slabGroup(s)));
  }

  protected resetLane(): void {
    this.editingLane.set(null);
    this.laneTo.setValue(''); this.laneService.setValue(''); this.lanePackage.setValue('');
    this.slabs.clear();
    defaultSlabs().forEach((s) => this.slabs.push(this.slabGroup(s)));
  }

  protected saveLane(): void {
    const slabs = this.slabs.getRawValue().map((s) => ({
      weightFromKg: Number(s.weightFromKg), weightToKg: Number(s.weightToKg), rateType: s.rateType as SlabRateType,
      rate: Number(s.rate ?? 0), stepKg: s.rateType === 'PER_EXTRA_KG' ? (s.stepKg ? Number(s.stepKg) : 1) : null
    }));
    if (slabs.some((s) => isNaN(s.weightFromKg) || isNaN(s.weightToKg))) { this.notify.error('Every slab needs a from and to weight.'); return; }
    this.savingLane.set(true);
    this.service.saveLane(this.cardId!, {
      toZoneId: this.laneTo.value, serviceTypeId: this.laneService.value, packageTypeId: this.lanePackage.value, slabs
    }).subscribe({
      next: (c) => { this.savingLane.set(false); this.setCard(c); this.resetLane(); this.notify.success('Rates saved.'); },
      error: (e: HttpErrorResponse) => { this.savingLane.set(false); this.notify.error(e.error?.message ?? 'Could not save the rates.'); }
    });
  }

  protected removeLane(l: RateLane): void {
    this.confirm.confirm({
      title: 'Remove these rates?', message: `${l.toZoneCode} · ${l.serviceTypeCode} · ${l.packageTypeCode} — all its slabs.`,
      confirmLabel: 'Remove', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.deleteLane(this.cardId!, l).subscribe({
        next: (c) => { this.setCard(c); if (this.editingLane() === this.laneKey(l)) this.resetLane(); this.notify.success('Rates removed.'); },
        error: (e: HttpErrorResponse) => this.notify.error(e.error?.message ?? 'Could not remove the rates.')
      });
    });
  }

  // --------------------------------------------------------------- charges

  protected appliesLabel(a: ChargeAppliesWhen): string { return APPLIES_LABELS[a]; }

  protected chargeScope(c: TariffCharge): string {
    const parts = [c.toZoneCode, c.serviceTypeCode, c.packageTypeCode].filter((p) => !!p);
    return parts.length ? parts.join(' · ') : 'All';
  }

  protected chargeHow(c: TariffCharge): string {
    const v = Number(c.value);
    switch (c.calcMethod) {
      case 'FLAT': return `₹${v}`;
      case 'PERCENT_OF_FREIGHT': return `${v}% of freight`;
      case 'PER_KG': return `₹${v} per kg`;
      case 'PER_PIECE': return `₹${v} per piece`;
      case 'PERCENT_OF_VALUE': return `${v}% of value`;
    }
  }

  protected editCharge(c: TariffCharge): void {
    this.editingCharge.set(c.id);
    this.charge.setValue({
      code: c.code, name: c.name, calcMethod: c.calcMethod, value: c.value, minAmount: c.minAmount ?? null, maxAmount: c.maxAmount ?? null,
      appliesWhen: c.appliesWhen ?? 'ALWAYS', toZoneId: c.toZoneId ?? '', serviceTypeId: c.serviceTypeId ?? '', packageTypeId: c.packageTypeId ?? '',
      displayOrder: c.displayOrder ?? 0, status: c.status ?? 'ACTIVE', taxable: c.taxable ?? true
    });
  }

  protected resetCharge(): void {
    this.editingCharge.set(null);
    this.charge.reset({
      code: '', name: '', calcMethod: 'PERCENT_OF_FREIGHT', value: null, minAmount: null, maxAmount: null, appliesWhen: 'ALWAYS',
      toZoneId: '', serviceTypeId: '', packageTypeId: '', displayOrder: 0, status: 'ACTIVE', taxable: true
    });
  }

  protected saveCharge(): void {
    const v = this.charge.getRawValue();
    if (!v.code.trim() || !v.name.trim() || v.value == null) { this.notify.error('A charge needs a code, a name and a value.'); return; }
    const body: ChargeRequest = {
      code: v.code.trim(), name: v.name.trim(), toZoneId: v.toZoneId || null, serviceTypeId: v.serviceTypeId || null,
      packageTypeId: v.packageTypeId || null, appliesWhen: v.appliesWhen as ChargeAppliesWhen, calcMethod: v.calcMethod as ChargeCalcMethod,
      value: Number(v.value), minAmount: v.minAmount ?? null, maxAmount: v.maxAmount ?? null, taxable: v.taxable,
      displayOrder: v.displayOrder ?? 0, status: v.status as TariffStatus
    };
    const id = this.editingCharge();
    this.savingCharge.set(true);
    (id ? this.service.updateCharge(this.cardId!, id, body) : this.service.addCharge(this.cardId!, body)).subscribe({
      next: (c) => { this.savingCharge.set(false); this.setCard(c); this.resetCharge(); this.notify.success(id ? 'Charge saved.' : 'Charge added.'); },
      error: (e: HttpErrorResponse) => { this.savingCharge.set(false); this.notify.error(e.error?.message ?? 'Could not save the charge.'); }
    });
  }

  protected removeCharge(c: TariffCharge): void {
    this.confirm.confirm({ title: 'Remove charge?', message: `${c.code} — ${c.name}.`, confirmLabel: 'Remove', danger: true }).subscribe((ok) => {
      if (!ok) return;
      this.service.deleteCharge(this.cardId!, c.id).subscribe({
        next: (n) => { this.setCard(n); if (this.editingCharge() === c.id) this.resetCharge(); this.notify.success('Charge removed.'); },
        error: (e: HttpErrorResponse) => this.notify.error(e.error?.message ?? 'Could not remove the charge.')
      });
    });
  }

  // ---------------------------------------------------------------- import

  protected newLanes(p: TariffImportResult): number { return p.lanes.filter((l) => !l.replaces).length; }

  protected pickFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.importFile.set(input.files?.[0] ?? null);
    this.importPreview.set(null);
    input.value = '';
  }

  protected previewImport(): void {
    const file = this.importFile();
    if (!file) return;
    this.previewing.set(true);
    this.service.previewImport(this.cardId!, file).subscribe({
      next: (p) => { this.previewing.set(false); this.importPreview.set(p); },
      error: (e: HttpErrorResponse) => { this.previewing.set(false); this.importPreview.set(null); this.notify.error(e.error?.message ?? 'Could not read the sheet.'); }
    });
  }

  protected runImport(): void {
    const file = this.importFile();
    if (!file) return;
    this.importing.set(true);
    this.service.importSheet(this.cardId!, file).subscribe({
      next: (r) => {
        this.importing.set(false); this.importPreview.set(null); this.importFile.set(null);
        this.notify.success(`Imported ${r.lanes.length} lane(s).`);
        this.service.card(this.cardId!).subscribe((c) => this.setCard(c));
      },
      error: (e: HttpErrorResponse) => { this.importing.set(false); this.notify.error(e.error?.message ?? 'Could not import the sheet.'); }
    });
  }

  protected back(): void { this.router.navigate(['/zone-tariff/rate-cards']); }
}
