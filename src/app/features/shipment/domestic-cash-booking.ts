import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { DecimalPipe, NgTemplateOutlet, UpperCasePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { MASTER_DEFINITIONS } from '@features/masters/master.config';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { CreateShipmentRequest, ShipmentItemRequest } from '@core/models/shipment.model';
import { ShipmentService } from './shipment.service';
import { CustomerService } from '@features/customer/customer.service';
import { BusinessCustomerService } from '@features/business-customer/business-customer.service';
import { CustomerResponse } from '@core/models/customer.model';
import { FreightCalculationService } from './freight-calculation.service';
import { codCharge, COD_MINIMUM, COD_PERCENT, fovCharge, FOV_MINIMUM, FOV_PERCENT, isCodOption } from './fov';
import { SettingsService } from '@features/settings/settings.service';
import { MatDialog } from '@angular/material/dialog';
import { CounterPaymentMethod } from '@core/models/shipment.model';
import { CounterPayment } from './components/counter-payment';
import { RazorpayQrDialog, RazorpayQrDialogData, RazorpayQrResult } from './components/razorpay-qr-dialog';

/** The default when the service type sets no divisor of its own. */
const DEFAULT_VOLUMETRIC_DIVISOR = 5000;

/** One row of "pieces of the same size"; weight is per piece, in grams (as the desk is used to). */
export interface SizeRow { length: number | null; width: number | null; height: number | null; weightGrams: number | null; pieces: number; }

/** One service (mode of dispatch) priced for this booking. */
export interface ModeRate {
  serviceTypeId: string; label: string; total: number | null; error?: string;
  freight: number; oda: number; extras: number; gst: number; estimate: number; days: number | null; basis?: string;
  /** This service's own chargeable weight: its volumetric divisor can differ from the others'. */
  chargeable: number;
  /** A Cargo service: priced at 20 kg at least, so a lighter parcel gets the note that 20 kg costs the same. */
  cargo?: boolean;
}

/** Cargo is charged for at least this much: anything lighter costs the same as this. */
export const CARGO_MIN_KG = 20;

/** The modes to offer: only those with charges set up (a price above 0), cheapest first. */
export function pricedModes(rates: ModeRate[]): ModeRate[] {
  return rates.filter((m) => m.total !== null && m.total > 0).sort((a, b) => a.estimate - b.estimate);
}

/** A pincode as the wizard resolved it: its city and the Area the freight is priced against. */
interface PincodeInfo { state: 'idle' | 'loading' | 'ok' | 'error'; city?: string | null; district?: string | null; areaId?: string | null; message?: string; }

/** Per-piece grams × pieces, in kg. */
export function actualKg(rows: SizeRow[]): number {
  return rows.reduce((s, r) => s + ((r.weightGrams ?? 0) * (r.pieces || 0)) / 1000, 0);
}

/** L×W×H / divisor × pieces, in kg (the backend's own volumetric formula). The divisor is
 *  the service type's own (Air and Surface commonly differ), 5000 when it sets none. */
export function volumetricKg(rows: SizeRow[], divisor?: number | null): number {
  const by = divisor || DEFAULT_VOLUMETRIC_DIVISOR;
  return rows.reduce((s, r) => (r.length && r.width && r.height)
    ? s + (r.length * r.width * r.height) / by * (r.pieces || 0) : s, 0);
}

const VIEW_KEY = 'cs.domesticBooking.view';

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
  imports: [DecimalPipe, NgTemplateOutlet, UpperCasePipe, MatIconModule, UiButton, CounterPayment],
  template: `
    <div class="page" (keydown)="onKey($event)">
      <header class="page__head">
        <div>
          <h1 class="text-h1">{{ credit ? 'Credit Shipment' : 'Domestic (CASH) Shipment' }}</h1>
          <p class="text-caption">{{ credit ? 'Pick the credit client, then book: priced from their rate card and billed to them, with no payment at the counter.'
            : view() === 'steps' ? 'Book step by step: check the pincodes, enter the packages, pick the mode, fill the addresses, take payment.' : 'Every section on one page; the summary on the right prices it as you go.' }}</p>
        </div>
      </header>

      <div class="viewbar" role="radiogroup" aria-label="Page view" data-nav-skip>
        <button type="button" role="radio" class="viewbar__opt" [class.viewbar__opt--on]="view() === 'steps'" [attr.aria-checked]="view() === 'steps'" [attr.tabindex]="view() === 'steps' ? 0 : -1" (click)="setView('steps')">
          <mat-icon>view_carousel</mat-icon> Step by step
        </button>
        <button type="button" role="radio" class="viewbar__opt" [class.viewbar__opt--on]="view() === 'single'" [attr.aria-checked]="view() === 'single'" [attr.tabindex]="view() === 'single' ? 0 : -1" (click)="setView('single')">
          <mat-icon>view_agenda</mat-icon> Single page
        </button>
      </div>

      @if (credit) {
        <section class="card client" [class.client--set]="!!client()">
          <h2 class="sec"><span class="sec__num" [class.sec__num--done]="!!client()">@if (client()) { <mat-icon>check</mat-icon> } @else { <mat-icon>business</mat-icon> }</span>Credit Client
            @if (client(); as cl) { <span class="sec__aside">{{ cl.customerCode }} · billed as To Be Billed</span> }</h2>
          <div class="cb">
            <input class="f__i cb__i" role="combobox" aria-label="Credit client" aria-autocomplete="list" [attr.aria-expanded]="clientListOpen()"
                   aria-controls="client-list" placeholder="Type the client's name or code…" autocomplete="off"
                   [value]="clientQuery()" (input)="onClientQuery($event)" (focus)="clientListOpen.set(true)" (blur)="closeClientList()"
                   (keydown)="onClientKey($event)" data-client-input />
            @if (clientListOpen() && clientMatches().length) {
              <ul class="cb__list" id="client-list" role="listbox">
                @for (o of clientMatches(); track o.value; let k = $index) {
                  <li role="option" class="cb__opt" [class.cb__opt--hi]="k === clientHi()" [attr.aria-selected]="k === clientHi()"
                      (mousedown)="$event.preventDefault(); pickClient(o.value + '')">{{ o.label }}</li>
                }
              </ul>
            }
            @if (clientListOpen() && clientQuery() && !clientMatches().length) { <p class="f__err">No business customer matches “{{ clientQuery() }}”.</p> }
          </div>
          @if (client(); as cl) {
            <p class="client__meta">{{ cl.displayName }} · {{ cl.mobile }}@if (cl.billingCity) { · {{ cl.billingCity }} }</p>
          }
        </section>
      }

      @if (view() === 'steps') {
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
              <ng-container [ngTemplateOutlet]="tService" />
            }
            @case (1) {
              <h2 class="card__title">Package Details</h2>
              <ng-container [ngTemplateOutlet]="tPackages" />
            }
            @case (2) {
              <h2 class="card__title">Select Delivery Mode</h2>
              <p class="text-caption">{{ fromInfo().city || fromPincode() }} → {{ toInfo().city || toPincode() }} · chargeable {{ weights().chargeable | number: '1.3-3' }} kg</p>
              <ng-container [ngTemplateOutlet]="tModes" />
            }
            @case (3) {
              @if (chosen(); as m) {
                <div class="chosen">
                  <span>Selected Mode of Shipment: <strong>{{ m.label }}</strong></span>
                  <span>Rate: <strong>₹ {{ m.estimate | number: '1.0-0' }}</strong></span>
                  <span>Time to Deliver: <strong>{{ m.days != null ? m.days + ' days' : 'N/A' }}</strong></span>
                </div>
              }
              <ng-container [ngTemplateOutlet]="tDetails" />
            }
            @case (4) {
              <h2 class="card__title">Payment Method</h2>
              <ng-container [ngTemplateOutlet]="tPay" />
            }
          }

          <div class="nav">
            <app-button data-nav-skip variant="text" icon="arrow_back" [disabled]="active() === 0 || busy()" (pressed)="back()">Back</app-button>
            <span class="nav__sp"></span>
            <app-button [loading]="busy()" (pressed)="next()">{{ active() === steps.length - 1 ? (credit ? 'Generate AWB' : 'Finish and Preview') : 'Next' }}</app-button>
          </div>
        </section>
      </div>
      } @else {
      <div class="sp">
        <div class="sp__main">
          <section class="card">
            <h2 class="sec"><span class="sec__num" [class.sec__num--done]="!stepError(0)">@if (!stepError(0)) { <mat-icon>check</mat-icon> } @else { 1 }</span>Serviceability</h2>
            <ng-container [ngTemplateOutlet]="tService" />
          </section>
          <section class="card">
            <h2 class="sec" data-sec="packages"><span class="sec__num" [class.sec__num--done]="!stepError(1)">@if (!stepError(1)) { <mat-icon>check</mat-icon> } @else { 2 }</span>Packages
              @if (numPieces()) { <span class="sec__aside">{{ numPieces() }} piece{{ numPieces() === 1 ? '' : 's' }}</span> }</h2>
            @if (itemType()) { <ng-container [ngTemplateOutlet]="tPackages" /> } @else { <p class="muted">Choose Document or Parcel first.</p> }
          </section>
          <section class="card">
            <h2 class="sec"><span class="sec__num" [class.sec__num--done]="!!chosen()">@if (chosen()) { <mat-icon>check</mat-icon> } @else { 3 }</span>Mode of Dispatch</h2>
            @if (stepError(0) || stepError(1)) {
              <p class="muted">Rates show here once the pincodes and packages are filled in.</p>
            } @else {
              <ng-container [ngTemplateOutlet]="tModes" />
            }
          </section>
          <section class="card">
            <h2 class="sec"><span class="sec__num" [class.sec__num--done]="!stepError(3)">@if (!stepError(3)) { <mat-icon>check</mat-icon> } @else { 4 }</span>Pickup &amp; Delivery</h2>
            <ng-container [ngTemplateOutlet]="tDetails" />
          </section>
        </div>

        <aside class="sp__side">
          <section class="card">
            <h2 class="sec">Booking Summary</h2>
            <div class="sum">
              <div class="sum__row"><span>Route</span><span>{{ fromInfo().city || fromPincode() || '—' }} → {{ toInfo().city || toPincode() || '—' }}</span></div>
              <div class="sum__row"><span>Type</span><span>{{ itemType() === 'DOCUMENT' ? 'Document' : itemType() === 'PARCEL' ? 'Non-Document (Parcel)' : '—' }}</span></div>
              <div class="sum__row"><span>Chargeable</span><span>{{ weights().chargeable ? (weights().chargeable | number: '1.3-3') + ' kg' : '—' }}</span></div>
              <div class="sum__row"><span>Mode</span><span>{{ chosen() ? chosen()!.label + (chosen()!.days != null ? ' · ' + chosen()!.days + ' days' : '') : '—' }}</span></div>
              @if (chosen(); as m) {
                <div class="sum__row"><span>Freight</span><span>₹{{ m.freight | number: '1.2-2' }}</span></div>
                @if (m.oda) { <div class="sum__row"><span>ODA</span><span>₹{{ m.oda | number: '1.2-2' }}</span></div> }
                @if (m.extras) { <div class="sum__row"><span>Other Charges</span><span>₹{{ m.extras | number: '1.2-2' }}</span></div> }
                @if (fovOn()) { <div class="sum__row"><span>FOV</span><span>₹{{ fov() | number: '1.2-2' }}</span></div> }
                @if (codFee()) { <div class="sum__row"><span>COD Charge</span><span>₹{{ codFee() | number: '1.2-2' }}</span></div> }
                <div class="sum__row"><span>GST {{ gstPercent() }}%</span><span>₹{{ m.gst + fovGst() | number: '1.2-2' }}</span></div>
                @if (isCod() && codAmount()) { <div class="sum__row"><span>COD to collect</span><span>₹{{ codAmount() | number: '1.0-0' }}</span></div> }
                @if (cargoNote(m)) { <p class="sum__note">Cargo: you can ship up to {{ cargoMin }} kg for this same amount.</p> }
              }
              <div class="sum__tot"><span>Total</span><span>{{ chosen() ? '₹' + (totalOf(chosen()!) | number: '1.0-0') : '—' }}</span></div>
            </div>
          </section>
          @if (credit) {
            <section class="card">
              <h2 class="sec">Billing</h2>
              <p class="client__meta">{{ client() ? 'Billed to ' + client()!.displayName + ' (To Be Billed). Nothing is collected at the counter.' : 'Pick the credit client at the top.' }}</p>
            </section>
          } @else {
            <section class="card">
              <h2 class="sec">Payment</h2>
              <ng-container [ngTemplateOutlet]="tPay" />
            </section>
          }
          <app-button icon="check" [loading]="busy()" (pressed)="previewAll()">{{ credit ? 'Generate AWB' : 'Preview &amp; Book' }}</app-button>
        </aside>
      </div>
      }

      <ng-template #tService>
              <div class="seg" role="radiogroup" aria-label="Type">
                @for (t of itemTypes; track t.value) {
                  <button type="button" class="seg__opt" role="radio" [attr.aria-checked]="itemType() === t.value" [attr.tabindex]="roving(itemType(), t.value, itemTypes[0].value)"
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
      </ng-template>

      <ng-template #tPackages>
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
                      <label class="f"><span class="f__l">Pieces of Same Size</span><input class="f__i" type="number" min="1" [value]="r.pieces || ''" (input)="setRow(i, 'pieces', $event)" (keydown.enter)="fillRemainder(i)" (blur)="fillRemainder(i)" /></label>
                       <button type="button" class="icon-btn" data-nav-skip [disabled]="rows().length === 1" (click)="removeRow(i)" aria-label="Remove this size"><mat-icon>delete</mat-icon></button>
                    </div>
                  }
                </div>
                <app-button data-nav-skip variant="stroked" icon="add" (pressed)="addRow()">Add Package</app-button>
              }
              <div class="weights">
                <span>Actual: <strong>{{ weights().actual | number: '1.3-3' }} kg</strong></span>
                @if (itemType() === 'PARCEL') { <span>Volumetric (÷{{ divisorFor(modeId()) }}): <strong>{{ weights().volumetric | number: '1.3-3' }} kg</strong></span> }
                <span>Chargeable: <strong>{{ weights().chargeable | number: '1.3-3' }} kg</strong></span>
              </div>
      </ng-template>

      <ng-template #tModes>
              @if (ratesLoading() && !modes().length) {
                <p class="muted">Getting rates for every mode…</p>
              } @else if (!modes().length) {
                <p class="muted">{{ noRates() ? 'No delivery mode has charges set up for this destination and weight.' : 'No delivery mode is set up for this company yet.' }}</p>
              } @else {
                <div class="modes" role="radiogroup" aria-label="Delivery mode">
                  @for (m of modes(); track m.serviceTypeId) {
                    <button type="button" class="mode" role="radio" [attr.aria-checked]="modeId() === m.serviceTypeId" [attr.tabindex]="roving(modeId(), m.serviceTypeId, firstModeId())"
                            [class.mode--on]="modeId() === m.serviceTypeId" [disabled]="m.total === null" (click)="modeId.set(m.serviceTypeId)">
                      <span class="mode__radio"></span>
                      <span class="mode__name">{{ m.label | uppercase }}</span>
                      @if (m.total === null) {
                        <span class="mode__err">{{ m.error }}</span>
                      } @else {
                        <span class="mode__meta">Rate: <strong>₹ {{ m.estimate | number: '1.0-0' }}</strong></span>
                        <span class="mode__meta mode__meta--cw">Chargeable Weight: {{ m.chargeable | number: '1.3-3' }} kg</span>
                        <span class="mode__meta">Time to Deliver: {{ m.days != null ? m.days + ' day' + (m.days === 1 ? '' : 's') : 'N/A' }}</span>
                        @if (cargoNote(m)) { <span class="mode__note">You can ship up to {{ cargoMin }} kg for this same amount.</span> }
                      }
                    </button>
                  }
                </div>
              }
      </ng-template>

      <ng-template #tDetails>
              <label class="f"><span class="f__l">Package Description</span>
                <textarea class="f__i f__ta" rows="4" [value]="d()['packageDescription']" (input)="setD('packageDescription', $event)"></textarea></label>
              <label class="f f--narrow"><span class="f__l">Package Value (₹)</span>
                <input class="f__i" inputmode="numeric" [value]="d()['packageValue']" (input)="setDigits('packageValue', $event, 9)" /></label>
              <label class="fov">
                <input type="checkbox" [checked]="fovOn()" (change)="fovOn.set($any($event.target).checked)" />
                <span>Risk cover (FOV) <small class="muted">· {{ fovPercent }}% of package value, minimum ₹{{ fovMin }}</small></span>
                @if (fovOn()) { <strong class="fov__amt">FOV ₹{{ fov() | number: '1.2-2' }}</strong> }
              </label>
              @if (credit && codModeId()) {
                <label class="fov">
                  <input type="checkbox" [checked]="isCod()" (change)="setCreditCod($any($event.target).checked)" />
                  <span>Cash on Delivery (COD) <small class="muted">· freight billed to the client; the rider collects the COD amount</small></span>
                </label>
                @if (isCod()) { <ng-container [ngTemplateOutlet]="tCod" /> }
              }
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
      </ng-template>

      <ng-template #tPay>
              <div class="pay" role="radiogroup" aria-label="Payment method">
                @for (p of paymentOptions(); track p.value) {
                  <button type="button" class="mode mode--row" role="radio" [attr.aria-checked]="paymentModeId() === p.value" [attr.tabindex]="roving(paymentModeId(), p.value + '', paymentOptions()[0]?.value + '')"
                          [class.mode--on]="paymentModeId() === p.value" (click)="paymentModeId.set(p.value + '')">
                    <span class="mode__radio"></span><span class="mode__name">{{ p.label }}</span>
                  </button>
                }
              </div>
              @if (isCod()) { <ng-container [ngTemplateOutlet]="tCod" /> }
              @if (isPaidMode()) {
                <app-counter-payment [amount]="finalAmount()" [upiId]="upiId()" [payeeName]="upiPayee()"
                  [note]="'Courier ' + (awbNumber().trim() || 'booking')" [(method)]="payMethod" [(reference)]="payRef" />
              }
      </ng-template>

      <ng-template #tCod>
              <label class="f f--narrow cod"><span class="f__l">COD Collection Amount (₹)</span>
                <input class="f__i" inputmode="numeric" [value]="codAmount()" (input)="setCodAmount($event)" /></label>
              <p class="cod__hint">The rider collects this from the consignee for the shipper. COD charge {{ codPercent }}%, minimum ₹{{ codMin }}@if (codFee()) {: <strong>₹{{ codFee() | number: '1.2-2' }}</strong>}</p>
      </ng-template>

      @if (weightAsk()) {
        <div class="ovl" (click)="answerWeight(false)" (keydown.escape)="answerWeight(false)">
          <div class="inv inv--sm" role="alertdialog" aria-modal="true" aria-labelledby="wt-title" (click)="$event.stopPropagation()">
            <h2 id="wt-title" class="inv__title">Confirm Weight</h2>
            <p class="wt__msg">Are you sure you want to ship actual weight <strong>{{ weights().actual | number: '1.2-2' }} kg</strong>?</p>
            <div class="nav">
              <app-button data-nav-skip variant="text" (pressed)="answerWeight(false)">No</app-button>
              <span class="nav__sp"></span>
              <app-button data-autofocus icon="check" (pressed)="answerWeight(true)">Yes</app-button>
            </div>
          </div>
        </div>
      }

      @if (booked(); as b) {
        <div class="ovl">
          <div class="inv inv--sm" role="alertdialog" aria-modal="true" aria-labelledby="awb-title">
            <h2 id="awb-title" class="inv__title">Air Way Bill Generated</h2>
            <p class="wt__msg">AWB Number: <strong class="awb">{{ b.number }}</strong></p>
            <p class="client__meta">Booked for {{ client()?.displayName }}.</p>
            <div class="nav">
              <app-button data-nav-skip variant="text" (pressed)="finishInscan()">Finish Inscan</app-button>
              <span class="nav__sp"></span>
              <app-button data-autofocus icon="add" (pressed)="continueInscan()">Continue Inscan</app-button>
            </div>
          </div>
        </div>
      }

      @if (previewOpen()) {
        <div class="ovl" (click)="previewOpen.set(false)" (keydown.escape)="previewOpen.set(false)">
          <div class="inv" role="dialog" aria-modal="true" aria-labelledby="inv-title" (click)="$event.stopPropagation()">
            <h2 id="inv-title" class="inv__title">Invoice Preview</h2>
            <div class="inv__grid">
              <div><h4>From</h4><p><strong>{{ d()['pickupName'] }}</strong></p><p>{{ d()['pickupAddress'] }}</p><p>{{ fromInfo().city }} – {{ fromPincode() }}</p><p>{{ d()['pickupContact'] }}</p></div>
              <div><h4>To</h4><p><strong>{{ d()['deliveryName'] }}</strong></p><p>{{ d()['deliveryAddress'] }}</p><p>{{ toInfo().city }} – {{ toPincode() }}</p><p>{{ d()['deliveryContact'] }}</p></div>
            </div>
            <table class="inv__t">
              <tbody>
                <tr><td>Type</td><td>{{ itemType() === 'DOCUMENT' ? 'Document' : 'Non-Document (Parcel)' }}</td></tr>
                @if (awbNumber()) { <tr><td>AWB Number</td><td>{{ awbNumber() }}</td></tr> }
                @if (referenceId()) { <tr><td>Reference ID</td><td>{{ referenceId() }}</td></tr> }
                <tr><td>Pieces</td><td>{{ numPieces() }}</td></tr>
                <tr><td>Chargeable Weight</td><td>{{ weights().chargeable | number: '1.3-3' }} kg</td></tr>
                <tr><td>Mode</td><td>{{ chosen()?.label }}</td></tr>
                <tr><td>Description</td><td>{{ d()['packageDescription'] }}</td></tr>
                <tr><td>Package Value</td><td>₹ {{ d()['packageValue'] }}</td></tr>
                <tr><td>Payment</td><td>{{ paymentLabel() }}@if (isPaidMode()) { · {{ payMethodLabel() }} }</td></tr>
                @if (chosen(); as m) {
                  <tr><td>Freight</td><td>₹ {{ m.freight | number: '1.2-2' }}</td></tr>
                  @if (m.oda) { <tr><td>ODA</td><td>₹ {{ m.oda | number: '1.2-2' }}</td></tr> }
                  @if (m.extras) { <tr><td>Other Charges</td><td>₹ {{ m.extras | number: '1.2-2' }}</td></tr> }
                  @if (fovOn()) { <tr><td>FOV (risk cover)</td><td>₹ {{ fov() | number: '1.2-2' }}</td></tr> }
                  @if (codFee()) { <tr><td>COD Charge</td><td>₹ {{ codFee() | number: '1.2-2' }}</td></tr> }
                  <tr><td>GST {{ gstPercent() }}%</td><td>₹ {{ m.gst + fovGst() | number: '1.2-2' }}</td></tr>
                  <tr class="inv__total"><td>Total</td><td>₹ {{ totalOf(m) | number: '1.0-0' }}</td></tr>
                  @if (isCod() && codAmount()) { <tr><td>COD to collect from consignee</td><td>₹ {{ codAmount() | number: '1.0-0' }}</td></tr> }
                }
              </tbody>
            </table>
            <p class="text-caption">The final amount is worked out again when the shipment is booked.</p>
            <div class="nav">
              <app-button data-nav-skip variant="text" [disabled]="busy()" (pressed)="previewOpen.set(false)">Close</app-button>
              <span class="nav__sp"></span>
              <app-button data-autofocus icon="check" [loading]="busy()" (pressed)="confirm()">Confirm</app-button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .client { margin-bottom: 4px; gap: 10px; }
    .client--set { border-color: var(--occpl-color-success); }
    .client__meta { margin: 0; font: 400 16px var(--font-sans); color: var(--content-muted); }
    .cb { position: relative; max-width: 560px; }
    .cb__list { position: absolute; z-index: 20; left: 0; right: 0; top: calc(100% + 4px); margin: 0; padding: 4px; list-style: none;
      background: var(--surface); border: 1px solid var(--surface-border); border-radius: 10px; box-shadow: var(--occpl-shadow-sm, 0 6px 20px rgba(0,0,0,.12)); max-height: 280px; overflow: auto; }
    .cb__opt { padding: 9px 12px; border-radius: 8px; cursor: pointer; font: 400 17px var(--font-sans); color: var(--content-fg); }
    .cb__opt--hi { background: var(--brand-50); color: var(--brand-700); }
    .awb { font-size: 23px; letter-spacing: .02em; }
    .viewbar { display: inline-flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--surface); border: 1px solid var(--surface-border); align-self: flex-start; }
    .viewbar__opt { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; cursor: pointer; padding: 8px 16px; border-radius: 999px;
      font: 500 16px var(--font-sans); color: var(--content-muted); }
    .viewbar__opt mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .viewbar__opt--on { background: var(--brand-600); color: #fff; }
    .sp { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 18px; align-items: start; }
    .sp__main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    .sp__side { position: sticky; top: 16px; display: flex; flex-direction: column; gap: 14px; }
    .sp__side app-button { display: block; }
    .sp__side ::ng-deep .app-btn { width: 100%; height: 50px; justify-content: center; }
    .sp .modes { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); }
    .sec { display: flex; align-items: center; gap: 10px; margin: 0; font: 600 19px var(--font-sans); color: var(--content-fg); }
    .sec__num { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font: 600 16px var(--font-sans); background: var(--brand-600); color: #fff; flex-shrink: 0; }
    .sec__num mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .sec__num--done { background: var(--occpl-color-success); }
    .sec__aside { margin-left: auto; font: 400 16px var(--font-sans); color: var(--content-muted); }
    .sum { display: flex; flex-direction: column; }
    .sum__row { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--surface-border); font: 400 16px var(--font-sans); color: var(--content-fg); }
    .sum__row span:first-child { color: var(--content-muted); }
    .sum__row span:last-child { text-align: right; }
    .sum__tot { display: flex; justify-content: space-between; padding-top: 10px; font: 700 25px var(--font-sans); color: var(--content-fg); }
    .wiz { width: 100%; max-width: 960px; margin: 0 auto; box-sizing: border-box; display: flex; flex-direction: column; gap: 20px; }
    .steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(5, 1fr); }
    .step { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
    .step:not(:first-child)::before { content: ''; position: absolute; top: 15px; right: 50%; width: 100%; height: 2px; background: var(--surface-border); z-index: 0; }
    .step--done:not(:first-child)::before, .step--active:not(:first-child)::before { background: var(--brand-600); }
    .step__dot { position: relative; z-index: 1; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center;
      font: 600 16px var(--font-sans); background: var(--surface); color: var(--content-muted); border: 2px solid var(--surface-border); }
    .step__dot mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .step--active .step__dot, .step--done .step__dot { background: var(--brand-600); border-color: var(--brand-600); color: #fff; }
    .step__label { font: 500 15px var(--font-sans); color: var(--content-muted); }
    .step--active .step__label { color: var(--content-fg); font-weight: 600; }
    .card { background: var(--surface); border: 1px solid var(--surface-border); border-radius: 12px; padding: 24px; display: flex; flex-direction: column; gap: 14px; }
    .card__title { font: 600 21px var(--font-sans); color: var(--content-fg); margin: 0; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 20px; }
    .f { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .f--narrow { max-width: 280px; }
    .f__l { font: 500 15px var(--font-sans); color: var(--content-muted); }
    .f__wrap { position: relative; display: flex; }
    .f__i { width: 100%; box-sizing: border-box; border: 1px solid var(--surface-border); border-radius: var(--r-field, 8px); padding: 10px 12px;
      font: 400 17px var(--font-sans); color: var(--content-fg); background: var(--surface); outline: 0; }
    .f__i:focus { border-color: var(--brand-600); box-shadow: 0 0 0 3px var(--brand-50); }
    .f__i[readonly] { background: var(--surface-muted, var(--brand-50)); color: var(--content-muted); }
    .f__wrap .f__i { padding-right: 160px; }
    .f__adorn { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font: 600 16px var(--font-sans); color: var(--brand-700);
      max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .f__ta { resize: vertical; }
    .f__err { font: 500 15px var(--font-sans); color: var(--danger); }
    .seg { display: inline-flex; gap: 8px; }
    .seg__opt { display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--surface-border); background: var(--surface); font: 500 17px var(--font-sans); color: var(--content-fg); }
    .seg__opt mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .seg__opt--on { border-color: var(--brand-600); background: var(--brand-50); color: var(--brand-700); }
    .rows { display: flex; flex-direction: column; gap: 10px; }
    .row { display: grid; grid-template-columns: repeat(5, 1fr) 40px; gap: 10px; align-items: end; }
    .icon-btn { width: 40px; height: 40px; display: grid; place-items: center; border: 0; background: transparent; cursor: pointer; color: var(--content-muted); border-radius: 8px; }
    .icon-btn:hover:not(:disabled) { color: var(--danger); background: var(--danger-bg); }
    .icon-btn:disabled { opacity: .3; cursor: default; }
    .weights { display: flex; flex-wrap: wrap; gap: 8px 24px; padding: 12px 14px; border-radius: 8px; background: var(--brand-50); font: 400 16px var(--font-sans); color: var(--content-fg); }
    .modes, .pay { display: flex; flex-direction: column; gap: 10px; }
    .mode { display: grid; grid-template-columns: 22px 1fr; column-gap: 12px; row-gap: 2px; align-items: center; text-align: left; cursor: pointer;
      padding: 14px 16px; border: 1px solid var(--surface-border); border-radius: 10px; background: var(--surface); font: 400 16px var(--font-sans); color: var(--content-fg); }
    .mode:hover:not(:disabled) { border-color: var(--brand-500); }
    .mode:disabled { cursor: default; opacity: .6; }
    .mode--on { border-color: var(--brand-600); background: var(--brand-50); }
    .mode__radio { grid-row: span 5; width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--surface-border); box-sizing: border-box; }
    .mode--row .mode__radio { grid-row: auto; }
    .mode--on .mode__radio { border: 5px solid var(--brand-600); }
    .mode__name { font: 600 17px var(--font-sans); }
    .mode__meta { color: var(--content-muted); }
    .mode__meta strong { color: var(--content-fg); }
    .mode__err { color: var(--danger); }
    .mode__note { grid-column: 2; }
    .fov { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; font: 400 17px var(--font-sans); color: var(--content-fg); cursor: pointer; }
    .fov input { width: 18px; height: 18px; accent-color: var(--brand-600); }
    .fov__amt { color: var(--brand-600); }
    .cod { margin-top: 12px; }
    .cod__hint { margin: 6px 0 0; color: var(--content-muted); font: 400 15px var(--font-sans); }
    .mode__note, .sum__note { color: var(--occpl-color-success, #15803d); font: 500 15px var(--font-sans); }
    .sum__note { margin: 8px 0 0; }
    .chosen { display: flex; flex-wrap: wrap; gap: 6px 24px; padding: 12px 14px; border-radius: 8px; background: var(--brand-50); font: 400 17px var(--font-sans); color: var(--content-fg); }
    .party__title { font: 600 18px var(--font-sans); margin: 8px 0 4px; color: var(--content-fg); }
    .parties > div { display: flex; flex-direction: column; gap: 12px; }
    .muted { color: var(--content-muted); font: 400 17px var(--font-sans); }
    .nav { display: flex; align-items: center; padding-top: 8px; }
    .nav__sp { flex: 1; }
    .ovl { position: fixed; inset: 0; background: rgba(15, 23, 42, .45); display: grid; place-items: center; z-index: 1000; padding: 16px; }
    .inv { background: var(--surface); border-radius: 12px; padding: 24px; width: min(640px, 100%); max-height: 90vh; overflow: auto; display: flex; flex-direction: column; gap: 14px; }
    .inv--sm { width: min(440px, 100%); }
    .wt__msg { margin: 0; font: 400 18px var(--font-sans); color: var(--content-fg); }
    .inv__title { margin: 0; font: 600 23px var(--font-sans); color: var(--content-fg); }
    .inv__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; font: 400 16px var(--font-sans); color: var(--content-fg); }
    .inv__grid h4 { margin: 0 0 4px; font: 600 15px var(--font-sans); color: var(--content-muted); text-transform: uppercase; }
    .inv__grid p { margin: 0; }
    .inv__t { width: 100%; border-collapse: collapse; font: 400 16px var(--font-sans); color: var(--content-fg); }
    .inv__t td { padding: 7px 0; border-bottom: 1px solid var(--surface-border); }
    .inv__t td:last-child { text-align: right; }
    .inv__total td { font: 700 19px var(--font-sans); border-bottom: 0; }
    @media (max-width: 1100px) {
      .sp { grid-template-columns: 1fr; }
      .sp__side { position: static; }
    }
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
  private readonly settings = inject(SettingsService);
  private readonly notify = inject(NotificationService);
  private readonly masters = inject(MasterDataService);
  private readonly shipments = inject(ShipmentService);
  private readonly freight = inject(FreightCalculationService);
  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);
  private readonly customers = inject(CustomerService);
  private readonly businessCustomers = inject(BusinessCustomerService);
  /** Credit Shipment: same booking, for a business customer picked first, priced from their rate card and billed to them. */
  protected readonly credit = !!this.route.snapshot.data['credit'];
  protected readonly steps: readonly string[] = this.credit ? STEPS.slice(0, 4) : STEPS;
  protected readonly client = signal<CustomerResponse | null>(null);
  private readonly clientOptions = signal<SelectOption[]>([]);
  protected readonly clientQuery = signal('');
  protected readonly clientListOpen = signal(false);
  protected readonly clientHi = signal(0);
  protected readonly clientMatches = computed(() => {
    const q = this.clientQuery().trim().toLowerCase();
    const all = this.clientOptions();
    return (q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all).slice(0, 8);
  });
  protected readonly booked = signal<{ id: string; number: string } | null>(null);
  protected readonly itemTypes = [
    { value: 'DOCUMENT' as const, label: 'Document', icon: 'description' },
    { value: 'PARCEL' as const, label: 'Non-Document (Parcel)', icon: 'inventory_2' }
  ];
  protected readonly sides = [
    { key: 'pickup', title: 'Pickup Details' },
    { key: 'delivery', title: 'Delivery Details' }
  ];

  private readonly branchId = this.auth.user()?.branchId ?? null;

  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly weightAsk = signal(false);

  /** Step-by-step wizard or everything on one page; remembered per browser. */
  protected readonly view = signal<'steps' | 'single'>(readView());
  protected readonly active = signal(0);
  protected readonly busy = signal(false);
  protected readonly previewOpen = signal(false);

  // Step 1
  protected readonly itemType = signal<'DOCUMENT' | 'PARCEL' | null>('PARCEL');
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
  /** Weights with the chosen mode's volumetric divisor (5000 until a mode is chosen). */
  protected readonly weights = computed(() => this.weightsFor(this.modeId()));

  /** Service Type id -> its volumetric divisor (null = 5000). */
  private readonly divisors = signal<Map<string, number | null>>(new Map());
  protected divisorFor(serviceTypeId: string | null): number {
    return (serviceTypeId && this.divisors().get(serviceTypeId)) || DEFAULT_VOLUMETRIC_DIVISOR;
  }

  /** Chargeable weight on one service: whichever is higher, actual or volumetric
   *  (L×W×H ÷ that service's divisor). No minimum. */
  weightsFor(serviceTypeId: string | null): { actual: number; volumetric: number; chargeable: number } {
    const doc = this.itemType() === 'DOCUMENT';
    const actual = doc ? (this.docWeightGrams() ?? 0) / 1000 : actualKg(this.rows());
    const volumetric = doc ? 0 : volumetricKg(this.rows(), this.divisorFor(serviceTypeId));
    return { actual: round3(actual), volumetric: round3(volumetric), chargeable: round3(Math.max(actual, volumetric)) };
  }

  // Step 3
  private readonly serviceOptions = signal<SelectOption[]>([]);
  private readonly deliveryDays = signal<Map<string, number | null>>(new Map());
  private readonly packageTypeOptions = signal<SelectOption[]>([]);
  protected readonly gstPercent = signal(18);
  protected readonly modes = signal<ModeRate[]>([]);
  protected readonly ratesLoading = signal(false);
  protected readonly modeId = signal<string | null>(null);
  /** Services exist, but none has charges set up for this destination and weight. */
  protected readonly noRates = signal(false);
  /** Risk cover (FOV) ticked: 0.2% of the package value, at least ₹100, plus GST on it. */
  protected readonly fovOn = signal(false);
  protected readonly fovPercent = FOV_PERCENT;
  protected readonly fovMin = FOV_MINIMUM;
  protected readonly fov = computed(() => this.fovOn() ? fovCharge(Number(this.d()['packageValue']) || 0) : 0);
  /** Cash on Delivery: the payment mode is COD; the rider collects {@link codAmount}; the shipper pays a COD charge. */
  protected readonly codModeId = computed(() => this.paymentOptions().find((o) => isCodOption(o.label))?.value?.toString() ?? null);
  protected readonly isCod = computed(() => !!this.paymentModeId() && this.paymentModeId() === this.codModeId());
  protected readonly codAmount = signal('');
  protected readonly codPercent = COD_PERCENT;
  protected readonly codMin = COD_MINIMUM;
  protected readonly codFee = computed(() => this.isCod() ? codCharge(Number(this.codAmount()) || 0) : 0);
  /** GST on what this page adds on top of a mode's rate: FOV and the COD charge. */
  protected readonly fovGst = computed(() => Math.round((this.fov() + this.codFee()) * this.gstPercent()) / 100);
  /** What the shipper pays on a mode: its rate plus FOV and the COD charge, with their GST. */
  protected totalOf(m: ModeRate): number {
    return Math.round(m.freight + m.oda + m.extras + m.gst + this.fov() + this.codFee() + this.fovGst());
  }
  protected setCodAmount(e: Event): void {
    const el = e.target as HTMLInputElement;
    el.value = el.value.replace(/\D/g, '').slice(0, 9);
    this.codAmount.set(el.value);
  }
  /** Credit: COD switches the payment mode between COD and To Be Billed. */
  protected setCreditCod(on: boolean): void {
    const tbb = this.paymentOptions().find((o) => /\(TBB\)$/i.test(o.label)) ?? this.paymentOptions().find((o) => /credit|to be billed/i.test(o.label));
    this.paymentModeId.set(on ? this.codModeId() : tbb ? String(tbb.value) : null);
  }
  private codError(): string | null {
    return this.isCod() && !(Number(this.codAmount()) > 0) ? 'Enter the COD collection amount.' : null;
  }
  protected readonly cargoMin = CARGO_MIN_KG;
  protected cargoNote(m: ModeRate): boolean { return !!m.cargo && m.chargeable < CARGO_MIN_KG; }
  protected readonly firstModeId = computed(() => this.modes().find((m) => m.total !== null)?.serviceTypeId ?? null);
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
  /** A Paid booking (not credit): the customer pays at the counter by Razorpay QR, cash or the company's UPI QR. */
  protected readonly isPaidMode = computed(() => !this.credit && /\(PAID\)$/i.test(this.paymentLabel()));
  protected readonly payMethod = signal<CounterPaymentMethod>('CASH');
  protected readonly payRef = signal('');
  protected readonly payMethodLabel = computed(() => ({ RAZORPAY: 'Razorpay QR', CASH: 'Cash', UPI_QR: 'UPI QR' })[this.payMethod()]);
  /** The company's UPI ID (Settings → Finance) for the QR option. */
  protected readonly upiId = signal<string | null>(null);
  protected readonly upiPayee = signal<string | null>(null);
  /** What the customer pays: the chosen mode's total. */
  protected readonly finalAmount = computed(() => { const m = this.chosen(); return m ? this.totalOf(m) : 0; });
  private readonly dialog = inject(MatDialog);

  constructor() {
    // Single page: re-price every mode whenever what prices it changes (debounced).
    let timer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      if (this.view() !== 'single') return;
      const ready = !this.stepError(0) && !this.stepError(1);
      const key = this.ratesKeyNow(ready);
      if (!ready || key === this.ratesKey) return;
      clearTimeout(timer);
      timer = setTimeout(() => { this.ratesKey = key; this.loadRates(); }, 400);
    });
    this.destroyRef.onDestroy(() => clearTimeout(timer));
  }

  private ratesKey = '';
  /** What the rates depend on; a change re-prices every mode. */
  private ratesKeyNow(ready = true): string {
    // The package itself, not the chosen mode's weight: picking a mode must not re-price.
    const pkg = this.itemType() === 'DOCUMENT' ? this.docWeightGrams() : JSON.stringify(this.rows());
    return [ready, this.toPincode(), this.toInfo().areaId, pkg, this.itemType(), this.numPieces(),
      this.serviceOptions().length, this.divisors().size, this.client()?.id].join('|');
  }
  private ratesSeq = 0;

  protected setView(v: 'steps' | 'single'): void {
    this.view.set(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable: the choice lasts this visit only */ }
  }

  ngOnInit(): void {
    this.focusLater();
    this.breadcrumb.set([{ label: 'Shipments', route: '/shipments' }, { label: this.credit ? 'Credit Shipment' : 'Domestic (CASH) Shipment' }]);
    if (this.credit) {
      this.businessCustomers.businessCustomers().subscribe({
        next: (p) => this.clientOptions.set(p.content.map((c) => ({ value: c.id, label: `${c.displayName} (${c.customerCode})` }))),
        error: () => this.notify.error('Could not load the credit clients.')
      });
    }
    this.masters.options('service-types').subscribe((o) => this.serviceOptions.set(o));
    this.masters.options('package-types').subscribe((o) => this.packageTypeOptions.set(o));
    this.masters.serviceTypeDirectory().subscribe((rows) => {
      this.deliveryDays.set(new Map(rows.map((r) => [r.id, r.deliveryDays])));
      this.divisors.set(new Map(rows.map((r) => [r.id, r.volumetricDivisor ?? null])));
    });
    this.masters.options('payment-modes').subscribe((o) => {
      this.paymentOptions.set(o);
      // Cash counter: Paid is the default, as on the earlier portal. Credit: always To Be Billed.
      const paid = this.credit
        ? o.find((opt) => /\(TBB\)$/i.test(opt.label)) ?? o.find((opt) => /credit|to be billed/i.test(opt.label))
        : o.find((opt) => /\(PAID\)$/i.test(opt.label)) ?? o.find((opt) => /cash/i.test(opt.label));
      if (paid && !this.paymentModeId()) this.paymentModeId.set(String(paid.value));
    });
    // GST: the company's one rate (Settings → Finance), the same the server books with — not the branch's.
    this.settings.get().subscribe({
      next: (d) => {
        const finance = (d as { finance?: { gstPercentage?: number; upiId?: string | null; upiPayeeName?: string | null } })?.finance;
        const gst = finance?.gstPercentage;
        if (gst != null) this.gstPercent.set(Number(gst));
        this.upiId.set(finance?.upiId || null);
        this.upiPayee.set(finance?.upiPayeeName || null);
      },
      error: () => { /* keep the default; the server's figure is what books */ }
    });
    this.masters.branchDirectory().subscribe((list) => {
      const mine = list.find((b) => b.id === this.branchId);
      if (mine?.postalCode && !this.fromPincode()) this.lookup('from', mine.postalCode);
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
    this.rows.update((rs) => rs.map((r, j) => j === i ? { ...r, [key]: key === 'pieces' ? (n == null ? 0 : Math.max(1, Math.floor(n))) : n } : r));
  }

  /** Last row's pieces committed (Enter or leaving the box) and fewer than the total covered:
   *  open a row for the rest, so Enter flows straight into it. Not on every keystroke — clearing
   *  the box to retype it must not add a row. */
  protected fillRemainder(i: number): void {
    const total = this.rows().reduce((s, r) => s + r.pieces, 0);
    const wanted = this.numPieces() ?? 0;
    if (i === this.rows().length - 1 && total < wanted) {
      this.rows.update((rs) => [...rs, { length: null, width: null, height: null, weightGrams: null, pieces: wanted - total }]);
    }
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
    if (this.active() > 0) this.goTo(this.active() - 1);
  }

  /** Moves to a step and puts the cursor in its first field. */
  private goTo(step: number): void {
    this.active.set(step);
    this.focusLater();
  }

  protected answerWeight(ok: boolean): void {
    this.weightAsk.set(false);
    if (ok) { this.goTo(2); this.loadRates(); } else { this.focusLater(); }
  }

  private openPreview(): void {
    this.previewOpen.set(true);
    this.focusLater('[data-autofocus]');
  }

  // ---------- keyboard: Enter works like Tab, arrows move inside a choice group ----------
  /** 0 for the option that takes Tab focus in its group (the chosen one, else the first), -1 for the rest. */
  protected roving(selected: string | null, value: string, first: string | null): number {
    return (selected ?? first) === value ? 0 : -1;
  }

  protected onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement;
    const radio = t.closest<HTMLElement>('[role="radio"]');
    const arrows = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    if (radio && arrows.includes(e.key)) {
      const group = radio.closest('[role="radiogroup"]');
      const opts = group ? Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')) : [];
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      const nextOpt = opts[(opts.indexOf(radio as HTMLButtonElement) + step + opts.length) % opts.length];
      e.preventDefault();
      nextOpt?.click();
      nextOpt?.focus();
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    if (radio) {
      e.preventDefault();
      radio.click();
      const group = radio.closest('[role="radiogroup"]') ?? radio;
      setTimeout(() => this.focusNext(group));
      return;
    }
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) {
      e.preventDefault();
      this.cdr.detectChanges(); // a size row the last keystroke opened must exist before the cursor moves on
      if (this.leavingPackagesForRates(t)) return;
      this.focusNext(t);
    }
    // a focused button keeps its own Enter (Next, Preview & Book, Yes, Confirm)
  }

  /** Single page: Enter on the last package field while the rates are not shown yet — fetch them now
   *  and put the cursor on the delivery modes when they arrive, instead of skipping past that section. */
  private awaitModes = false;
  private leavingPackagesForRates(from: HTMLElement): boolean {
    if (this.view() !== 'single' || this.chosen() || this.stepError(0) || this.stepError(1)) return false;
    const section = this.host.nativeElement.querySelector('[data-sec="packages"]')?.closest('.card');
    if (!section?.contains(from)) return false;
    const next = this.navStops().find((el) => from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (next && section.contains(next)) return false; // still inside Packages
    if (this.modes().length && !this.ratesLoading()) { this.focusModes(); return true; }
    this.awaitModes = true;
    this.ratesKey = this.ratesKeyNow(); // the debounced refresh then sees nothing new to fetch
    this.loadRates();
    return true;
  }

  private focusModes(): void {
    setTimeout(() => {
      this.cdr.detectChanges();
      const opt = this.host.nativeElement.querySelector<HTMLElement>('[aria-label="Delivery mode"] [role="radio"][tabindex="0"]');
      if (opt) { opt.focus(); return; }
      const desc = this.host.nativeElement.querySelector<HTMLElement>('textarea');
      desc?.focus();
    });
  }

  /** Every place the cursor can stop, in page order: editable fields, the chosen option of each group, and the main buttons. */
  private navStops(root: ParentNode = this.host.nativeElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>('input, textarea, button')).filter((el) =>
      !(el as HTMLInputElement).disabled && !(el as HTMLInputElement).readOnly && el.tabIndex !== -1 &&
      !el.closest('[data-nav-skip]') && el.offsetParent !== null);
  }

  private focusNext(from: Element): void {
    const next = this.navStops().find((el) => !from.contains(el) && (from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
    if (!next) return;
    next.focus();
    if (next instanceof HTMLInputElement) { try { next.select(); } catch { /* some input types cannot select */ } }
  }

  /** After the view updates: focus the element matching `selector`, else the first stop in the current step or page. */
  private focusLater(selector?: string): void {
    setTimeout(() => {
      this.cdr.detectChanges();
      const root = this.host.nativeElement;
      const target = selector
        ? root.querySelector<HTMLElement>(`${selector} button`) ?? root.querySelector<HTMLElement>(selector)
        : null;
      if (!target && this.credit && !this.client()) { root.querySelector<HTMLElement>('[data-client-input]')?.focus(); return; }
      const scope = root.querySelector('.wiz .card') ?? root.querySelector('.sp__main') ?? root;
      (target ?? this.navStops(scope)[0])?.focus();
    });
  }

  protected next(): void {
    const error = this.stepError(this.active());
    if (error) { this.notify.error(error); return; }
    switch (this.active()) {
      case 0: {
        const awb = this.awbNumber().trim();
        if (!awb) { this.goTo(1); return; }
        this.busy.set(true);
        this.shipments.list({ page: 0, size: 5, search: awb }).pipe(catchError(() => of(null))).subscribe((page) => {
          this.busy.set(false);
          if (page?.content.some((s) => s.shipmentNumber?.toUpperCase() === awb.toUpperCase())) {
            this.notify.error('AWB number already exists. Please use a different AWB number.');
            return;
          }
          this.goTo(1);
        });
        return;
      }
      case 1:
        if (this.active() === this.steps.length - 1) break;
        this.ratesKey = '';
        this.weightAsk.set(true);
        this.focusLater('[data-autofocus]');
        return;
      default:
        if (this.active() === this.steps.length - 1) { this.finish(); return; }
        this.goTo(this.active() + 1);
    }
  }

  /** Why the given step cannot move on yet, or null. */
  stepError(step: number): string | null {
    switch (step) {
      case 0:
        if (this.credit && !this.client()) return 'Select the credit client first.';
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
        if (bad) return `${bad[1]} must be exactly 10 digits.`;
        return this.credit ? this.codError() : null;
      }
      case 4:
        if (this.isPaidMode() && this.payMethod() === 'UPI_QR' && !this.upiId()) {
          return 'No company UPI ID yet: choose Razorpay or Cash, or ask the company admin to add it in Settings.';
        }
        if (this.paymentModeId()) return this.codError();
        return this.credit ? 'The payment-mode list has no To Be Billed (TBB) mode — add it under Masters.' : 'Please select a payment method.';
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
    const seq = ++this.ratesSeq;
    const calls: Observable<ModeRate>[] = services.map((svc) => {
      const label = svc.label.replace(/\s*\(.*\)$/, '');
      const cargo = /cargo/i.test(svc.label);
      const days = this.deliveryDays().get(String(svc.value)) ?? null;
      const chargeable = this.weightsFor(String(svc.value)).chargeable;
      return this.freight.calculate({
        bookingBranchId: this.branchId!, destinationPincode: this.toPincode(), destinationAreaId: areaId,
        chargeableWeight: chargeable, businessCustomerId: this.client()?.id ?? null,
        declaredValue: Number(this.d()['packageValue']) || null,
        serviceTypeId: String(svc.value), packageTypeId: this.packageTypeId(),
        numberOfPackages: this.numPieces() || 1, bookingDate: null
      }, { silent: true }).pipe(
        map((r): ModeRate => {
          const freight = Number(r.baseFreight ?? 0);
          const oda = Number(r.odaCharge ?? 0);
          const extras = Number(r.customerExtraCharges ?? 0);
          const gst = Math.round((freight + oda + extras) * this.gstPercent()) / 100;
          return { serviceTypeId: String(svc.value), label, total: r.totalFreight, freight, oda, extras, gst,
            estimate: Math.round(freight + oda + extras + gst), days, basis: r.weightSlabLabel, chargeable, cargo };
        }),
        catchError((e: HttpErrorResponse) => of<ModeRate>({ serviceTypeId: String(svc.value), label, total: null,
          error: e?.error?.message ?? 'No rate for this destination.', freight: 0, oda: 0, extras: 0, gst: 0, estimate: 0, days, chargeable }))
      );
    });
    forkJoin(calls).subscribe((rates) => {
      if (seq !== this.ratesSeq) return; // a newer request is on its way
      this.ratesLoading.set(false);
      // Step by step: the rates arrive after the step opened, so put the cursor on them now.
      if (this.view() === 'steps' && this.active() === 2) this.focusLater();
      if (this.awaitModes) { this.awaitModes = false; this.focusModes(); }
      // Only the modes with charges set up for this destination, cheapest first; the rest are left out.
      this.modes.set(pricedModes(rates));
      this.noRates.set(rates.length > 0 && !this.modes().length);
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
      remarks: extra || null, deliveryType: 'DOOR', businessCustomerId: this.client()?.id ?? null,
      insuranceApplicable: this.fovOn() || null,
      codAmount: this.isCod() ? Number(this.codAmount()) || null : null,
      paymentMethod: this.isPaidMode() ? this.payMethod() : null,
      paymentReference: this.isPaidMode() && this.payMethod() === 'UPI_QR' ? this.payRef().trim() || null : null
    };
  }

  /** Single page: check every section, then the AWB number, then open the invoice preview. */
  protected previewAll(): void {
    const names = ['Serviceability', 'Packages', 'Mode of Dispatch', 'Pickup & Delivery', this.credit ? 'Billing' : 'Payment'];
    for (let i = 0; i < names.length; i++) {
      const error = this.stepError(i);
      if (error) { this.notify.error(`${names[i]}: ${error}`); return; }
    }
    if (this.ratesLoading()) { this.notify.error('Rates are still updating — try again in a moment.'); return; }
    const awb = this.awbNumber().trim();
    if (!awb) { this.finish(); return; }
    this.busy.set(true);
    this.shipments.list({ page: 0, size: 5, search: awb }).pipe(catchError(() => of(null))).subscribe((page) => {
      this.busy.set(false);
      if (page?.content.some((s) => s.shipmentNumber?.toUpperCase() === awb.toUpperCase())) {
        this.notify.error('AWB number already exists. Please use a different AWB number.');
        return;
      }
      this.finish();
    });
  }

  /** Cash: the invoice preview, then Confirm. Credit: book straight away, as the earlier portal's Generate AWB did. */
  private finish(): void {
    if (this.credit) {
      const error = this.stepError(4);
      if (error) { this.notify.error(error); return; }
      this.confirm();
    } else {
      this.openPreview();
    }
  }

  // ---------- credit client ----------
  protected onClientQuery(e: Event): void {
    this.clientQuery.set(this.val(e));
    this.clientHi.set(0);
    this.clientListOpen.set(true);
  }

  protected closeClientList(): void {
    setTimeout(() => this.clientListOpen.set(false), 120);
  }

  /** Arrows move through the matches; Enter picks the highlighted one and the page's Enter then moves on. */
  protected onClientKey(e: KeyboardEvent): void {
    const n = this.clientMatches().length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.clientListOpen.set(true);
      if (n) this.clientHi.set((this.clientHi() + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
    } else if (e.key === 'Enter') {
      const o = this.clientMatches()[this.clientHi()];
      if (this.clientListOpen() && o && o.value !== this.client()?.id) this.pickClient(String(o.value));
      else if (!this.client()) { e.preventDefault(); e.stopPropagation(); }
    } else if (e.key === 'Escape') {
      this.clientListOpen.set(false);
    }
  }

  /** Loads the client and fills the sender from it: name, mobile, default pickup address and billing pincode. */
  protected pickClient(id: string): void {
    const label = this.clientOptions().find((o) => o.value === id)?.label ?? '';
    this.clientQuery.set(label);
    this.clientListOpen.set(false);
    this.customers.get(id).subscribe({
      next: (cust) => {
        this.client.set(cust);
        this.modes.set([]);
        this.modeId.set(null);
        const pickup = cust.addresses.filter((a) => a.status === 'ACTIVE' && a.addressUsage !== 'DELIVERY');
        const addr = pickup.find((a) => a.isDefaultPickup) ?? pickup[0];
        const address = addr ? [addr.addressLine1, addr.addressLine2, addr.landmark].filter(Boolean).join(', ')
          : [cust.billingAddressLine1, cust.billingAddressLine2].filter(Boolean).join(', ');
        this.d.update((d) => ({ ...d, pickupName: cust.companyName || cust.displayName, pickupAddress: address,
          pickupContact: (cust.mobile ?? '').replace(/\D/g, '').slice(-10), pickupEmail: cust.email ?? '' }));
        if (cust.billingPincode && PINCODE.test(cust.billingPincode)) this.lookup('from', cust.billingPincode);
      },
      error: () => this.notify.error('Could not load that client.')
    });
  }

  /** Book the next shipment for the same client: clears the shipment, keeps the client and the sender. */
  protected continueInscan(): void {
    this.booked.set(null);
    this.awbNumber.set('');
    this.referenceId.set('');
    this.toPincode.set('');
    this.toInfo.set({ state: 'idle' });
    this.numPieces.set(null);
    this.docWeightGrams.set(null);
    this.rows.set([{ length: null, width: null, height: null, weightGrams: null, pieces: 1 }]);
    this.modes.set([]);
    this.modeId.set(null);
    this.ratesKey = '';
    this.fovOn.set(false);
    this.codAmount.set('');
    if (this.credit && this.isCod()) this.setCreditCod(false);
    this.d.update((d) => ({ ...d, packageDescription: '', packageValue: '', deliveryName: '', deliveryAddress: '',
      deliveryContact: '', deliveryAltContact: '', deliveryEmail: '' }));
    this.active.set(0);
    this.focusLater();
  }

  protected finishInscan(): void {
    const b = this.booked();
    this.booked.set(null);
    if (b) this.router.navigate(['/shipments', b.id]);
  }

  /** Razorpay: the QR for the final amount; once paid the booking carries on by itself (status Paid). */
  private collectByRazorpay(id: string, shipmentNumber: string): void {
    this.dialog.open<RazorpayQrDialog, RazorpayQrDialogData, RazorpayQrResult>(RazorpayQrDialog,
      { data: { shipmentId: id, shipmentNumber }, disableClose: true, autoFocus: false })
      .afterClosed().subscribe((result) => {
        if (result === 'PAID') this.notify.success(`Payment received. Shipment ${shipmentNumber} is paid.`);
        else this.notify.info(`Shipment ${shipmentNumber} booked; the Razorpay payment is pending. Show the QR again from the shipment.`);
        this.router.navigate(['/shipments', id]);
      });
  }

  protected confirm(): void {
    this.busy.set(true);
    this.shipments.create(this.buildRequest()).subscribe({
      next: (s) => {
        this.busy.set(false);
        this.previewOpen.set(false);
        if (this.credit) {
          this.booked.set({ id: s.id, number: s.shipmentNumber });
          this.focusLater('[data-autofocus]');
          return;
        }
        if (this.isPaidMode() && this.payMethod() === 'RAZORPAY') {
          this.collectByRazorpay(s.id, s.shipmentNumber);
          return;
        }
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

function readView(): 'steps' | 'single' {
  try { return localStorage.getItem(VIEW_KEY) === 'single' ? 'single' : 'steps'; } catch { return 'steps'; }
}
