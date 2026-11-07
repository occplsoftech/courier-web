import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { CustomerRate, PricingZone, RateSlab, SaveRateRequest, SlabMode } from '@core/models/pricing-zone.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { BusinessCustomerService } from './business-customer.service';

/**
 * Slabs run from above their min up to and including their max: sorted by min, starting at 0, no overlap and no gap, only the last
 * may be open-ended. A weight in no slab cannot be priced, so the customer would silently get the company's rates.
 */
function slabsValid(array: AbstractControl): ValidationErrors | null {
  const rows = (array as FormArray).controls.map((g) => ({
    min: Number(g.get('minWeight')!.value), maxRaw: g.get('maxWeight')!.value as string | number | null
  })).sort((a, b) => a.min - b.min);
  if (rows.length && rows[0].min !== 0) return { start: `The first slab must start at 0 kg (it starts at ${rows[0].min} kg, so lighter parcels have no rate).` };
  for (let i = 0; i < rows.length; i++) {
    const max = rows[i].maxRaw === null || rows[i].maxRaw === '' ? null : Number(rows[i].maxRaw);
    if (max !== null && max <= rows[i].min) return { range: `Slab ${i + 1}: maximum must be above its minimum.` };
    if (max === null && i < rows.length - 1) return { open: 'Only the last slab may have no maximum.' };
    if (i > 0) {
      const prev = rows[i - 1].maxRaw === null || rows[i - 1].maxRaw === '' ? null : Number(rows[i - 1].maxRaw);
      if (prev !== null && rows[i].min < prev) return { overlap: `Slabs overlap at ${rows[i].min} kg.` };
      if (prev !== null && rows[i].min > prev) return { gap: `Gap between slab ${i} (ends at ${prev} kg) and slab ${i + 1} (starts at ${rows[i].min} kg): weights in between have no rate.` };
    }
  }
  return null;
}

export interface FreightPreview { freight: number; minApplied: boolean; parts: string[]; }

/**
 * The freight a card would charge for a weight, as the backend prices it: chargeable = max(weight, min chargeable weight); WHOLE =
 * the slab the weight falls in prices every kg (or its flat price); TIERED = each slab prices only its own kilos (a fixed slab adds its
 * flat price once entered); then the minimum freight. Null when no slab covers the weight.
 */
export function previewFreight(slabs: RateSlab[], weight: number, mode: SlabMode, minFreight: number, minChargeable: number): FreightPreview | null {
  const w = Math.max(weight, minChargeable || 0);
  const sorted = [...slabs].sort((a, b) => a.minWeight - b.minWeight);
  const covers = (s: RateSlab) => (w > s.minWeight || (s.minWeight === 0 && w >= 0)) && (s.maxWeight === null || s.maxWeight === undefined || w <= s.maxWeight);
  const slab = sorted.find(covers);
  if (!slab || !(w > 0)) return null;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const parts: string[] = [];
  let freight = 0;
  if (mode === 'TIERED') {
    for (const s of sorted) {
      if (w <= s.minWeight && s.minWeight > 0) break;
      const top = s.maxWeight === null || s.maxWeight === undefined ? w : Math.min(w, s.maxWeight);
      const kilos = r2(top - s.minWeight);
      if (kilos <= 0) continue;
      const amt = s.fixedRate ? s.ratePerKg : kilos * s.ratePerKg;
      freight += amt;
      parts.push(s.fixedRate ? `${s.minWeight}–${s.maxWeight ?? '∞'} kg fixed ₹${s.ratePerKg}` : `${kilos} kg × ₹${s.ratePerKg}`);
    }
  } else {
    freight = slab.fixedRate ? slab.ratePerKg : w * slab.ratePerKg;
    parts.push(slab.fixedRate ? `fixed ₹${slab.ratePerKg}` : `${w} kg × ₹${slab.ratePerKg}`);
  }
  freight = r2(freight);
  const minApplied = (minFreight || 0) > freight;
  return { freight: minApplied ? r2(minFreight) : freight, minApplied, parts };
}

