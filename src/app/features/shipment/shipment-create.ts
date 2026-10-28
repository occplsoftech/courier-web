import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { AbstractControl, FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, Subject, catchError, debounceTime, distinctUntilChanged, filter, forkJoin, merge, of, switchMap } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { CompanyProfileService } from '@features/company/company-profile.service';
import { MASTER_DEFINITIONS } from '@features/masters/master.config';
import { CustomerService } from '@features/customer/customer.service';
import { BusinessCustomerService } from '@features/business-customer/business-customer.service';
import { SettingsService } from '@features/settings/settings.service';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiAutocomplete } from '@shared/components/ui-autocomplete/ui-autocomplete';
import { BusCrossingEditor } from '@features/bus-depot/bus-crossing-editor';
import { BusDepotService } from '@features/bus-depot/bus-depot.service';
import { BusCrossingPick } from '@core/models/bus-depot.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { Customer, CustomerAddress } from '@core/models/customer.model';
import {
  ShipmentItemRequest, CreateShipmentRequest, PricingResponse, DeliveryType, DELIVERY_TYPES
} from '@core/models/shipment.model';
import { FreightCalculationResponse } from '@core/models/district-level-freight.model';
import { ItemEntryGrid } from './components/item-entry-grid';
import { ChargeSummary } from './components/charge-summary';
import { VoiceMicButton } from './components/voice-mic-button';
import { ShipmentService } from './shipment.service';
import { EwayBillService } from './eway-bill.service';
import { PickupService } from '@features/pdp/pickup.service';
import { FreightCalculationService } from './freight-calculation.service';
import { companyAddressLine } from './consignment-print.util';
import { printPerformaBillCopies } from './performa-bill-print.util';
import { parseVoiceBooking } from './voice-booking.util';

/** `yyyy-MM-dd` in the local timezone — a native `<input type="date">` value, and what
 *  `bookingDate` defaults to on the server if omitted; setting it explicitly here just
 *  makes today's date visible without waiting on a round trip. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type PriceOutcome = { ok: true; data: PricingResponse } | { ok: false; message: string | null };
type FreightOutcome =
  { ok: true; data: FreightCalculationResponse } | { ok: false; message: string | null };

/**
 * Create Shipment — a single page, not a step wizard: Booking Details, Parties,
 * and the Item grid on the left, a sticky live "Booking Summary"
 * sidebar on the right that prices the booking as soon as every required field is
 * filled in (debounced) — the layout the user asked to book from directly, adapted
 * from a supplied reference mockup onto the app's own design system.
 *
 * <p>Consignor/Consignee are plain typed fields (name/address/contact number) — no
 * Customer module lookup, matching the reference screen's own Parties block. Pickup/
 * delivery pincode are typed alongside the branches, feeding the Pricing Engine
 * directly, since there is no longer an address record to resolve one from.
 */
