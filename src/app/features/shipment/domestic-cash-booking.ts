import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe, UpperCasePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { MASTER_DEFINITIONS } from '@features/masters/master.config';
import { SettingsService } from '@features/settings/settings.service';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { CreateShipmentRequest, ShipmentItemRequest } from '@core/models/shipment.model';
import { ShipmentService } from './shipment.service';
import { FreightCalculationService } from './freight-calculation.service';

const VOLUMETRIC_DIVISOR = 5000;

/** One row of "pieces of the same size"; weight is per piece, in grams (as the desk is used to). */
export interface SizeRow { length: number | null; width: number | null; height: number | null; weightGrams: number | null; pieces: number; }

/** One service (mode of dispatch) priced for this booking. */
export interface ModeRate {
  serviceTypeId: string; label: string; total: number | null; error?: string;
  freight: number; oda: number; extras: number; gst: number; estimate: number; days: number | null; basis?: string;
}

/** A pincode as the wizard resolved it: its city and the Area the freight is priced against. */
interface PincodeInfo { state: 'idle' | 'loading' | 'ok' | 'error'; city?: string | null; district?: string | null; areaId?: string | null; message?: string; }

/** Per-piece grams × pieces, in kg. */
export function actualKg(rows: SizeRow[]): number {
  return rows.reduce((s, r) => s + ((r.weightGrams ?? 0) * (r.pieces || 0)) / 1000, 0);
}

/** L×W×H / 5000 × pieces, in kg (the backend's own volumetric formula). */
export function volumetricKg(rows: SizeRow[]): number {
  return rows.reduce((s, r) => (r.length && r.width && r.height)
    ? s + (r.length * r.width * r.height) / VOLUMETRIC_DIVISOR * (r.pieces || 0) : s, 0);
}

const STEPS = ['Serviceability Check', 'Package Details', 'Mode of Dispatch', 'Shipment Details', 'Payment'] as const;
const PHONE = /^\d{10}$/;
const PINCODE = /^\d{6}$/;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Domestic (CASH) Shipment — the five-step booking wizard of the earlier OCCPL portal
 * (Serviceability Check → Package Details → Mode of Dispatch → Shipment Details → Payment,
 * then an invoice preview), on this app's own services: pincode/area lookup, the
 * serviceability check, District Level Freight per service, and POST /shipments.
 * The single-page Shipment Booking (`shipment-create.ts`) stays as it is.
 */
