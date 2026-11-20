import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ApplicableChargeLine } from '@core/models/shipment.model';

/** Normalised shape both callers adapt to: the Pricing Engine's live `ChargeBreakup`
 *  (Step 3 preview) and the persisted `ShipmentCharge` (GET /shipments/{id}/charges) —
 *  same nine lines, `discountAmount` naming the one field that otherwise differs. */
export interface ChargeSummaryData {
  freight: number;
  fuelCharge: number;
  handlingCharge: number;
  odaCharge: number;
  insuranceCharge: number;
  /** Sum of ACTIVE charge-module rows (e.g. "Hamali") matched to this booking's service
   *  type and weight/distance — auto-computed, never manually edited here. */
  applicableCharges: number;
  /** `applicableCharges` broken out by charge name — shown as one row per line instead of
   *  the lumped total when non-empty; falls back to the lumped `applicableCharges` row
   *  when empty/undefined (older callers, or a shipment with none matched). */
  applicableChargeLines?: ApplicableChargeLine[];
  gstAmount: number;
  discountAmount: number;
  roundOff: number;
  /** Manual, typed at booking time — not part of the Pricing Engine's own rate-driven
   *  lines above; added on top of the engine's net amount by the caller. */
  otherCharges: number;
  /** Manual, typed at booking time when Appointment Delivery is checked — deliberately
   *  GST-free, unlike {@link otherCharges}. Undefined/omitted hides the row entirely
   *  (e.g. Shipment Charges' persisted view when the shipment carries none). */
  appointmentDeliveryCharge?: number;
  /** Manual, typed at booking time when Delivery Type is DOOR — taxed with GST (folded
   *  into `gstAmount`), unlike {@link appointmentDeliveryCharge}. Undefined/omitted hides
   *  the row entirely. */
  doorDeliveryCharge?: number;
  /** Company-configured To-Pay charge — added by the backend on To-Pay bookings, never typed
   *  (read-only here), taxed with GST (folded into `gstAmount`). Zero/omitted hides the row. */
  toPayCharge?: number;
  netAmount: number;
}

/** Freight through Net Amount — the Pricing Engine's own charge breakup, shown identically
 *  whether it is a live preview or what actually got booked. Other Charges sits above GST
 *  (not calculation order) since `gstAmount` already includes tax on it — see
 *  `ShipmentServiceImpl.copyCharge`. */