@Component({
  selector: 'app-shipment-create',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, ReactiveFormsModule, MatIconModule, UiSelect, UiAutocomplete, UiButton, UiCard, BusCrossingEditor, ItemEntryGrid, ChargeSummary, VoiceMicButton],
  template: `
    <div class="page">
      <header class="page__head" data-tour="booking-head">
        <div><h1 class="text-h1">{{ isMsrtc ? 'MSRTC Shipment Booking' : isBusinessBooking ? 'Business Customer Booking' : 'New Shipment' }}</h1><p class="text-caption">{{ isBusinessBooking && !selectedBusinessCustomer() ? 'Select the business customer first — the booking form opens once you do.' : 'Fill in the booking — the summary prices it as you go, or speak it.' }}</p></div>
        <div class="page__head-actions">
          <app-voice-mic-button (transcriptReady)="onVoiceTranscript($event)" (error)="onVoiceError($event)" />
          <app-button variant="stroked" (pressed)="cancel()">Cancel</app-button>
        </div>
      </header>
      @if (voiceSummary(); as vs) {
        <p class="voice-banner">{{ vs }}</p>
      }

      @if (isBusinessBooking) {
        <app-card title="Business Customer" subtitle="Choose who this booking is for. The consignor and payment mode are filled from the customer.">
          <div class="bizbook__panel">
            <app-autocomplete [control]="businessCustomerCtl" label="Business Customer" [options]="businessCustomerOptions()"
              placeholder="Search business customer by name or code…" />
            @if (businessPickupOptions().length > 1) {
              <app-select [control]="businessPickupCtl" label="Pickup Address" [options]="businessPickupOptions()" placeholder="Select a pickup address" />
            }
            @if (selectedBusinessCustomer() && !businessPickupOptions().length) {
              <p class="hint">This customer has no pickup address on file — type the sender's address below.</p>
            }
          </div>
        </app-card>
      }
      @if (!isBusinessBooking || selectedBusinessCustomer()) {
      <div class="lr">
        <div class="lr__main">
          <app-card title="Booking Details" [subtitle]="'Booking from ' + myBranchLabel()">
            <div class="grid3">
              <label class="fld"><span class="fld__l">Booking Date</span>
                <input class="fld__i" type="date" [formControl]="c('bookingDate')" /></label>
              @if (isMsrtc) {
                <app-select [control]="c('msrtcDeliveryBranchId')" label="To Branch" [options]="branchOptions()" placeholder="Select the delivery branch" />
              }
              @if (!isMsrtc) {
              <label class="fld"><span class="fld__l">Destination Pincode</span>
                <input class="fld__i" [formControl]="c('destinationPincode')" [readonly]="isMsrtc && destMode() === 'BRANCH'" placeholder="e.g. 411001" maxlength="10" /></label>
              <div class="fld">
                <span class="fld__l">Destination Area</span>
                @if (destinationAreaLoading()) {
                  <span class="fld__i fld__i--hint">Looking up areas…</span>
                } @else if (destinationAreaOptions().length) {
                  <app-select [control]="c('destinationAreaId')" [options]="destinationAreaOptions()" placeholder="Select an area" />
                } @else {
                  <span class="fld__i fld__i--hint">{{ destinationAreaError() ?? 'Enter a destination pincode first' }}</span>
                }
              </div>
              <label class="fld"><span class="fld__l">From City</span>
                <input class="fld__i" [value]="myBranchCity() ?? '—'" disabled /></label>
              <label class="fld"><span class="fld__l">To City</span>
                <input class="fld__i" [value]="freightCalc()?.destinationCityName ?? (freightCalcLoading() ? 'Resolving…' : '—')" disabled /></label>
              }
              <div class="fld">
                <app-select [control]="c('serviceTypeId')" label="Service Type" [options]="serviceTypeOptions()" placeholder="Select a service type" />
                @if (expectedDeliveryPreview(); as edp) {
                  <p class="hint">Expected delivery: {{ edp | date: 'mediumDate' }}</p>
                }
              </div>
              <div class="fld">
                <app-select [control]="c('packageTypeId')" label="Package Type" [options]="packageTypeOptions()" [allowEmpty]="true" emptyLabel="Not set" placeholder="Not set" />
                <p class="hint">Needed when your zone tariff prices this branch's bookings.</p>
              </div>
              <label class="fld"><span class="fld__l">Shipment No. (optional)</span>
                <input class="fld__i" [formControl]="c('manualShipmentNumber')" placeholder="Leave blank to auto-generate" maxlength="30" /></label>
            </div>
            <div class="spacer"></div>
            @if (isMsrtc) {
              <app-bus-crossing-editor [fromBranchId]="myBranchId" [toBranchId]="msrtcDeliveryBranchId()"
                [(value)]="busCrossing" [(incomplete)]="busCrossingIncomplete" />
            }
            @if (!isMsrtc) {
            <label class="chk">
              <input type="checkbox" [formControl]="c('crossing')" />
              <span>Route through a crossing branch/hub</span>
            </label>
            }
            @if (c('crossing').value) {
              <div class="crossing-hops">
                @for (ctrl of crossingBranchArray.controls; track $index) {
                  <div class="crossing-hop">
                    <app-autocomplete [control]="asControl(ctrl)" [label]="'Crossing Branch ' + ($index + 1)" [options]="crossingBranchOptions()" placeholder="Search crossing branch…" />
                    @if (crossingBranchArray.length > 1) {
                      <button type="button" class="crossing-hop__remove" (click)="removeCrossingBranch($index)" aria-label="Remove this hop">✕</button>
                    }
                  </div>
                }
                <app-button variant="stroked" (pressed)="addCrossingBranch()">+ Add another crossing branch</app-button>
              </div>
              <div class="spacer"></div>
              <div class="grid3">
                <label class="fld"><span class="fld__l">Crossing Charge</span>
                  <input class="fld__i" type="number" min="0" step="0.01" [formControl]="c('crossingCharge')" /></label>
              </div>
            }
          </app-card>

          <app-card title="Items" subtitle="Add every package on this shipment; weight and dimensions drive the chargeable weight.">
            <app-item-entry-grid [initial]="voiceItems()" [defaultWeightKg]="defaultChargeableWeightKg()" (itemsChange)="onItems($event)" (weightChange)="onWeight($event)" (packagesChange)="onPackages($event)">
              <label class="fld fld--sm"><span class="fld__l">Number of Packages</span>
                <input class="fld__i" type="number" [value]="c('numberOfPackages').value" disabled /></label>
              <label class="fld fld--sm"><span class="fld__l">Declared Value</span>
                <input class="fld__i" type="number" [value]="c('declaredValue').value ?? 0" readonly title="Sum of every item's own Value above" /></label>
            </app-item-entry-grid>
            <div class="spacer"></div>
            <label class="fld"><span class="fld__l">Remarks</span>
              <textarea class="ta" rows="2" placeholder="Handle with care, deliver before noon…" maxlength="500" [formControl]="c('remarks')"></textarea></label>
          </app-card>

          <app-card title="Delivery Preferences" subtitle="How this shipment is delivered, and any add-ons.">
            <div class="pref-grid">
              <div class="pref-box">
                <span class="pref-box__title">Delivery Type</span>
                <div class="radio-row">
                  @for (type of deliveryTypes; track type) {
                    <label class="radio">
                      <input type="radio" name="deliveryType" [value]="type" [formControl]="c('deliveryType')" />
                      <span>{{ type === 'DOOR' ? 'Door Delivery' : 'Office Delivery' }}</span>
                    </label>
                  }
                </div>
                @if (c('deliveryType').value === 'DOOR') {
                  <label class="fld pref-box__sub"><span class="fld__l">Door Delivery Charge</span>
                    <input class="fld__i" type="number" min="0" step="0.01" [value]="doorDeliveryCharge()"
                      (input)="doorDeliveryCharge.set($any($event.target).valueAsNumber || 0)" /></label>
                }
              </div>

              <div class="pref-box">
                <label class="chk pref-box__title">
                  <input type="checkbox" [formControl]="c('appointmentDelivery')" />
                  <span>Appointment Delivery</span>
                </label>
                @if (c('appointmentDelivery').value) {
                  <div class="pref-box__sub pref-box__sub--grid">
                    <label class="fld"><span class="fld__l">Appointment Date</span>
                      <input class="fld__i" type="date" [formControl]="c('appointmentDate')" /></label>
                    <label class="fld"><span class="fld__l">Time Slot</span>
                      <input class="fld__i" [formControl]="c('appointmentTimeSlot')" placeholder="e.g. 1:00-2:00" maxlength="20" /></label>
                    <label class="fld"><span class="fld__l">Appointment Charge <span class="hint">(no GST)</span></span>
                      <input class="fld__i" type="number" min="0" step="0.01" [value]="appointmentDeliveryCharge()"
                        (input)="appointmentDeliveryCharge.set($any($event.target).valueAsNumber || 0)" /></label>
                  </div>
                } @else {
                  <p class="hint pref-box__note">Book a fixed date/time window with the receiver.</p>
                }
              </div>

              <div class="pref-box">
                <label class="chk pref-box__title">
                  <input type="checkbox" [formControl]="c('insuranceApplicable')" />
                  <span>FOV Applicable</span>
                </label>
                <p class="hint pref-box__note">2% of Invoice Value, added to charges automatically.</p>
              </div>
            </div>
          </app-card>

          <app-card title="Parties">
            @if (!isBusinessBooking) {
            <label class="chk bizbook">
              <input type="checkbox" [checked]="businessMode()" (change)="toggleBusinessMode($any($event.target).checked)" />
              <span>Business Customer booking</span>
            </label>
            @if (businessMode()) {
              <div class="bizbook__panel">
                <app-autocomplete [control]="businessCustomerCtl" label="Business Customer" [options]="businessCustomerOptions()"
                  placeholder="Search business customer by name or code…" />
                @if (businessPickupOptions().length > 1) {
                  <app-select [control]="businessPickupCtl" label="Pickup Address" [options]="businessPickupOptions()" placeholder="Select a pickup address" />
                }
                @if (selectedBusinessCustomer() && !businessPickupOptions().length) {
                  <p class="hint">This customer has no pickup address on file — type the sender's address below.</p>
                }
                <p class="hint">Fills the Consignor from the customer and defaults the payment mode to the customer's. Everything else stays the same.</p>
              </div>
              <div class="spacer"></div>
            }
            }
            <div class="parties">
              <div class="party party--sender">
                <div class="party__title">Consignor (Sender)</div>
                <label class="fld party__lookup"><span class="fld__l">Name</span>
                  <input class="fld__i" [formControl]="c('senderName')" placeholder="Sender's full name, or search by name / mobile"
                    maxlength="150" (focus)="openSuggest('sender', 'name')" (blur)="closeSuggest('sender')" />
                  @if (senderSuggestOpen() === 'name' && senderSuggestions().length) {
                    <ul class="lookup__list">
                      @for (cust of senderSuggestions(); track cust.id) {
                        <li class="lookup__item" (mousedown)="pickCustomer('sender', cust)">
                          <span class="lookup__name">{{ cust.displayName }}</span>
                          <span class="lookup__mobile">{{ cust.mobile }}</span>
                        </li>
                      }
                    </ul>
                  }
                </label>
                <div class="spacer"></div>
                <label class="fld"><span class="fld__l">Address</span>
                  <textarea class="ta" rows="2" [formControl]="c('senderAddress')" placeholder="Pickup address" maxlength="500"></textarea></label>
                <div class="spacer"></div>
                <label class="fld party__lookup"><span class="fld__l">Contact Number</span>
                  <input class="fld__i" type="tel" [formControl]="c('senderContact')" placeholder="10-digit mobile number, or search"
                    maxlength="20" (focus)="openSuggest('sender', 'contact')" (blur)="closeSuggest('sender')" />
                  @if (senderSuggestOpen() === 'contact' && senderSuggestions().length) {
                    <ul class="lookup__list">
                      @for (cust of senderSuggestions(); track cust.id) {
                        <li class="lookup__item" (mousedown)="pickCustomer('sender', cust)">
                          <span class="lookup__name">{{ cust.displayName }}</span>
                          <span class="lookup__mobile">{{ cust.mobile }}</span>
                        </li>
                      }
                    </ul>
                  }
                </label>
                <div class="spacer"></div>
                <label class="fld"><span class="fld__l">From Pincode</span>
                  <input class="fld__i" [formControl]="c('pickupPincode')" placeholder="e.g. 411001" maxlength="10" /></label>
              </div>

              <div class="party party--receiver">
                <div class="party__title">Consignee (Receiver)</div>
                <label class="fld party__lookup"><span class="fld__l">Name</span>
                  <input class="fld__i" [formControl]="c('receiverName')" placeholder="Receiver's full name, or search by name / mobile"
                    maxlength="150" (focus)="openSuggest('receiver', 'name')" (blur)="closeSuggest('receiver')" />
                  @if (receiverSuggestOpen() === 'name' && receiverSuggestions().length) {
                    <ul class="lookup__list">
                      @for (cust of receiverSuggestions(); track cust.id) {
                        <li class="lookup__item" (mousedown)="pickCustomer('receiver', cust)">
                          <span class="lookup__name">{{ cust.displayName }}</span>
                          <span class="lookup__mobile">{{ cust.mobile }}</span>
                        </li>
                      }
                    </ul>
                  }
                </label>
                <div class="spacer"></div>
                <label class="fld"><span class="fld__l">Address</span>
                  <textarea class="ta" rows="2" [formControl]="c('receiverAddress')" placeholder="Delivery address" maxlength="500"></textarea></label>
                <div class="spacer"></div>
                <label class="fld party__lookup"><span class="fld__l">Contact Number</span>
                  <input class="fld__i" type="tel" [formControl]="c('receiverContact')" placeholder="10-digit mobile number, or search"
                    maxlength="20" (focus)="openSuggest('receiver', 'contact')" (blur)="closeSuggest('receiver')" />
                  @if (receiverSuggestOpen() === 'contact' && receiverSuggestions().length) {
                    <ul class="lookup__list">
                      @for (cust of receiverSuggestions(); track cust.id) {
                        <li class="lookup__item" (mousedown)="pickCustomer('receiver', cust)">
                          <span class="lookup__name">{{ cust.displayName }}</span>
                          <span class="lookup__mobile">{{ cust.mobile }}</span>
                        </li>
                      }
                    </ul>
                  }
                </label>
                <div class="spacer"></div>
                <label class="fld"><span class="fld__l">To Pincode</span>
                  <input class="fld__i" [formControl]="c('deliveryPincode')" placeholder="e.g. 400008" maxlength="10" /></label>
              </div>
            </div>
          </app-card>

          <app-card title="E-Way Bill" subtitle="Required over the mandatory invoice value; optional below it. Generated automatically after booking.">
            <div class="grid3">
              <label class="fld"><span class="fld__l">Invoice Value</span>
                <input class="fld__i" type="number" [value]="c('invoiceValue').value ?? 0" readonly title="Same as Declared Value — the sum of every item's own Value" /></label>
              <div class="fld">
                <span class="fld__l">Status</span>
                @if (ewayBillMandatory()) {
                  <span class="eway-chip eway-chip--mandatory">⚠ E-Way Bill Mandatory</span>
                } @else {
                  <span class="eway-chip eway-chip--optional">E-Way Bill Optional</span>
                }
              </div>
            </div>

            @if (!ewayBillOpen()) {
              <div class="spacer"></div>
              <app-button variant="stroked" (pressed)="addEwayBill()">+ Add E-Way Bill</app-button>
            } @else {
              <div class="spacer"></div>
              <p class="hint">The E-Way Bill number and validity are issued automatically once the shipment is
                booked (Part-A); vehicle/transport details (Part-B) are filled in when the shipment is dispatched
                on a manifest. Only the invoice details below are needed now.</p>
              <div class="spacer"></div>
              <div class="grid3">
                <label class="fld"><span class="fld__l">Invoice Number</span>
                  <input class="fld__i" [formControl]="c('ewayBillInvoiceNumber')" placeholder="e.g. INV-1042" maxlength="50" /></label>
                <label class="fld"><span class="fld__l">Invoice Date</span>
                  <input class="fld__i" type="date" [formControl]="c('ewayBillInvoiceDate')" /></label>
                <label class="fld"><span class="fld__l">Sender GSTIN <span class="hint">(optional)</span></span>
                  <input class="fld__i" [formControl]="c('ewayBillConsignorGstin')" placeholder="e.g. 27AAAAA0000A1Z5" maxlength="15" /></label>
                <label class="fld"><span class="fld__l">Receiver GSTIN <span class="hint">(optional)</span></span>
                  <input class="fld__i" [formControl]="c('ewayBillConsigneeGstin')" placeholder="e.g. 27BBBBB0000B1Z5" maxlength="15" /></label>
              </div>
              <div class="spacer"></div>
              <label class="fld"><span class="fld__l">Remarks</span>
                <input class="fld__i" [formControl]="c('ewayBillRemarks')" placeholder="Optional" maxlength="500" /></label>
              <div class="spacer"></div>
              <div class="eway-doc">
                @if (selectedEwayBillFile(); as file) {
                  <span class="eway-doc__name">{{ file.name }}</span>
                  <button type="button" class="eway-doc__remove" (click)="removeEwayBillFile()"><mat-icon>close</mat-icon></button>
                } @else {
                  <button type="button" class="img__btn" (click)="ewayBillFile.click()">
                    <mat-icon>upload_file</mat-icon> Attach a document (PDF/JPG/PNG, optional)
                  </button>
                }
                <input #ewayBillFile type="file" accept=".pdf,.jpg,.jpeg,.png" hidden (change)="onEwayBillFile($event)" />
              </div>
              <div class="spacer"></div>
              <app-button variant="stroked" (pressed)="removeEwayBill()">Remove</app-button>
            }
            @if (ewayBillReason(); as reason) {
              <div class="spacer"></div>
              <p class="err">{{ reason }}</p>
            }
          </app-card>

          <app-card title="Shipment Image" subtitle="Optional — a photo of the parcel, uploaded once the shipment is booked.">
            <div class="img">
              @if (imagePreviewUrl(); as preview) {
                <div class="img__preview">
                  <img [src]="preview" alt="Shipment photo preview" />
                  <button type="button" class="img__remove" (click)="removeImage()">
                    <mat-icon>close</mat-icon>
                  </button>
                </div>
              } @else {
                <button type="button" class="img__btn" (click)="imageFile.click()">
                  <mat-icon>add_a_photo</mat-icon> Choose photo
                </button>
              }
              <input #imageFile type="file" accept="image/*" hidden (change)="onImageFile($event)" />
            </div>
          </app-card>
        </div>

        <aside class="lr__sum">
          <div class="sum">
            <h2 class="sum__title">Booking Summary</h2>

            <span class="sum__lbl">Route</span>
            <span class="sum__val">{{ myBranchCity() ?? myBranchLabel() }} → {{ freightCalc()?.destinationCityName ?? '—' }}</span>

            <span class="sum__lbl">Load</span>
            <span class="sum__val">{{ c('numberOfPackages').value || 1 }} pkg · {{ weight().chargeable | number: '1.3-3' }} kg</span>

            @if (c('invoiceValue').value) {
              <span class="sum__lbl">Invoice Value</span>
              <span class="sum__val">{{ c('invoiceValue').value | number: '1.2-2' }}
                — {{ ewayBillMandatory() ? 'E-Way Bill Mandatory' : 'E-Way Bill Optional' }}</span>
            }

            @if (myBranchIdPresent() && readyForFreight()) {
              @if (freightCalcLoading()) {
                <p class="hint">Calculating freight…</p>
              } @else if (freightCalcError()) {
                <p class="err">{{ freightCalcError() }}</p>
              }
            }

            <div class="sum__body">
              @if (freightCalc(); as f) {
                <div class="factor-row">
                  <span class="sum__lbl">Rate / KG
                    <span class="hint">(min {{ f.ratePerKg | number: '1.2-2' }}, increase only)</span>
                    @if (f.customerZoneName) {
                      <span class="hint">· {{ f.customerZoneName.startsWith('Zone tariff') ? f.customerZoneName + ' (' + f.weightSlabLabel + ')' : 'Customer zone ' + f.customerZoneName }}</span>
                    }
                  </span>
                  <input class="factor-input" type="number" step="0.01" [min]="f.ratePerKg"
                         [value]="ratePerKgOverride() ?? f.ratePerKg"
                         (input)="onRatePerKgInput($event)" />
                </div>
              } @else if (freightFactorApplicable()) {
                <div class="factor-row">
                  <span class="sum__lbl">Freight Factor
                    @if (matchedFreightFactor() != null) {
                      <span class="hint">(min {{ matchedFreightFactor() | number: '1.2-2' }}, increase only)</span>
                    }
                  </span>
                  <input class="factor-input" type="number" step="0.01" [min]="matchedFreightFactor()"
                         [value]="freightFactorOverride() ?? matchedFreightFactor()"
                         (input)="onFreightFactorInput($event)" />
                </div>
              }
              @if (!myBranchIdPresent()) {
                <p class="err">Your account has no branch assigned — ask an admin before booking.</p>
              } @else if (!readyToPrice()) {
                <p class="hint">{{ isMsrtc ? 'Select the delivery branch' : 'Enter a destination pincode' }} and add at least one item's weight to see pricing.</p>
              } @else if (pricingLoading()) {
                <p class="hint">Pricing…</p>
              } @else if (pricingError()) {
                <p class="err">{{ pricingError() }}</p>
              } @else if (pricing(); as p) {
                <div class="matched">
                  @if (p.matchedRouteCode) { <span class="chip">Route {{ p.matchedRouteCode }}</span> }
                  @if (p.matchedRateCode) { <span class="chip">Rate {{ p.matchedRateCode }}</span> }
                </div>
                <app-charge-summary [charges]="{
                  freight: freightCalc() ? effectiveBaseFreight() : p.chargeBreakup.freight, fuelCharge: p.chargeBreakup.fuelCharge,
                  handlingCharge: p.chargeBreakup.handlingCharge,
                  odaCharge: odaChargeOverride() ?? freightCalc()?.odaCharge ?? p.chargeBreakup.odaCharge,
                  insuranceCharge: finalInsuranceCharge(),
                  applicableCharges: p.chargeBreakup.applicableCharges,
                  applicableChargeLines: p.chargeBreakup.applicableChargeLines,
                  gstAmount: p.chargeBreakup.gstAmount + gstOnOtherCharges() + gstOnOdaChargeDelta() + gstOnFreightDelta()
                    + gstOnInsuranceChargeDelta() + gstOnDoorDeliveryCharge() + gstOnToPayCharge(),
                  discountAmount: p.chargeBreakup.discount, roundOff: computedRoundOff(),
                  otherCharges: otherCharges(),
                  appointmentDeliveryCharge: c('appointmentDelivery').value ? appointmentDeliveryCharge() : undefined,
                  doorDeliveryCharge: c('deliveryType').value === 'DOOR' ? doorDeliveryCharge() : undefined,
                  toPayCharge: toPayCharge(),
                  netAmount: manualNetAmount() ?? computedNetAmount()
                }" [editable]="true" (netAmountChange)="onManualNetAmountChange($event)"
                  (otherChargesChange)="otherCharges.set($event)"
                  (odaChargeChange)="odaChargeOverride.set($event)"
                  (appointmentDeliveryChargeChange)="appointmentDeliveryCharge.set($event)"
                  (doorDeliveryChargeChange)="doorDeliveryCharge.set($event)" />
              }
            </div>

            <div class="sum__paymode">
              <app-select [control]="c('paymentModeId')" label="Payment Mode" [options]="paymentModeOptions()" placeholder="Select a payment mode" />
            </div>

            @if (ewayBillReason(); as reason) {
              <p class="err">{{ reason }}</p>
            }
            @if (appointmentDeliveryReason(); as reason) {
              <p class="err">{{ reason }}</p>
            }
            <div class="sum__cta">
              <app-button icon="check" [loading]="submitting()"
                [disabled]="!pricing() || pricingLoading() || !freightCalc() || freightCalcLoading()
                  || form.invalid || ewayBillReason() !== null || appointmentDeliveryReason() !== null
                  || !c('declaredValue').value || (isMsrtc && !msrtcDeliveryBranchId()) || busCrossingIncomplete()"
                (pressed)="book()">Book Shipment</app-button>
            </div>
          </div>
        </aside>
      </div>
      }
    </div>
  `,
  styles: [`
    .page__head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; }
    .page__head { margin-bottom:4px; }
    .page__head-actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .voice-banner { margin:4px 0 0; font:500 13px var(--font-sans); color:var(--brand-700); background:var(--brand-50);
      border-radius:var(--r-field); padding:8px 12px; }
    .lr { display:grid; grid-template-columns:minmax(0,1fr) 300px; gap:16px; align-items:start; margin-top:10px; }
    .lr__main { display:flex; flex-direction:column; gap:10px; min-width:0; }
    .lr__main ::ng-deep .ac__head { padding:10px 16px; }
    .lr__main ::ng-deep .ac__body { padding:14px 16px; }
    .lr__sum { position:sticky; top:10px; }
    .sum { display:flex; flex-direction:column; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-field); padding:14px 16px; gap:2px; }
    .sum__title { margin:0 0 6px; font:700 15px var(--font-sans); color:var(--content-fg); }
    .sum__lbl { font:500 12px var(--font-sans); color:var(--content-muted); margin-top:8px; }
    .sum__val { font:600 14px var(--font-sans); color:var(--content-fg); }
    .sum__body { margin-top:12px; }
    .factor-row { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:12px; }
    .factor-row .hint { font:400 11px var(--font-sans); }
    .factor-input { width:90px; text-align:right; font:700 14px var(--font-mono, ui-monospace); color:var(--brand-600);
      background:transparent; border:1px solid var(--surface-border); border-radius:6px; padding:2px 6px; }
    .factor-input:focus { outline:0; border-color:var(--brand-500); }
    .fld__i--hint { display:flex; align-items:center; font:400 13px var(--font-sans); color:var(--content-muted); }
    .sum__paymode { margin-top:12px; }
    .sum__cta { margin-top:10px; }
    .sum__cta app-button, .sum__cta ::ng-deep .app-btn { width:100%; }
    .hint { font:400 13px var(--font-sans); color:var(--content-muted); margin:0; }
    .err { font:500 13px var(--font-sans); color:var(--danger); padding:10px 12px; background:var(--danger-bg); border-radius:var(--r-field); margin:0; }
    .matched { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
    .chip { font:600 11px var(--font-sans); padding:4px 10px; border-radius:999px; background:var(--brand-50); color:var(--brand-700); }
    .grid2 { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px 16px; }
    .grid3 { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px 16px; }
    .parties { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
    .pref-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; align-items:start; }
    .pref-box { background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field);
      padding:14px; display:flex; flex-direction:column; gap:10px; }
    .pref-box__title { font:700 13px var(--font-sans); color:var(--content-fg); }
    .pref-box__sub { margin-top:2px; }
    .pref-box__sub--grid { display:grid; grid-template-columns:1fr; gap:10px; }
    .pref-box__note { margin:0; }
    .party { background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); padding:12px; }
    .party--sender { border-top:3px solid var(--info); }
    .party--receiver { border-top:3px solid var(--brand-600); }
    .party__title { font:700 11px var(--font-sans); letter-spacing:.06em; text-transform:uppercase; margin-bottom:8px; }
    .party--sender .party__title { color:var(--info); }
    .party--receiver .party__title { color:var(--brand-600); }
    .fld { display:flex; flex-direction:column; gap:4px; }
    .dest-mode { display:flex; gap:20px; padding-top:6px; }
    .bizbook { margin-bottom:12px; font-weight:600; }
    .bizbook__panel { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px 20px; align-items:start; }
    .bizbook__panel .hint { grid-column:1 / -1; }
    @media (max-width:760px){ .bizbook__panel { grid-template-columns:1fr; } }
    .chk { display:flex; gap:10px; align-items:flex-start; font:400 14px var(--font-sans); color:var(--content-fg); cursor:pointer; }
    .chk input { margin-top:3px; width:16px; height:16px; accent-color:var(--brand-600); }
    .radio-row { display:flex; gap:16px; align-items:center; }
    .radio { display:flex; gap:6px; align-items:center; font:400 14px var(--font-sans); color:var(--content-fg); cursor:pointer; }
    .radio input { width:16px; height:16px; accent-color:var(--brand-600); }
    .crossing-hops { display:flex; flex-direction:column; gap:8px; margin-top:8px; }
    .crossing-hop { display:flex; align-items:flex-end; gap:8px; }
    .crossing-hop app-autocomplete { flex:1; }
    .crossing-hop__remove { flex-shrink:0; height:38px; width:38px; border:1px solid var(--surface-border);
      border-radius:var(--r-field); background:var(--surface); color:var(--content-muted); cursor:pointer; }
    .crossing-hop__remove:hover { color:var(--danger, #e11d48); border-color:currentColor; }
    .party__lookup { position:relative; }
    .lookup__list { position:absolute; top:100%; left:0; right:0; z-index:20; margin-top:2px; max-height:220px; overflow-y:auto;
      background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); box-shadow:0 4px 14px rgba(0,0,0,.12);
      list-style:none; padding:4px; }
    .lookup__item { display:flex; justify-content:space-between; gap:8px; padding:7px 9px; border-radius:6px; cursor:pointer; font:400 13px var(--font-sans); }
    .lookup__item:hover { background:var(--brand-50); }
    .lookup__name { color:var(--content-fg); font-weight:500; }
    .lookup__mobile { color:var(--content-muted); }
    .fld--sm { width:160px; }
    .fld__l { font:500 13px var(--font-sans); color:var(--content-fg); }
    .fld__i { height:38px; padding:0 12px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-field); font:400 14px var(--font-sans); color:var(--content-fg); }
    .ta { width:100%; padding:8px 12px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-field); font:400 14px var(--font-sans); color:var(--content-fg); resize:vertical; }
    .spacer { height:8px; }
    .img__btn { display:inline-flex; align-items:center; gap:6px;
      border:1px dashed var(--surface-border); background:var(--surface); border-radius:var(--r-field);
      padding:10px 16px; font:600 13px var(--font-sans); color:var(--content-fg); cursor:pointer; }
    .img__btn mat-icon { font-size:18px; width:18px; height:18px; }
    .img__preview { position:relative; display:inline-block; }
    .img__preview img { display:block; max-width:220px; max-height:160px; border-radius:var(--r-field);
      border:1px solid var(--surface-border); }
    .img__remove { position:absolute; top:-8px; right:-8px; width:26px; height:26px; border-radius:50%;
      border:1px solid var(--surface-border); background:var(--surface); color:var(--content-fg);
      display:grid; place-items:center; cursor:pointer; }
    .img__remove mat-icon { font-size:16px; width:16px; height:16px; }
    .eway-chip { display:inline-flex; align-items:center; height:38px; padding:0 12px; border-radius:var(--r-field);
      font:600 13px var(--font-sans); width:fit-content; }
    .eway-chip--optional { background:var(--brand-50); color:var(--brand-700); }
    .eway-chip--mandatory { background:var(--danger-bg); color:var(--danger); }
    .eway-doc { display:flex; align-items:center; gap:10px; }
    .eway-doc__name { font:500 13px var(--font-sans); color:var(--content-fg); }
    .eway-doc__remove { width:26px; height:26px; border-radius:50%; border:1px solid var(--surface-border);
      background:var(--surface); color:var(--content-fg); display:grid; place-items:center; cursor:pointer; flex-shrink:0; }
    .eway-doc__remove mat-icon { font-size:16px; width:16px; height:16px; }
    @media (max-width:960px){ .lr { grid-template-columns:1fr; } .lr__sum { position:static; } }
    @media (max-width:760px){ .grid2, .grid3, .parties, .pref-grid { grid-template-columns:1fr; } }
  `]
})
export class ShipmentCreate implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(ShipmentService);
  private readonly ewayBillService = inject(EwayBillService);
  private readonly freightCalculationService = inject(FreightCalculationService);
  private readonly customers = inject(CustomerService);
  private readonly businessCustomerService = inject(BusinessCustomerService);
  private readonly masters = inject(MasterDataService);
  private readonly companyProfile = inject(CompanyProfileService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly settings = inject(SettingsService);

  protected readonly submitting = signal(false);

  /** The signed-in user's own branch — Booking Branch is not a picker here, a booking
   *  desk books from its own branch, not a chosen one. `null` for a user with no branch
   *  of their own (e.g. COMPANY_ADMIN), handled as a hard stop, not a silent fallback. */
  protected readonly myBranchId = this.auth.user()?.branchId ?? null;
  private readonly route = inject(ActivatedRoute);
  private readonly pickupService = inject(PickupService);
  /** `?pickupId=` — this booking is for a collected Pickup Request; it is linked back once booked. */
  private readonly pickupId = this.route.snapshot.queryParamMap.get('pickupId');
  /** The MSRTC Shipment Booking route reuses this screen; everything MSRTC-only below is
   *  gated on this, so the standard booking behaves exactly as before. */
  protected readonly isMsrtc = this.route.snapshot.data['flowType'] === 'MSRTC';
  /** Operations > Business Customer Booking: the customer is chosen first, then the normal booking form opens. */
  protected readonly isBusinessBooking = this.route.snapshot.data['businessBooking'] === true;
  /** MSRTC only: how the destination is chosen — a pincode (its mapped branch is looked up)
   *  or a branch picked directly (its own pincode drives pricing). */
  protected readonly destMode = signal<'PINCODE' | 'BRANCH'>(this.route.snapshot.data['flowType'] === 'MSRTC' ? 'BRANCH' : 'PINCODE');
  /** MSRTC only: the branch mapped to the typed destination pincode, if any. */
  protected readonly pincodeBranch = signal<{ id: string; name: string } | null>(null);
  private readonly pincodeBranchLookup = signal<'idle' | 'loading' | 'none'>('idle');
  private branchPostalCodes = new Map<string, string>();
  /** MSRTC only: the branch picked in "To Branch" mode (mirrors the form control as a signal). */
  private readonly msrtcPickedBranch = signal<string | null>(null);
  /** MSRTC only: the delivery branch this booking will carry, whichever way it was chosen. */
  protected readonly busCrossing = signal<BusCrossingPick | null>(null);
  protected readonly busCrossingIncomplete = signal(false);
  private readonly busDepotService = inject(BusDepotService);
  protected readonly msrtcDeliveryBranchId = computed(() =>
    this.destMode() === 'BRANCH' ? this.msrtcPickedBranch() : (this.pincodeBranch()?.id ?? null));
  protected readonly pincodeBranchLabel = computed(() => {
    const b = this.pincodeBranch();
    if (b) return b.name;
    const state = this.pincodeBranchLookup();
    if (state === 'loading') return 'Looking up…';
    if (state === 'none') return 'No branch is mapped to this pincode — choose "To Branch" instead';
    return 'Enter a destination pincode';
  });

  /** Crossing Branch picker options — excludes the caller's own branch, see `ngOnInit`. */
  protected readonly branchOptions = signal<SelectOption[]>([]);
  /** The caller's own branch label, read from the unfiltered list before it's excluded
   *  above — `myBranchLabel()` needs it even though `branchOptions()` no longer carries it. */
  protected readonly myBranchName = signal<string | null>(null);
  /** The booking branch's own city — shown as "From City" instead of a branch picker. */
  protected readonly myBranchCity = signal<string | null>(null);
  protected readonly serviceTypeOptions = signal<SelectOption[]>([]);
  protected readonly packageTypeOptions = signal<SelectOption[]>([]);
  /** Service Type id -> `deliveryDays`, from the raw directory (options() only carries
   *  {value,label}) — feeds {@link expectedDeliveryPreview}. */
  private readonly serviceTypeDeliveryDays = signal<Map<string, number | null>>(new Map());
  /** `bookingDate + serviceType.deliveryDays`, client-side and instant (mirrors the
   *  server's own `ShipmentServiceImpl.expectedDeliveryDate`) — a live preview only, the
   *  saved value still comes from the create/update response. */
  protected readonly expectedDeliveryPreview = signal<string | null>(null);
  protected readonly paymentModeOptions = signal<SelectOption[]>([]);

  protected readonly items = signal<ShipmentItemRequest[]>([]);
  protected readonly weight = signal({ actual: 0, volumetric: 0, chargeable: 0 });

  /** Fed to `ItemEntryGrid`'s `initial` input only after a voice command supplies a
   *  weight/package count — `null` otherwise, so the grid keeps its own default row. */
  protected readonly voiceItems = signal<ShipmentItemRequest[] | null>(null);
  /** What the last voice command actually filled — shown as a small confirmation banner;
   *  the user still reviews and clicks Book, nothing books itself off a voice command. */
  protected readonly voiceSummary = signal<string | null>(null);

  protected readonly pricing = signal<PricingResponse | null>(null);
  protected readonly pricingLoading = signal(false);
  protected readonly pricingError = signal<string | null>(null);

  /**
   * District Level Freight's own live-preview result — the authoritative source for the
   * Freight and ODA lines shown in the Booking Summary. `null` until a preview resolves
   * (or after a lane/weight change invalidates the last one); `freightCalcError()` carries
   * a clear message — e.g. no configuration for this From Station + District — that also
   * gates the Book button, per the brief's own "do not allow booking with an invalid/
   * unavailable freight calculation" rule.
   */
  protected readonly freightCalc = signal<FreightCalculationResponse | null>(null);
  protected readonly freightCalcLoading = signal(false);
  protected readonly freightCalcError = signal<string | null>(null);
  private readonly freightTrigger$ = new Subject<void>();

  /** A manual override of the previewed Net Amount — display only, cleared whenever the
   *  underlying price is recomputed. Never sent to the server: the booking is always
   *  priced server-side from the actual booking fields, not from what was shown here.
   *  Bounded by {@link netAmountMaxDecreasePercent}/{@link netAmountMaxIncreasePercent} —
   *  see {@link onManualNetAmountChange}. */
  protected readonly manualNetAmount = signal<number | null>(null);

  /** Company's Round Off rule (`CompanySettings.roundOffRule`) — mirrors
   *  `ShipmentServiceImpl.roundOffRule` so this preview's Round Off/Net Amount matches
   *  what actually gets persisted once Other Charges/ODA/Door Delivery are edited. */
  protected readonly companyRoundOffRule = signal<string>('NEAREST_FIVE');

  /** How far the editable Net Amount preview may be typed below/above the computed amount
   *  (`CompanySettings.netAmountMaxDecreasePercent`/`netAmountMaxIncreasePercent`) — see
   *  {@link onManualNetAmountChange}. */
  protected readonly netAmountMaxDecreasePercent = signal<number>(10);
  protected readonly netAmountMaxIncreasePercent = signal<number>(50);

  /** Other Charges — a manual, typed-at-booking amount (e.g. packing, handling extras) on
   *  top of the Pricing Engine's own rate-driven breakup. Unlike {@link manualNetAmount}
   *  this one IS sent to the server, see {@link book}; it survives a reprice since it's
   *  the desk's own figure, not a stale echo of one specific preview. */
  protected readonly otherCharges = signal<number>(0);

  /** ODA Charge override — null until the operator types over the Pricing Engine's own
   *  `chargeBreakup.odaCharge` for this preview. Unlike {@link otherCharges} this one
   *  replaces the engine's line rather than adding a new one, so it resets to null (falls
   *  back to the engine's figure again) on every reprice — see {@link priceIt$}. IS sent
   *  to the server, see {@link book}. */
  protected readonly odaChargeOverride = signal<number | null>(null);

  /** Manual, typed at booking time when Appointment Delivery is checked — deliberately
   *  GST-free (direct user request), unlike {@link otherCharges}. Prefilled from
   *  {@link defaultAppointmentDeliveryCharge} whenever the checkbox is checked, and reset
   *  to zero whenever it's unchecked — see `ngOnInit`. */
  protected readonly appointmentDeliveryCharge = signal<number>(0);

  /** Company Settings → Shipment → default appointment delivery charge, prefilled onto
   *  {@link appointmentDeliveryCharge} when the checkbox is checked. Falls back to 1000
   *  (the backend's own default) until settings load. */
  protected readonly defaultAppointmentDeliveryCharge = signal<number>(1000);

  protected readonly deliveryTypes = DELIVERY_TYPES;

  /** Manual, typed at booking time when Delivery Type is DOOR — taxed with GST, same
   *  treatment as {@link otherCharges} (see {@link gstOnDoorDeliveryCharge}), unlike
   *  {@link appointmentDeliveryCharge}. Reset to zero whenever Office Delivery is picked,
   *  see `ngOnInit`. */
  protected readonly doorDeliveryCharge = signal<number>(0);
  /** `CompanySettings.toPayCharge` — the flat amount the backend adds to every To-Pay booking. */
  private readonly toPayChargeSetting = signal<number>(0);

  /** Set only when the current preview priced through the Freight Factor fallback (no
   *  route/rate for this lane) — gates the "Freight Factor" input in the summary. */
  protected readonly freightFactorApplicable = signal(false);
  /** The grid cell's own factor, as last returned by a preview that carried no override —
   *  shown as the floor a typed value may not go below (server-enforced; see {@link
   *  onFreightFactorInput}). */
  protected readonly matchedFreightFactor = signal<number | null>(null);
  /** `null` until the desk types a raised factor — sent to the server as-is, which is the
   *  only place "increase only" is actually enforced. */
  protected readonly freightFactorOverride = signal<number | null>(null);

  /** Operator override of District Level Freight's own matched-slab rate/KG — same
   *  "increase only, server-enforced" shape as {@link freightFactorOverride}, a different
   *  module. `null` keeps the system rate; reset on every lane/weight/area change since a
   *  new preview's own floor may differ (see {@link scheduleFreightCalc}). */
  protected readonly ratePerKgOverride = signal<number | null>(null);

  /** Areas of the typed Destination Pincode, looked up via `master_pincode_areas` — the
   *  new pre-Delivery-Branch flow: pincode -> areas -> pick one -> freight recalculates
   *  off that exact area's District/ODA. Empty until a 6-digit pincode resolves. */
  protected readonly destinationAreaOptions = signal<SelectOption[]>([]);
  protected readonly destinationAreaLoading = signal(false);
  protected readonly destinationAreaError = signal<string | null>(null);
  private readonly destinationPincodeQuery$ = new Subject<string>();

  /** The booking branch's own GST% (V25) — Other Charges is a manual, booking-time amount
   *  the Pricing Engine never sees, so GST on it is computed here (mirroring
   *  `ShipmentServiceImpl.copyCharge`) purely so the live preview's total matches what
   *  actually gets persisted at booking. */
  protected readonly myBranchGstPercentage = signal<number>(18);

  /** Company Settings → Shipment → default chargeable weight, fed to `ItemEntryGrid`.
   *  Null until the settings call resolves — the grid falls back to its own constant
   *  until then. */
  protected readonly defaultChargeableWeightKg = signal<number | null>(null);

  /** Picked at booking time but only uploaded once the shipment id exists — the endpoint
   *  is `POST /shipments/{id}/image-upload`, so there is nothing to upload to until
   *  `book()` succeeds. `imagePreviewUrl` is a local `URL.createObjectURL`, revoked on
   *  removal/replacement so it doesn't leak. */
  protected readonly selectedImageFile = signal<File | null>(null);
  protected readonly imagePreviewUrl = signal<string | null>(null);

  /**
   * E-Way Bill Management (`com.courier.modules.ewaybill`), integrated inline: invoice
   * value over the company's own configurable threshold (`ewayBillThreshold`, from
   * `GET /company-settings`'s `ewayBill` section, default 50000) makes an E-Way Bill
   * mandatory before AWB generation. The backend re-checks and enforces this itself
   * inside `POST /shipments` — `ewayBillReason()` below is UX only, never the real gate;
   * see `MEMORY/modules/eway-bill.md`.
   */
  protected readonly ewayBillThreshold = signal(50000);
  /** Shown/hidden by "Add E-Way Bill"/"Remove" — auto-opens once invoice value crosses
   *  the threshold, see `ngOnInit`. */
  protected readonly ewayBillOpen = signal(false);
  /** Picked at booking time, uploaded once the shipment (and its E-Way Bill row) exist —
   *  same delayed-upload shape as `selectedImageFile`. */
  protected readonly selectedEwayBillFile = signal<File | null>(null);

  private readonly pricingTrigger$ = new Subject<void>();

  /** Search-as-you-type over the Customer module by name or mobile (see `CustomerSpecifications`
   *  on the backend) — matches existing prior parties into `senderName`/`senderContact` and
   *  `receiverName`/`receiverContact` without joining Shipment to Customer at booking time; the
   *  picked customer's plain values are copied into the free-text fields exactly like manual
   *  typing, nothing here becomes a foreign key. */
  /** Business Customer booking: pick a business customer to fill the consignor and payment
   *  mode. Purely a convenience — like `pickCustomer`, no customer id is stored on the shipment. */
  protected readonly businessMode = signal(false);
  protected readonly businessCustomerOptions = signal<SelectOption[]>([]);
  protected readonly businessPickupOptions = signal<SelectOption[]>([]);
  protected readonly businessCustomerCtl = new FormControl<string>('', { nonNullable: true });
  /** The autocomplete control holds the typed text until an option is chosen; this is set only to a real customer id. */
  protected readonly selectedBusinessCustomer = signal('');
  /** The Business Customer zone rate's docket/mathadi/pack/fuel/FOV total currently folded into
   *  Other Charges — tracked so a recalculation replaces it instead of stacking on it. */
  private readonly zoneExtraCharges = signal(0);
  protected readonly businessPickupCtl = new FormControl<string>('', { nonNullable: true });
  private businessPickupAddresses: CustomerAddress[] = [];
  protected readonly senderSuggestions = signal<Customer[]>([]);
  protected readonly receiverSuggestions = signal<Customer[]>([]);
  /** Which field within the party currently owns the dropdown — `null` closes it. Both
   *  Name and Contact Number search into the same suggestion list, but only the focused
   *  field should show it, not both at once. */
  protected readonly senderSuggestOpen = signal<'name' | 'contact' | null>(null);
  protected readonly receiverSuggestOpen = signal<'name' | 'contact' | null>(null);
  private readonly senderQuery$ = new Subject<string>();
  private readonly receiverQuery$ = new Subject<string>();

  protected readonly form: FormGroup = this.fb.group({
    bookingBranchId: [this.myBranchId, Validators.required],
    msrtcDeliveryBranchId: [null as string | null],
    manualShipmentNumber: ['', Validators.maxLength(30)],
    pickupPincode: ['', Validators.maxLength(10)],
    deliveryPincode: ['', Validators.maxLength(10)],
    destinationPincode: ['', Validators.maxLength(10)],
    destinationAreaId: [null as string | null],
    senderName: ['', [Validators.required, Validators.maxLength(150)]],
    senderAddress: ['', [Validators.required, Validators.maxLength(500)]],
    senderContact: ['', [Validators.required, Validators.maxLength(20)]],
    receiverName: ['', [Validators.required, Validators.maxLength(150)]],
    receiverAddress: ['', [Validators.required, Validators.maxLength(500)]],
    receiverContact: ['', [Validators.required, Validators.maxLength(20)]],
    serviceTypeId: [null as string | null, Validators.required],
    packageTypeId: [null as string | null],
    paymentModeId: [null as string | null, Validators.required],
    bookingDate: [{ value: today(), disabled: true }],
    numberOfPackages: [1],
    declaredValue: [null as number | null],
    remarks: ['', Validators.maxLength(500)],
    crossing: [false],
    crossingBranchIds: this.fb.array<FormControl<string | null>>([]),
    crossingCharge: [null as number | null],
    appointmentDelivery: [false],
    appointmentDate: [null as string | null],
    appointmentTimeSlot: ['', Validators.maxLength(20)],
    insuranceApplicable: [false],
    deliveryType: ['DOOR' as DeliveryType],
    invoiceValue: [null as number | null],
    ewayBillInvoiceNumber: ['', Validators.maxLength(50)],
    ewayBillInvoiceDate: [today()],
    ewayBillConsignorGstin: ['', Validators.maxLength(15)],
    ewayBillConsigneeGstin: ['', Validators.maxLength(15)],
    ewayBillRemarks: ['', Validators.maxLength(500)]
  });

  protected get crossingBranchArray(): FormArray<FormControl<string | null>> {
    return this.form.get('crossingBranchIds') as FormArray<FormControl<string | null>>;
  }

  /** `app-autocomplete` wants a plain `FormControl` — a `FormArray` element is typed as
   *  `AbstractControl` in the template's `@for`, so this narrows it back. */
  protected asControl(ctrl: AbstractControl): FormControl<string | null> {
    return ctrl as FormControl<string | null>;
  }

  protected addCrossingBranch(): void {
    this.crossingBranchArray.push(this.fb.control(null as string | null, Validators.required));
  }

  protected removeCrossingBranch(index: number): void {
    this.crossingBranchArray.removeAt(index);
  }

  /** Crossing Branch picker options — excludes the caller's own branch (already out of
   *  `branchOptions`). There is no Delivery Branch to also exclude any more — that's
   *  decided later, at Load Sheet, not at booking. */
  protected readonly crossingBranchOptions = computed(() => this.branchOptions());

  ngOnInit(): void {
    if (this.pickupId) {
      // Booking for a collected Pickup Request: prefill the consignor, pincode and what was actually collected.
      const q = this.route.snapshot.queryParamMap;
      this.form.patchValue({
        pickupPincode: q.get('pincode') ?? '', senderName: q.get('name') ?? '',
        senderContact: q.get('mobile') ?? '', senderAddress: q.get('address') ?? ''
      });
      const weight = Number(q.get('weight'));
      if (weight > 0) {
        this.voiceItems.set([{ itemName: 'Package', quantity: Number(q.get('parcels')) || 1, weight, lengthCm: null,
          widthCm: null, heightCm: null, declaredValue: null, fragile: false, dangerousGoods: false }]);
      }
    }
    const fromTariff = this.route.snapshot.queryParamMap;
    if (fromTariff.get('fromTariff')) {
      // "Book" on a Tariff Calculator option: the destination, service, package and package details it priced.
      this.form.patchValue({
        deliveryPincode: fromTariff.get('deliveryPincode') ?? '',
        serviceTypeId: fromTariff.get('serviceTypeId'), packageTypeId: fromTariff.get('packageTypeId')
      });
      const weight = Number(fromTariff.get('weight'));
      if (weight > 0) {
        const value = Number(fromTariff.get('declaredValue'));
        this.voiceItems.set([{ itemName: 'Package', quantity: Number(fromTariff.get('parcels')) || 1, weight, lengthCm: null,
          widthCm: null, heightCm: null, declaredValue: value > 0 ? value : null, fragile: false, dangerousGoods: false }]);
      }
    }
    this.breadcrumb.set(this.isBusinessBooking
      ? [{ label: 'Operations' }, { label: 'Business Customer Booking' }]
      : [{ label: 'Shipments', route: '/shipments' }, { label: 'New' }]);
    this.settings.get().subscribe((d) => {
      const shipment = (d as { shipment?: { defaultChargeableWeightKg?: number; defaultAppointmentDeliveryCharge?: number; toPayCharge?: number } })?.shipment;
      if (shipment?.defaultChargeableWeightKg != null) {
        this.defaultChargeableWeightKg.set(Number(shipment.defaultChargeableWeightKg));
      }
      if (shipment?.toPayCharge != null) this.toPayChargeSetting.set(Number(shipment.toPayCharge));
      if (shipment?.defaultAppointmentDeliveryCharge != null) {
        this.defaultAppointmentDeliveryCharge.set(Number(shipment.defaultAppointmentDeliveryCharge));
        if (this.c('appointmentDelivery').value) {
          this.appointmentDeliveryCharge.set(this.defaultAppointmentDeliveryCharge());
        }
      }
      const ewayBill = (d as { ewayBill?: { ewayBillMandatoryValue?: number } })?.ewayBill;
      if (ewayBill?.ewayBillMandatoryValue != null) {
        this.ewayBillThreshold.set(Number(ewayBill.ewayBillMandatoryValue));
      }
      const finance = (d as { finance?: {
        roundOffRule?: string; netAmountMaxDecreasePercent?: number; netAmountMaxIncreasePercent?: number;
      } })?.finance;
      if (finance?.roundOffRule) {
        this.companyRoundOffRule.set(finance.roundOffRule);
      }
      if (finance?.netAmountMaxDecreasePercent != null) {
        this.netAmountMaxDecreasePercent.set(Number(finance.netAmountMaxDecreasePercent));
      }
      if (finance?.netAmountMaxIncreasePercent != null) {
        this.netAmountMaxIncreasePercent.set(Number(finance.netAmountMaxIncreasePercent));
      }
    });
    // Auto-opens the E-Way Bill section the moment invoice value crosses the threshold —
    // a desk typing a large invoice shouldn't also have to remember to click "Add E-Way
    // Bill" themselves. Never auto-closes it once opened, even if the value drops back
    // down, since the desk may already be partway through filling it in.
    this.c('invoiceValue').valueChanges.subscribe(() => {
      if (this.ewayBillMandatory()) this.ewayBillOpen.set(true);
    });
    // Crossing Branch's own picker (branchOptions) excludes the caller's own booking
    // branch — a shipment cannot be booked and crossed through the same branch.
    this.masters.options('branches').subscribe((o) => {
      this.myBranchName.set(o.find((opt) => opt.value === this.myBranchId)?.label ?? null);
      this.branchOptions.set(o.filter((opt) => opt.value !== this.myBranchId));
    });
    this.masters.branchDirectory().subscribe((list) => {
      if (this.isMsrtc) {
        this.branchPostalCodes = new Map(list.filter((b) => !!b.postalCode).map((b) => [b.id, b.postalCode]));
      }
      const mine = list.find((b) => b.id === this.myBranchId);
      if (mine?.postalCode && !this.form.get('pickupPincode')?.value) {
        this.form.get('pickupPincode')?.setValue(mine.postalCode);
      }
      if (mine?.gstPercentage != null) this.myBranchGstPercentage.set(mine.gstPercentage);
      if (mine?.city) this.myBranchCity.set(mine.city);
    });
    // MSRTC "To Branch" mode: the picked branch's own pincode becomes the destination
    // pincode, which then runs the same area lookup + pricing the pincode mode does.
    if (this.isMsrtc) {
      this.c('msrtcDeliveryBranchId').valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((id: string | null) => {
        this.msrtcPickedBranch.set(id);
        if (this.destMode() !== 'BRANCH') return;
        const postal = id ? this.branchPostalCodes.get(id) : undefined;
        if (id && !postal) this.notify.error('That branch has no pincode on file — pick another branch or use Pincode.');
        this.c('destinationPincode').setValue(postal ?? '');
      });
    }
    // Destination Pincode -> its own Areas (master_pincode_areas, 0.32.2) -> picking one
    // resolves District Level Freight's District/ODA off that exact link rather than the
    // pincode's legacy single area — see MasterDistrictFreightCoverageDirectory
    // .findByPincodeAndArea. A 6-digit pincode is looked up (paged master search, exact
    // code match) for its id, then its area links (the primary one auto-selects as a
    // convenience default, still overridable). No delivery branch is resolved from this
    // any more — that's decided later, at Load Sheet, not at booking.
    this.c('destinationPincode').valueChanges.subscribe((v) =>
      this.destinationPincodeQuery$.next((v ?? '').trim()));
    this.destinationPincodeQuery$.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      switchMap((code) => {
        if (this.isMsrtc) { this.pincodeBranch.set(null); this.pincodeBranchLookup.set('idle'); }
        this.destinationAreaOptions.set([]);
        this.destinationAreaError.set(null);
        this.c('destinationAreaId').setValue(null, { emitEvent: false });
        if (!/^\d{6}$/.test(code)) return of(null);
        this.destinationAreaLoading.set(true);
        return this.masters.list(MASTER_DEFINITIONS['pincodes'], { page: 0, size: 5, search: code }).pipe(
          switchMap((page) => {
            const match = page.content.find((r) => r.code === code);
            if (!match) return of(null);
            if (this.isMsrtc) this.lookupPincodeBranch(match.id);
            return this.masters.pincodeAreas(match.id);
          }),
          catchError(() => of(null))
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((rows) => {
      this.destinationAreaLoading.set(false);
      if (!rows || !rows.length) {
        this.destinationAreaOptions.set([]);
        this.destinationAreaError.set(
          this.c('destinationPincode').value?.trim() ? 'No areas found for this pincode.' : null);
      } else {
        this.destinationAreaOptions.set(rows.map((r) => ({
          value: r.areaId,
          label: r.areaName ? `${r.areaName}${r.cityName ? ', ' + r.cityName : ''}` : r.areaId
        })));
        const primary = rows.find((r) => r.primary);
        if (primary) this.c('destinationAreaId').setValue(primary.areaId);
      }
      // The Pricing Engine reads `deliveryPincode`, not `destinationPincode` — synced here
      // (not only from the Area-select listener below) because a pincode can resolve with
      // no `master_pincode_areas` row at all (data gap, not a reason to leave pricing
      // permanently blank).
      const code = this.c('destinationPincode').value?.trim();
      if (code && /^\d{6}$/.test(code)) this.form.get('deliveryPincode')?.setValue(code);
    });
    // Picking an Area is the trigger the brief asks for ("after area select it should get
    // rate") — also syncs deliveryPincode so Pricing Engine and District Level Freight
    // never target two different destinations for the same booking.
    this.c('destinationAreaId').valueChanges.subscribe((areaId) => {
      if (!areaId) return;
      const pincode = this.c('destinationPincode').value?.trim();
      if (pincode) this.form.get('deliveryPincode')?.setValue(pincode);
      this.scheduleFreightCalc();
    });
    // At least one Crossing Branch is required only while Crossing is checked —
    // unchecking clears every picked hop, so a hidden stale value never submits.
    this.form.get('crossing')?.valueChanges.subscribe((on) => {
      if (on) {
        if (this.crossingBranchArray.length === 0) this.addCrossingBranch();
      } else {
        this.crossingBranchArray.clear();
        this.form.get('crossingCharge')?.setValue(null);
      }
    });
    // Checking Appointment Delivery prefills the company's configured default charge;
    // unchecking clears its date/slot/charge, same "hidden stale value never submits"
    // rule as Crossing above.
    this.form.get('appointmentDelivery')?.valueChanges.subscribe((on) => {
      if (on) {
        this.appointmentDeliveryCharge.set(this.defaultAppointmentDeliveryCharge());
      } else {
        this.form.get('appointmentDate')?.setValue(null);
        this.form.get('appointmentTimeSlot')?.setValue('');
        this.appointmentDeliveryCharge.set(0);
      }
    });
    // Picking Office Delivery clears the Door Delivery Charge, same rule — it never
    // charges extra, and a stale figure must never ride along in the payload.
    this.form.get('deliveryType')?.valueChanges.subscribe((type) => {
      if (type !== 'DOOR') {
        this.doorDeliveryCharge.set(0);
      }
    });
    this.masters.options('service-types').subscribe((o) => {
      this.serviceTypeOptions.set(o);
      if (o.length && !this.form.get('serviceTypeId')?.value) this.form.get('serviceTypeId')?.setValue(o[0].value);
    });
    this.masters.options('package-types').subscribe((o) => this.packageTypeOptions.set(o));
    this.masters.serviceTypeDirectory().subscribe((rows) => {
      this.serviceTypeDeliveryDays.set(new Map(rows.map((r) => [r.id, r.deliveryDays])));
      this.updateDeliveryPreview();
    });
    merge(this.c('serviceTypeId').valueChanges, this.c('bookingDate').valueChanges)
      .subscribe(() => this.updateDeliveryPreview());
    this.initBusinessBooking();
    if (this.isBusinessBooking) this.toggleBusinessMode(true);
    this.masters.options('payment-modes').subscribe((o) => {
      this.paymentModeOptions.set(o);
      const paid = o.find((opt) => opt.label.endsWith('(PAID)'));
      if (paid && !this.form.get('paymentModeId')?.value) this.form.get('paymentModeId')?.setValue(paid.value);
    });

    // Only the fields that actually feed PricingCommand reschedule a price call — typing
    // in sender/receiver name, address or contact (or an item's own name, see onItems)
    // does not move the price, so it must not restart the debounce or spam
    // /pricing/calculate on every keystroke there. There is no delivery branch to price
    // against any more — `deliveryPincode` is what actually signals a destination change.
    const PRICE_AFFECTING_CONTROLS = ['deliveryPincode', 'serviceTypeId',
      'paymentModeId', 'declaredValue', 'bookingDate'];
    merge(...PRICE_AFFECTING_CONTROLS.map((name) => this.form.get(name)!.valueChanges))
      .subscribe(() => { this.resetFreightFactor(); this.schedulePricing(); });

    // District Level Freight's own calculation is keyed on From Station + destination
    // pincode + chargeable weight — a different, smaller set than PricingCommand's own
    // (it doesn't care about service type/package type/payment mode/declared value/
    // booking date); weight reschedules via {@link onWeight}.
    this.c('deliveryPincode').valueChanges.subscribe(() => this.scheduleFreightCalc());
    // The zone tariff prices by service type and package type too (District Level Freight ignores them).
    merge(this.c('serviceTypeId').valueChanges, this.c('packageTypeId').valueChanges)
      .subscribe(() => this.scheduleFreightCalc());
    // A Business Customer zone's FOV % is a share of the declared value, so it moves with it.
    this.c('declaredValue').valueChanges.subscribe(() => {
      if (this.selectedBusinessCustomer()) this.scheduleFreightCalc();
    });

    this.freightTrigger$.pipe(
      debounceTime(500),
      switchMap(() => this.freightCalc$()),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((outcome) => {
      this.freightCalcLoading.set(false);
      if (outcome.ok) {
        this.freightCalc.set(outcome.data);
        this.freightCalcError.set(null);
        this.applyZoneExtraCharges(outcome.data.customerExtraCharges ?? 0);
      } else {
        this.freightCalc.set(null);
        this.freightCalcError.set(outcome.message);
      }
    });

    this.pricingTrigger$.pipe(
      debounceTime(500),
      switchMap(() => this.priceIt$()),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((outcome) => {
      this.pricingLoading.set(false);
      if (outcome.ok) {
        this.pricing.set(outcome.data);
        this.pricingError.set(null);
        const applied = outcome.data.appliedFreightFactor;
        if (applied != null) {
          this.freightFactorApplicable.set(true);
          // Only capture the floor from a response priced with no override — an overridden
          // response echoes back the override itself, not the grid's own matched value.
          if (this.freightFactorOverride() == null) this.matchedFreightFactor.set(applied);
        } else {
          this.freightFactorApplicable.set(false);
          this.matchedFreightFactor.set(null);
          this.freightFactorOverride.set(null);
        }
      } else {
        this.pricing.set(null);
        this.pricingError.set(outcome.message);
      }
    });

    // Name and Contact Number both feed the same free-text search — typing either one
    // looks up prior customers matching it (CustomerSpecifications LIKEs code/name/mobile/email).
    merge(this.c('senderName').valueChanges, this.c('senderContact').valueChanges)
      .subscribe((v) => this.senderQuery$.next(v ?? ''));
    merge(this.c('receiverName').valueChanges, this.c('receiverContact').valueChanges)
      .subscribe((v) => this.receiverQuery$.next(v ?? ''));

    this.senderQuery$.pipe(
      debounceTime(300), distinctUntilChanged(), filter((q) => q.trim().length >= 2),
      switchMap((q) => this.customers.list({ page: 0, size: 6, status: 'ACTIVE', search: q })),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((page) => this.senderSuggestions.set(page.content));

    this.receiverQuery$.pipe(
      debounceTime(300), distinctUntilChanged(), filter((q) => q.trim().length >= 2),
      switchMap((q) => this.customers.list({ page: 0, size: 6, status: 'ACTIVE', search: q })),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((page) => this.receiverSuggestions.set(page.content));
  }

  /** Marks which field owns the dropdown; the template only renders it once that party's
   *  suggestions list is non-empty, so an empty focus shows nothing until a search resolves. */
  protected openSuggest(party: 'sender' | 'receiver', field: 'name' | 'contact'): void {
    (party === 'sender' ? this.senderSuggestOpen : this.receiverSuggestOpen).set(field);
  }

  protected toggleBusinessMode(on: boolean): void {
    this.businessMode.set(on);
    if (!on) {
      this.businessCustomerCtl.setValue('');
      this.selectedBusinessCustomer.set('');
      this.businessPickupCtl.setValue('', { emitEvent: false });
      this.businessPickupOptions.set([]);
      this.businessPickupAddresses = [];
      this.scheduleFreightCalc();
      return;
    }
    if (!this.businessCustomerOptions().length) {
      this.businessCustomerService.businessCustomers().subscribe({
        next: (p) => this.businessCustomerOptions.set(
          p.content.map((c) => ({ value: c.id, label: `${c.displayName} (${c.customerCode})` }))),
        error: () => this.notify.error('Could not load business customers.')
      });
    }
  }

  /** Wires the two business pickers once, from the constructor-time subscriptions block. */
  private initBusinessBooking(): void {
    this.businessCustomerCtl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((raw) => {
      const id = this.businessCustomerOptions().some((o) => o.value === raw) ? raw : '';
      if (id === this.selectedBusinessCustomer()) return;
      this.selectedBusinessCustomer.set(id);
      this.scheduleFreightCalc();
      this.businessPickupOptions.set([]);
      this.businessPickupAddresses = [];
      this.businessPickupCtl.setValue('', { emitEvent: false });
      if (!id) return;
      this.customers.get(id).subscribe({
        next: (cust) => {
          this.c('senderName').setValue(cust.displayName);
          this.c('senderContact').setValue(cust.mobile);
          // The payment-mode master has no CREDIT row: a credit customer is "To Be Billed" (TBB).
          const codes = ({ CREDIT: ['TBB'], TOPAY: ['TOPAY', 'TO_PAY'], PAID: ['PAID'] } as Record<string, string[]>)[cust.defaultPaymentMode ?? ''] ?? [];
          const mode = this.paymentModeOptions().find((o) => codes.some((code) => o.label.toUpperCase().endsWith(`(${code})`)));
          if (mode) this.c('paymentModeId').setValue(mode.value);
          this.businessPickupAddresses = cust.addresses
            .filter((a) => a.status === 'ACTIVE' && (a.addressUsage === 'PICKUP' || a.addressUsage === 'BOTH' || !a.addressUsage));
          this.businessPickupOptions.set(this.businessPickupAddresses.map((a) => ({ value: a.id, label: this.addressText(a) })));
          const preferred = this.businessPickupAddresses.find((a) => a.isDefaultPickup) ?? this.businessPickupAddresses[0];
          if (preferred) { this.businessPickupCtl.setValue(preferred.id, { emitEvent: false }); this.applyPickupAddress(preferred); }
          else this.c('senderAddress').setValue(this.billingText(cust));
        },
        error: () => this.notify.error('Could not load that customer.')
      });
    });
    this.businessPickupCtl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((id) => {
      const a = this.businessPickupAddresses.find((x) => x.id === id);
      if (a) this.applyPickupAddress(a);
    });
  }

  private applyPickupAddress(a: CustomerAddress): void { this.c('senderAddress').setValue(this.addressText(a)); }
  private addressText(a: CustomerAddress): string {
    return [a.addressLine1, a.addressLine2, a.landmark].filter((x) => !!x).join(', ');
  }
  private billingText(c: { billingAddressLine1?: string | null; billingAddressLine2?: string | null; billingCity?: string | null;
    billingState?: string | null; billingPincode?: string | null }): string {
    return [c.billingAddressLine1, c.billingAddressLine2, c.billingCity, c.billingState, c.billingPincode].filter((x) => !!x).join(', ');
  }

  /** Copies the picked customer's plain name/mobile into the party's free-text fields —
   *  no Customer id is ever stored on the shipment, matching the rest of this form. */
  protected pickCustomer(party: 'sender' | 'receiver', cust: Customer): void {
    this.c(`${party}Name`).setValue(cust.displayName);
    this.c(`${party}Contact`).setValue(cust.mobile);
    (party === 'sender' ? this.senderSuggestOpen : this.receiverSuggestOpen).set(null);
  }

  /** Deferred so `mousedown` on a suggestion fires before the input's own `blur` closes the list. */
  protected closeSuggest(party: 'sender' | 'receiver'): void {
    setTimeout(() => (party === 'sender' ? this.senderSuggestOpen : this.receiverSuggestOpen).set(null), 150);
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }
  protected branchLabel(id: string | null): string { return this.labelOf(this.branchOptions(), id); }

  /** "—" while the branch list is still loading, then either the caller's own branch
   *  name or a hard "no branch assigned" notice — never a picker. */
  protected myBranchLabel(): string {
    if (!this.myBranchId) return 'no branch assigned to your account';
    return this.myBranchName() ?? '—';
  }

  /** Keeps the booking payload's item list current — an item's name never affects price,
   *  and its weight/dimensions already reschedule pricing through {@link onWeight}. Also
   *  the single source of Declared Value: rather than typing it twice (once per item,
   *  once at shipment level), the shipment-level figure is just the sum of every item's
   *  own Value — and Invoice Value (E-Way Bill) mirrors it exactly, on direct request,
   *  so the two can never diverge. Both fields are read-only in the template; this is the
   *  only place either one is ever set. */
  protected onItems(items: ShipmentItemRequest[]): void {
    this.items.set(items);
    const total = items.reduce((sum, i) => sum + (i.declaredValue ?? 0), 0);
    const value = total > 0 ? total : null;
    this.c('declaredValue').setValue(value);
    this.c('invoiceValue').setValue(value);
  }

  protected onWeight(weight: { actual: number; volumetric: number; chargeable: number }): void {
    this.weight.set(weight);
    this.resetFreightFactor();
    this.schedulePricing();
    this.scheduleFreightCalc();
  }

  /** A different lane or weight may not hit the Freight Factor fallback at all, or may
   *  match a different grid cell — any typed override from the previous quote no longer
   *  means anything, so it's cleared rather than silently resubmitted. */
  private resetFreightFactor(): void {
    this.freightFactorOverride.set(null);
    this.matchedFreightFactor.set(null);
  }

  /** `bookingDate + serviceType.deliveryDays`, string arithmetic on the `yyyy-MM-dd` value
   *  so it matches what the server stores regardless of local timezone. */
  private updateDeliveryPreview(): void {
    const days = this.serviceTypeDeliveryDays().get(this.c('serviceTypeId').value ?? '');
    const bookingDate = this.c('bookingDate').value as string | null;
    if (days == null || !bookingDate) {
      this.expectedDeliveryPreview.set(null);
      return;
    }
    const [y, m, d] = bookingDate.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    this.expectedDeliveryPreview.set(iso);
  }

  protected onFreightFactorInput(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    if (Number.isNaN(v)) return;
    this.freightFactorOverride.set(v);
    this.schedulePricing();
  }

  /** Manual Other Charges (never priced by the Pricing Engine) at the booking branch's own
   *  GST% (V25) — mirrors `ShipmentServiceImpl.copyCharge`'s server-side math so the live
   *  total shown here matches what actually gets booked. */
  protected gstOnOtherCharges(): number {
    return (this.otherCharges() * this.myBranchGstPercentage()) / 100;
  }

  /** Manual Door Delivery Charge (DOOR only) is taxed with GST, same branch GST% as
   *  {@link gstOnOtherCharges} — mirrors `ShipmentServiceImpl.copyCharge`'s
   *  `gstOnDoorDeliveryCharge`. Zero when Delivery Type isn't DOOR. */
  protected gstOnDoorDeliveryCharge(): number {
    if (this.c('deliveryType').value !== 'DOOR') return 0;
    return (this.doorDeliveryCharge() * this.myBranchGstPercentage()) / 100;
  }

  /** The company's To-Pay charge when the selected payment mode is To-Pay, else zero — the
   *  backend decides and adds it (`ShipmentServiceImpl.toPayChargeFor`); this only mirrors it
   *  so the live total matches what gets booked. To-Pay is recognised by its `(TO_PAY)` code,
   *  the same way `PAID` is above. */
  protected toPayCharge(): number {
    const id = this.c('paymentModeId').value;
    const label = this.paymentModeOptions().find((o) => o.value === id)?.label ?? '';
    return label.endsWith('(TO_PAY)') ? this.toPayChargeSetting() : 0;
  }

  /** GST on {@link toPayCharge} at the booking branch's GST% — mirrors `copyCharge`'s
   *  `gstOnToPayCharge`. */
  protected gstOnToPayCharge(): number {
    return (this.toPayCharge() * this.myBranchGstPercentage()) / 100;
  }

  /** ODA Charge is normally the Pricing Engine's own figure (GST on it already folded into
   *  `chargeBreakup.gstAmount`) — once the operator types an override, only the *difference*
   *  from the engine's figure needs fresh GST, same branch GST% as {@link gstOnOtherCharges}.
   *  Mirrors `ShipmentServiceImpl.copyCharge`'s `odaChargeDelta`/`gstOnOdaChargeDelta`. */
  protected gstOnOdaChargeDelta(): number {
    return (this.odaChargeDelta() * this.myBranchGstPercentage()) / 100;
  }

  /** Difference between the final ODA figure and the Pricing Engine's own `chargeBreakup.
   *  odaCharge` (the only ODA amount already taxed into `chargeBreakup.gstAmount`) — mirrors
   *  `ShipmentServiceImpl.copyCharge`'s `finalOdaCharge`/`odaChargeDelta` exactly: District
   *  Level Freight's own {@link freightCalc} figure is the default the moment it resolves
   *  (a pincode-driven ODA the engine never priced), the typed override wins when present.
   *  See {@link gstOnOdaChargeDelta}. */
  protected odaChargeDelta(): number {
    const finalOdaCharge = this.odaChargeOverride() ?? this.freightCalc()?.odaCharge ?? 0;
    const engineOdaCharge = this.pricing()?.chargeBreakup.odaCharge ?? 0;
    return finalOdaCharge - engineOdaCharge;
  }

  /** District Level Freight's own base freight is authoritative now, replacing the Pricing
   *  Engine's own `chargeBreakup.freight` — same delta-at-booking-branch-GST% trick as
   *  {@link gstOnOdaChargeDelta}, mirroring `ShipmentServiceImpl.copyCharge`'s
   *  `freightDelta`/`gstOnFreightDelta` exactly, so this live preview's total matches what
   *  actually gets booked. Zero until a freight preview has resolved. */
  protected freightDelta(): number {
    const freightCalc = this.freightCalc();
    if (!freightCalc) return 0;
    const engineFreight = this.pricing()?.chargeBreakup.freight ?? 0;
    return this.effectiveBaseFreight() - engineFreight;
  }

  protected gstOnFreightDelta(): number {
    return (this.freightDelta() * this.myBranchGstPercentage()) / 100;
  }

  /** When the FOV (insurance) Applicable checkbox is on, FOV is 2% of Invoice Value instead
   *  of the Pricing Engine's own rate-driven `chargeBreakup.insuranceCharge` — mirrors
   *  `ShipmentServiceImpl.copyCharge`'s `finalInsuranceCharge`. Plain method, not
   *  `computed()` — same `FormControl.value`-staleness reason as {@link readyToPrice}. */
  protected finalInsuranceCharge(): number {
    const engineInsurance = this.pricing()?.chargeBreakup.insuranceCharge ?? 0;
    if (!this.c('insuranceApplicable').value) return engineInsurance;
    const invoiceValue = Number(this.c('invoiceValue').value) || 0;
    return invoiceValue * 0.02;
  }

  /** Difference between {@link finalInsuranceCharge} and the engine's own figure — zero
   *  unless the checkbox is on. See {@link gstOnInsuranceChargeDelta}. */
  protected insuranceChargeDelta(): number {
    return this.finalInsuranceCharge() - (this.pricing()?.chargeBreakup.insuranceCharge ?? 0);
  }

  protected gstOnInsuranceChargeDelta(): number {
    return (this.insuranceChargeDelta() * this.myBranchGstPercentage()) / 100;
  }

  /** Every line `ShipmentServiceImpl.copyCharge`'s own `totalBeforeRoundOff` sums, before
   *  rounding — the Pricing Engine's own (now-stale) round-off is subtracted back out
   *  first, since Other Charges/ODA/Door Delivery/Freight/Insurance deltas move the total
   *  after the engine already rounded its own figure. See {@link computedNetAmount}. */
  protected preRoundNetAmount(): number {
    const p = this.pricing();
    if (!p) return 0;
    const appointmentCharge = this.c('appointmentDelivery').value ? this.appointmentDeliveryCharge() : 0;
    const doorCharge = this.c('deliveryType').value === 'DOOR' ? this.doorDeliveryCharge() : 0;
    return p.chargeBreakup.netAmount - p.chargeBreakup.roundOff
      + this.otherCharges() + this.gstOnOtherCharges()
      + this.odaChargeDelta() + this.gstOnOdaChargeDelta()
      + this.freightDelta() + this.gstOnFreightDelta()
      + appointmentCharge
      + doorCharge + this.gstOnDoorDeliveryCharge()
      + this.toPayCharge() + this.gstOnToPayCharge()
      + this.insuranceChargeDelta() + this.gstOnInsuranceChargeDelta();
  }

  /** Rounds `amount` per the company's {@link companyRoundOffRule} — mirrors backend
   *  `RoundingRule.apply` (HALF_UP) exactly so this preview matches what
   *  `ShipmentServiceImpl.roundOffRule` persists. */
  protected applyRoundOffRule(amount: number): number {
    switch (this.companyRoundOffRule()) {
      case 'NEAREST_ONE': return Math.round(amount);
      case 'NEAREST_FIVE': return Math.round(amount / 5) * 5;
      case 'NEAREST_TEN': return Math.round(amount / 10) * 10;
      default: return Math.round(amount * 100) / 100;
    }
  }

  /** Freshly recomputed Round Off — replaces the Pricing Engine's own (now-stale once any
   *  charge below it is edited) `chargeBreakup.roundOff`. */
  protected computedRoundOff(): number {
    const total = this.preRoundNetAmount();
    return this.applyRoundOffRule(total) - total;
  }

  /** Freshly recomputed, rounded Net Amount — what actually gets persisted (before any
   *  {@link manualNetAmount} preview override). */
  protected computedNetAmount(): number {
    return this.applyRoundOffRule(this.preRoundNetAmount());
  }

  /** Bounds a typed Net Amount preview to {@link netAmountMaxDecreasePercent}/{@link
   *  netAmountMaxIncreasePercent} either side of {@link computedNetAmount} — company-
   *  configurable guardrail (Company Settings → Finance), direct request. Display only,
   *  same as {@link manualNetAmount} itself; clamps rather than rejecting outright. */
  protected onManualNetAmountChange(value: number): void {
    const computed = this.computedNetAmount();
    const minAllowed = computed * (1 - this.netAmountMaxDecreasePercent() / 100);
    const maxAllowed = computed * (1 + this.netAmountMaxIncreasePercent() / 100);
    if (value < minAllowed) {
      this.notify.error(`Net Amount cannot be decreased by more than ${this.netAmountMaxDecreasePercent()}% — minimum ₹${minAllowed.toFixed(2)}.`);
      value = minAllowed;
    } else if (value > maxAllowed) {
      this.notify.error(`Net Amount cannot be increased by more than ${this.netAmountMaxIncreasePercent()}% — maximum ₹${maxAllowed.toFixed(2)}.`);
      value = maxAllowed;
    }
    this.manualNetAmount.set(value);
  }

  /** `freightCalc().baseFreight` unless the operator raised Rate/KG above the matched
   *  slab's own rate — the server refuses a lower one (see `requireRateNotDecreased`),
   *  this is just the live preview echoing that same math. Zero until a freight preview
   *  has resolved. */
  protected effectiveBaseFreight(): number {
    const f = this.freightCalc();
    if (!f) return 0;
    const override = this.ratePerKgOverride();
    return override == null ? f.baseFreight : override * f.chargeableWeight;
  }

  protected onRatePerKgInput(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    if (Number.isNaN(v)) return;
    this.ratePerKgOverride.set(v);
  }

  protected onPackages(count: number): void {
    this.form.get('numberOfPackages')?.setValue(count, { emitEvent: false });
  }

  protected setDestMode(mode: 'PINCODE' | 'BRANCH'): void {
    if (this.destMode() === mode) return;
    this.destMode.set(mode);
    this.msrtcPickedBranch.set(null);
    this.pincodeBranch.set(null);
    this.pincodeBranchLookup.set('idle');
    this.c('msrtcDeliveryBranchId').setValue(null, { emitEvent: false });
    this.c('destinationPincode').setValue('');
  }

  /** MSRTC pincode mode: the branch mapped to this pincode (one branch per pincode). */
  private lookupPincodeBranch(pincodeId: string): void {
    if (this.destMode() !== 'PINCODE') return;
    this.pincodeBranchLookup.set('loading');
    this.masters.branchForPincode(pincodeId).pipe(catchError(() => of(undefined))).subscribe((b) => {
      this.pincodeBranch.set(b ? { id: b.id, name: b.branchName } : null);
      this.pincodeBranchLookup.set(b ? 'idle' : 'none');
    });
  }

  protected cancel(): void { this.router.navigate([this.isMsrtc ? '/msrtc/shipments/new' : this.isBusinessBooking ? '/business-customer/booking' : '/shipments']); }

  protected onImageFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const previous = this.imagePreviewUrl();
    if (previous) URL.revokeObjectURL(previous);
    this.selectedImageFile.set(file);
    this.imagePreviewUrl.set(URL.createObjectURL(file));
  }

  protected removeImage(): void {
    const previous = this.imagePreviewUrl();
    if (previous) URL.revokeObjectURL(previous);
    this.selectedImageFile.set(null);
    this.imagePreviewUrl.set(null);
  }

  // ------------------------------------------------------------------- E-Way Bill

  /** A plain method, not `computed()` — same `FormControl.value`-staleness reason as
   *  {@link readyToPrice}. Re-invoked on every change-detection run, so it never lags
   *  behind a typed invoice value. */
  protected ewayBillMandatory(): boolean {
    const v = Number(this.c('invoiceValue').value);
    return !!v && v > this.ewayBillThreshold();
  }

  /** Null once nothing blocks booking; otherwise the reason shown next to the Book
   *  button. Mirrors `EwayBillServiceImpl.requireBookingData`'s own minimum-data check
   *  for instant feedback — the backend re-runs the real check server-side regardless,
   *  since this is UX only. The E-Way Bill number itself is no longer typed here: it is
   *  issued automatically by the provider once the shipment books. */
  protected ewayBillReason(): string | null {
    if (!this.ewayBillMandatory()) return null;
    if (!this.ewayBillOpen()) {
      return 'E-Way Bill is mandatory because invoice value exceeds the configured threshold — add one below.';
    }
    const invoiceNumber = (this.c('ewayBillInvoiceNumber').value ?? '').trim();
    if (!invoiceNumber) return 'An E-Way Bill invoice number is required.';
    if (!this.c('ewayBillInvoiceDate').value) return 'An E-Way Bill invoice date is required.';
    return null;
  }

  /** Null once nothing blocks booking; otherwise the reason shown next to the Book button —
   *  same "plain method, not computed()" reason as {@link ewayBillReason} (reads
   *  `FormControl.value`). The backend re-checks this itself (`Shipment.applyInvariants`),
   *  this is UX only. */
  protected appointmentDeliveryReason(): string | null {
    if (!this.c('appointmentDelivery').value) return null;
    if (!this.c('appointmentDate').value) return 'Pick an appointment delivery date.';
    if (!(this.c('appointmentTimeSlot').value ?? '').trim()) return 'Enter an appointment delivery time slot.';
    return null;
  }

  protected addEwayBill(): void { this.ewayBillOpen.set(true); }

  protected removeEwayBill(): void {
    this.ewayBillOpen.set(false);
    this.c('ewayBillInvoiceNumber').setValue('');
    this.c('ewayBillInvoiceDate').setValue(today());
    this.c('ewayBillConsignorGstin').setValue('');
    this.c('ewayBillConsigneeGstin').setValue('');
    this.c('ewayBillRemarks').setValue('');
    this.selectedEwayBillFile.set(null);
  }

  protected onEwayBillFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) this.selectedEwayBillFile.set(file);
  }

  protected removeEwayBillFile(): void { this.selectedEwayBillFile.set(null); }

  /**
   * Rule-based transcript → form fields (see `voice-booking.util.ts`). Only ever
   * `setValue`s a control when the transcript actually supplied that field — an
   * incomplete voice command leaves the rest of the form exactly as it was, never
   * clears anything. Nothing books itself: the existing pricing debounce and the
   * Booking Summary sidebar pick up the filled fields the same way manual typing does,
   * and the user still has to review and click Book Shipment.
   */
  protected onVoiceTranscript(transcript: string): void {
    const fields = parseVoiceBooking(transcript);
    const applied: string[] = [];

    const setIfPresent = (control: string, value: string | number | null | undefined, label: string) => {
      if (value === null || value === undefined || value === '') return;
      this.form.get(control)?.setValue(value);
      applied.push(label);
    };

    setIfPresent('senderName', fields.senderName, 'sender name');
    setIfPresent('senderContact', fields.senderContact, 'sender contact');
    setIfPresent('senderAddress', fields.senderAddress, 'sender address');
    setIfPresent('pickupPincode', fields.pickupPincode, 'pickup pincode');
    setIfPresent('receiverName', fields.receiverName, 'receiver name');
    setIfPresent('receiverContact', fields.receiverContact, 'receiver contact');
    setIfPresent('receiverAddress', fields.receiverAddress, 'receiver address');
    setIfPresent('deliveryPincode', fields.deliveryPincode, 'delivery pincode');
    setIfPresent('declaredValue', fields.declaredValue, 'declared value');
    setIfPresent('remarks', fields.remarks, 'remarks');

    // No Delivery Branch to set from voice any more — Load Sheet is where one gets
    // assigned, not booking (fields.deliveryBranchText, if a voice command names one, is
    // simply not applied to anything here).

    const serviceTypeId = fields.serviceTypeText && this.matchOption(this.serviceTypeOptions(), fields.serviceTypeText);
    setIfPresent('serviceTypeId', serviceTypeId || null, 'service type');

    // No Package Type to set from voice any more — it's no longer picked at booking at
    // all (fields.packageTypeText, if a voice command names one, is simply not applied).

    const paymentModeId = fields.paymentModeText && this.matchOption(this.paymentModeOptions(), fields.paymentModeText);
    setIfPresent('paymentModeId', paymentModeId || null, 'payment mode');

    if (fields.weightKg != null || fields.numberOfPackages != null) {
      this.voiceItems.set([{
        itemName: 'Package', quantity: fields.numberOfPackages ?? 1, weight: fields.weightKg ?? 5,
        lengthCm: null, widthCm: null, heightCm: null,
        declaredValue: fields.declaredValue ?? null, fragile: false, dangerousGoods: false
      }]);
      applied.push('items (weight/packages)');
    }

    if (applied.length) {
      this.voiceSummary.set(`Voice filled: ${applied.join(', ')}. Review and click Book Shipment.`);
      this.notify.success(`Voice booking filled ${applied.length} field${applied.length > 1 ? 's' : ''} from what you said.`);
    } else {
      this.voiceSummary.set(null);
      this.notify.error('Could not pick out any booking details from that. Try naming sender/receiver, pincode, weight and payment mode.');
    }
  }

  protected onVoiceError(message: string): void { this.notify.error(message); }

  private matchOption(options: SelectOption[], spoken: string): string | null {
    const needle = spoken.trim().toLowerCase();
    if (!needle) return null;
    const found = options.find((o) => {
      const label = o.label.toLowerCase();
      return label.includes(needle) || needle.includes(label);
    });
    return found?.value ?? null;
  }

  /**
   * A plain method, not `computed()` — see `MEMORY/modules/shipment-booking.md`'s note
   * on the identical `computed()`-reading-`FormControl.value` staleness bug this
   * project already hit once. Called from the template on every change detection run,
   * so it never goes stale.
   */
  protected readyToPrice(): boolean {
    const v = this.form.getRawValue();
    // Only the fields the Pricing Engine actually reads — sender/receiver identity plays
    // no part in a price, so the preview shouldn't wait on it (booking itself still does,
    // via the Book button's own `form.invalid` check). There is no Delivery Branch any
    // more — Load Sheet is where one gets assigned, not booking — so `deliveryPincode` is
    // what signals "a destination has been entered".
    return !!(v.bookingBranchId && v.deliveryPincode && v.serviceTypeId
      && v.paymentModeId && this.weight().chargeable > 0);
  }

  /** See {@link readyToPrice} — same reason this is a plain method. */
  protected myBranchIdPresent(): boolean { return !!this.myBranchId; }

  /** District Level Freight's own three inputs — a smaller set than {@link readyToPrice},
   *  see the trigger wiring in `ngOnInit`. Plain method, same staleness reason. */
  protected readyForFreight(): boolean {
    const v = this.form.getRawValue();
    return !!(v.bookingBranchId && v.deliveryPincode && v.destinationAreaId && this.weight().chargeable > 0);
  }

  private schedulePricing(): void {
    this.pricing.set(null);
    this.pricingError.set(null);
    this.manualNetAmount.set(null);
    this.odaChargeOverride.set(null);
    this.pricingTrigger$.next();
  }

  /** A zone-priced booking carries its rate card's non-freight lines as Other Charges (the
   *  server refuses less). Replaces the previous zone figure, keeps anything the operator
   *  raised above it, and clears it again when the booking stops being zone-priced. */
  private applyZoneExtraCharges(next: number): void {
    const prev = this.zoneExtraCharges();
    if (next > 0 || prev > 0) {
      const current = this.otherCharges();
      if (current === prev || current < next) this.otherCharges.set(next);
    }
    this.zoneExtraCharges.set(next);
  }

  private scheduleFreightCalc(): void {
    this.freightCalc.set(null);
    this.freightCalcError.set(null);
    this.manualNetAmount.set(null);
    this.odaChargeOverride.set(null);
    this.ratePerKgOverride.set(null);
    this.freightTrigger$.next();
  }

  private freightCalc$(): Observable<FreightOutcome> {
    if (!this.readyForFreight()) return of({ ok: false, message: null } as FreightOutcome);

    this.freightCalcLoading.set(true);
    const v = this.form.getRawValue();

    return this.freightCalculationService.calculate({
      bookingBranchId: v.bookingBranchId, destinationPincode: v.deliveryPincode,
      destinationAreaId: v.destinationAreaId, chargeableWeight: this.weight().chargeable,
      businessCustomerId: this.selectedBusinessCustomer() || null, declaredValue: v.declaredValue || null,
      serviceTypeId: v.serviceTypeId || null, packageTypeId: v.packageTypeId || null,
      numberOfPackages: v.numberOfPackages || 1, bookingDate: v.bookingDate || null
    }).pipe(
      switchMap((data) => of({ ok: true, data }) as Observable<FreightOutcome>),
      catchError((e: HttpErrorResponse) =>
        of({ ok: false, message: e?.error?.message ?? 'Could not calculate freight for this booking.' } as FreightOutcome))
    );
  }

  private priceIt$(): Observable<PriceOutcome> {
    if (!this.readyToPrice()) return of({ ok: false, message: null } as PriceOutcome);

    this.pricingLoading.set(true);
    const v = this.form.getRawValue();

    return this.service.preview({
      bookingBranchId: v.bookingBranchId,
      pickupPincode: v.pickupPincode, deliveryPincode: v.deliveryPincode,
      serviceTypeId: v.serviceTypeId, paymentModeId: v.paymentModeId,
      // Fed as chargeableWeight, not actualWeight — matches the booking's own priceIt()
      // quirk (skip PricingEngine re-deriving volumetric weight from a single blended
      // figure; this screen's own WeightCalculator already did it, multi-item aware).
      // totalActualWeight carries the real actual weight separately, for a qty-level
      // Applicable Charge's per-piece slab match.
      actualWeight: this.weight().chargeable, totalActualWeight: this.weight().actual,
      declaredValue: v.declaredValue || null,
      bookingDate: v.bookingDate || null, freightFactorOverride: this.freightFactorOverride(),
      numberOfPackages: v.numberOfPackages || 1
    }).pipe(
      switchMap((data) => of({ ok: true, data }) as Observable<PriceOutcome>),
      catchError((e: HttpErrorResponse) =>
        of({ ok: false, message: e?.error?.message ?? 'Could not price this booking.' } as PriceOutcome))
    );
  }

  protected book(): void {
    const p = this.pricing();
    const f = this.freightCalc();
    if (!p || !f || this.form.invalid || this.ewayBillReason() !== null) return;
    const v = this.form.getRawValue();
    if (this.isMsrtc && !this.msrtcDeliveryBranchId()) {
      this.notify.error('Choose the delivery branch.');
      return;
    }
    if (!v.declaredValue || v.declaredValue <= 0) {
      this.notify.error('Declared Value is required — enter a Value for at least one item.');
      return;
    }

    const body: CreateShipmentRequest = {
      bookingBranchId: v.bookingBranchId, manualShipmentNumber: v.manualShipmentNumber?.trim() || null,
      pickupPincode: v.pickupPincode, deliveryPincode: v.deliveryPincode,
      senderName: v.senderName, senderAddress: v.senderAddress, senderContact: v.senderContact,
      receiverName: v.receiverName, receiverAddress: v.receiverAddress, receiverContact: v.receiverContact,
      serviceTypeId: v.serviceTypeId, packageTypeId: v.packageTypeId || null, paymentModeId: v.paymentModeId,
      bookingDate: v.bookingDate || null,
      declaredValue: v.declaredValue || null, numberOfPackages: v.numberOfPackages || 1,
      remarks: v.remarks || null, otherCharges: this.otherCharges() || null,
      odaCharge: this.odaChargeOverride(),
      freightFactorOverride: this.freightFactorOverride(), items: this.items(),
      crossing: v.crossing || null,
      crossingBranchIds: v.crossing ? (v.crossingBranchIds as (string | null)[]).filter((id): id is string => !!id) : null,
      crossingCharge: v.crossingCharge || null,
      invoiceValue: v.invoiceValue || null,
      destinationAreaId: v.destinationAreaId || null,
      businessCustomerId: this.selectedBusinessCustomer() || null,
      ratePerKgOverride: this.ratePerKgOverride(),
      appointmentDelivery: v.appointmentDelivery || null,
      appointmentDate: v.appointmentDelivery ? v.appointmentDate : null,
      appointmentTimeSlot: v.appointmentDelivery ? (v.appointmentTimeSlot?.trim() || null) : null,
      appointmentDeliveryCharge: v.appointmentDelivery ? (this.appointmentDeliveryCharge() || null) : null,
      insuranceApplicable: v.insuranceApplicable || null,
      deliveryType: v.deliveryType,
      doorDeliveryCharge: v.deliveryType === 'DOOR' ? (this.doorDeliveryCharge() || null) : null,
      ...(this.isMsrtc ? { flowType: 'MSRTC' as const, deliveryBranchId: this.msrtcDeliveryBranchId() } : {}),
      ewayBill: this.ewayBillOpen() && v.ewayBillInvoiceNumber?.trim() ? {
        invoiceNumber: v.ewayBillInvoiceNumber?.trim() || '',
        invoiceDate: v.ewayBillInvoiceDate || today(),
        documentType: 'INVOICE',
        consignorGstin: v.ewayBillConsignorGstin?.trim() || null,
        consigneeGstin: v.ewayBillConsigneeGstin?.trim() || null,
        remarks: v.ewayBillRemarks?.trim() || null
      } : null
    };

    this.submitting.set(true);
    this.service.create(body).subscribe({
      next: (s) => {
        this.submitting.set(false);
        const ewayBillFile = this.selectedEwayBillFile();
        if (ewayBillFile && s.ewayBill?.id) {
          this.ewayBillService.upload(s.ewayBill.id, ewayBillFile).subscribe({
            error: () => this.notify.error(`Shipment ${s.shipmentNumber} booked, but the E-Way Bill document could not be uploaded.`)
          });
        }
        this.notify.success(`Shipment ${s.shipmentNumber} booked — AWB ${s.trackingNumber}.`);
        const crossing = this.isMsrtc ? this.busCrossing() : null;
        if (crossing) {
          this.busDepotService.setShipmentCrossing(s.id, { ...crossing, saveAsRoute: true }).subscribe({
            error: () => this.notify.error(`Shipment ${s.shipmentNumber} booked, but its crossing could not be saved. Add it again from the shipment.`)
          });
        }
        if (this.pickupId) {
          this.pickupService.linkShipment(this.pickupId, { shipmentId: s.id, shipmentNo: s.shipmentNumber }).subscribe({
            error: () => this.notify.error(`Shipment ${s.shipmentNumber} booked, but the pickup request could not be linked to it.`)
          });
        }
        forkJoin({
          company: this.companyProfile.get().pipe(catchError(() => of(null))),
          bookingGeo: v.pickupPincode
            ? this.masters.pincodeGeo(v.pickupPincode).pipe(catchError(() => of(null)))
            : of(null),
          deliveryGeo: v.deliveryPincode
            ? this.masters.pincodeGeo(v.deliveryPincode).pipe(catchError(() => of(null)))
            : of(null)
        }).subscribe(({ company, bookingGeo, deliveryGeo }) => {
          printPerformaBillCopies({
            companyName: company?.companyName ?? this.auth.companyName() ?? 'Courier SaaS',
            companyLogo: company?.logo ?? this.auth.companyLogo(),
            companyAddress: companyAddressLine(company),
            companyGst: company?.gstNumber ?? null,
            companyContact: company?.mobile ?? null,
            companyWebsite: company?.website ?? null,
            shipmentNumber: s.shipmentNumber, trackingNumber: s.trackingNumber, bookingDate: s.bookingDate,
            expectedDeliveryDate: s.expectedDeliveryDate ?? null,
            bookingBranchLabel: this.myBranchCity() ?? this.myBranchLabel(),
            deliveryBranchLabel: f.destinationCityName ?? '—',
            bookingPincode: v.pickupPincode || null,
            bookingDistrict: bookingGeo?.districtName ?? null,
            bookingArea: bookingGeo?.areaName ?? null,
            deliveryPincode: v.deliveryPincode || null,
            deliveryDistrict: deliveryGeo?.districtName ?? null,
            deliveryArea: deliveryGeo?.areaName ?? null,
            senderName: v.senderName, senderAddress: v.senderAddress, senderContact: v.senderContact,
            receiverName: v.receiverName, receiverAddress: v.receiverAddress, receiverContact: v.receiverContact,
            serviceTypeLabel: this.labelOf(this.serviceTypeOptions(), v.serviceTypeId),
            packageTypeLabel: v.packageTypeId ? this.labelOf(this.packageTypeOptions(), v.packageTypeId) : '—',
            paymentModeLabel: this.labelOf(this.paymentModeOptions(), v.paymentModeId),
            deliveryType: v.deliveryType,
            numberOfPackages: v.numberOfPackages || 1, chargeableWeight: this.weight().chargeable,
            declaredValue: v.declaredValue || null,
            charges: {
              ...p.chargeBreakup,
              freight: this.effectiveBaseFreight(),
              odaCharge: this.odaChargeOverride() ?? f.odaCharge,
              insuranceCharge: this.finalInsuranceCharge(),
              gstAmount: p.chargeBreakup.gstAmount + this.gstOnOtherCharges() + this.gstOnOdaChargeDelta()
                + this.gstOnFreightDelta() + this.gstOnInsuranceChargeDelta() + this.gstOnDoorDeliveryCharge()
                + this.gstOnToPayCharge(),
              // `roundOff`/`netAmount` deliberately exclude raw otherCharges/appointmentDeliveryCharge/
              // doorDeliveryCharge here (unlike the sidebar preview) — this file's own `total`
              // (performa-bill-print.util.ts `sheet()`) adds those three back on top of
              // `charges.netAmount` itself, so including them here would double-count them on the
              // printed bill. Only the round-off delta is folded in, so the printed total still lands
              // on the company's own rounding rule once Other Charges/ODA/Freight/Insurance are edited.
              roundOff: this.computedRoundOff(),
              netAmount: p.chargeBreakup.netAmount + this.gstOnOtherCharges()
                + this.odaChargeDelta() + this.gstOnOdaChargeDelta() + this.freightDelta() + this.gstOnFreightDelta()
                + this.insuranceChargeDelta() + this.gstOnInsuranceChargeDelta() + this.gstOnDoorDeliveryCharge()
                + this.gstOnToPayCharge()
                + (this.computedRoundOff() - p.chargeBreakup.roundOff)
            },
            otherCharges: this.otherCharges(),
            appointmentDeliveryCharge: v.appointmentDelivery ? this.appointmentDeliveryCharge() : undefined,
            appointmentDate: v.appointmentDelivery ? v.appointmentDate : null,
            appointmentTimeSlot: v.appointmentDelivery ? v.appointmentTimeSlot : null,
            doorDeliveryCharge: v.deliveryType === 'DOOR' ? this.doorDeliveryCharge() : undefined,
            toPayCharge: this.toPayCharge(),
            remarks: v.remarks || null,
            createdByName: s.createdByName ?? null,
            invoiceValue: v.invoiceValue || null,
            items: this.items().map((i) => ({ weight: i.weight, lengthCm: i.lengthCm, widthCm: i.widthCm, heightCm: i.heightCm }))
          });
        });
        const image = this.selectedImageFile();
        if (image) {
          this.service.uploadImage(s.id, image).subscribe({
            error: () => this.notify.error(`Shipment ${s.shipmentNumber} booked, but the photo could not be uploaded.`)
          });
        }
        this.router.navigate(['/shipments', s.id]);
      },
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        // Any 4xx is the caller's to fix (bad input, a business rule, a stale reference) and
        // carries a specific message worth showing; 5xx/network failures get the generic one.
        const specific: string | null = err.status >= 400 && err.status < 500 ? err.error?.message : null;
        // ShipmentServiceImpl.requireSufficientBalance's own wording ("available X, required Y")
        // is accurate but not actionable — the fix is always one of two things, so say that
        // instead of the raw balance figures.
        if (specific?.startsWith('Insufficient wallet balance')) {
          this.notify.error('Insufficient wallet balance — recharge your wallet or choose a different payment mode.');
          return;
        }
        this.notify.error(specific ?? 'Could not book this shipment.');
      }
    });
  }

  private labelOf(options: SelectOption[], value: string | null): string {
    if (!value) return '—';
    return options.find((o) => o.value === value)?.label ?? '—';
  }
}
