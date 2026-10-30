import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { CustomerRate, PricingZone, RateSlab, SaveRateRequest } from '@core/models/pricing-zone.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { BusinessCustomerService } from './business-customer.service';

/** Slabs run from above their min up to and including their max: sorted by min, no overlap, only the last may be open-ended. */
function slabsValid(array: AbstractControl): ValidationErrors | null {
  const rows = (array as FormArray).controls.map((g) => ({
    min: Number(g.get('minWeight')!.value), maxRaw: g.get('maxWeight')!.value as string | number | null
  })).sort((a, b) => a.min - b.min);
  for (let i = 0; i < rows.length; i++) {
    const max = rows[i].maxRaw === null || rows[i].maxRaw === '' ? null : Number(rows[i].maxRaw);
    if (max !== null && max <= rows[i].min) return { range: `Slab ${i + 1}: maximum must be above its minimum.` };
    if (max === null && i < rows.length - 1) return { open: 'Only the last slab may have no maximum.' };
    if (i > 0) {
      const prev = rows[i - 1].maxRaw === null || rows[i - 1].maxRaw === '' ? null : Number(rows[i - 1].maxRaw);
      if (prev !== null && rows[i].min < prev) return { overlap: `Slabs overlap at ${rows[i].min} kg.` };
    }
  }
  return null;
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
          <p class="text-caption">{{ zone()?.customerName }} — slab rates and charges for this zone.</p>
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
        <form [formGroup]="form" (ngSubmit)="save()" class="rform">
          <app-card title="Charges" subtitle="Applied on top of the per-kg freight. Fuel % is on freight; FOV % is on declared value.">
            <div class="grid">
              <app-input [control]="c('minChargeableWeight')" label="Min Chargeable Weight (kg)" type="number" [min]="0" [step]="0.5" />
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

          <app-card title="Per-kg Weight Slabs" subtitle="Freight = chargeable weight × the rate of the slab it falls in. A slab covers weights above its min up to and including its max: with 0–5 and 5–10, a 5 kg parcel is in the first slab and 5.3 kg in the second.">
            <div class="slabs">
              <div class="slab slab--head"><span>Min weight (kg)</span><span>Max weight (kg)</span><span>Rate / kg</span><span></span></div>
              @for (g of slabs.controls; track g; let i = $index) {
                <div class="slab" [formGroup]="asGroup(g)">
                  <app-input [control]="gc(g, 'minWeight')" type="number" [min]="0" [step]="0.5" />
                  <app-input [control]="gc(g, 'maxWeight')" type="number" [min]="0" [step]="0.5" placeholder="No limit" />
                  <app-input [control]="gc(g, 'ratePerKg')" type="number" [min]="0" [step]="0.5" />
                  @if (canWrite()) {
                    <button type="button" class="rm" aria-label="Remove slab" [disabled]="slabs.length === 1" (click)="removeSlab(i)">✕</button>
                  } @else { <span></span> }
                </div>
              }
            </div>
            @if (slabs.errors; as errs) { <p class="err">{{ firstError(errs) }}</p> }
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
                <dt>Rate / kg</dt><dd>{{ r.ratePerKg }}</dd>
                <dt>Freight</dt><dd>{{ r.freight }}</dd>
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
    .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px 20px; align-items:end; }
    .slabs { display:flex; flex-direction:column; gap:10px; margin-bottom:12px; }
    .slab { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)) 40px; gap:12px; align-items:center; }
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
    @media (max-width:860px){ .grid { grid-template-columns:1fr; } .slab { grid-template-columns:1fr 1fr 1fr 32px; } }
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
    docketCharge: [0, [Validators.required, Validators.min(0)]],
    mathadiCharge: [0, [Validators.required, Validators.min(0)]],
    packCharge: [0, [Validators.required, Validators.min(0)]],
    odaCharge: [0, [Validators.required, Validators.min(0)]],
    fuelSurchargePercent: [0, [Validators.required, Validators.min(0), Validators.max(100)]],
    fovPercent: [0, [Validators.required, Validators.min(0), Validators.max(100)]],
    effectiveFrom: [''], effectiveTo: [''],
    slabs: this.slabs
  });
  protected readonly qWeight = this.fb.nonNullable.control<number>(10, [Validators.min(0.001)]);
  protected readonly qValue = this.fb.nonNullable.control<number>(0, [Validators.min(0)]);

  ngOnInit(): void {
    this.service.zone(this.zoneId).subscribe({
      next: (z) => {
        this.zone.set(z);
        this.breadcrumb.set([{ label: 'Business Customer' }, { label: 'Rate', route: '/business-customer/rates' }, { label: z.zoneName }]);
        this.service.rate(this.zoneId).subscribe({
          next: (r) => { this.hydrate(r ?? null); this.loading.set(false); },
          error: () => { this.hydrate(null); this.loading.set(false); }
        });
      },
      error: () => { this.zone.set(null); this.loading.set(false); }
    });
  }

  protected c(name: string) { return this.form.get(name) as import('@angular/forms').FormControl; }
  protected asGroup(g: AbstractControl): FormGroup { return g as FormGroup; }
  protected gc(g: AbstractControl, name: string) { return g.get(name) as import('@angular/forms').FormControl; }

  private slabGroup(s?: Partial<RateSlab>): FormGroup {
    return this.fb.group({
      minWeight: [s?.minWeight ?? 0, [Validators.required, Validators.min(0)]],
      maxWeight: [s?.maxWeight ?? null as number | null, [Validators.min(0)]],
      ratePerKg: [s?.ratePerKg ?? 0, [Validators.required, Validators.min(0)]]
    });
  }

  private hydrate(r: CustomerRate | null): void {
    this.rate.set(r);
    this.slabs.clear();
    if (r) {
      this.form.patchValue({
        minChargeableWeight: r.minChargeableWeight, docketCharge: r.docketCharge, mathadiCharge: r.mathadiCharge,
        packCharge: r.packCharge, odaCharge: r.odaCharge, fuelSurchargePercent: r.fuelSurchargePercent,
        fovPercent: r.fovPercent, effectiveFrom: r.effectiveFrom ?? '', effectiveTo: r.effectiveTo ?? ''
      });
      [...r.slabs].sort((a, b) => a.minWeight - b.minWeight).forEach((s) => this.slabs.push(this.slabGroup(s)));
    } else {
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
    const num = (x: unknown) => (x === '' || x === null || x === undefined ? null : Number(x));
    const body: SaveRateRequest = {
      minChargeableWeight: num(v.minChargeableWeight), docketCharge: num(v.docketCharge), mathadiCharge: num(v.mathadiCharge),
      packCharge: num(v.packCharge), odaCharge: num(v.odaCharge), fuelSurchargePercent: num(v.fuelSurchargePercent),
      fovPercent: num(v.fovPercent), effectiveFrom: v.effectiveFrom || null, effectiveTo: v.effectiveTo || null,
      slabs: (v.slabs as Array<{ minWeight: unknown; maxWeight: unknown; ratePerKg: unknown }>).map((s) => ({
        minWeight: Number(s.minWeight), maxWeight: num(s.maxWeight), ratePerKg: Number(s.ratePerKg)
      })),
      version: this.rate()?.version ?? null
    };
    this.saving.set(true);
    this.service.saveRate(this.zoneId, body).subscribe({
      next: (r) => { this.saving.set(false); this.hydrate(r); this.result.set(null); this.notify.success('Rate saved.'); },
      error: (e: HttpErrorResponse) => {
        this.saving.set(false);
        if (e.status === 409) this.notify.error('This rate changed since you opened it. Reload and try again.');
        else this.notify.error(e.error?.message ?? 'Could not save the rate.');
      }
    });
  }

  protected toggle(): void {
    const active = this.rate()!.status === 'ACTIVE';
    (active ? this.service.deactivateRate(this.zoneId) : this.service.activateRate(this.zoneId)).subscribe({
      next: (r) => { this.rate.set(r); this.notify.success(active ? 'Rate deactivated.' : 'Rate activated.'); },
      error: (e: HttpErrorResponse) => this.notify.error(e.error?.message ?? 'Could not change the rate status.')
    });
  }

  protected remove(): void {
    this.confirm.confirm({
      title: 'Delete this rate?', message: 'The zone stays; only its rate card and slabs are removed.',
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.deleteRate(this.zoneId).subscribe({
        next: () => { this.notify.success('Rate deleted.'); this.hydrate(null); },
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
      actualWeight: Number(this.qWeight.value), declaredValue: Number(this.qValue.value) || 0, odaApplicable: this.qOda()
    }).subscribe({
      next: (r) => { this.result.set(r); this.quoting.set(false); },
      error: (e: HttpErrorResponse) => { this.quoting.set(false); this.result.set(null); this.notify.error(e.error?.message ?? 'Could not calculate.'); }
    });
  }

  protected back(): void { this.router.navigate(['/business-customer/rates']); }
}