@Component({
  selector: 'app-charge-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <dl class="kv">
      @if (charges().freight) {
        <dt>Freight</dt><dd class="mono">{{ charges().freight | number: '1.2-2' }}</dd>
      }
      @if (charges().fuelCharge) {
        <dt>Fuel Surcharge</dt><dd class="mono">{{ charges().fuelCharge | number: '1.2-2' }}</dd>
      }
      @if (charges().handlingCharge) {
        <dt>Handling</dt><dd class="mono">{{ charges().handlingCharge | number: '1.2-2' }}</dd>
      }
      @if (charges().insuranceCharge) {
        <dt>FOV</dt><dd class="mono">{{ charges().insuranceCharge | number: '1.2-2' }}</dd>
      }
      @if (charges().applicableChargeLines?.length) {
        @for (line of charges().applicableChargeLines; track line.chargeName) {
          <dt>{{ line.chargeName }}</dt><dd class="mono">{{ line.amount | number: '1.2-2' }}</dd>
        }
      } @else if (charges().applicableCharges) {
        <dt>Applicable Charges</dt><dd class="mono">{{ charges().applicableCharges | number: '1.2-2' }}</dd>
      }
      <dt>Other Charges</dt>
      @if (editable()) {
        <dd class="mono">
          <input class="net-input" type="number" step="0.01" min="0"
                 [value]="charges().otherCharges" (input)="onOtherChargesInput($event)" />
        </dd>
      } @else {
        <dd class="mono">{{ charges().otherCharges | number: '1.2-2' }}</dd>
      }
      @if (editable()) {
        <dt>ODA Charge</dt>
        <dd class="mono">
          <input class="net-input" type="number" step="0.01" min="0"
                 [value]="charges().odaCharge" (input)="onOdaChargeInput($event)" />
        </dd>
      } @else if (charges().odaCharge) {
        <dt>ODA</dt><dd class="mono">{{ charges().odaCharge | number: '1.2-2' }}</dd>
      }
      @if (showAppointmentCharge()) {
        <dt>Appointment Delivery <span class="hint">(no GST)</span></dt>
        @if (editable()) {
          <dd class="mono">
            <input class="net-input" type="number" step="0.01" min="0"
                   [value]="charges().appointmentDeliveryCharge ?? 0" (input)="onAppointmentDeliveryChargeInput($event)" />
          </dd>
        } @else {
          <dd class="mono">{{ charges().appointmentDeliveryCharge ?? 0 | number: '1.2-2' }}</dd>
        }
      }
      @if (showDoorDeliveryCharge()) {
        <dt>Door Delivery</dt>
        @if (editable()) {
          <dd class="mono">
            <input class="net-input" type="number" step="0.01" min="0"
                   [value]="charges().doorDeliveryCharge ?? 0" (input)="onDoorDeliveryChargeInput($event)" />
          </dd>
        } @else {
          <dd class="mono">{{ charges().doorDeliveryCharge ?? 0 | number: '1.2-2' }}</dd>
        }
      }
      @if (charges().toPayCharge) {
        <dt>To-Pay Charge</dt><dd class="mono">{{ charges().toPayCharge | number: '1.2-2' }}</dd>
      }
      @if (charges().gstAmount) {
        <dt>GST</dt><dd class="mono">{{ charges().gstAmount | number: '1.2-2' }}</dd>
      }
      @if (charges().discountAmount) {
        <dt>Discount</dt><dd class="mono discount">-{{ charges().discountAmount | number: '1.2-2' }}</dd>
      }
      @if (charges().roundOff) {
        <dt>Round Off</dt><dd class="mono">{{ charges().roundOff | number: '1.2-2' }}</dd>
      }
      <dt class="total">Net Amount</dt>
      @if (editable()) {
        <dd class="mono total">
          <input class="net-input" type="number" step="0.01" min="0"
                 [value]="charges().netAmount" (input)="onNetAmountInput($event)" />
        </dd>
      } @else {
        <dd class="mono total">{{ charges().netAmount | number: '1.2-2' }}</dd>
      }
    </dl>
  `,
  styles: [`
    .kv { display:grid; grid-template-columns:1fr auto; gap:8px 16px; margin:0; }
    .kv dt { font:500 16px var(--font-sans); color:var(--content-muted); }
    .kv dd { font:600 17px var(--font-sans); color:var(--content-fg); margin:0; text-align:right; }
    .discount { color:var(--success); }
    .kv .total { font-weight:700; font-size:19px; color:var(--brand-600); border-top:1px solid var(--surface-border); padding-top:8px; margin-top:4px; }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .net-input { width:100px; text-align:right; font:700 19px var(--font-mono, ui-monospace); color:var(--brand-600);
      background:transparent; border:1px solid var(--surface-border); border-radius:6px; padding:2px 6px; }
    .net-input:focus { outline:0; border-color:var(--brand-500); }
    .hint { font:400 14px var(--font-sans); color:var(--content-muted); }
  `]
})
export class ChargeSummary {
  readonly charges = input.required<ChargeSummaryData>();
  /** When true, Net Amount becomes a typeable override — display only, never sent to the
   *  server; the caller decides whether/how to use the edited value. */
  readonly editable = input<boolean>(false);
  readonly netAmountChange = output<number>();
  /** Emits the typed Other Charges amount — unlike {@link netAmountChange}, this one IS
   *  sent to the server (see `ShipmentCreate.otherCharges` form control). */
  readonly otherChargesChange = output<number>();
  /** Emits the typed ODA Charge override — sent to the server, same as
   *  {@link otherChargesChange} (see `ShipmentCreate.odaCharge` form control). */
  readonly odaChargeChange = output<number>();
  /** Emits the typed Appointment Delivery Charge — sent to the server, same as
   *  {@link otherChargesChange}. */
  readonly appointmentDeliveryChargeChange = output<number>();
  /** Emits the typed Door Delivery Charge — sent to the server, same as
   *  {@link otherChargesChange}. */
  readonly doorDeliveryChargeChange = output<number>();

  /** Only shown when the caller actually supplies a value — undefined means Appointment
   *  Delivery isn't checked (create) or the persisted shipment never had one (view), so
   *  the row stays out of the way rather than showing an always-editable zero. */
  protected showAppointmentCharge(): boolean {
    return this.charges().appointmentDeliveryCharge !== undefined;
  }

  /** Only shown when the caller actually supplies a value — undefined means Delivery Type
   *  isn't DOOR (create) or the persisted shipment never had one (view). */
  protected showDoorDeliveryCharge(): boolean {
    return this.charges().doorDeliveryCharge !== undefined;
  }

  protected onNetAmountInput(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    if (!Number.isNaN(v)) this.netAmountChange.emit(v);
  }

  protected onOtherChargesInput(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    if (!Number.isNaN(v)) this.otherChargesChange.emit(v);
  }

  protected onOdaChargeInput(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    if (!Number.isNaN(v)) this.odaChargeChange.emit(v);
  }

  protected onAppointmentDeliveryChargeInput(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    if (!Number.isNaN(v)) this.appointmentDeliveryChargeChange.emit(v);
  }

  protected onDoorDeliveryChargeInput(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    if (!Number.isNaN(v)) this.doorDeliveryChargeChange.emit(v);
  }
}