/**
 * Rate card of one pricing zone: header charges (min chargeable weight, docket, mathadi,
 * pack, ODA, fuel %, FOV %) plus per-kg weight slabs. Saved as one full replacement.
 * Includes a quote tester that prices a sample shipment from what is currently saved.
 */
@Component({
  selector: 'app-customer-rate-edit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiInput, UiButton, UiLoader, StatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">{{ zone()?.zoneName || 'Rate' }}</h1>
          <p class="text-caption">{{ zone()?.customerName }} — slab rates and charges for this zone, {{ typeLabel() }}.</p>
        </div>
        @if (rate()) {
          <div class="page__actions">
            <app-status-badge [value]="rate()!.status" [label]="rate()!.status === 'ACTIVE' ? 'Active' : 'Inactive'" />
            @if (canWrite()) {
              <app-button variant="stroked" [icon]="rate()!.status === 'ACTIVE' ? 'block' : 'check_circle'" (pressed)="toggle()">
                {{ rate()!.status === 'ACTIVE' ? 'Deactivate' : 'Activate' }}</app-button>
              <app-button variant="stroked" icon="delete" (pressed)="remove()">Delete</app-button>
            }
          </div>
        }
      </header>

      @if (loading()) {
        <app-loader [minHeight]="240" caption="Loading…" />
      } @else if (!zone()) {
        <app-card><p class="empty">Zone not found or outside your scope.</p></app-card>
      } @else {
        <app-card title="Service type" subtitle="A customer can have a different rate for each service. A card for all services applies to any service that has no card of its own.">
          <div class="chips" role="tablist">
            <button type="button" role="tab" class="chip" [class.on]="serviceTypeId() === null" (click)="pickType(null)">
              All services @if (hasCard(null)) { <span class="dot" title="Rate set"></span> }</button>
            @for (t of types(); track t.id) {
              <button type="button" role="tab" class="chip" [class.on]="serviceTypeId() === t.id" (click)="pickType(t.id)">
                {{ t.name }} @if (hasCard(t.id)) { <span class="dot" title="Rate set"></span> }</button>
            }
          </div>
        </app-card>

        <form [formGroup]="form" (ngSubmit)="save()" class="rform">
          <app-card title="Charges" subtitle="Applied on top of the freight. Fuel % is on freight; FOV % is on declared value. Min chargeable weight: a lighter parcel is charged as this weight (e.g. 20 kg for Cargo).">
            <div class="grid">
              <app-input [control]="c('minChargeableWeight')" label="Min Chargeable Weight (kg)" type="number" [min]="0" [step]="0.5" />
              <app-input [control]="c('minFreight')" label="Minimum Freight (₹, 0 = none)" type="number" [min]="0" />
              <app-input [control]="c('docketCharge')" label="Docket Charge" type="number" [min]="0" />
              <app-input [control]="c('mathadiCharge')" label="Mathadi Charge" type="number" [min]="0" />
              <app-input [control]="c('packCharge')" label="Pack Charge" type="number" [min]="0" />
              <app-input [control]="c('odaCharge')" label="ODA Charge (out of delivery area)" type="number" [min]="0" />
              <app-input [control]="c('fuelSurchargePercent')" label="Fuel Surcharge %" type="number" [min]="0" [max]="100" [step]="0.5" />
              <app-input [control]="c('fovPercent')" label="FOV %" type="number" [min]="0" [max]="100" [step]="0.1" />
              <app-input [control]="c('effectiveFrom')" label="Effective From" type="date" />
              <app-input [control]="c('effectiveTo')" label="Effective To" type="date" />
            </div>
          </app-card>

          <app-card title="Weight Slabs" subtitle="Whole weight: the slab the weight falls in prices every kg. Tiered: each slab prices only its own kilos. Per kg: freight = chargeable weight × the slab rate. Fixed price: the rate is the whole freight for any weight in the slab (0–10 kg at 100 fixed costs 100 for 1 kg and for 10 kg). A slab covers weights above its min up to and including its max: with 0–5 and 5–10, a 5 kg parcel is in the first slab and 5.3 kg in the second.">
            <div class="mode" role="radiogroup" aria-label="Slab pricing">
              <label [class.on]="mode() === 'WHOLE'"><input type="radio" [formControl]="c('slabMode')" value="WHOLE" />
                <span><b>Whole weight</b><small>7 kg in 5–10 kg @ ₹30 = 7 × 30</small></span></label>
              <label [class.on]="mode() === 'TIERED'"><input type="radio" [formControl]="c('slabMode')" value="TIERED" />
                <span><b>Tiered</b><small>0–5 @ ₹40, 5–10 @ ₹30: 7 kg = 5 × 40 + 2 × 30</small></span></label>
            </div>
            <div class="slabs">
              <div class="slab slab--head"><span>Min weight (kg)</span><span>Max weight (kg)</span><span>Rate (₹)</span><span>Pricing</span><span></span></div>
              @for (g of slabs.controls; track g; let i = $index) {
                <div class="slab" [formGroup]="asGroup(g)">
                  <app-input [control]="gc(g, 'minWeight')" type="number" [min]="0" [step]="0.5" />
                  <app-input [control]="gc(g, 'maxWeight')" type="number" [min]="0" [step]="0.5" placeholder="No limit" />
                  <app-input [control]="gc(g, 'ratePerKg')" type="number" [min]="0" [step]="0.5" />
                  <select class="pricing" [formControl]="gc(g, 'fixedRate')" aria-label="Pricing">
                    <option [ngValue]="false">Per kg</option>
                    <option [ngValue]="true">Fixed price</option>
                  </select>
                  @if (canWrite()) {
                    <button type="button" class="rm" aria-label="Remove slab" [disabled]="slabs.length === 1" (click)="removeSlab(i)">✕</button>
                  } @else { <span></span> }
                </div>
              }
            </div>
            @if (slabs.errors; as errs) { <p class="err">{{ firstError(errs) }}</p> }
            <div class="example">
              <label>Example: <input type="number" min="0" step="0.5" [value]="exWeight()" (input)="exWeight.set(+$any($event.target).value)" aria-label="Example weight" /> kg</label>
              @if (example(); as ex) {
                <span>→ freight <b>₹{{ ex.freight }}</b> <small>({{ ex.parts.join(' + ') }}@if (ex.minApplied) {; minimum freight applies})</small></span>
              } @else { <span class="muted">no slab covers this weight</span> }
            </div>
            @if (canWrite()) { <app-button variant="stroked" icon="add" (pressed)="addSlab()">Add slab</app-button> }
          </app-card>

          <div class="bar">
            <span class="note">@if (form.invalid && form.touched) { Fix the highlighted fields before saving. }</span>
            <div class="bar__actions">
              <app-button variant="stroked" (pressed)="back()">Back</app-button>
              @if (canWrite()) { <app-button type="submit" icon="save" [loading]="saving()">{{ rate() ? 'Save Changes' : 'Create Rate' }}</app-button> }
            </div>
          </div>
        </form>

        @if (rate()) {
          <app-card title="Test a quote" subtitle="Prices a sample shipment to a location of this zone, using the saved rate.">
            <div class="grid">
              <app-input [control]="qWeight" label="Actual weight (kg)" type="number" [min]="0" [step]="0.5" />
              <app-input [control]="qValue" label="Declared value" type="number" [min]="0" />
              <label class="oda"><input type="checkbox" [checked]="qOda()" (change)="qOda.set(!qOda())" /> ODA applies</label>
              <app-button icon="calculate" [loading]="quoting()" [disabled]="!hasLocation()" (pressed)="quote()">Calculate</app-button>
            </div>
            @if (!hasLocation()) { <p class="err">Add a district or city to this zone to test a quote.</p> }
            @if (result(); as r) {
              <dl class="kv">
                <dt>Chargeable weight</dt><dd>{{ r.chargeableWeight }} kg</dd>
                <dt>{{ r.fixedRate ? 'Fixed slab price' : r.tiered || r.minFreightApplied ? 'Average / kg' : 'Rate / kg' }}</dt><dd>{{ r.fixedRate ? r.freight : r.ratePerKg }}</dd>
                <dt>Freight</dt><dd>{{ r.freight }}@if (r.tiered) { <span class="tag">tiered</span> }@if (r.minFreightApplied) { <span class="tag">minimum freight</span> }</dd>
                <dt>Docket + Mathadi + Pack</dt><dd>{{ r.docketCharge + r.mathadiCharge + r.packCharge }}</dd>
                <dt>ODA</dt><dd>{{ r.odaCharge }}</dd>
                <dt>Fuel surcharge</dt><dd>{{ r.fuelSurcharge }}</dd>
                <dt>FOV</dt><dd>{{ r.fovCharge }}</dd>
                <dt class="tot">Total (before GST)</dt><dd class="tot">{{ r.total }}</dd>
              </dl>
            }
          </app-card>
        }
      }
    </div>
  `,
  styles: [`
    .rform { display:flex; flex-direction:column; gap:16px; }
    .chips { display:flex; flex-wrap:wrap; gap:10px; }
    .chip { display:inline-flex; align-items:center; gap:8px; padding:8px 16px; border-radius:999px; border:1px solid var(--surface-border); background:var(--surface); color:var(--content-fg); font:600 13px var(--font-sans); cursor:pointer; }
    .chip:hover { border-color:var(--brand-600); }
    .chip.on { background:var(--occpl-gradient-button); border-color:var(--brand-700); color:#fff; }
    .chip .dot { width:8px; height:8px; border-radius:50%; background:#1a9d5a; }
    .chip.on .dot { background:#fff; }
    .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px 20px; align-items:end; }
    .slabs { display:flex; flex-direction:column; gap:10px; margin-bottom:12px; }
    .slab { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)) minmax(0,1fr) 40px; gap:12px; align-items:center; }
    .slab--head { font:600 12px var(--font-sans); color:var(--content-muted); text-transform:uppercase; letter-spacing:.04em; }
    .rm { border:0; background:transparent; cursor:pointer; color:var(--content-muted); font-size:16px; }
    .rm:disabled { opacity:.3; cursor:default; } .rm:hover:not(:disabled) { color:var(--danger); }
    .err { font:500 13px var(--font-sans); color:var(--danger); margin:0 0 10px; }
    .empty { font:400 14px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
    .bar { display:flex; align-items:center; justify-content:space-between; gap:16px; padding-bottom:8px; }
    .bar__actions { display:flex; gap:10px; } .note { font:500 13px var(--font-sans); color:var(--danger); }
    .oda { display:flex; align-items:center; gap:8px; font:500 14px var(--font-sans); padding-bottom:10px; }
    .kv { display:grid; grid-template-columns:max-content 1fr; gap:6px 24px; margin:16px 0 0; font:400 14px var(--font-sans); }
    .kv dt { color:var(--content-muted); } .kv dd { margin:0; font-weight:600; }
    .kv .tot { color:var(--content-fg); font-weight:700; border-top:1px solid var(--surface-border); padding-top:8px; }
    @media (max-width:860px){ .grid { grid-template-columns:1fr; } .slab { grid-template-columns:1fr 1fr 1fr 1fr 32px; } }
    .mode { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; }
    .mode label { display:flex; gap:10px; align-items:flex-start; padding:10px 12px; border:1px solid var(--surface-border); border-radius:10px; cursor:pointer; }
    .mode label.on { border-color:var(--brand-600); background:var(--surface-muted, #faf5f6); }
    .mode b { display:block; font:600 14px var(--font-sans); } .mode small { color:var(--content-muted); font:400 12px var(--font-sans); }
    .example { display:flex; flex-wrap:wrap; gap:8px 12px; align-items:center; margin:4px 0 12px; font:400 14px var(--font-sans); }
    .example input { width:80px; height:34px; padding:0 8px; border:1px solid var(--surface-border); border-radius:8px; background:var(--surface); color:var(--content-fg); }
    .example small, .example .muted { color:var(--content-muted); }
    .tag { margin-left:8px; padding:1px 8px; border-radius:999px; background:#fff4e0; color:#9a5b00; font:600 11px var(--font-sans); }
    @media (max-width:860px){ .mode { grid-template-columns:1fr; } }
    .pricing { height:44px; padding:0 12px; border:1px solid var(--surface-border); border-radius:var(--r-field); background:var(--surface); color:var(--content-fg); font:500 14px var(--font-sans); }
  `]
})
export class CustomerRateEdit implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(BusinessCustomerService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly confirm = inject(DialogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly zoneId = this.route.snapshot.paramMap.get('zoneId') ?? '';
  /** The service type being edited; null is the card for all services. */
  protected readonly serviceTypeId = signal<string | null>(this.route.snapshot.queryParamMap.get('serviceTypeId'));
  protected readonly types = signal<Array<{ id: string; code: string; name: string }>>([]);
  private readonly cardTypes = signal<Set<string | null>>(new Set());
  protected readonly typeLabel = computed(() => {
    const id = this.serviceTypeId();
    return id ? `for ${this.types().find((t) => t.id === id)?.name ?? 'this service'}` : 'for all services';
  });
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly quoting = signal(false);
  protected readonly zone = signal<PricingZone | null>(null);
  protected readonly rate = signal<CustomerRate | null>(null);
  protected readonly result = signal<import('@core/models/pricing-zone.model').CalculateRateResponse | null>(null);
  protected readonly qOda = signal(false);
  protected readonly canWrite = computed(() => this.perms.canAccess({
    roles: [AppRole.COMPANY_ADMIN], permissions: [this.rate() ? 'CUSTOMER_RATE_UPDATE' : 'CUSTOMER_RATE_CREATE']
  }));
  protected readonly hasLocation = computed(() => !!this.zone()?.locations.length);

  protected readonly slabs: FormArray<FormGroup> = this.fb.array<FormGroup>([], slabsValid);
  protected readonly form: FormGroup = this.fb.group({
    minChargeableWeight: [0, [Validators.required, Validators.min(0)]],
    minFreight: [0, [Validators.min(0)]],
    slabMode: ['WHOLE' as SlabMode],
    docketCharge: [0, [Validators.required, Validators.min(0)]],
    mathadiCharge: [0, [Validators.required, Validators.min(0)]],
    packCharge: [0, [Validators.required, Validators.min(0)]],
    odaCharge: [0, [Validators.required, Validators.min(0)]],
    fuelSurchargePercent: [0, [Validators.required, Validators.min(0), Validators.max(100)]],
    fovPercent: [0, [Validators.required, Validators.min(0), Validators.max(100)]],
    effectiveFrom: [''], effectiveTo: [''],
    slabs: this.slabs
  });
  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly mode = computed(() => (this.formValue().slabMode ?? 'WHOLE') as SlabMode);
  protected readonly exWeight = signal(7);
  protected readonly example = computed(() => {
    const v = this.formValue();
    const num = (x: unknown) => (x === '' || x === null || x === undefined ? null : Number(x));
    const slabs = ((v.slabs ?? []) as Array<{ minWeight: unknown; maxWeight: unknown; ratePerKg: unknown; fixedRate: unknown }>).map((s) => ({
      minWeight: Number(s.minWeight) || 0, maxWeight: num(s.maxWeight), ratePerKg: Number(s.ratePerKg) || 0, fixedRate: s.fixedRate === true
    }));
    return previewFreight(slabs, this.exWeight(), (v.slabMode ?? 'WHOLE') as SlabMode, Number(v.minFreight) || 0, Number(v.minChargeableWeight) || 0);
  });
  protected readonly qWeight = this.fb.nonNullable.control<number>(10, [Validators.min(0.001)]);
  protected readonly qValue = this.fb.nonNullable.control<number>(0, [Validators.min(0)]);

  ngOnInit(): void {
    this.service.zone(this.zoneId).subscribe({
      next: (z) => {
        this.zone.set(z);
        this.breadcrumb.set([{ label: 'Business Customer' }, { label: 'Rate', route: '/business-customer/rates' }, { label: z.zoneName }]);
        this.service.serviceTypes().subscribe({ next: (p) => this.types.set(p.content), error: () => this.types.set([]) });
        this.loadCard();
      },
      error: () => { this.zone.set(null); this.loading.set(false); }
    });
  }

  private loadCard(): void {
    this.service.cards(this.zoneId).subscribe({ next: (cs) => this.cardTypes.set(new Set((cs ?? []).map((c) => c.serviceTypeId ?? null))), error: () => undefined });
    this.service.rate(this.zoneId, this.serviceTypeId()).subscribe({
      next: (r) => { this.hydrate(r ?? null); this.loading.set(false); },
      error: () => { this.hydrate(null); this.loading.set(false); }
    });
  }

  protected hasCard(id: string | null): boolean { return this.cardTypes().has(id); }

  protected pickType(id: string | null): void {
    if (id === this.serviceTypeId()) return;
    this.serviceTypeId.set(id);
    this.result.set(null);
    this.router.navigate([], { relativeTo: this.route, queryParams: { serviceTypeId: id }, queryParamsHandling: 'merge', replaceUrl: true });
    this.loading.set(true);
    this.loadCard();
  }

  protected c(name: string) { return this.form.get(name) as import('@angular/forms').FormControl; }
  protected asGroup(g: AbstractControl): FormGroup { return g as FormGroup; }
  protected gc(g: AbstractControl, name: string) { return g.get(name) as import('@angular/forms').FormControl; }

  private slabGroup(s?: Partial<RateSlab>): FormGroup {
    return this.fb.group({
      minWeight: [s?.minWeight ?? 0, [Validators.required, Validators.min(0)]],
      maxWeight: [s?.maxWeight ?? null as number | null, [Validators.min(0)]],
      ratePerKg: [s?.ratePerKg ?? 0, [Validators.required, Validators.min(0)]],
      fixedRate: [s?.fixedRate ?? false]
    });
  }

  private hydrate(r: CustomerRate | null): void {
    this.rate.set(r);
    this.slabs.clear();
    if (r) {
      this.form.patchValue({
        minChargeableWeight: r.minChargeableWeight, minFreight: r.minFreight ?? 0, slabMode: r.slabMode ?? 'WHOLE', docketCharge: r.docketCharge, mathadiCharge: r.mathadiCharge,
        packCharge: r.packCharge, odaCharge: r.odaCharge, fuelSurchargePercent: r.fuelSurchargePercent,
        fovPercent: r.fovPercent, effectiveFrom: r.effectiveFrom ?? '', effectiveTo: r.effectiveTo ?? ''
      });
      [...r.slabs].sort((a, b) => a.minWeight - b.minWeight).forEach((s) => this.slabs.push(this.slabGroup(s)));
    } else {
      this.form.patchValue({ minFreight: 0, slabMode: 'WHOLE' });
      this.slabs.push(this.slabGroup({ minWeight: 0, maxWeight: null, ratePerKg: 0 }));
    }
    this.form.markAsPristine();
  }

  protected addSlab(): void {
    const last = this.slabs.at(this.slabs.length - 1)?.value as { maxWeight: number | null } | undefined;
    this.slabs.push(this.slabGroup({ minWeight: last?.maxWeight ?? 0, maxWeight: null, ratePerKg: 0 }));
  }
  protected removeSlab(i: number): void { if (this.slabs.length > 1) this.slabs.removeAt(i); }
  protected firstError(errs: ValidationErrors): string { return String(Object.values(errs)[0]); }

  protected save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const heaviest = (v.slabs as Array<{ maxWeight: unknown }>).map((x) => x.maxWeight === null || x.maxWeight === '' ? Infinity : Number(x.maxWeight));
    if (Number(v.minChargeableWeight) > Math.max(...heaviest)) {
      this.notify.error(`The minimum chargeable weight (${v.minChargeableWeight} kg) is above the heaviest slab (${Math.max(...heaviest)} kg), so no parcel could be priced.`);
      return;
    }
    const num = (x: unknown) => (x === '' || x === null || x === undefined ? null : Number(x));
    const body: SaveRateRequest = {
      minChargeableWeight: num(v.minChargeableWeight), docketCharge: num(v.docketCharge), mathadiCharge: num(v.mathadiCharge),
      packCharge: num(v.packCharge), odaCharge: num(v.odaCharge), fuelSurchargePercent: num(v.fuelSurchargePercent),
      fovPercent: num(v.fovPercent), effectiveFrom: v.effectiveFrom || null, effectiveTo: v.effectiveTo || null,
      slabs: (v.slabs as Array<{ minWeight: unknown; maxWeight: unknown; ratePerKg: unknown; fixedRate: unknown }>).map((s) => ({
        minWeight: Number(s.minWeight), maxWeight: num(s.maxWeight), ratePerKg: Number(s.ratePerKg), fixedRate: s.fixedRate === true
      })),
      version: this.rate()?.version ?? null,
      minFreight: num(v.minFreight) ?? 0,
      slabMode: (v.slabMode ?? 'WHOLE') as SlabMode
    };
    this.saving.set(true);
    this.service.saveRate(this.zoneId, body, this.serviceTypeId()).subscribe({
      next: (r) => { this.saving.set(false); this.hydrate(r); this.result.set(null); this.cardTypes.update((s) => new Set(s).add(this.serviceTypeId())); this.notify.success('Rate saved.'); },
      error: (e: HttpErrorResponse) => {
        this.saving.set(false);
        if (e.status === 409) this.notify.error('This rate changed since you opened it. Reload and try again.');
        else this.notify.error(e.error?.message ?? 'Could not save the rate.');
      }
    });
  }

  protected toggle(): void {
    const active = this.rate()!.status === 'ACTIVE';
    (active ? this.service.deactivateRate(this.zoneId, this.serviceTypeId()) : this.service.activateRate(this.zoneId, this.serviceTypeId())).subscribe({
      next: (r) => { this.rate.set(r); this.notify.success(active ? 'Rate deactivated.' : 'Rate activated.'); },
      error: (e: HttpErrorResponse) => this.notify.error(e.error?.message ?? 'Could not change the rate status.')
    });
  }

  protected remove(): void {
    this.confirm.confirm({
      title: 'Delete this rate?', message: 'The zone stays; only this rate card and its slabs are removed.',
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.deleteRate(this.zoneId, this.serviceTypeId()).subscribe({
        next: () => { this.notify.success('Rate deleted.'); this.hydrate(null); this.cardTypes.update((s) => { const n = new Set(s); n.delete(this.serviceTypeId()); return n; }); },
        error: (e: HttpErrorResponse) => this.notify.error(e.error?.message ?? 'Could not delete the rate.')
      });
    });
  }

  protected quote(): void {
    const loc = this.zone()?.locations[0];
    if (!loc || this.qWeight.invalid) return;
    this.quoting.set(true);
    this.service.calculate({
      customerId: this.zone()!.customerId, districtId: loc.districtId, cityId: loc.cityId ?? null,
      actualWeight: Number(this.qWeight.value), declaredValue: Number(this.qValue.value) || 0, odaApplicable: this.qOda(), serviceTypeId: this.serviceTypeId()
    }).subscribe({
      next: (r) => { this.result.set(r); this.quoting.set(false); },
      error: (e: HttpErrorResponse) => { this.quoting.set(false); this.result.set(null); this.notify.error(e.error?.message ?? 'Could not calculate.'); }
    });
  }

  protected back(): void { this.router.navigate(['/business-customer/rates']); }
}
