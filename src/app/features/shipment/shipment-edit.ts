import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { AuthService } from '@core/auth/auth.service';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { SettingsService } from '@features/settings/settings.service';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import {
  ShipmentResponse, ShipmentItemRequest, ShipmentType, SHIPMENT_TYPES, UpdateShipmentRequest,
  DeliveryType, DELIVERY_TYPES
} from '@core/models/shipment.model';
import { ItemEntryGrid } from './components/item-entry-grid';
import { ShipmentService } from './shipment.service';

const TYPE_OPTIONS: SelectOption[] = SHIPMENT_TYPES.map((t) => ({ value: t, label: t.replace('_', ' ') }));

/**
 * Edit Shipment — full replacement, only while the shipment is still `BOOKED` (the
 * backend refuses otherwise). Booking Branch is immutable once booked, shown read-only;
 * everything else UpdateShipmentRequest carries is editable, including the plain-text
 * Consignor/Consignee fields (no Customer module lookup). Saving re-prices the booking
 * server-side — this page does not run its own preview, unlike Create's wizard.
 */
@Component({
  selector: 'app-shipment-edit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiSelect, UiButton, UiCard, UiLoader, ItemEntryGrid],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Edit Shipment</h1><p class="text-caption">Only while the shipment is still BOOKED.</p></div>
      </header>

      @if (loading()) {
        <app-loader [minHeight]="280" caption="Loading…" />
      } @else if (!shipment()) {
        <app-card><p class="empty">Shipment not found, outside your scope, or no longer editable.</p></app-card>
      } @else {
        <div class="ef">
          <app-card title="Booking Branch">
            <div class="grid2">
              <div class="stat"><span class="stat__l">Booking Branch</span><span class="stat__v">{{ branchLabel(shipment()!.bookingBranchId) }}</span><span class="stat__h">Immutable once booked</span></div>
              <label class="fld"><span class="fld__l">From Pincode</span>
                <input class="fld__i" [formControl]="c('pickupPincode')" placeholder="e.g. 411001" maxlength="10" /></label>
              <label class="fld"><span class="fld__l">To Pincode</span>
                <input class="fld__i" [formControl]="c('deliveryPincode')" placeholder="e.g. 400008" maxlength="10" /></label>
            </div>
          </app-card>

          <div class="parties">
            <div class="party party--sender">
              <div class="party__title">Consignor (Sender)</div>
              <label class="fld"><span class="fld__l">Name</span>
                <input class="fld__i" [formControl]="c('senderName')" placeholder="Sender's full name" maxlength="150" /></label>
              <div class="spacer"></div>
              <label class="fld"><span class="fld__l">Address</span>
                <textarea class="ta" rows="2" [formControl]="c('senderAddress')" placeholder="Pickup address" maxlength="500"></textarea></label>
              <div class="spacer"></div>
              <label class="fld"><span class="fld__l">Contact Number</span>
                <input class="fld__i" type="tel" [formControl]="c('senderContact')" placeholder="10-digit mobile number" maxlength="20" /></label>
            </div>

            <div class="party party--receiver">
              <div class="party__title">Consignee (Receiver)</div>
              <label class="fld"><span class="fld__l">Name</span>
                <input class="fld__i" [formControl]="c('receiverName')" placeholder="Receiver's full name" maxlength="150" /></label>
              <div class="spacer"></div>
              <label class="fld"><span class="fld__l">Address</span>
                <textarea class="ta" rows="2" [formControl]="c('receiverAddress')" placeholder="Delivery address" maxlength="500"></textarea></label>
              <div class="spacer"></div>
              <label class="fld"><span class="fld__l">Contact Number</span>
                <input class="fld__i" type="tel" [formControl]="c('receiverContact')" placeholder="10-digit mobile number" maxlength="20" /></label>
            </div>
          </div>

          <app-card title="Package Details">
            <div class="grid3">
              <app-select [control]="c('serviceTypeId')" label="Service Type" [options]="serviceTypeOptions()" placeholder="Select a service type" />
              <app-select [control]="c('packageTypeId')" label="Package Type" [options]="packageTypeOptions()" placeholder="Select a package type" />
              <app-select [control]="c('paymentModeId')" label="Payment Mode" [options]="paymentModeOptions()" placeholder="Select a payment mode" />
              <app-select [control]="c('shipmentType')" label="Shipment Type" [options]="typeOptions" />
              <label class="fld"><span class="fld__l">Booking Date</span>
                <input class="fld__i" type="date" [formControl]="c('bookingDate')" /></label>
              <label class="fld"><span class="fld__l">Number of Packages</span>
                <input class="fld__i" type="number" min="1" [formControl]="c('numberOfPackages')" /></label>
              <label class="fld"><span class="fld__l">Declared Value</span>
                <input class="fld__i" type="number" [value]="c('declaredValue').value ?? 0" readonly title="Sum of every item's own Value below" /></label>
              @if (isAdmin) {
                <label class="fld"><span class="fld__l">Other Charges</span>
                  <input class="fld__i" type="number" min="0" step="0.01" [formControl]="c('otherCharges')" /></label>
              }
            </div>
            <div class="spacer"></div>
            <div class="fld"><span class="fld__l">Delivery Type</span>
              <div class="radio-row">
                @for (type of deliveryTypes; track type) {
                  <label class="radio">
                    <input type="radio" name="deliveryType" [value]="type" [formControl]="c('deliveryType')" />
                    <span>{{ type === 'DOOR' ? 'Door Delivery' : 'Office Delivery' }}</span>
                  </label>
                }
              </div>
            </div>
            @if (c('deliveryType').value === 'DOOR') {
              <div class="spacer"></div>
              <label class="fld fld--sm"><span class="fld__l">Door Delivery Charge</span>
                <input class="fld__i" type="number" min="0" step="0.01" [formControl]="c('doorDeliveryCharge')" /></label>
            }
            <div class="spacer"></div>
            <label class="chk">
              <input type="checkbox" [formControl]="c('appointmentDelivery')" />
              <span>Appointment Delivery</span>
            </label>
            @if (c('appointmentDelivery').value) {
              <div class="spacer"></div>
              <div class="grid3">
                <label class="fld"><span class="fld__l">Appointment Date</span>
                  <input class="fld__i" type="date" [formControl]="c('appointmentDate')" /></label>
                <label class="fld"><span class="fld__l">Time Slot</span>
                  <input class="fld__i" [formControl]="c('appointmentTimeSlot')" placeholder="e.g. 1:00-2:00" maxlength="20" /></label>
                <label class="fld"><span class="fld__l">Appointment Delivery Charge <span class="fld__h">(no GST)</span></span>
                  <input class="fld__i" type="number" min="0" step="0.01" [formControl]="c('appointmentDeliveryCharge')" /></label>
              </div>
            }
            <div class="spacer"></div>
            <label class="chk">
              <input type="checkbox" [formControl]="c('insuranceApplicable')" />
              <span>FOV Applicable <span class="fld__h">(2% of Invoice Value)</span></span>
            </label>
          </app-card>

          <app-card title="Items">
            <app-item-entry-grid [initial]="hydrateItems()" [volumetricDivisor]="volumetricDivisor()" (itemsChange)="onItems($event)" (weightChange)="weight.set($event)" />
          </app-card>

          <app-card title="Remarks">
            <textarea class="ta" rows="2" [formControl]="c('remarks')" maxlength="500"></textarea>
          </app-card>

          @if (appointmentDeliveryReason(); as reason) {
            <p class="err">{{ reason }}</p>
          }
          <div class="ef__bar">
            <app-button variant="stroked" (pressed)="cancel()">Cancel</app-button>
            <app-button icon="save" [loading]="saving()" [disabled]="!canSave()" (pressed)="save()">Save Changes</app-button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .ef { display:flex; flex-direction:column; gap:16px; }
    .grid2 { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }
    .grid3 { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px 20px; }
    .parties { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
    .party { background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); padding:16px; }
    .party--sender { border-top:3px solid var(--info); }
    .party--receiver { border-top:3px solid var(--brand-600); }
    .party__title { font:700 14px var(--font-sans); letter-spacing:.06em; text-transform:uppercase; margin-bottom:12px; }
    .party--sender .party__title { color:var(--info); }
    .party--receiver .party__title { color:var(--brand-600); }
    @media (max-width:700px){ .parties { grid-template-columns:1fr; } }
    .fld { display:flex; flex-direction:column; gap:6px; }
    .fld__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .fld__h { font:400 14px var(--font-sans); color:var(--content-muted); }
    .chk { display:flex; gap:10px; align-items:flex-start; font:400 17px var(--font-sans); color:var(--content-fg); cursor:pointer; }
    .chk input { margin-top:3px; width:16px; height:16px; accent-color:var(--brand-600); }
    .radio-row { display:flex; gap:16px; align-items:center; }
    .radio { display:flex; gap:6px; align-items:center; font:400 17px var(--font-sans); color:var(--content-fg); cursor:pointer; }
    .radio input { width:16px; height:16px; accent-color:var(--brand-600); }
    .fld__i { height:42px; padding:0 12px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-field); font:400 17px var(--font-sans); color:var(--content-fg); }
    .ta { width:100%; padding:10px 12px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-field); font:400 17px var(--font-sans); color:var(--content-fg); resize:vertical; }
    .stat { display:flex; flex-direction:column; gap:6px; justify-content:center; }
    .stat__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .stat__v { font:600 17px var(--font-sans); color:var(--content-fg); }
    .stat__h { font:400 15px var(--font-sans); color:var(--content-muted); }
    .spacer { height:14px; }
    .ef__bar { position:sticky; bottom:0; display:flex; align-items:center; justify-content:flex-end;
      gap:10px; padding:14px 16px; background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
    .err { font:500 16px var(--font-sans); color:var(--danger); padding:10px 12px; background:var(--danger-bg); border-radius:var(--r-field); margin:0; }
    @media (max-width:760px){ .grid2, .grid3 { grid-template-columns:1fr; } }
  `]
})
export class ShipmentEdit implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  /** Charges are admin-only after booking — see ShipmentServiceImpl.update. */
  protected readonly isAdmin = this.auth.hasAnyRole(['COMPANY_ADMIN']);
  private readonly service = inject(ShipmentService);
  private readonly masters = inject(MasterDataService);
  private readonly settings = inject(SettingsService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly typeOptions = TYPE_OPTIONS;
  protected readonly deliveryTypes = DELIVERY_TYPES;

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly shipment = signal<ShipmentResponse | null>(null);

  readonly branchOptions = signal<SelectOption[]>([]);
  readonly serviceTypeOptions = signal<SelectOption[]>([]);
  readonly packageTypeOptions = signal<SelectOption[]>([]);
  readonly paymentModeOptions = signal<SelectOption[]>([]);

  /** Hydrates ItemEntryGrid exactly once when the shipment loads — a separate signal from
   *  `items` (which the grid writes back into) so the two-way flow can't loop. */
  readonly hydrateItems = signal<ShipmentItemRequest[] | null>(null);
  readonly items = signal<ShipmentItemRequest[]>([]);
  readonly weight = signal({ actual: 0, volumetric: 0, chargeable: 0 });
  /** Service Type id -> its volumetric divisor; the item grid divides L×W×H by the chosen one. */
  private readonly serviceTypeDivisors = signal<Map<string, number | null>>(new Map());
  private readonly chosenServiceTypeId = signal<string | null>(null);
  protected readonly volumetricDivisor = computed(() =>
    this.serviceTypeDivisors().get(this.chosenServiceTypeId() ?? '') ?? null);
  /** Company Settings → Shipment → default chargeable weight, for any new row added
   *  while editing. */
  /** Company Settings → Shipment → default appointment delivery charge, prefilled onto
   *  `appointmentDeliveryCharge` when the checkbox is checked. */
  protected readonly defaultAppointmentDeliveryCharge = signal<number>(1000);

  private id = '';

  protected readonly form: FormGroup = this.fb.group({
    pickupPincode: ['', Validators.maxLength(10)],
    deliveryPincode: ['', Validators.maxLength(10)],
    senderName: ['', [Validators.required, Validators.maxLength(150)]],
    senderAddress: ['', [Validators.required, Validators.maxLength(500)]],
    senderContact: ['', [Validators.required, Validators.maxLength(20)]],
    receiverName: ['', [Validators.required, Validators.maxLength(150)]],
    receiverAddress: ['', [Validators.required, Validators.maxLength(500)]],
    receiverContact: ['', [Validators.required, Validators.maxLength(20)]],
    serviceTypeId: [null as string | null, Validators.required],
    packageTypeId: [null as string | null, Validators.required],
    paymentModeId: [null as string | null, Validators.required],
    shipmentType: ['NON_DOCUMENT' as ShipmentType],
    bookingDate: [''],
    numberOfPackages: [1],
    declaredValue: [null as number | null],
    otherCharges: [null as number | null],
    remarks: ['', Validators.maxLength(500)],
    appointmentDelivery: [false],
    appointmentDate: [null as string | null],
    appointmentTimeSlot: ['', Validators.maxLength(20)],
    appointmentDeliveryCharge: [null as number | null],
    insuranceApplicable: [false],
    deliveryType: ['DOOR' as DeliveryType],
    doorDeliveryCharge: [null as number | null]
  });

  /**
   * A plain method, not `computed()` — it reads `FormControl.value`, which a `computed()`
   * cannot track. Called from the template on every change detection run, so it never
   * goes stale; see `ShipmentCreate.readyToPrice` for the same reasoning.
   */
  canSave(): boolean {
    const v = this.form.getRawValue();
    return !!(
      v.serviceTypeId && v.packageTypeId && v.paymentModeId
      && v.senderName && v.senderAddress && v.senderContact
      && v.receiverName && v.receiverAddress && v.receiverContact
      && this.items().length > 0 && this.weight().chargeable > 0
      && !!v.declaredValue
      && this.appointmentDeliveryReason() === null
    );
  }

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.masters.options('branches').subscribe((o) => this.branchOptions.set(o));
    this.masters.options('service-types').subscribe((o) => this.serviceTypeOptions.set(o));
    this.masters.serviceTypeDirectory().subscribe((rows) =>
      this.serviceTypeDivisors.set(new Map(rows.map((r) => [r.id, r.volumetricDivisor ?? null]))));
    this.chosenServiceTypeId.set(this.form.get('serviceTypeId')?.value ?? null);
    this.form.get('serviceTypeId')?.valueChanges.subscribe((v) => this.chosenServiceTypeId.set(v ?? null));
    this.masters.options('package-types').subscribe((o) => this.packageTypeOptions.set(o));
    this.masters.options('payment-modes').subscribe((o) => this.paymentModeOptions.set(o));
    this.settings.get().subscribe((d) => {
      const shipment = (d as { shipment?: { defaultAppointmentDeliveryCharge?: number } })?.shipment;
      if (shipment?.defaultAppointmentDeliveryCharge != null) {
        this.defaultAppointmentDeliveryCharge.set(Number(shipment.defaultAppointmentDeliveryCharge));
      }
    });
    // Checking Appointment Delivery prefills the company's configured default charge when
    // no charge is set yet; unchecking clears its date/slot/charge — same "hidden stale
    // value never submits" rule as `ShipmentCreate`.
    this.form.get('appointmentDelivery')?.valueChanges.subscribe((on) => {
      if (on) {
        if (!this.form.get('appointmentDeliveryCharge')?.value) {
          this.form.get('appointmentDeliveryCharge')?.setValue(this.defaultAppointmentDeliveryCharge());
        }
      } else {
        this.form.get('appointmentDate')?.setValue(null);
        this.form.get('appointmentTimeSlot')?.setValue('');
        this.form.get('appointmentDeliveryCharge')?.setValue(null);
      }
    });
    // Picking Office Delivery clears the Door Delivery Charge, same rule — it never
    // charges extra, and a stale figure must never ride along in the payload.
    this.form.get('deliveryType')?.valueChanges.subscribe((type) => {
      if (type !== 'DOOR') {
        this.form.get('doorDeliveryCharge')?.setValue(null);
      }
    });
    this.load();
  }

  /** Null once nothing blocks saving; otherwise the reason — mirrors
   *  `ShipmentCreate.appointmentDeliveryReason`, UX only, the backend re-checks it. */
  appointmentDeliveryReason(): string | null {
    const v = this.form.getRawValue();
    if (!v.appointmentDelivery) return null;
    if (!v.appointmentDate) return 'Pick an appointment delivery date.';
    if (!(v.appointmentTimeSlot ?? '').trim()) return 'Enter an appointment delivery time slot.';
    return null;
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }
  branchLabel(id: string): string { return this.branchOptions().find((o) => o.value === id)?.label ?? id; }

  /** Declared Value is the sum of every item's own Value, not typed separately — matches
   *  Shipment Booking's own rule (direct request: never typed twice, never diverges from
   *  the items). This screen has no Invoice Value field to also mirror. */
  protected onItems(items: ShipmentItemRequest[]): void {
    this.items.set(items);
    const total = items.reduce((sum, i) => sum + (i.declaredValue ?? 0), 0);
    this.c('declaredValue').setValue(total > 0 ? total : null);
  }

  private load(): void {
    this.loading.set(true);
    this.service.get(this.id).subscribe({
      next: (s) => {
        this.shipment.set(s);
        this.breadcrumb.set([{ label: 'Shipments', route: '/shipments' }, { label: s.shipmentNumber, route: `/shipments/${this.id}` }, { label: 'Edit' }]);
        this.form.patchValue({
          pickupPincode: s.pickupPincode, deliveryPincode: s.deliveryPincode,
          senderName: s.senderName, senderAddress: s.senderAddress, senderContact: s.senderContact,
          receiverName: s.receiverName, receiverAddress: s.receiverAddress, receiverContact: s.receiverContact,
          serviceTypeId: s.serviceTypeId, packageTypeId: s.packageTypeId,
          paymentModeId: s.paymentModeId, shipmentType: s.shipmentType, bookingDate: s.bookingDate,
          numberOfPackages: s.numberOfPackages, declaredValue: s.declaredValue, remarks: s.remarks ?? '',
          appointmentDelivery: s.appointmentDelivery, appointmentDate: s.appointmentDate ?? null,
          appointmentTimeSlot: s.appointmentTimeSlot ?? '', insuranceApplicable: s.insuranceApplicable,
          deliveryType: s.deliveryType
        });
        this.hydrateItems.set(s.items.map((i) => ({
          itemName: i.itemName, quantity: i.quantity, weight: i.weight, lengthCm: i.lengthCm,
          widthCm: i.widthCm, heightCm: i.heightCm, declaredValue: i.declaredValue,
          fragile: i.fragile, dangerousGoods: i.dangerousGoods
        })));
        // Other Charges lives on the persisted charge row, not ShipmentResponse itself —
        // fetched separately so an edit doesn't silently reset it to zero on save.
        this.service.charges(this.id).subscribe({
          next: (c) => this.form.patchValue({
            otherCharges: c.otherCharges || null,
            appointmentDeliveryCharge: c.appointmentDeliveryCharge || null,
            doorDeliveryCharge: c.doorDeliveryCharge || null
          }),
          error: () => {}
        });
        this.loading.set(false);
      },
      error: () => { this.shipment.set(null); this.loading.set(false); }
    });
  }

  save(): void {
    const s = this.shipment();
    if (!s || !this.canSave()) return;
    const v = this.form.getRawValue();

    const body: UpdateShipmentRequest = {
      version: s.version,
      pickupPincode: v.pickupPincode, deliveryPincode: v.deliveryPincode,
      senderName: v.senderName, senderAddress: v.senderAddress, senderContact: v.senderContact,
      receiverName: v.receiverName, receiverAddress: v.receiverAddress, receiverContact: v.receiverContact,
      serviceTypeId: v.serviceTypeId, packageTypeId: v.packageTypeId, paymentModeId: v.paymentModeId,
      shipmentType: v.shipmentType, bookingDate: v.bookingDate || null,
      declaredValue: v.declaredValue || null, numberOfPackages: v.numberOfPackages || 1,
      remarks: v.remarks || null, otherCharges: v.otherCharges || null, items: this.items(),
      appointmentDelivery: v.appointmentDelivery || null,
      appointmentDate: v.appointmentDelivery ? v.appointmentDate : null,
      appointmentTimeSlot: v.appointmentDelivery ? (v.appointmentTimeSlot?.trim() || null) : null,
      appointmentDeliveryCharge: v.appointmentDelivery ? (v.appointmentDeliveryCharge || null) : null,
      insuranceApplicable: v.insuranceApplicable || null,
      deliveryType: v.deliveryType,
      doorDeliveryCharge: v.deliveryType === 'DOOR' ? (v.doorDeliveryCharge || null) : null
    };

    this.saving.set(true);
    this.service.update(this.id, body).subscribe({
      next: () => { this.saving.set(false); this.notify.success('Shipment updated.'); this.router.navigate(['/shipments', this.id]); },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 409) { this.notify.error('This shipment changed since you opened it. Reloading the latest version.'); this.load(); }
        else if (err.status === 400 || err.status === 422) this.notify.error(err.error?.message ?? 'Please correct the highlighted fields.');
        else this.notify.error('Could not update the shipment.');
      }
    });
  }

  cancel(): void { this.router.navigate(['/shipments', this.id]); }
}
