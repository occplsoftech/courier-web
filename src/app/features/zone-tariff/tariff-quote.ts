import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { QuoteResponse } from '@core/models/zone-tariff.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { MasterDataService } from '@features/masters/master-data.service';
import { ZoneTariffService } from './zone-tariff.service';

/**
 * Prices a sample shipment on the zone tariff, exactly as booking will: the pickup pincode's from zone picks the
 * active rate card for the date, the delivery pincode's to zone picks the rate. Nothing is saved.
 */
@Component({
  selector: 'app-tariff-quote',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DecimalPipe, UiCard, UiInput, UiSelect, UiButton],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Tariff Calculator</h1>
          <p class="text-caption">Price a shipment from the zone tariff — freight, charges, GST and total.</p></div>
      </header>

      <app-card title="Shipment">
        <div class="grid">
          <app-input [control]="f.controls.originPincode" label="Pickup pincode" [required]="true" [maxLength]="6" placeholder="411030" />
          <app-input [control]="f.controls.destinationPincode" label="Delivery pincode" [required]="true" [maxLength]="6" placeholder="400001" />
          <app-select [control]="f.controls.serviceTypeId" label="Service type" [options]="serviceOpts()" placeholder="Select" />
          <app-select [control]="f.controls.packageTypeId" label="Package type" [options]="packageOpts()" placeholder="Select" />
          <app-input [control]="f.controls.actualWeightKg" label="Weight (kg)" type="number" [min]="0.001" [step]="0.1" [required]="true" />
          <app-input [control]="f.controls.pieces" label="Pieces" type="number" [min]="1" />
          <app-input [control]="f.controls.lengthCm" label="Length (cm, per piece)" type="number" [min]="0" />
          <app-input [control]="f.controls.widthCm" label="Width (cm)" type="number" [min]="0" />
          <app-input [control]="f.controls.heightCm" label="Height (cm)" type="number" [min]="0" />
          <app-input [control]="f.controls.declaredValue" label="Declared value" type="number" [min]="0" />
          <app-input [control]="f.controls.bookingDate" label="Booking date (empty = today)" type="date" />
          <label class="chk"><input type="checkbox" [checked]="f.controls.cod.value" (change)="f.controls.cod.setValue(!f.controls.cod.value)" /> Cash on delivery</label>
        </div>
        <div class="bar"><app-button icon="calculate" [loading]="quoting()" (pressed)="quote()">Calculate</app-button></div>
      </app-card>

      @if (result(); as r) {
        <app-card title="Price" [subtitle]="r.rateCardCode + ': ' + r.fromZone.code + ' → ' + r.toZone.code + ' · ' + r.serviceTypeCode + ' · ' + r.packageTypeCode">
          <dl class="kv">
            <dt>From zone</dt><dd>{{ r.fromZone.code }} ({{ r.fromZone.name }}) — by {{ r.fromZone.matchedBy }}</dd>
            <dt>To zone</dt><dd>{{ r.toZone.code }} ({{ r.toZone.name }}) — by {{ r.toZone.matchedBy }}@if (r.oda) { · ODA pincode }</dd>
            <dt>Weight</dt>
            <dd>{{ r.chargeableWeightKg | number: '1.0-3' }} kg chargeable (actual {{ r.actualWeightKg | number: '1.0-3' }}@if (r.volumetricWeightKg != null) {, volumetric {{ r.volumetricWeightKg | number: '1.0-3' }}})</dd>
            <dt>Freight</dt><dd>₹{{ r.freight | number: '1.2-2' }} <span class="muted">— {{ r.freightBasis }}</span></dd>
            @for (c of r.charges; track c.code) {
              <dt>{{ c.name }}@if (!c.taxable) { <span class="muted"> (no GST)</span> }</dt><dd>₹{{ c.amount | number: '1.2-2' }} <span class="muted">— {{ c.basis }}</span></dd>
            }
            <dt>Taxable amount</dt><dd>₹{{ r.taxableAmount | number: '1.2-2' }}</dd>
            @for (t of r.taxes; track t.code) {
              <dt>{{ t.code }} {{ t.percent | number: '1.0-2' }}%</dt><dd>₹{{ t.amount | number: '1.2-2' }}</dd>
            }
            @if (r.roundOff !== 0) { <dt>Round off</dt><dd>₹{{ r.roundOff | number: '1.2-2' }}</dd> }
            <dt class="tot">Total</dt><dd class="tot">₹{{ r.total | number: '1.2-2' }}</dd>
          </dl>
        </app-card>
      }
    </div>
  `,
  styles: [`
    .grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:16px 20px; align-items:end; }
    .bar { display:flex; justify-content:flex-end; margin-top:12px; }
    .chk { display:flex; align-items:center; gap:8px; font:400 14px var(--font-sans); padding-bottom:10px; }
    .kv { display:grid; grid-template-columns:max-content 1fr; gap:8px 24px; margin:0; font:400 14px var(--font-sans); }
    .kv dt { color:var(--content-muted); } .kv dd { margin:0; }
    .kv .tot { font-weight:700; color:var(--content-fg); border-top:1px solid var(--surface-border); padding-top:8px; }
    .muted { color:var(--content-muted); font-size:12px; }
    @media (max-width:900px){ .grid { grid-template-columns:1fr 1fr; } }
  `]
})
export class TariffQuote implements OnInit {
  private readonly service = inject(ZoneTariffService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);

  protected readonly serviceOpts = signal<SelectOption[]>([]);
  protected readonly packageOpts = signal<SelectOption[]>([]);
  protected readonly quoting = signal(false);
  protected readonly result = signal<QuoteResponse | null>(null);

  protected readonly f = new FormGroup({
    originPincode: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^[1-9][0-9]{5}$/)] }),
    destinationPincode: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^[1-9][0-9]{5}$/)] }),
    serviceTypeId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    packageTypeId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    actualWeightKg: new FormControl<number | null>(1, [Validators.required, Validators.min(0.001)]),
    pieces: new FormControl<number | null>(1),
    lengthCm: new FormControl<number | null>(null),
    widthCm: new FormControl<number | null>(null),
    heightCm: new FormControl<number | null>(null),
    declaredValue: new FormControl<number | null>(null),
    bookingDate: new FormControl('', { nonNullable: true }),
    cod: new FormControl(false, { nonNullable: true })
  });

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Zone Tariff' }, { label: 'Calculator' }]);
    this.masters.options('service-types').subscribe((o) => this.serviceOpts.set(o));
    this.masters.options('package-types').subscribe((o) => this.packageOpts.set(o));
  }

  protected quote(): void {
    this.f.markAllAsTouched();
    if (this.f.invalid) { this.notify.error('Enter both 6-digit pincodes, the service type, the package type and the weight.'); return; }
    const v = this.f.getRawValue();
    this.quoting.set(true);
    this.service.quote({
      originPincode: v.originPincode, destinationPincode: v.destinationPincode, serviceTypeId: v.serviceTypeId,
      packageTypeId: v.packageTypeId, actualWeightKg: Number(v.actualWeightKg), lengthCm: v.lengthCm || null,
      widthCm: v.widthCm || null, heightCm: v.heightCm || null, pieces: v.pieces || null, declaredValue: v.declaredValue || null,
      cod: v.cod, bookingDate: v.bookingDate || null
    }).subscribe({
      next: (r) => { this.result.set(r); this.quoting.set(false); },
      error: (e: HttpErrorResponse) => { this.result.set(null); this.quoting.set(false); this.notify.error(e.error?.message ?? 'Could not price this shipment.'); }
    });
  }
}