@Component({
  selector: 'app-domestic-cash-booking',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, UpperCasePipe, MatIconModule, UiButton],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">Domestic (CASH) Shipment</h1>
          <p class="text-caption">Book step by step: check the pincodes, enter the packages, pick the mode, fill the addresses, take payment.</p>
        </div>
      </header>

      <div class="wiz">
        <ol class="steps" aria-label="Booking steps">
          @for (label of steps; track label; let i = $index) {
            <li class="step" [class.step--done]="i < active()" [class.step--active]="i === active()" [attr.aria-current]="i === active() ? 'step' : null">
              <span class="step__dot">
                @if (i < active()) { <mat-icon>check</mat-icon> } @else { {{ i + 1 }} }
              </span>
              <span class="step__label">{{ label }}</span>
            </li>
          }
        </ol>

        <section class="card">
          @switch (active()) {
            @case (0) {
              <h2 class="card__title">What are you shipping?</h2>
              <div class="seg" role="radiogroup" aria-label="Type">
                @for (t of itemTypes; track t.value) {
                  <button type="button" class="seg__opt" role="radio" [attr.aria-checked]="itemType() === t.value"
                          [class.seg__opt--on]="itemType() === t.value" (click)="setItemType(t.value)">
                    <mat-icon>{{ t.icon }}</mat-icon> {{ t.label }}
                  </button>
                }
              </div>
              <div class="grid2">
                <label class="f"><span class="f__l">AWB Number (Optional)</span>
                  <input class="f__i" [value]="awbNumber()" (input)="awbNumber.set(val($event))" placeholder="Auto-generated if left blank" /></label>
                <label class="f"><span class="f__l">Reference ID</span>
                  <input class="f__i" [value]="referenceId()" (input)="referenceId.set(val($event))" /></label>
                <label class="f"><span class="f__l">Consignor (Sender) Pin code</span>
                  <span class="f__wrap">
                    <input class="f__i" inputmode="numeric" maxlength="6" [value]="fromPincode()" (input)="onPincode('from', $event)" />
                    <span class="f__adorn">{{ adorn(fromInfo()) }}</span>
                  </span>
                  @if (fromInfo().state === 'error') { <span class="f__err">{{ fromInfo().message }}</span> }
                </label>
                <label class="f"><span class="f__l">Consignee (Receiver) Pin code</span>
                  <span class="f__wrap">
                    <input class="f__i" inputmode="numeric" maxlength="6" [value]="toPincode()" (input)="onPincode('to', $event)" />
                    <span class="f__adorn">{{ adorn(toInfo()) }}</span>
                  </span>
                  @if (toInfo().state === 'error') { <span class="f__err">{{ toInfo().message }}</span> }
                </label>
              </div>
            }

            @case (1) {
              <h2 class="card__title">Package Details</h2>
              <label class="f f--narrow"><span class="f__l">Number of Pieces</span>
                <input class="f__i" type="number" min="1" [value]="numPieces() ?? ''" (input)="setNumPieces($event)" /></label>
              @if (itemType() === 'DOCUMENT') {
                <label class="f f--narrow"><span class="f__l">Total Weight (grams)</span>
                  <input class="f__i" type="number" min="1" [value]="docWeightGrams() ?? ''" (input)="docWeightGrams.set(num($event))" /></label>
              } @else {
                <div class="rows">
                  @for (r of rows(); track $index; let i = $index) {
                    <div class="row">
                      <label class="f"><span class="f__l">Length (cm)</span><input class="f__i" type="number" min="0" [value]="r.length ?? ''" (input)="setRow(i, 'length', $event)" /></label>
                      <label class="f"><span class="f__l">Width (cm)</span><input class="f__i" type="number" min="0" [value]="r.width ?? ''" (input)="setRow(i, 'width', $event)" /></label>
                      <label class="f"><span class="f__l">Height (cm)</span><input class="f__i" type="number" min="0" [value]="r.height ?? ''" (input)="setRow(i, 'height', $event)" /></label>
                      <label class="f"><span class="f__l">Weight (grams)</span><input class="f__i" type="number" min="0" [value]="r.weightGrams ?? ''" (input)="setRow(i, 'weightGrams', $event)" /></label>
                      <label class="f"><span class="f__l">Pieces of Same Size</span><input class="f__i" type="number" min="1" [value]="r.pieces" (input)="setRow(i, 'pieces', $event)" /></label>
                      <button type="button" class="icon-btn" [disabled]="rows().length === 1" (click)="removeRow(i)" aria-label="Remove this size"><mat-icon>delete</mat-icon></button>
                    </div>
                  }
                </div>
                <app-button variant="stroked" icon="add" (pressed)="addRow()">Add Package</app-button>
              }
              <div class="weights">
                <span>Actual: <strong>{{ weights().actual | number: '1.3-3' }} kg</strong></span>
                @if (itemType() === 'PARCEL') { <span>Volumetric: <strong>{{ weights().volumetric | number: '1.3-3' }} kg</strong></span> }
                <span>Chargeable: <strong>{{ weights().chargeable | number: '1.3-3' }} kg</strong></span>
              </div>
            }

            @case (2) {
              <h2 class="card__title">Select Delivery Mode</h2>
              <p class="text-caption">{{ fromInfo().city || fromPincode() }} → {{ toInfo().city || toPincode() }} · chargeable {{ weights().chargeable | number: '1.3-3' }} kg</p>
              @if (ratesLoading()) {
                <p class="muted">Getting rates for every mode…</p>
              } @else if (!modes().length) {
                <p class="muted">No delivery mode is set up for this company yet.</p>
              } @else {
                <div class="modes" role="radiogroup" aria-label="Delivery mode">
                  @for (m of modes(); track m.serviceTypeId) {
                    <button type="button" class="mode" role="radio" [attr.aria-checked]="modeId() === m.serviceTypeId"
                            [class.mode--on]="modeId() === m.serviceTypeId" [disabled]="m.total === null" (click)="modeId.set(m.serviceTypeId)">
                      <span class="mode__radio"></span>
                      <span class="mode__name">{{ m.label | uppercase }}</span>
                      @if (m.total === null) {
                        <span class="mode__err">{{ m.error }}</span>
                      } @else {
                        <span class="mode__meta">Rate: <strong>₹ {{ m.estimate | number: '1.0-0' }}</strong></span>
                        <span class="mode__meta">Chargeable Weight: {{ weights().chargeable | number: '1.3-3' }} kg</span>
                        <span class="mode__meta">Time to Deliver: {{ m.days != null ? m.days + ' day' + (m.days === 1 ? '' : 's') : 'N/A' }}</span>
                      }
                    </button>
                  }
                </div>
              }
            }

            @case (3) {
              @if (chosen(); as m) {
                <div class="chosen">
                  <span>Selected Mode of Shipment: <strong>{{ m.label }}</strong></span>
                  <span>Rate: <strong>₹ {{ m.estimate | number: '1.0-0' }}</strong></span>
                  <span>Time to Deliver: <strong>{{ m.days != null ? m.days + ' days' : 'N/A' }}</strong></span>
                </div>
              }
              <label class="f"><span class="f__l">Package Description</span>
                <textarea class="f__i f__ta" rows="4" [value]="d()['packageDescription']" (input)="setD('packageDescription', $event)"></textarea></label>
              <label class="f f--narrow"><span class="f__l">Package Value (₹)</span>
                <input class="f__i" inputmode="numeric" [value]="d()['packageValue']" (input)="setDigits('packageValue', $event, 9)" /></label>
              <div class="grid2 parties">
                @for (side of sides; track side.key) {
                  <div>
                    <h3 class="party__title">{{ side.title }}</h3>
                    <label class="f"><span class="f__l">Name</span><input class="f__i" [value]="d()[side.key + 'Name']" (input)="setD(side.key + 'Name', $event)" /></label>
                    <label class="f"><span class="f__l">{{ side.title.split(' ')[0] }} Address</span><input class="f__i" [value]="d()[side.key + 'Address']" (input)="setD(side.key + 'Address', $event)" /></label>
                    <div class="grid2">
                      <label class="f"><span class="f__l">{{ side.title.split(' ')[0] }} City</span><input class="f__i" readonly [value]="(side.key === 'pickup' ? fromInfo() : toInfo()).city ?? ''" /></label>
                      <label class="f"><span class="f__l">District</span><input class="f__i" readonly [value]="(side.key === 'pickup' ? fromInfo() : toInfo()).district ?? ''" /></label>
                    </div>
                    <label class="f"><span class="f__l">{{ side.title.split(' ')[0] }} Contact Number</span><input class="f__i" inputmode="numeric" maxlength="10" [value]="d()[side.key + 'Contact']" (input)="setDigits(side.key + 'Contact', $event, 10)" /></label>
                    <label class="f"><span class="f__l">Alternate {{ side.title.split(' ')[0] }} Contact Number (Optional)</span><input class="f__i" inputmode="numeric" maxlength="10" [value]="d()[side.key + 'AltContact']" (input)="setDigits(side.key + 'AltContact', $event, 10)" /></label>
                    <label class="f"><span class="f__l">{{ side.title.split(' ')[0] }} Email (Optional)</span><input class="f__i" type="email" [value]="d()[side.key + 'Email']" (input)="setD(side.key + 'Email', $event)" /></label>
                  </div>
                }
              </div>
            }

            @case (4) {
              <h2 class="card__title">Payment Method</h2>
              <div class="pay" role="radiogroup" aria-label="Payment method">
                @for (p of paymentOptions(); track p.value) {
                  <button type="button" class="mode mode--row" role="radio" [attr.aria-checked]="paymentModeId() === p.value"
                          [class.mode--on]="paymentModeId() === p.value" (click)="paymentModeId.set(p.value + '')">
                    <span class="mode__radio"></span><span class="mode__name">{{ p.label }}</span>
                  </button>
                }
              </div>
            }
          }

          <div class="nav">
            <app-button variant="text" icon="arrow_back" [disabled]="active() === 0 || busy()" (pressed)="back()">Back</app-button>
            <span class="nav__sp"></span>
            <app-button [loading]="busy()" (pressed)="next()">{{ active() === steps.length - 1 ? 'Finish and Preview' : 'Next' }}</app-button>
          </div>
        </section>
      </div>

      @if (previewOpen()) {
        <div class="ovl" (click)="previewOpen.set(false)">
          <div class="inv" role="dialog" aria-modal="true" aria-labelledby="inv-title" (click)="$event.stopPropagation()">
            <h2 id="inv-title" class="inv__title">Invoice Preview</h2>
            <div class="inv__grid">
              <div><h4>From</h4><p><strong>{{ d()['pickupName'] }}</strong></p><p>{{ d()['pickupAddress'] }}</p><p>{{ fromInfo().city }} – {{ fromPincode() }}</p><p>{{ d()['pickupContact'] }}</p></div>
              <div><h4>To</h4><p><strong>{{ d()['deliveryName'] }}</strong></p><p>{{ d()['deliveryAddress'] }}</p><p>{{ toInfo().city }} – {{ toPincode() }}</p><p>{{ d()['deliveryContact'] }}</p></div>
            </div>
            <table class="inv__t">
              <tbody>
                <tr><td>Type</td><td>{{ itemType() === 'DOCUMENT' ? 'Document' : 'Parcel' }}</td></tr>
                @if (awbNumber()) { <tr><td>AWB Number</td><td>{{ awbNumber() }}</td></tr> }
                @if (referenceId()) { <tr><td>Reference ID</td><td>{{ referenceId() }}</td></tr> }
                <tr><td>Pieces</td><td>{{ numPieces() }}</td></tr>
                <tr><td>Chargeable Weight</td><td>{{ weights().chargeable | number: '1.3-3' }} kg</td></tr>
                <tr><td>Mode</td><td>{{ chosen()?.label }}</td></tr>
                <tr><td>Description</td><td>{{ d()['packageDescription'] }}</td></tr>
                <tr><td>Package Value</td><td>₹ {{ d()['packageValue'] }}</td></tr>
                <tr><td>Payment</td><td>{{ paymentLabel() }}</td></tr>
                @if (chosen(); as m) {
                  <tr><td>Freight</td><td>₹ {{ m.freight | number: '1.2-2' }}</td></tr>
                  @if (m.oda) { <tr><td>ODA</td><td>₹ {{ m.oda | number: '1.2-2' }}</td></tr> }
                  @if (m.extras) { <tr><td>Other Charges</td><td>₹ {{ m.extras | number: '1.2-2' }}</td></tr> }
                  <tr><td>GST {{ gstPercent() }}%</td><td>₹ {{ m.gst | number: '1.2-2' }}</td></tr>
                  <tr class="inv__total"><td>Total</td><td>₹ {{ m.estimate | number: '1.0-0' }}</td></tr>
                }
              </tbody>
            </table>
            <p class="text-caption">The final amount is worked out again when the shipment is booked.</p>
            <div class="nav">
              <app-button variant="text" [disabled]="busy()" (pressed)="previewOpen.set(false)">Close</app-button>
              <span class="nav__sp"></span>
              <app-button icon="check" [loading]="busy()" (pressed)="confirm()">Confirm</app-button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .wiz { width: 100%; max-width: 960px; margin: 0 auto; box-sizing: border-box; display: flex; flex-direction: column; gap: 20px; }
    .steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(5, 1fr); }
    .step { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
    .step:not(:first-child)::before { content: ''; position: absolute; top: 15px; right: 50%; width: 100%; height: 2px; background: var(--surface-border); z-index: 0; }
    .step--done:not(:first-child)::before, .step--active:not(:first-child)::before { background: var(--brand-600); }
    .step__dot { position: relative; z-index: 1; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center;
      font: 600 13px var(--font-sans); background: var(--surface); color: var(--content-muted); border: 2px solid var(--surface-border); }
    .step__dot mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .step--active .step__dot, .step--done .step__dot { background: var(--brand-600); border-color: var(--brand-600); color: #fff; }
    .step__label { font: 500 12px var(--font-sans); color: var(--content-muted); }
    .step--active .step__label { color: var(--content-fg); font-weight: 600; }
    .card { background: var(--surface); border: 1px solid var(--surface-border); border-radius: 12px; padding: 24px; display: flex; flex-direction: column; gap: 14px; }
    .card__title { font: 600 18px var(--font-sans); color: var(--content-fg); margin: 0; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 20px; }
    .f { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .f--narrow { max-width: 280px; }
    .f__l { font: 500 12px var(--font-sans); color: var(--content-muted); }
    .f__wrap { position: relative; display: flex; }
    .f__i { width: 100%; box-sizing: border-box; border: 1px solid var(--surface-border); border-radius: var(--r-field, 8px); padding: 10px 12px;
      font: 400 14px var(--font-sans); color: var(--content-fg); background: var(--surface); outline: 0; }
    .f__i:focus { border-color: var(--brand-600); box-shadow: 0 0 0 3px var(--brand-50); }
    .f__i[readonly] { background: var(--surface-muted, var(--brand-50)); color: var(--content-muted); }
    .f__wrap .f__i { padding-right: 160px; }
    .f__adorn { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font: 600 13px var(--font-sans); color: var(--brand-700);
      max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .f__ta { resize: vertical; }
    .f__err { font: 500 12px var(--font-sans); color: var(--danger); }
    .seg { display: inline-flex; gap: 8px; }
    .seg__opt { display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--surface-border); background: var(--surface); font: 500 14px var(--font-sans); color: var(--content-fg); }
    .seg__opt mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .seg__opt--on { border-color: var(--brand-600); background: var(--brand-50); color: var(--brand-700); }
    .rows { display: flex; flex-direction: column; gap: 10px; }
    .row { display: grid; grid-template-columns: repeat(5, 1fr) 40px; gap: 10px; align-items: end; }
    .icon-btn { width: 40px; height: 40px; display: grid; place-items: center; border: 0; background: transparent; cursor: pointer; color: var(--content-muted); border-radius: 8px; }
    .icon-btn:hover:not(:disabled) { color: var(--danger); background: var(--danger-bg); }
    .icon-btn:disabled { opacity: .3; cursor: default; }
    .weights { display: flex; flex-wrap: wrap; gap: 8px 24px; padding: 12px 14px; border-radius: 8px; background: var(--brand-50); font: 400 13px var(--font-sans); color: var(--content-fg); }
    .modes, .pay { display: flex; flex-direction: column; gap: 10px; }
    .mode { display: grid; grid-template-columns: 22px 1fr; column-gap: 12px; row-gap: 2px; align-items: center; text-align: left; cursor: pointer;
      padding: 14px 16px; border: 1px solid var(--surface-border); border-radius: 10px; background: var(--surface); font: 400 13px var(--font-sans); color: var(--content-fg); }
    .mode:hover:not(:disabled) { border-color: var(--brand-500); }
    .mode:disabled { cursor: default; opacity: .6; }
    .mode--on { border-color: var(--brand-600); background: var(--brand-50); }
    .mode__radio { grid-row: span 4; width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--surface-border); box-sizing: border-box; }
    .mode--row .mode__radio { grid-row: auto; }
    .mode--on .mode__radio { border: 5px solid var(--brand-600); }
    .mode__name { font: 600 14px var(--font-sans); }
    .mode__meta { color: var(--content-muted); }
    .mode__meta strong { color: var(--content-fg); }
    .mode__err { color: var(--danger); }
    .chosen { display: flex; flex-wrap: wrap; gap: 6px 24px; padding: 12px 14px; border-radius: 8px; background: var(--brand-50); font: 400 14px var(--font-sans); color: var(--content-fg); }
    .party__title { font: 600 15px var(--font-sans); margin: 8px 0 4px; color: var(--content-fg); }
    .parties > div { display: flex; flex-direction: column; gap: 12px; }
    .muted { color: var(--content-muted); font: 400 14px var(--font-sans); }
    .nav { display: flex; align-items: center; padding-top: 8px; }
    .nav__sp { flex: 1; }
    .ovl { position: fixed; inset: 0; background: rgba(15, 23, 42, .45); display: grid; place-items: center; z-index: 1000; padding: 16px; }
    .inv { background: var(--surface); border-radius: 12px; padding: 24px; width: min(640px, 100%); max-height: 90vh; overflow: auto; display: flex; flex-direction: column; gap: 14px; }
    .inv__title { margin: 0; font: 600 20px var(--font-sans); color: var(--content-fg); }
    .inv__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; font: 400 13px var(--font-sans); color: var(--content-fg); }
    .inv__grid h4 { margin: 0 0 4px; font: 600 12px var(--font-sans); color: var(--content-muted); text-transform: uppercase; }
    .inv__grid p { margin: 0; }
    .inv__t { width: 100%; border-collapse: collapse; font: 400 13px var(--font-sans); color: var(--content-fg); }
    .inv__t td { padding: 7px 0; border-bottom: 1px solid var(--surface-border); }
    .inv__t td:last-child { text-align: right; }
    .inv__total td { font: 700 16px var(--font-sans); border-bottom: 0; }
    @media (max-width: 720px) {
      .grid2, .inv__grid { grid-template-columns: 1fr; }
      .row { grid-template-columns: 1fr 1fr; }
      .step__label { display: none; }
      .card { padding: 16px; }
    }
  `]
})
export class DomesticCashBooking implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly masters = inject(MasterDataService);
  private readonly settings = inject(SettingsService);
  private readonly dialogs = inject(DialogService);
  private readonly shipments = inject(ShipmentService);
  private readonly freight = inject(FreightCalculationService);
  private readonly router = inject(Router);

  protected readonly steps = STEPS;
  protected readonly itemTypes = [
    { value: 'DOCUMENT' as const, label: 'Document', icon: 'description' },
    { value: 'PARCEL' as const, label: 'Parcel', icon: 'inventory_2' }
  ];
  protected readonly sides = [
    { key: 'pickup', title: 'Pickup Details' },
    { key: 'delivery', title: 'Delivery Details' }
  ];

  private readonly branchId = this.auth.user()?.branchId ?? null;

  protected readonly active = signal(0);
  protected readonly busy = signal(false);
  protected readonly previewOpen = signal(false);

  // Step 1
  protected readonly itemType = signal<'DOCUMENT' | 'PARCEL' | null>(null);
  protected readonly awbNumber = signal('');
  protected readonly referenceId = signal('');
  protected readonly fromPincode = signal('');
  protected readonly toPincode = signal('');
  protected readonly fromInfo = signal<PincodeInfo>({ state: 'idle' });
  protected readonly toInfo = signal<PincodeInfo>({ state: 'idle' });
  private lookupSeq = { from: 0, to: 0 };

  // Step 2
  protected readonly numPieces = signal<number | null>(null);
  protected readonly docWeightGrams = signal<number | null>(null);
  protected readonly rows = signal<SizeRow[]>([{ length: null, width: null, height: null, weightGrams: null, pieces: 1 }]);
  private readonly minChargeableKg = signal<number | null>(null);
  protected readonly weights = computed(() => {
    const doc = this.itemType() === 'DOCUMENT';
    const actual = doc ? (this.docWeightGrams() ?? 0) / 1000 : actualKg(this.rows());
    const volumetric = doc ? 0 : volumetricKg(this.rows());
    const floor = this.minChargeableKg();
    const raw = Math.max(actual, volumetric);
    return { actual: round3(actual), volumetric: round3(volumetric), chargeable: round3(floor != null && raw > 0 ? Math.max(raw, floor) : raw) };
  });

  // Step 3
  private readonly serviceOptions = signal<SelectOption[]>([]);
  private readonly deliveryDays = signal<Map<string, number | null>>(new Map());
  private readonly packageTypeOptions = signal<SelectOption[]>([]);
  protected readonly gstPercent = signal(18);
  protected readonly modes = signal<ModeRate[]>([]);
  protected readonly ratesLoading = signal(false);
  protected readonly modeId = signal<string | null>(null);
  protected readonly chosen = computed(() => this.modes().find((m) => m.serviceTypeId === this.modeId()) ?? null);

  // Step 4
  protected readonly d = signal<Record<string, string>>({
    packageDescription: '', packageValue: '',
    pickupName: '', pickupAddress: '', pickupContact: '', pickupAltContact: '', pickupEmail: '',
    deliveryName: '', deliveryAddress: '', deliveryContact: '', deliveryAltContact: '', deliveryEmail: ''
  });

  // Step 5
  protected readonly paymentOptions = signal<SelectOption[]>([]);
  protected readonly paymentModeId = signal<string | null>(null);
  protected readonly paymentLabel = computed(() => this.paymentOptions().find((o) => o.value === this.paymentModeId())?.label ?? '—');

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Shipments', route: '/shipments' }, { label: 'Domestic (CASH) Shipment' }]);
    this.masters.options('service-types').subscribe((o) => this.serviceOptions.set(o));
    this.masters.options('package-types').subscribe((o) => this.packageTypeOptions.set(o));
    this.masters.serviceTypeDirectory().subscribe((rows) => this.deliveryDays.set(new Map(rows.map((r) => [r.id, r.deliveryDays]))));
    this.masters.options('payment-modes').subscribe((o) => {
      this.paymentOptions.set(o);
      // Cash counter: Paid is the default, as on the earlier portal.
      const paid = o.find((opt) => /\(PAID\)$/i.test(opt.label)) ?? o.find((opt) => /cash/i.test(opt.label));
      if (paid && !this.paymentModeId()) this.paymentModeId.set(String(paid.value));
    });
    this.masters.branchDirectory().subscribe((list) => {
      const mine = list.find((b) => b.id === this.branchId);
      if (mine?.gstPercentage != null) this.gstPercent.set(mine.gstPercentage);
      if (mine?.postalCode && !this.fromPincode()) this.lookup('from', mine.postalCode);
    });
    this.settings.get().subscribe((s) => {
      const kg = (s as { shipment?: { defaultChargeableWeightKg?: number } })?.shipment?.defaultChargeableWeightKg;
      if (kg != null) this.minChargeableKg.set(Number(kg));
    });
  }

  // ---------- helpers for the template ----------
  protected val(e: Event): string { return (e.target as HTMLInputElement).value; }
  protected num(e: Event): number | null {
    const v = (e.target as HTMLInputElement).value;
    return v === '' ? null : Number(v);
  }
  protected adorn(i: PincodeInfo): string {
    return i.state === 'loading' ? 'Checking…' : i.state === 'ok' ? (i.city ?? i.district ?? '✓') : '';
  }

  protected setItemType(t: 'DOCUMENT' | 'PARCEL'): void {
    this.itemType.set(t);
    this.modes.set([]);
    this.modeId.set(null);
  }

  protected onPincode(side: 'from' | 'to', e: Event): void {
    const input = e.target as HTMLInputElement;
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
    this.lookup(side, input.value);
  }

  /** Six digits → the pincode's city (shown inside the field) and, for the destination, its Area and serviceability. */
  private lookup(side: 'from' | 'to', code: string): void {
    (side === 'from' ? this.fromPincode : this.toPincode).set(code);
    const info = side === 'from' ? this.fromInfo : this.toInfo;
    const seq = ++this.lookupSeq[side];
    if (!PINCODE.test(code)) { info.set({ state: 'idle' }); return; }
    info.set({ state: 'loading' });
    this.masters.list(MASTER_DEFINITIONS['pincodes'], { page: 0, size: 5, search: code }).pipe(
      switchMap((page) => {
        const match = page.content.find((r) => r.code === code);
        if (!match) return of<PincodeInfo>({ state: 'error', message: 'This pincode is not on file.' });
        return this.masters.pincodeAreas(match.id).pipe(
          switchMap((areas) => {
            const area = areas.find((a) => a.primary) ?? areas[0];
            if (!area) return of<PincodeInfo>({ state: 'error', message: 'No area is set up for this pincode.' });
            const geo = this.masters.pincodeGeo(code, area.areaId).pipe(catchError(() => of(null)));
            if (side === 'from') {
              return geo.pipe(map((g): PincodeInfo => ({ state: 'ok', city: g?.cityName ?? area.cityName, district: g?.districtName ?? null, areaId: area.areaId })));
            }
            return forkJoin({ geo, svc: this.shipments.checkServiceability(code, area.areaId, this.branchId).pipe(catchError(() => of(null))) }).pipe(
              map(({ geo: g, svc }): PincodeInfo => svc && !svc.serviceable
                ? { state: 'error', city: svc.cityName, message: svc.message ?? 'Delivery is not available to this pincode.' }
                : { state: 'ok', city: g?.cityName ?? svc?.cityName ?? area.cityName, district: g?.districtName ?? null, areaId: area.areaId })
            );
          })
        );
      }),
      catchError(() => of<PincodeInfo>({ state: 'error', message: 'Could not check this pincode.' }))
    ).subscribe((r) => { if (seq === this.lookupSeq[side]) info.set(r); });
  }

  protected setNumPieces(e: Event): void {
    const n = this.num(e);
    this.numPieces.set(n && n > 0 ? Math.floor(n) : null);
    // One size row covering every piece, as the earlier portal started it.
    if (this.itemType() === 'PARCEL' && n && n > 0 && this.rows().length === 1) {
      this.rows.update((rs) => [{ ...rs[0], pieces: Math.floor(n) }]);
    }
  }

  protected setRow(i: number, key: keyof SizeRow, e: Event): void {
    const n = this.num(e);
    this.rows.update((rs) => rs.map((r, j) => j === i ? { ...r, [key]: key === 'pieces' ? Math.max(1, Math.floor(n ?? 1)) : n } : r));
  }

  protected addRow(): void {
    this.rows.update((rs) => [...rs, { length: null, width: null, height: null, weightGrams: null, pieces: 1 }]);
  }

  protected removeRow(i: number): void {
    this.rows.update((rs) => rs.length > 1 ? rs.filter((_, j) => j !== i) : rs);
  }

  protected setD(key: string, e: Event): void {
    const v = this.val(e);
    this.d.update((d) => ({ ...d, [key]: v }));
  }

  protected setDigits(key: string, e: Event, max: number): void {
    const input = e.target as HTMLInputElement;
    input.value = input.value.replace(/\D/g, '').slice(0, max);
    this.d.update((d) => ({ ...d, [key]: input.value }));
  }

  // ---------- navigation ----------
  protected back(): void {
    if (this.active() > 0) this.active.update((s) => s - 1);
  }

  protected next(): void {
    const error = this.stepError(this.active());
    if (error) { this.notify.error(error); return; }
    switch (this.active()) {
      case 0: {
        const awb = this.awbNumber().trim();
        if (!awb) { this.active.set(1); return; }
        this.busy.set(true);
        this.shipments.list({ page: 0, size: 5, search: awb }).pipe(catchError(() => of(null))).subscribe((page) => {
          this.busy.set(false);
          if (page?.content.some((s) => s.shipmentNumber?.toUpperCase() === awb.toUpperCase())) {
            this.notify.error('AWB number already exists. Please use a different AWB number.');
            return;
          }
          this.active.set(1);
        });
        return;
      }
      case 1:
        this.dialogs.confirm({
          title: 'Confirm Weight',
          message: `Are you sure you want to ship actual weight ${this.weights().actual.toFixed(2)} kg?`,
          confirmLabel: 'Yes'
        }).subscribe((ok) => { if (ok) { this.active.set(2); this.loadRates(); } });
        return;
      case 4:
        this.previewOpen.set(true);
        return;
      default:
        this.active.update((s) => s + 1);
    }
  }

  /** Why the given step cannot move on yet, or null. */
  stepError(step: number): string | null {
    switch (step) {
      case 0:
        if (!this.itemType()) return 'Please select an Item Type.';
        if (!PINCODE.test(this.fromPincode())) return 'Enter the 6-digit consignor (sender) pincode.';
        if (!PINCODE.test(this.toPincode())) return 'Enter the 6-digit consignee (receiver) pincode.';
        if (this.fromInfo().state === 'loading' || this.toInfo().state === 'loading') return 'Still checking the pincodes — try again in a moment.';
        if (this.fromInfo().state === 'error') return this.fromInfo().message ?? 'Pickup pincode is not serviceable.';
        if (this.toInfo().state !== 'ok') return this.toInfo().message ?? 'Pincode is not serviceable.';
        if (!this.branchId) return 'Your user has no branch, so it cannot book shipments.';
        return null;
      case 1: {
        const pieces = this.numPieces();
        if (!pieces) return 'Enter the number of pieces.';
        if (this.itemType() === 'DOCUMENT') return (this.docWeightGrams() ?? 0) > 0 ? null : 'Enter the total weight in grams.';
        if (this.rows().some((r) => !r.weightGrams || r.weightGrams <= 0)) return 'Enter the weight of every package size.';
        const total = this.rows().reduce((s, r) => s + r.pieces, 0);
        return total === pieces ? null : 'Pieces of same size does not match with the total number of pieces.';
      }
      case 2:
        return this.chosen() ? null : 'Please select a mode of shipment.';
      case 3: {
        const d = this.d();
        const required: [string, string][] = [['packageDescription', 'Package Description'], ['packageValue', 'Package Value'],
          ['pickupName', 'Pickup Name'], ['pickupAddress', 'Pickup Address'], ['pickupContact', 'Pickup Contact Number'],
          ['deliveryName', 'Delivery Name'], ['deliveryAddress', 'Delivery Address'], ['deliveryContact', 'Delivery Contact Number']];
        const missing = required.find(([k]) => !d[k]?.trim());
        if (missing) return `${missing[1]} is required.`;
        if (!(Number(d['packageValue']) > 0)) return 'Package Value must be more than zero.';
        const phones: [string, string][] = [['pickupContact', 'Pickup Contact Number'], ['pickupAltContact', 'Alternate Pickup Contact Number'],
          ['deliveryContact', 'Delivery Contact Number'], ['deliveryAltContact', 'Alternate Delivery Contact Number']];
        const bad = phones.find(([k]) => d[k] && !PHONE.test(d[k]));
        return bad ? `${bad[1]} must be exactly 10 digits.` : null;
      }
      case 4:
        return this.paymentModeId() ? null : 'Please select a payment method.';
      default:
        return null;
    }
  }

  /** The package type the zone tariff prices by: Document or Non Document. */
  private packageTypeId(): string | null {
    const doc = this.itemType() === 'DOCUMENT';
    const opt = this.packageTypeOptions().find((o) => doc ? /^\s*doc/i.test(o.label) && !/non/i.test(o.label) : /non[\s-]?doc/i.test(o.label));
    return opt ? String(opt.value) : null;
  }

  /** Every service priced for this destination and weight (one freight call each). */
  private loadRates(): void {
    const services = this.serviceOptions();
    const areaId = this.toInfo().areaId;
    if (!services.length || !areaId || !this.branchId) { this.modes.set([]); return; }
    this.ratesLoading.set(true);
    const calls: Observable<ModeRate>[] = services.map((svc) => {
      const label = svc.label.replace(/\s*\(.*\)$/, '');
      const days = this.deliveryDays().get(String(svc.value)) ?? null;
      return this.freight.calculate({
        bookingBranchId: this.branchId!, destinationPincode: this.toPincode(), destinationAreaId: areaId,
        chargeableWeight: this.weights().chargeable, businessCustomerId: null, declaredValue: null,
        serviceTypeId: String(svc.value), packageTypeId: this.packageTypeId(),
        numberOfPackages: this.numPieces() || 1, bookingDate: null
      }).pipe(
        map((r): ModeRate => {
          const freight = Number(r.baseFreight ?? 0);
          const oda = Number(r.odaCharge ?? 0);
          const extras = Number(r.customerExtraCharges ?? 0);
          const gst = Math.round((freight + oda + extras) * this.gstPercent()) / 100;
          return { serviceTypeId: String(svc.value), label, total: r.totalFreight, freight, oda, extras, gst,
            estimate: Math.round(freight + oda + extras + gst), days, basis: r.weightSlabLabel };
        }),
        catchError((e: HttpErrorResponse) => of<ModeRate>({ serviceTypeId: String(svc.value), label, total: null,
          error: e?.error?.message ?? 'No rate for this destination.', freight: 0, oda: 0, extras: 0, gst: 0, estimate: 0, days }))
      );
    });
    forkJoin(calls).subscribe((rates) => {
      this.ratesLoading.set(false);
      // Priced modes first, cheapest first; the rest show why they cannot be used.
      this.modes.set([...rates].sort((a, b) => (a.total === null ? 1 : 0) - (b.total === null ? 1 : 0) || a.estimate - b.estimate));
      if (!this.chosen()) this.modeId.set(null);
    });
  }

  /** The POST /shipments body for what the wizard holds. */
  buildRequest(): CreateShipmentRequest {
    const d = this.d();
    const doc = this.itemType() === 'DOCUMENT';
    const value = Number(d['packageValue']) || null;
    const items: ShipmentItemRequest[] = doc
      ? [{ itemName: d['packageDescription'].trim() || 'Document', quantity: this.numPieces() || 1, weight: round3((this.docWeightGrams() ?? 0) / 1000), declaredValue: value }]
      : this.rows().map((r, i) => ({
        itemName: d['packageDescription'].trim() || 'Parcel', quantity: r.pieces,
        weight: round3(((r.weightGrams ?? 0) * r.pieces) / 1000),
        lengthCm: r.length, widthCm: r.width, heightCm: r.height,
        declaredValue: i === 0 ? value : null
      }));
    const extra = [
      this.referenceId().trim() && `Ref: ${this.referenceId().trim()}`,
      d['pickupAltContact'] && `Alt pickup: ${d['pickupAltContact']}`,
      d['deliveryAltContact'] && `Alt delivery: ${d['deliveryAltContact']}`,
      d['pickupEmail'].trim() && `Pickup email: ${d['pickupEmail'].trim()}`,
      d['deliveryEmail'].trim() && `Delivery email: ${d['deliveryEmail'].trim()}`
    ].filter(Boolean).join(' · ');
    return {
      bookingBranchId: this.branchId!, manualShipmentNumber: this.awbNumber().trim() || null,
      pickupPincode: this.fromPincode(), deliveryPincode: this.toPincode(), destinationAreaId: this.toInfo().areaId ?? null,
      senderName: d['pickupName'].trim(), senderAddress: d['pickupAddress'].trim(), senderContact: d['pickupContact'],
      receiverName: d['deliveryName'].trim(), receiverAddress: d['deliveryAddress'].trim(), receiverContact: d['deliveryContact'],
      serviceTypeId: this.modeId()!, packageTypeId: this.packageTypeId(), paymentModeId: this.paymentModeId()!,
      declaredValue: value, numberOfPackages: this.numPieces() || 1, items,
      remarks: extra || null, deliveryType: 'DOOR'
    };
  }

  protected confirm(): void {
    this.busy.set(true);
    this.shipments.create(this.buildRequest()).subscribe({
      next: (s) => {
        this.busy.set(false);
        this.previewOpen.set(false);
        this.notify.success(`Shipment booked. AWB: ${s.shipmentNumber}`);
        this.router.navigate(['/shipments', s.id]);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        const specific: string | null = err.status >= 400 && err.status < 500 ? err.error?.message : null;
        this.notify.error(specific?.startsWith('Insufficient wallet balance')
          ? 'Insufficient wallet balance — recharge your wallet or choose a different payment mode.'
          : specific ?? 'Could not book this shipment.');
      }
    });
  }
}
