import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { ShipmentCharge } from '@core/models/shipment.model';
import { ChargeSummary } from './components/charge-summary';
import { ShipmentService } from './shipment.service';

/** Shipment Charges — the Pricing Engine's own breakup, persisted at booking time and
 *  never recomputed from a later rate/config change. GET /shipments/{id}/charges. */
@Component({
  selector: 'app-shipment-charges',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DecimalPipe, UiCard, UiLoader, ChargeSummary],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Shipment Charges</h1>
          <p class="text-caption"><a [routerLink]="['/shipments', id]">← Back to shipment</a></p></div>
      </header>

      @if (loading()) {
        <app-loader [minHeight]="240" caption="Loading…" />
      } @else if (!charges()) {
        <app-card><p class="empty">No charge breakup on file for this shipment.</p></app-card>
      } @else {
        <app-card title="Charge Breakup"
                  [subtitle]="(charges()!.matchedRouteCode ? 'Route ' + charges()!.matchedRouteCode + ' · ' : '') + (charges()!.matchedRateCode ? 'Rate ' + charges()!.matchedRateCode : '')">
          <app-charge-summary [charges]="{
            freight: charges()!.freight, fuelCharge: charges()!.fuelCharge, handlingCharge: charges()!.handlingCharge,
            odaCharge: charges()!.odaCharge, insuranceCharge: charges()!.insuranceCharge,
            applicableCharges: charges()!.applicableCharges, applicableChargeLines: charges()!.applicableChargeLines,
            gstAmount: charges()!.gstAmount,
            discountAmount: charges()!.discountAmount, roundOff: charges()!.roundOff,
            otherCharges: charges()!.otherCharges, appointmentDeliveryCharge: charges()!.appointmentDeliveryCharge,
            doorDeliveryCharge: charges()!.doorDeliveryCharge, toPayCharge: charges()!.toPayCharge,
            netAmount: charges()!.netAmount
          }" />
        </app-card>
        <app-card title="Booking Branch Commission" subtitle="Computed from the booking branch's own charge percentages.">
          <div class="commission">
            <div class="commission__row"><span>Commission on Basic Freight</span><strong>{{ charges()!.commissionOnBasicFreight | number:'1.2-2' }}</strong></div>
            <div class="commission__row"><span>Branch Commission on Other Amount</span><strong>{{ charges()!.branchCommissionOnOtherAmount | number:'1.2-2' }}</strong></div>
            <div class="commission__row"><span>Company Commission on Basic Freight</span><strong>{{ charges()!.companyCommissionOnBasicFreight | number:'1.2-2' }}</strong></div>
            <div class="commission__row commission__row--total"><span>Total Commission</span><strong>{{ charges()!.totalCommission | number:'1.2-2' }}</strong></div>
          </div>
        </app-card>
      }
    </div>
  `,
  styles: [`
    .empty{ font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
    .commission{ display:flex; flex-direction:column; gap:10px; }
    .commission__row{ display:flex; align-items:center; justify-content:space-between; font:400 17px var(--font-sans); color:var(--content-fg); }
    .commission__row strong{ font-weight:600; }
    .commission__row--total{ border-top:1px solid var(--surface-border); padding-top:10px; margin-top:2px; }
    .commission__row--total strong{ color:var(--brand-600); }
  `]
})
export class ShipmentCharges implements OnInit {
  private readonly service = inject(ShipmentService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(true);
  readonly charges = signal<ShipmentCharge | null>(null);
  id = '';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.breadcrumb.set([{ label: 'Shipments', route: '/shipments' }, { label: 'Charges' }]);
    this.service.charges(this.id).subscribe({
      next: (c) => { this.charges.set(c); this.loading.set(false); },
      error: () => { this.charges.set(null); this.loading.set(false); }
    });
  }
}
