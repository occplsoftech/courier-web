import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { AbstractControl, FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AuthService } from '@core/auth/auth.service';
import { AppRole } from '@core/models/role.model';
import { CalculatePdpRateResponse, PdpRate, PdpRateSlab, PdpRateType, SavePdpRateRequest } from '@core/models/pdp.model';
import { CustomerService } from '@features/customer/customer.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { PdpService } from './pdp.service';

/** Slabs are half-open [min,max): sorted by min, no overlap, only the last may be open-ended. */
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
 * Rate cards of ONE partner: a Pickup tab and a Delivery tab, each listing the partner's cards
 * (all districts or one district) with a card editor — minimum weight, per-kg slabs and the
 * type's extra charges — plus a quote tester. Pickup pays on collection, delivery on a
 * POD-approved delivery. Pickup cards carry no mathadi / ODA / return fee (delivery-only).
 */
@Component({
  selector: 'app-partner-rate-edit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiInput, UiSelect, UiButton, UiLoader, StatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">{{ partnerName() || 'Partner' }} — Rates</h1>
          <p class="text-caption">What this partner is paid. Pickup and delivery are priced separately.</p>
        </div>
        <app-button variant="stroked" (pressed)="back()">Back</app-button>
      </header>

      <p class="note-line">These rates are what the partner is <strong>paid</strong>. What the customer is <strong>charged</strong> for this partner's bookings comes from
        <a (click)="goFreight()" class="lnk">District Level Freight</a> rows set for this partner as the From Station.</p>

      <div class="tabs" role="tablist">
        <button type="button" role="tab" [class.on]="type() === 'PICKUP'" (click)="setType('PICKUP')">Pickup Rates</button>
        <button type="button" role="tab" [class.on]="type() === 'DELIVERY'" (click)="setType('DELIVERY')">Delivery Rates</button>
      </div>

      @if (loading()) {
        <app-loader [minHeight]="240" caption="Loading…" />
      } @else {
        <app-card [title]="type() === 'PICKUP' ? 'Pickup rate cards' : 'Delivery rate cards'"
                  [subtitle]="type() === 'PICKUP' ? 'Paid when the partner collects a shipment.' : 'Paid when the partner delivers and the POD is approved.'">
          @if (cards().length) {
            <table class="cards">
              <thead><tr><th>District</th><th>Min weight</th><th>Slabs</th><th>Validity</th><th>Status</th><th></th></tr></thead>
              <tbody>
                @for (r of cards(); track r.id) {
                  <tr [class.sel]="editing()?.id === r.id">
                    <td>{{ districtLabel(r.districtId) }}</td>
                    <td>{{ r.minChargeableWeight }} kg</td>
                    <td>{{ r.slabs.length }} ({{ lowest(r) }}–{{ highest(r) }} /kg)</td>
                    <td>{{ r.effectiveFrom || '…' }} → {{ r.effectiveTo || '…' }}</td>
                    <td><app-status-badge [value]="r.status" [label]="r.status === 'ACTIVE' ? 'Active' : 'Inactive'" /></td>
                    <td class="act"><app-button variant="stroked" icon="edit" (pressed)="edit(r)">{{ canWrite() ? 'Edit' : 'View' }}</app-button></td>
                  </tr>
                }
              </tbody>
            </table>
          } @else { <p class="empty">No {{ type().toLowerCase() }} rate yet.</p> }
          @if (canWrite()) { <app-button icon="add" (pressed)="startNew()">New {{ type() === 'PICKUP' ? 'pickup' : 'delivery' }} rate</app-button> }
        </app-card>

        @if (formOpen()) {
          <form [formGroup]="form" (ngSubmit)="save()" class="rform">
            <app-card [title]="editing() ? 'Edit rate card' : 'New rate card'"
                      subtitle="Leave District empty for a default card covering every district. A district card wins over the default.">
              <div class="grid">
                <app-select [control]="stateCtl" label="State" [options]="stateOpts()" [allowEmpty]="true" emptyLabel="Any (all districts)" placeholder="Any" />
                <app-select [control]="districtCtl" label="District" [options]="districtOpts()" [allowEmpty]="true" emptyLabel="All districts" placeholder="All districts" />
                <app-input [control]="c('minChargeableWeight')" [label]="type() === 'PICKUP' ? 'Minimum Pickup Weight (kg)' : 'Minimum Delivery Weight (kg)'" type="number" [min]="0" [step]="0.5" />
                @if (type() === 'DELIVERY') {
                  <app-input [control]="c('mathadiCharge')" label="Mathadi Charge" type="number" [min]="0" />
                  <app-input [control]="c('odaCharge')" label="ODA Charge" type="number" [min]="0" />
                  <app-input [control]="c('returnFee')" label="Return-to-origin Fee" type="number" [min]="0" />
                }
                <app-input [control]="c('failedAttemptFee')" [label]="type() === 'PICKUP' ? 'Failed-pickup Fee' : 'Failed-attempt Fee'" type="number" [min]="0" />
                <app-input [control]="c('effectiveFrom')" label="Effective From" type="date" />
                <app-input [control]="c('effectiveTo')" label="Effective To" type="date" />
              </div>
            </app-card>

            <app-card title="Per-kg Weight Slabs" subtitle="Pay = chargeable weight (at least the minimum above) × the rate of the slab it falls in. A slab covers min up to, not including, max.">
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
                @if (editing(); as e) {
                  @if (canWrite()) {
                    <app-button variant="stroked" [icon]="e.status === 'ACTIVE' ? 'block' : 'check_circle'" (pressed)="toggle(e)">{{ e.status === 'ACTIVE' ? 'Deactivate' : 'Activate' }}</app-button>
                    <app-button variant="stroked" icon="delete" (pressed)="remove(e)">Delete</app-button>
                  }
                }
                <app-button variant="stroked" (pressed)="closeForm()">Close</app-button>
                @if (canWrite()) { <app-button type="submit" icon="save" [loading]="saving()">{{ editing() ? 'Save Changes' : 'Create Rate' }}</app-button> }
              </div>
            </div>
          </form>

          @if (editing()) {
            <app-card title="Test a quote" subtitle="What the partner would be paid for a sample job, using the saved card.">
              <div class="grid">
                <app-input [control]="qWeight" label="Actual weight (kg)" type="number" [min]="0" [step]="0.5" />
                @if (type() === 'DELIVERY') { <label class="oda"><input type="checkbox" [checked]="qOda()" (change)="qOda.set(!qOda())" /> ODA applies</label> }
                <app-button icon="calculate" [loading]="quoting()" (pressed)="quote()">Calculate</app-button>
              </div>
              @if (result(); as r) {
                <dl class="kv">
                  <dt>Chargeable weight</dt><dd>{{ r.chargeableWeight }} kg</dd>
                  <dt>Rate / kg</dt><dd>{{ r.ratePerKg }}</dd>
                  <dt>Weight charge</dt><dd>{{ r.weightCharge }}</dd>
                  @if (type() === 'DELIVERY') { <dt>Mathadi</dt><dd>{{ r.mathadiCharge }}</dd><dt>ODA</dt><dd>{{ r.odaCharge }}</dd> }
                  <dt class="tot">Partner is paid</dt><dd class="tot">{{ r.total }}</dd>
                </dl>
              }
            </app-card>
          }
        }
      }
    </div>
  `,
  styles: [`
    .note-line { font:400 16px var(--font-sans); color:var(--content-muted); margin:0 0 12px; } .lnk { color:var(--primary, #1a56db); cursor:pointer; text-decoration:underline; }
    .tabs { display:flex; gap:4px; border-bottom:1px solid var(--surface-border); margin-bottom:16px; }
    .tabs button { border:0; background:transparent; padding:10px 18px; font:600 17px var(--font-sans); color:var(--content-muted); cursor:pointer; border-bottom:2px solid transparent; }
    .tabs button.on { color:var(--primary, var(--content-fg)); border-bottom-color:var(--primary, var(--content-fg)); }
    .cards { width:100%; border-collapse:collapse; margin-bottom:12px; font:400 17px var(--font-sans); }
    .cards th { text-align:left; font:600 15px var(--font-sans); color:var(--content-muted); text-transform:uppercase; letter-spacing:.04em; padding:6px 8px; }
    .cards td { padding:8px; border-top:1px solid var(--surface-border); } .cards tr.sel td { background:var(--surface-muted, transparent); }
    .act { text-align:right; }
    .rform { display:flex; flex-direction:column; gap:16px; margin-top:16px; }
    .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px 20px; align-items:end; }
    .slabs { display:flex; flex-direction:column; gap:10px; margin-bottom:12px; }
    .slab { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)) 40px; gap:12px; align-items:center; }
    .slab--head { font:600 15px var(--font-sans); color:var(--content-muted); text-transform:uppercase; letter-spacing:.04em; }
    .rm { border:0; background:transparent; cursor:pointer; color:var(--content-muted); font-size:19px; }
    .rm:disabled { opacity:.3; cursor:default; } .rm:hover:not(:disabled) { color:var(--danger); }
    .err { font:500 16px var(--font-sans); color:var(--danger); margin:0 0 10px; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); padding:8px 0 16px; }
    .bar { display:flex; align-items:center; justify-content:space-between; gap:16px; padding-bottom:8px; flex-wrap:wrap; }
    .bar__actions { display:flex; gap:10px; flex-wrap:wrap; } .note { font:500 16px var(--font-sans); color:var(--danger); }
    .oda { display:flex; align-items:center; gap:8px; font:500 17px var(--font-sans); padding-bottom:10px; }
    .kv { display:grid; grid-template-columns:max-content 1fr; gap:6px 24px; margin:16px 0 0; font:400 17px var(--font-sans); }
    .kv dt { color:var(--content-muted); } .kv dd { margin:0; font-weight:600; }
    .kv .tot { color:var(--content-fg); font-weight:700; border-top:1px solid var(--surface-border); padding-top:8px; }
    @media (max-width:860px){ .grid { grid-template-columns:1fr; } .slab { grid-template-columns:1fr 1fr 1fr 32px; } }
  `]
})
export class PartnerRateEdit implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(PdpService);
  private readonly geo = inject(CustomerService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly confirm = inject(DialogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly auth = inject(AuthService);
  /** `/pdp/rates/:branchId` for an admin; `/pdp/my-rates` is a partner's own (read-only) rate cards. */
  private readonly branchId = this.route.snapshot.paramMap.get('branchId') ?? this.auth.user()?.branchId ?? '';
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly quoting = signal(false);
  protected readonly partnerName = signal('');
  protected readonly type = signal<PdpRateType>('PICKUP');
  protected readonly allRates = signal<PdpRate[]>([]);
  protected readonly cards = computed(() => this.allRates().filter((r) => r.rateType === this.type()));
  protected readonly formOpen = signal(false);
  protected readonly editing = signal<PdpRate | null>(null);
  protected readonly result = signal<CalculatePdpRateResponse | null>(null);
  protected readonly qOda = signal(false);
  /** id -> district name. A signal, not a plain Map: filled asynchronously under OnPush. */
  protected readonly districtNames = signal<Record<string, string>>({});
  protected readonly canWrite = computed(() => this.perms.canAccess({
    roles: [AppRole.COMPANY_ADMIN], permissions: [this.editing() ? 'PDP_RATE_UPDATE' : 'PDP_RATE_CREATE']
  }));

  protected readonly stateCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly districtCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly stateOpts = signal<SelectOption[]>([]);
  protected readonly districtOpts = signal<SelectOption[]>([]);

  protected readonly slabs: FormArray<FormGroup> = this.fb.array<FormGroup>([], slabsValid);
  protected readonly form: FormGroup = this.fb.group({
    minChargeableWeight: [0, [Validators.required, Validators.min(0)]],
    mathadiCharge: [0, [Validators.required, Validators.min(0)]],
    odaCharge: [0, [Validators.required, Validators.min(0)]],
    failedAttemptFee: [0, [Validators.required, Validators.min(0)]],
    returnFee: [0, [Validators.required, Validators.min(0)]],
    effectiveFrom: [''], effectiveTo: [''],
    slabs: this.slabs
  });
  protected readonly qWeight = this.fb.nonNullable.control<number>(10, [Validators.min(0.001)]);

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Pickup Delivery Partner Management' }, { label: 'Partner Rates', route: '/pdp/rates' }, { label: 'Rates' }]);
    this.service.partners({ page: 0, size: 200 }).subscribe((p) => {
      const b = p.content.find((x) => x.id === this.branchId);
      if (b) this.partnerName.set(`${b.branchName} (${b.branchCode})`);
    });
    this.geo.countries().subscribe((cs) => {
      if (!cs.length) return;
      this.geo.states(cs[0].id).subscribe((states) => {
        this.stateOpts.set(states.map((o) => ({ value: o.id, label: o.label })));
        // Name every district once so cards can show "Pune" instead of an id.
        forkJoin(states.map((s) => this.geo.districts(s.id))).subscribe((lists) => {
          const names: Record<string, string> = {};
          lists.flat().forEach((d) => { names[d.id] = d.label; });
          this.districtNames.set(names);
        });
      });
    });
    this.stateCtl.valueChanges.subscribe((id) => {
      this.districtCtl.setValue(''); this.districtOpts.set([]);
      if (id) this.geo.districts(id).subscribe((d) => this.districtOpts.set(d.map((o) => ({ value: o.id, label: o.label }))));
    });
    this.reload();
  }

  private reload(): void {
    this.service.rates({ branchId: this.branchId }).subscribe({
      next: (r) => { this.allRates.set(r ?? []); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  protected c(name: string) { return this.form.get(name) as FormControl; }
  protected asGroup(g: AbstractControl): FormGroup { return g as FormGroup; }
  protected gc(g: AbstractControl, name: string) { return g.get(name) as FormControl; }
  protected districtLabel(id?: string | null): string { return id ? (this.districtNames()[id] ?? 'District') : 'All districts'; }
  protected lowest(r: PdpRate): number { return Math.min(...r.slabs.map((s) => s.ratePerKg)); }
  protected highest(r: PdpRate): number { return Math.max(...r.slabs.map((s) => s.ratePerKg)); }

  protected setType(t: PdpRateType): void { this.type.set(t); this.closeForm(); }
  protected closeForm(): void { this.formOpen.set(false); this.editing.set(null); this.result.set(null); }

  private slabGroup(s?: Partial<PdpRateSlab>): FormGroup {
    return this.fb.group({
      minWeight: [s?.minWeight ?? 0, [Validators.required, Validators.min(0)]],
      maxWeight: [s?.maxWeight ?? null as number | null, [Validators.min(0)]],
      ratePerKg: [s?.ratePerKg ?? 0, [Validators.required, Validators.min(0)]]
    });
  }

  protected startNew(): void {
    this.editing.set(null); this.result.set(null);
    this.stateCtl.setValue(''); this.districtCtl.setValue('');
    this.form.reset({ minChargeableWeight: 0, mathadiCharge: 0, odaCharge: 0, failedAttemptFee: 0, returnFee: 0, effectiveFrom: '', effectiveTo: '' });
    this.slabs.clear(); this.slabs.push(this.slabGroup({ minWeight: 0, maxWeight: null, ratePerKg: 0 }));
    this.formOpen.set(true);
  }

  protected edit(r: PdpRate): void {
    this.editing.set(r); this.result.set(null);
    this.stateCtl.setValue('');
    this.districtOpts.set(r.districtId ? [{ value: r.districtId, label: this.districtLabel(r.districtId) }] : []);
    this.districtCtl.setValue(r.districtId ?? '', { emitEvent: false });
    this.form.patchValue({
      minChargeableWeight: r.minChargeableWeight, mathadiCharge: r.mathadiCharge, odaCharge: r.odaCharge,
      failedAttemptFee: r.failedAttemptFee, returnFee: r.returnFee,
      effectiveFrom: r.effectiveFrom ?? '', effectiveTo: r.effectiveTo ?? ''
    });
    this.slabs.clear();
    [...r.slabs].sort((a, b) => a.minWeight - b.minWeight).forEach((s) => this.slabs.push(this.slabGroup(s)));
    this.form.markAsPristine();
    this.formOpen.set(true);
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
    const delivery = this.type() === 'DELIVERY';
    const e = this.editing();
    const body: SavePdpRateRequest = {
      branchId: this.branchId, rateType: this.type(), districtId: this.districtCtl.value || null,
      minChargeableWeight: num(v.minChargeableWeight),
      mathadiCharge: delivery ? num(v.mathadiCharge) : 0, odaCharge: delivery ? num(v.odaCharge) : 0,
      returnFee: delivery ? num(v.returnFee) : 0, failedAttemptFee: num(v.failedAttemptFee),
      effectiveFrom: v.effectiveFrom || null, effectiveTo: v.effectiveTo || null,
      slabs: (v.slabs as Array<{ minWeight: unknown; maxWeight: unknown; ratePerKg: unknown }>).map((s) => ({
        minWeight: Number(s.minWeight), maxWeight: num(s.maxWeight), ratePerKg: Number(s.ratePerKg)
      })),
      version: e?.version ?? null
    };
    this.saving.set(true);
    (e ? this.service.updateRate(e.id, body) : this.service.createRate(body)).subscribe({
      next: (r) => { this.saving.set(false); this.notify.success('Rate saved.'); this.reload(); this.edit(r); },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 409) this.notify.error('This rate changed since you opened it. Reload and try again.');
        else this.notify.error(err.error?.message ?? 'Could not save the rate.');
      }
    });
  }

  protected toggle(r: PdpRate): void {
    const active = r.status === 'ACTIVE';
    (active ? this.service.deactivateRate(r.id) : this.service.activateRate(r.id)).subscribe({
      next: (x) => { this.notify.success(active ? 'Rate deactivated.' : 'Rate activated.'); this.reload(); this.editing.set(x); },
      error: (e: HttpErrorResponse) => this.notify.error(e.error?.message ?? 'Could not change the rate status.')
    });
  }

  protected remove(r: PdpRate): void {
    this.confirm.confirm({
      title: 'Delete this rate card?', message: 'Past earnings keep their own snapshot; only this card and its slabs are removed.',
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.deleteRate(r.id).subscribe({
        next: () => { this.notify.success('Rate deleted.'); this.closeForm(); this.reload(); },
        error: (e: HttpErrorResponse) => this.notify.error(e.error?.message ?? 'Could not delete the rate.')
      });
    });
  }

  protected quote(): void {
    const e = this.editing();
    if (!e || this.qWeight.invalid) return;
    this.quoting.set(true);
    this.service.calculate({
      branchId: this.branchId, rateType: this.type(), districtId: e.districtId ?? null,
      actualWeight: Number(this.qWeight.value), odaApplicable: this.qOda()
    }).subscribe({
      next: (r) => { this.result.set(r); this.quoting.set(false); },
      error: (err: HttpErrorResponse) => { this.quoting.set(false); this.result.set(null); this.notify.error(err.error?.message ?? 'Could not calculate.'); }
    });
  }

  protected goFreight(): void { this.router.navigate(['/district-level-freight']); }
  protected back(): void { this.router.navigate([this.route.snapshot.paramMap.get('branchId') ? '/pdp/rates' : '/pdp/pickups']); }
}
