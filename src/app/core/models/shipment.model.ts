/**
 * Shipment Booking models — mirror the backend `com.courier.modules.shipment` module
 * one-to-one (see MEMORY/modules/shipment-booking.md). A shipment is booked only after
 * Customer, Serviceability + Route + Pricing (all inside one Pricing Engine call) and,
 * for a PAID booking, the Branch Wallet have all agreed. No mock shapes: every field is
 * returned by, or accepted by, an endpoint.
 */

export type ShipmentType = 'DOCUMENT' | 'NON_DOCUMENT' | 'CARGO';
export const SHIPMENT_TYPES: ShipmentType[] = ['DOCUMENT', 'NON_DOCUMENT', 'CARGO'];

/** DOOR (default) may carry a manual, GST-taxed doorDeliveryCharge; OFFICE never charges
 *  extra, enforced server-side regardless of what was typed. */
export type DeliveryType = 'DOOR' | 'OFFICE';
export const DELIVERY_TYPES: DeliveryType[] = ['DOOR', 'OFFICE'];

/**
 * Renamed in V19 (Shipment Movement) to match that module's own vocabulary exactly:
 * `MANIFESTED` -> `MANIFEST_CREATED`, `RECEIVED` -> `IN_SCAN`, `RETURN_INITIATED` folded
 * into a direct edge to `RETURNED`. V20, on direct request, folded the separate
 * `OUT_SCAN` state back into `MANIFEST_CREATED` — one milestone ("loading sheet created"),
 * not two; adding a shipment to a manifest already is the loading sheet action. See backend
 * `ShipmentStatus.java`.
 */
export type ShipmentStatus =
  | 'BOOKED' | 'READY_FOR_MANIFEST' | 'MANIFEST_CREATED' | 'DISPATCHED' | 'IN_SCAN'
  | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'RETURNED' | 'CANCELLED';

/** The states a booking may still be cancelled from — mirrors `ShipmentStatus.isCancellable()`. */
export const CANCELLABLE_STATUSES: ShipmentStatus[] =
  ['BOOKED', 'READY_FOR_MANIFEST', 'MANIFEST_CREATED'];

export type ShipmentDocumentType = 'INVOICE' | 'EWAY_BILL' | 'PACKING_LIST' | 'LR_COPY' | 'POD';
export const SHIPMENT_DOCUMENT_TYPES: ShipmentDocumentType[] =
  ['INVOICE', 'EWAY_BILL', 'PACKING_LIST', 'LR_COPY', 'POD'];

/** One packed item — mirrors backend `ShipmentItemResponse`/`ShipmentItemRequest`. */
export interface ShipmentItem {
  id?: string;
  itemName: string;
  quantity: number;
  weight: number;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  declaredValue?: number | null;
  fragile: boolean;
  dangerousGoods: boolean;
}

/** List-row projection — mirrors backend `ShipmentSummaryResponse` (GET /shipments). */
export interface Shipment {
  id: string;
  shipmentNumber: string;
  trackingNumber: string;
  bookingDate: string;
  bookingBranchId: string;
  /** No longer picked at booking — resolved server-side off the destination pincode's own
   *  branch mapping (null when that pincode isn't mapped yet). See `fromCity`/`toCity`. */
  deliveryBranchId?: string | null;
  /** The booking branch's own city. */
  fromCity?: string | null;
  /** The destination pincode/area's resolved city. */
  toCity?: string | null;
  /** Where the shipment physically is right now — same as `bookingBranchId` unless it has
   *  moved past a crossing hop. */
  currentLocationId?: string | null;
  /** The shipment's next stop — a crossing hub, or `deliveryBranchId` once every hop is
   *  done. */
  nextLocationId?: string | null;
  manifestId?: string | null;
  paymentModeId: string;
  deliveryType: DeliveryType;
  senderName: string;
  senderContact: string;
  receiverName: string;
  receiverContact: string;
  chargeableWeight: number;
  /** Null only for a row with no charge record — see backend `ShipmentSummaryResponse`. */
  netAmount: number | null;
  /** Commission breakdown (V28), null only for a row with no charge record. */
  totalCommission: number | null;
  commissionOnBasicFreight: number | null;
  branchCommissionOnOtherAmount: number | null;
  companyCommissionOnBasicFreight: number | null;
  status: ShipmentStatus;
  /** Null until `DeliveryAssignment.markDelivered` has run — the Delivery Report's own column. */
  deliveredAt?: string | null;
  createdDate?: string | null;
  version: number;
  /** Current E-Way Bill's invoice number, null where the shipment has none — the THC's
   *  own INVOICE NO column. */
  invoiceNumber?: string | null;
  /** Last IN_SCAN ("received") timestamp — populated on the Bulk Shipment Tracking report
   *  only; null elsewhere (other list screens don't ask for it). */
  receivedAt?: string | null;
  /** The government-issued E-Way Bill number itself (distinct from `invoiceNumber`) —
   *  null until Part-A has actually succeeded. The THC's own E-WAY BILL NO column. */
  ewayBillNumber?: string | null;
  /** Package count — the THC's own QTY column. */
  numberOfPackages?: number | null;
}

/** One row of a bulk-track result — mirrors backend `BulkTrackRowResponse`. `shipment` is
 *  null when `found` is false. */
export interface BulkTrackRow {
  number: string;
  found: boolean;
  shipment: Shipment | null;
}

/** Bulk Shipment Tracking report result — mirrors backend `BulkTrackResponse`. */
export interface BulkTrackResponse {
  results: BulkTrackRow[];
  foundCount: number;
  notFoundCount: number;
}

/** Full representation, with its item grid — mirrors backend `ShipmentResponse`. */
export interface ShipmentResponse {
  flowType?: FlowType;
  id: string;
  companyId: string;
  shipmentNumber: string;
  trackingNumber: string;
  bookingDate: string;
  bookingBranchId: string;
  /** No longer picked at booking — resolved server-side off the destination pincode's own
   *  branch mapping (null when that pincode isn't mapped yet). See `fromCity`/`toCity`. */
  deliveryBranchId?: string | null;
  /** The booking branch's own city, shown at booking instead of a branch picker. */
  fromCity?: string | null;
  /** The destination pincode/area's resolved city, shown at booking instead of a Delivery
   *  Branch picker. */
  toCity?: string | null;
  manifestId?: string | null;
  currentLocationId?: string | null;
  nextLocationId?: string | null;
  pickupPincode: string;
  deliveryPincode: string;
  /** The specific Area of deliveryPincode the operator picked at booking, when that
   *  pincode has more than one; null for shipments booked before this field existed. */
  destinationAreaId?: string | null;
  senderName: string;
  senderAddress: string;
  senderContact: string;
  receiverName: string;
  receiverAddress: string;
  receiverContact: string;
  serviceTypeId: string;
  /** No longer picked at booking — null on any shipment booked after that change. Still
   *  populated on older bookings. */
  packageTypeId?: string | null;
  paymentModeId: string;
  shipmentType: ShipmentType;
  expectedDeliveryDate?: string | null;
  actualWeight: number;
  volumetricWeight: number;
  chargeableWeight: number;
  declaredValue?: number | null;
  numberOfPackages: number;
  status: ShipmentStatus;
  remarks?: string | null;
  appointmentDelivery: boolean;
  appointmentDate?: string | null;
  appointmentTimeSlot?: string | null;
  insuranceApplicable: boolean;
  deliveryType: DeliveryType;
  deliveredAt?: string | null;
  podPhotoUrl?: string | null;
  podSignatureUrl?: string | null;
  shipmentImageUrl?: string | null;
  /** Drives whether an E-Way Bill is mandatory — see `ShipmentEwayBillInfo`/`ewayBillRequired`. */
  invoiceValue?: number | null;
  /** Frozen at booking time from `invoiceValue` vs. the threshold in effect then — never
   *  recomputed against a later threshold change. */
  ewayBillRequired: boolean;
  /** The shipment's current E-Way Bill, if it has ever had one. */
  ewayBill?: ShipmentEwayBillInfo | null;
  createdBy?: string | null;
  createdByName?: string | null;
  createdDate?: string | null;
  updatedBy?: string | null;
  updatedDate?: string | null;
  version: number;
  items: ShipmentItem[];
}

/**
 * E-Way Bill Management (`com.courier.modules.ewaybill`) — integrated into Shipment
 * Booking: an invoice value over the company's own configurable threshold
 * (`CompanySettings.ewayBillMandatoryValue`, default 50000.00, see
 * `GET /company-settings`'s `ewayBill` section) makes an E-Way Bill mandatory. Once
 * mandatory, Part-A (invoice/consignor/consignee) is generated automatically through
 * `EwayBillProvider` right after booking, and Part-B (vehicle/transport) automatically
 * once the shipment is dispatched on a Manifest — nothing here is manually typed except
 * the invoice details. The backend enforces all of this inside `POST`/`PUT /shipments`
 * and `ManifestServiceImpl.dispatch` — the frontend's own checks below are UX only,
 * never the real gate. See MEMORY/modules/eway-bill.md.
 */
export type EwayBillStatus =
  | 'NOT_REQUIRED' | 'REQUIRED' | 'PART_A_PENDING' | 'PART_A_GENERATED' | 'PART_B_PENDING'
  | 'GENERATED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

/** The E-Way Bill data a booking screen supplies inline, in the same call that books or
 *  edits a shipment — mirrors backend `EwayBillBookingRequest`. Its own `invoiceValue`
 *  is not repeated here; the shipment's own `invoiceValue` carries it.
 *
 *  `ewayBillNumber`/`transporterId`/`vehicleNumber`/`distance`/`validFrom`/`validUntil`
 *  are ignored on the mandatory auto-generation path — the number is provider-issued,
 *  and transport details are filled in at Manifest dispatch. They stay on the wire only
 *  for a non-mandatory manual attach (an operator already holding a number obtained
 *  outside this application). */
export interface EwayBillBookingRequest {
  ewayBillNumber?: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  documentType?: string | null;
  documentNumber?: string | null;
  documentDate?: string | null;
  transporterId?: string | null;
  vehicleNumber?: string | null;
  distance?: number | null;
  validFrom?: string | null;
  validUntil?: string | null;
  documentUrl?: string | null;
  remarks?: string | null;
  /** Sender's GSTIN, optional — Shipment itself carries no GST fields. */
  consignorGstin?: string | null;
  /** Receiver's GSTIN, optional. */
  consigneeGstin?: string | null;
}

/** The shipment's current E-Way Bill, read-only — mirrors backend
 *  `ShipmentResponse.EwayBillInfo`, nested on `ShipmentResponse.ewayBill`. */
export interface ShipmentEwayBillInfo {
  id: string;
  ewayBillNumber?: string | null;
  status: EwayBillStatus;
  invoiceValue: number;
  validFrom?: string | null;
  validUntil?: string | null;
  documentUrl?: string | null;
  /** The provider's own sanitized failure reason — set only when `status` is `FAILED`. */
  lastError?: string | null;
}

/** Full standalone E-Way Bill record — mirrors backend `EwayBillResponse`, the
 *  `/eway-bills` CRUD/lifecycle endpoints used from Shipment Details post-booking. */
export interface EwayBill {
  id: string;
  shipmentId: string;
  ewayBillNumber?: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceValue: number;
  documentType: string;
  documentNumber?: string | null;
  documentDate?: string | null;
  consignorGstin?: string | null;
  consigneeGstin?: string | null;
  transporterId?: string | null;
  vehicleNumber?: string | null;
  transportMode?: string | null;
  distance?: number | null;
  validFrom?: string | null;
  validUntil?: string | null;
  status: EwayBillStatus;
  providerName?: string | null;
  providerReference?: string | null;
  partAGeneratedAt?: string | null;
  partBGeneratedAt?: string | null;
  lastError?: string | null;
  retryCount: number;
  documentUrl?: string | null;
  remarks?: string | null;
  createdBy?: string | null;
  createdDate?: string | null;
  updatedBy?: string | null;
  updatedDate?: string | null;
  version: number;
}

/** Body of POST /eway-bills — attaches an E-Way Bill to an already-booked shipment. */
export interface CreateEwayBillRequest extends EwayBillBookingRequest {
  shipmentId: string;
  invoiceValue: number;
}

/** Body of PUT /eway-bills/{id}. */
export interface UpdateEwayBillRequest extends EwayBillBookingRequest {
  invoiceValue: number;
  version: number;
}

/** One named applicable-charge line — e.g. `{ chargeName: "Hamali", amount: 10.00 }`. */
export interface ApplicableChargeLine {
  chargeName: string;
  amount: number;
}

/** The Pricing Engine's own charge breakup, persisted at booking time — GET /shipments/{id}/charges. */
export interface ShipmentCharge {
  shipmentId: string;
  freight: number;
  fuelCharge: number;
  handlingCharge: number;
  odaCharge: number;
  insuranceCharge: number;
  /** Sum of ACTIVE charge-module rows (e.g. "Hamali") matched to this shipment's service
   *  type and weight/distance — GST-inclusive, unlike `appointmentDeliveryCharge`. */
  applicableCharges: number;
  /** `applicableCharges` broken out by the charge module's own name (e.g. "Hamali",
   *  "Fuel Surcharge") — resolved live off this shipment's own booking/delivery branch,
   *  chargeable weight and freight, not persisted. Empty when no charge is configured for
   *  this shipment's service type. */
  applicableChargeLines: ApplicableChargeLine[];
  gstAmount: number;
  discountAmount: number;
  roundOff: number;
  otherCharges: number;
  /** Manual, typed at booking time when `appointmentDelivery` is checked — deliberately
   *  GST-free, unlike `otherCharges`. */
  appointmentDeliveryCharge: number;
  /** Manual, typed at booking time when `deliveryType` is DOOR — taxed with GST (folded
   *  into `gstAmount`), unlike `appointmentDeliveryCharge`. Zero when `deliveryType` is
   *  OFFICE. */
  doorDeliveryCharge: number;
  /** Company-configured flat To-Pay charge, added by the backend on To-Pay bookings — taxed
   *  with GST (folded into `gstAmount`). Zero on any other payment mode. */
  toPayCharge: number;
  /** Commission breakdown (V28), computed from the booking branch's own charge percentages. */
  commissionOnBasicFreight: number;
  branchCommissionOnOtherAmount: number;
  companyCommissionOnBasicFreight: number;
  /** {@code commissionOnBasicFreight + branchCommissionOnOtherAmount} — the branch's total earning. */
  totalCommission: number;
  netAmount: number;
  matchedRouteId?: string | null;
  matchedRouteCode?: string | null;
  matchedRateId?: string | null;
  matchedRateCode?: string | null;
  /** The Freight Factor grid cell's own factor, or an accepted override of it — null unless
   *  this shipment priced through the Freight Factor fallback. */
  appliedFreightFactor?: number | null;
}

/** One entry of a shipment's status timeline — GET /shipments/{id}/history. */
export interface ShipmentStatusHistoryEntry {
  id: string;
  status: ShipmentStatus;
  previousStatus?: ShipmentStatus | null;
  remarks?: string | null;
  branchId?: string | null;
  manifestId?: string | null;
  vehicleId?: string | null;
  changedBy?: string | null;
  changedAt: string;
}

/** GET /shipments/{id}/delivery-run — mirrors `ShipmentDrsResponse`. */
export interface ShipmentDrs {
  drsNumber?: string | null;
  deliveryBranchId?: string | null;
  deliveryUserId: string;
  vehicleId?: string | null;
  fuelCost?: number | null;
  deliveryCharge?: number | null;
  status: string;
  assignedAt: string;
  deliveredAt?: string | null;
  receiverName?: string | null;
  deliveryRemarks?: string | null;
}

/** One uploaded document reference — GET/POST /shipments/{id}/documents. */
export interface ShipmentDocument {
  id: string;
  documentType: ShipmentDocumentType;
  documentName: string;
  documentUrl: string;
  remarks?: string | null;
  createdBy?: string | null;
  createdDate?: string | null;
}

/** One packed item on a booking/update request — mirrors backend `ShipmentItemRequest`. */
export interface ShipmentItemRequest {
  itemName: string;
  quantity?: number | null;
  weight: number;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  declaredValue?: number | null;
  fragile?: boolean;
  dangerousGoods?: boolean;
}

/** Fields shared by create and update — mirrors the overlap of Create/UpdateShipmentRequest. */
export interface ShipmentFields {
  pickupPincode: string;
  deliveryPincode: string;
  senderName: string;
  senderAddress: string;
  senderContact: string;
  receiverName: string;
  receiverAddress: string;
  receiverContact: string;
  serviceTypeId: string;
  /** Optional at Shipment Booking (required on Update — see `shipment-edit.ts`). The zone
   *  tariff prices by it, so booking offers it again. */
  packageTypeId?: string | null;
  paymentModeId: string;
  shipmentType?: ShipmentType | null;
  bookingDate?: string | null;
  declaredValue?: number | null;
  numberOfPackages?: number | null;
  remarks?: string | null;
  /** Manual, typed at booking time — not computed by the Pricing Engine — added on top of
   *  its net amount server-side. See `ShipmentCharge.otherCharges`. */
  otherCharges?: number | null;
  /** Optional override of the Pricing Engine's own `ShipmentCharge.odaCharge` — typed at
   *  booking time when the operator needs to adjust it. Null uses the engine's own computed
   *  value unchanged; GST is recomputed server-side on the difference. */
  odaCharge?: number | null;
  /** Only meaningful when this lane falls back to the Freight Factor grid (no route/rate
   *  available) — raises the matched cell's own factor. Must be >= the matched factor;
   *  the server refuses a smaller value. See `PricingResponse.appliedFreightFactor`. */
  freightFactorOverride?: number | null;
  items?: ShipmentItemRequest[];
  actualWeight?: number | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  /** Drives whether an E-Way Bill is mandatory — see `EwayBillBookingRequest`. Null is
   *  never mandatory. */
  invoiceValue?: number | null;
  /** Required when `invoiceValue` exceeds the company's own mandatory threshold — booking
   *  is refused with a 422 otherwise (backend-enforced; the frontend's own checks in
   *  shipment-create.ts are UX only). Optional and simply attached when supplied below it. */
  ewayBill?: EwayBillBookingRequest | null;
  /** The specific Area of `deliveryPincode` picked from its Area dropdown, if any —
   *  resolves District Level Freight's District/ODA off that exact pincode-area link. */
  destinationAreaId?: string | null;
  /** Optional override of District Level Freight's own matched-slab rate/KG. Must not be
   *  lower than that rate — the server refuses a smaller value with a 422. A higher figure
   *  raises freight (and its GST, on the difference only) above the system-calculated
   *  figure. */
  ratePerKgOverride?: number | null;
  /** When true, `appointmentDate`/`appointmentTimeSlot` are required — the server refuses
   *  otherwise. */
  appointmentDelivery?: boolean | null;
  /** Required only when `appointmentDelivery` is true. */
  appointmentDate?: string | null;
  /** Free text, e.g. "1:00-2:00" — required only when `appointmentDelivery` is true. */
  appointmentTimeSlot?: string | null;
  /** Optional, defaults to zero. Deliberately never taxed with GST, unlike `otherCharges`. */
  appointmentDeliveryCharge?: number | null;
  /** When true, insurance is charged at 2% of freight instead of the Pricing Engine's own
   *  rate-driven insurance figure. GST is recomputed server-side on the difference, same as
   *  `odaCharge`. */
  insuranceApplicable?: boolean | null;
  /** Defaults to DOOR server-side when omitted. OFFICE never charges extra —
   *  `doorDeliveryCharge` is ignored server-side when this is OFFICE. */
  deliveryType?: DeliveryType | null;
  /** Optional, defaults to zero, meaningful only when `deliveryType` is DOOR. Deliberately
   *  never taxed with GST, unlike `otherCharges`. */
  doorDeliveryCharge?: number | null;
}

/** Body of POST /shipments — mirrors backend `CreateShipmentRequest`. */
/** STANDARD is the original booking / Load Sheet / THC flow; MSRTC books straight to a
 *  delivery branch and moves branch to branch only. */
export type FlowType = 'STANDARD' | 'MSRTC';

export interface CreateShipmentRequest extends ShipmentFields {
  bookingBranchId: string;
  /** Omit for the normal flow. MSRTC requires `deliveryBranchId`. */
  flowType?: FlowType;
  deliveryBranchId?: string | null;
  /** The Business Customer this booking is for — prices freight from their zone rate card
   *  when one covers the destination. Omit for an ordinary booking. */
  businessCustomerId?: string | null;
  /** Optional — enter a specific shipment number instead of the auto-generated
   *  "<BRANCH_CODE>-<serial>" one. Must be unique within the company; booking is
   *  refused with a 422 if it's already in use. */
  manualShipmentNumber?: string | null;
  /** Route this shipment through one or more intermediate branches/hubs, in order,
   *  instead of straight to the delivery branch. When true, crossingBranchIds must carry
   *  at least one branch. */
  crossing?: boolean | null;
  /** The intermediate branches/hubs, in the order the shipment passes through them. */
  crossingBranchIds?: string[] | null;
  /** The whole route's crossing charge — not per hop. */
  crossingCharge?: number | null;
}

/** Body of PUT /shipments/{id} — mirrors backend `UpdateShipmentRequest`. `bookingBranchId`
 *  is absent — immutable once booked. Carries `version`. */
export interface UpdateShipmentRequest extends ShipmentFields {
  version: number;
}

/** Advanced-filter criteria for GET /shipments. All optional; merged into the page query. */
export interface ShipmentSearchRequest {
  status?: ShipmentStatus[];
  bookingBranchId?: string;
  deliveryBranchId?: string;
  manifestId?: string;
  bookingDateFrom?: string;
  bookingDateTo?: string;
  /** Delivery Report's own range — matched against when the shipment was actually
   *  delivered, not when it was booked. */
  deliveredDateFrom?: string;
  deliveredDateTo?: string;
  paymentModeId?: string;
  search?: string;
  /** Load Sheet's destination-city match, for a shipment with no delivery branch
   *  resolved yet. */
  toCity?: string;
  /** Load Sheet's own eligibility filter — true for only shipments with no delivery
   *  branch resolved yet. */
  unassignedDeliveryBranch?: boolean;
}

/** Unpaged aggregates for GET /shipments/summary — the Booking/Delivery Report summary row.
 *  Mirrors backend `ShipmentSummaryStatsResponse`. */
export interface ShipmentSummaryStats {
  totalCount: number;
  totalChargeableWeight: number;
  totalNetAmount: number;
  statusCounts: Partial<Record<ShipmentStatus, number>>;
}

/** One row of GET /shipments/commission-summary — the Commission Report's branch-wise
 *  summary table. Mirrors backend `BranchCommissionSummaryResponse`. */
export interface BranchCommissionSummary {
  bookingBranchId: string;
  shipmentCount: number;
  totalNetAmount: number;
  commissionOnBasicFreight: number;
  branchCommissionOnOtherAmount: number;
  companyCommissionOnBasicFreight: number;
  totalCommission: number;
}

/** One row of GET /shipments/vendor-audit — the Vendor Audit Report's per-branch
 *  reconciliation table. Mirrors backend `VendorAuditRowResponse`.
 *  `deliveryCommission`/`deliveryTotalCommission` are recomputed from the branch's
 *  *current* DRS rate — see the backend `VendorAuditRow` javadoc for why an older
 *  delivery's figure here can differ from what was actually credited. */
export interface VendorAuditRow {
  branchId: string;
  paidOrderCount: number;
  paidOrderQuantity: number;
  paidOrderAmount: number;
  topayOrderCount: number;
  topayOrderQuantity: number;
  topayOrderAmount: number;
  paidCommission: number;
  deliveryCommission: number;
  totalBookedOrderCount: number;
  totalDeliveredOrderCount: number;
  bookingTotalCommission: number;
  deliveryTotalCommission: number;
  odaCharges: number;
  otherCharges: number;
  cancelledOrderCount: number;
}

/** One row of GET /shipments/branch-performance — the Branch Performance Report's
 *  per-branch summary table. Mirrors backend `BranchPerformanceSummaryResponse`. */
export interface BranchPerformanceSummary {
  bookingBranchId: string;
  shipmentCount: number;
  deliveredCount: number;
  inTransitCount: number;
  returnedCount: number;
  cancelledCount: number;
  totalChargeableWeight: number;
  totalNetAmount: number;
}

/** Body of POST /shipments/{id}/documents — mirrors backend `AddShipmentDocumentRequest`. */
export interface AddShipmentDocumentRequest {
  documentType: ShipmentDocumentType;
  documentName: string;
  documentUrl: string;
  remarks?: string | null;
}

/**
 * The Pricing Engine (`com.courier.modules.pricing`) has no frontend of its own — see
 * MEMORY/modules/pricing-engine.md's own Definition of Done — so its request/response
 * shapes live here, next to the one caller that needs a live preview before booking: the
 * wizard's Step 3. Mirrors backend `PricingRequest`/`PricingResponse` one-to-one.
 */
export interface PricingRequest {
  bookingBranchId: string;
  /** No longer resolved or sent by Shipment Booking — a destination pincode has no
   *  delivery branch at booking any more (Load Sheet is where one gets assigned).
   *  Optional purely because the backend DTO still accepts one from other callers. */
  deliveryBranchId?: string | null;
  pickupPincode: string;
  deliveryPincode: string;
  serviceTypeId: string;
  /** No longer picked at Shipment Booking — see `CreateShipmentRequest`'s own doc.
   *  Optional purely because the backend DTO still accepts one from other callers. */
  packageTypeId?: string | null;
  paymentModeId: string;
  actualWeight: number;
  /** The shipment's real total actual weight, only when it differs from actualWeight
   *  above (this screen feeds actualWeight its already-computed chargeable weight, to
   *  skip the engine re-deriving it — see priceIt$()). Optional; falls back to
   *  actualWeight when omitted. Only a qty-level Applicable Charge (e.g. "Hamali") reads
   *  this, alongside numberOfPackages. */
  totalActualWeight?: number | null;
  /** Piece count. Optional, defaults to 1 — only matters for a qty-level Applicable
   *  Charge (e.g. "Hamali"), which slab-matches on totalActualWeight / this instead of
   *  chargeable weight, then multiplies the matched slab's value by this. */
  numberOfPackages?: number | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  declaredValue?: number | null;
  bookingDate?: string | null;
  discountPercentage?: number | null;
  discountAmount?: number | null;
  /** Only meaningful when this lane falls back to the Freight Factor grid — raises the
   *  matched cell's own factor. Must be >= the matched factor; a smaller value is refused. */
  freightFactorOverride?: number | null;
}

export interface ChargeBreakup {
  freight: number;
  fuelCharge: number;
  handlingCharge: number;
  odaCharge: number;
  insuranceCharge: number;
  /** Sum of ACTIVE charge-module rows (e.g. "Hamali") matched to this booking's service
   *  type and weight/distance — GST-inclusive, unlike appointmentDeliveryCharge. */
  applicableCharges: number;
  /** `applicableCharges` broken out by charge name. Empty when none is configured for
   *  this lane's service type. */
  applicableChargeLines: ApplicableChargeLine[];
  gstAmount: number;
  discount: number;
  roundOff: number;
  netAmount: number;
}

export interface PricingResponse {
  bookingBranchId: string;
  deliveryBranchId: string;
  matchedRouteId?: string | null;
  matchedRouteCode?: string | null;
  matchedRateId?: string | null;
  matchedRateCode?: string | null;
  matchedRateName?: string | null;
  actualWeight: number;
  volumetricWeight: number;
  chargeableWeight: number;
  weightUnit: string;
  /** The Freight Factor grid cell's own factor, or an accepted override of it — set only
   *  on the Freight Factor fallback (matchedRouteCode/matchedRateCode both null/absent). */
  appliedFreightFactor?: number | null;
  chargeBreakup: ChargeBreakup;
}

/**
 * Shipment Movement (V19) — Booking Branch -> Create Manifest (Loading Sheet Created) ->
 * Trip Hire Challan (THC) -> Delivery Branch -> In Scan -> Out For Delivery -> Delivered. Mirrors
 * `com.courier.modules.manifest`/`com.courier.modules.shipment`'s movement additions
 * one-to-one. See MEMORY/modules/shipment-movement.md.
 */

export type ManifestStatus = 'CREATED' | 'DISPATCHED' | 'COMPLETED';

/** Who is responsible for delivery — decided at Load Sheet creation, never at booking.
 *  `BRANCH_DELIVERY` (the original, only-ever-existing shape) has a real
 *  `deliveryBranchId`; `DIRECT_COMPANY_DELIVERY` has none — the company's own
 *  vehicle/driver, assigned at the same dispatch step, carries the shipment the rest of
 *  the way itself. */
export type DeliveryMode = 'BRANCH_DELIVERY' | 'DIRECT_COMPANY_DELIVERY';

/** Mirrors backend `ManifestResponse` — GET/POST /manifests. */
export interface Manifest {
  id: string;
  manifestNumber: string;
  bookingBranchId: string;
  /** Null only for `DIRECT_COMPANY_DELIVERY` — see `deliveryMode`. */
  deliveryBranchId: string | null;
  deliveryMode: DeliveryMode;
  /** The destination city this Load Sheet was created for — set only when it grouped
   *  shipments with no delivery branch resolved yet, matched by their own `toCity`. Null
   *  for a manifest created the old way (every shipment on it already had a real next-stop
   *  branch — a crossing hop, or a legacy row). */
  destinationCity?: string | null;
  vehicleId?: string | null;
  driverUserId?: string | null;
  status: ManifestStatus;
  dispatchedAt?: string | null;
  departureTime?: string | null;
  completedAt?: string | null;
  remarks?: string | null;
  fuelCost?: number | null;
  driverAdvance?: number | null;
  tollAmount?: number | null;
  otherAmount?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  version: number;
  shipmentCount: number;
  totalWeight: number;
  totalPackages: number;
}

/** Body of POST /manifests — mirrors backend `CreateManifestRequest`. */
export interface CreateManifestRequest {
  bookingBranchId: string;
  /** Required for BRANCH_DELIVERY, must be omitted/null for DIRECT_COMPANY_DELIVERY. */
  deliveryBranchId?: string | null;
  /** Null defaults to BRANCH_DELIVERY, the only mode that existed before this field. */
  deliveryMode?: DeliveryMode | null;
  /** The destination city this Load Sheet is being created for — required to attach a
   *  freshly BOOKED shipment with no delivery branch resolved yet; not needed when every
   *  shipment being attached already carries a real next-stop branch. */
  destinationCity?: string | null;
  shipmentIds: string[];
  remarks?: string | null;
  /** true when `deliveryBranchId` is a HUB this Load Sheet goes to first; the hub assigns
   *  the shipments' real delivery branch from its own Load Sheet. */
  hubTransfer?: boolean;
  /** Omit for a Load Sheet. MSRTC makes a branch-to-branch MSRTC manifest. */
  flowType?: FlowType;
}

/** GET /manifests/summary — the THC Report summary row. Mirrors backend
 *  `ManifestSummaryStatsResponse`. */
export interface ManifestSummaryStats {
  totalManifests: number;
  totalShipments: number;
  totalWeight: number;
  totalPackages: number;
  totalTripExpenses: number;
}

export interface ManifestSearchRequest {
  status?: ManifestStatus;
  bookingBranchId?: string;
  deliveryBranchId?: string;
  search?: string;
  /** Only manifests of this flow; omit for both. */
  flowType?: FlowType;
}

export type VehicleType = 'BIKE' | 'SCOOTER' | 'AUTO' | 'VAN' | 'PICKUP' | 'TRUCK' | 'TEMPO' | 'OTHER';
export type FuelType = 'PETROL' | 'DIESEL' | 'CNG' | 'EV' | 'OTHER';
export type VehicleStatus = 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'INACTIVE';

/** Mirrors backend `VehicleResponse` — the fleet Trip Hire Challan (THC)'s "Assign Vehicle" picker reads. */
export interface Vehicle {
  id: string;
  companyId: string;
  vehicleNumber: string;
  ownerName?: string | null;
  vehicleType: VehicleType;
  make?: string | null;
  model?: string | null;
  modelVariant?: string | null;
  series?: string | null;
  chassisNumber?: string | null;
  engineNumber?: string | null;
  dealerName?: string | null;
  fuelType?: FuelType | null;
  capacityKg?: number | null;
  currentOdometer?: number | null;
  purchaseDate?: string | null;
  registrationDate?: string | null;
  insuranceExpiry?: string | null;
  pucExpiry?: string | null;
  fitnessExpiry?: string | null;
  permitExpiry?: string | null;
  status: VehicleStatus;
  branchId?: string | null;
  remarks?: string | null;
  active: boolean;
  createdBy?: string | null;
  createdAt?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
  version: number;
}

export interface CreateVehicleRequest {
  vehicleNumber: string;
  ownerName?: string | null;
  vehicleType: VehicleType;
  make?: string | null;
  model?: string | null;
  modelVariant?: string | null;
  series?: string | null;
  chassisNumber?: string | null;
  engineNumber?: string | null;
  dealerName?: string | null;
  fuelType?: FuelType | null;
  capacityKg?: number | null;
  currentOdometer?: number | null;
  purchaseDate?: string | null;
  registrationDate?: string | null;
  insuranceExpiry?: string | null;
  pucExpiry?: string | null;
  fitnessExpiry?: string | null;
  permitExpiry?: string | null;
  branchId?: string | null;
  remarks?: string | null;
}

export interface UpdateVehicleRequest {
  vehicleNumber: string;
  ownerName?: string | null;
  vehicleType: VehicleType;
  make?: string | null;
  model?: string | null;
  modelVariant?: string | null;
  series?: string | null;
  chassisNumber?: string | null;
  engineNumber?: string | null;
  dealerName?: string | null;
  fuelType?: FuelType | null;
  capacityKg?: number | null;
  currentOdometer?: number | null;
  purchaseDate?: string | null;
  registrationDate?: string | null;
  insuranceExpiry?: string | null;
  pucExpiry?: string | null;
  fitnessExpiry?: string | null;
  permitExpiry?: string | null;
  status: VehicleStatus;
  branchId?: string | null;
  remarks?: string | null;
  version: number;
}

/** Bulk-operation per-item result — mirrors backend `MovementOutcomeResponse`. */
export interface MovementOutcome {
  reference: string;
  success: boolean;
  message?: string | null;
}

/** Mirrors backend `BulkMovementResponse` — In Scan/Out For Delivery both return this.
 *  `drsNumber` is only ever set on Out For Delivery's response — null for In Scan.
 *  `shortageTicketNumber` is only ever set on In Scan's response, and only when it was
 *  called with a non-empty `missingTrackingNumbers` — null otherwise. */
export interface BulkMovementResult {
  results: MovementOutcome[];
  successCount: number;
  failureCount: number;
  drsNumber: string | null;
  shortageTicketNumber: string | null;
}

/** Body of POST /shipment-movement/dispatch. */
export interface DispatchManifestRequest {
  manifestId: string;
  vehicleId: string;
  driverUserId: string;
  departureTime?: string | null;
  fuelCost?: number | null;
  driverAdvance?: number | null;
  tollAmount?: number | null;
  otherAmount?: number | null;
}

export interface DispatchManifestResponse {
  manifestId: string;
  manifestNumber: string;
  status: ManifestStatus;
  vehicleId: string;
  driverUserId: string;
  dispatchedAt?: string | null;
  departureTime?: string | null;
  shipmentCount: number;
  fuelCost?: number | null;
  driverAdvance?: number | null;
  tollAmount?: number | null;
  otherAmount?: number | null;
}

/** Body of POST /shipment-movement/in-scan. `manifestNumber` is descriptive only (a
 *  shortage ticket's subject/description); a non-empty `missingTrackingNumbers`
 *  auto-raises that ticket. */
export interface InScanRequest {
  receivingBranchId: string;
  trackingNumbers: string[];
  manifestNumber?: string | null;
  missingTrackingNumbers?: string[];
  /** Recorded on every received shipment's status-history row in place of the default
   *  "In scan" text. */
  remarks?: string | null;
  /** URL from ShipmentMovementService.uploadInScanPhoto(), attached as a shared photo
   *  asset to every shipment this call actually receives. */
  photoUrl?: string | null;
}

/** Body of POST /shipment-movement/out-for-delivery. vehicleId/fuelCost/deliveryCharge
 *  are all optional trip fields, same shape DispatchManifestRequest's own trip expenses
 *  use — stamped on every DeliveryAssignment row the call touches. */
export interface OutForDeliveryRequest {
  shipmentIds: string[];
  deliveryUserId: string;
  vehicleId?: string | null;
  fuelCost?: number | null;
  deliveryCharge?: number | null;
}

/** Body of POST /shipment-movement/deliver. */
export interface DeliverRequest {
  shipmentId: string;
  receiverName: string;
  remarks?: string | null;
  otp?: string | null;
  signatureUrl?: string | null;
  photoUrl?: string | null;
}

/** Body of POST /shipment-movement/{shipmentId}/override-status. Only the fields the
 *  chosen targetStatus actually needs matter — deliveryUserId for OUT_FOR_DELIVERY,
 *  receiverName for DELIVERED; everything else is ignored server-side for other targets.
 *  See `ShipmentService.overrideStatus`'s own doc for when a real side-effecting method
 *  runs vs. a raw no-side-effect status write. */
export interface OverrideStatusRequest {
  targetStatus: ShipmentStatus;
  reason: string;
  deliveryUserId?: string | null;
  vehicleId?: string | null;
  fuelCost?: number | null;
  deliveryCharge?: number | null;
  receiverName?: string | null;
  otp?: string | null;
  signatureUrl?: string | null;
  photoUrl?: string | null;
}

/** Mirrors backend `OverrideStatusResponse` — `warning` is non-null only when no real
 *  service method covered the jump, so no money/wallet/POD side effect ran for it. */
export interface OverrideStatusResponse {
  shipment: ShipmentResponse;
  viaRealMethod: boolean;
  warning: string | null;
}

/** One step of GET /shipments/{id}/timeline — mirrors backend `TimelineStepResponse`. */
export interface TimelineStep {
  status: ShipmentStatus;
  label: string;
  changedAt?: string | null;
  changedBy?: string | null;
  completed: boolean;
}

/** One row of GET /shipment-movement/drs — a DRS "run" (delivery user + delivery branch +
 *  calendar day), grouped server-side from `DeliveryAssignment` rows. There is no separate
 *  DRS/batch table — see `MEMORY/modules/shipment-movement.md`. Mirrors `DrsSummaryResponse`. */
export interface DrsSummary {
  deliveryUserId: string;
  deliveryBranchId: string;
  runDate: string;
  drsNumber: string | null;
  shipmentCount: number;
  deliveredCount: number;
  pendingCount: number;
}

/** One shipment row of GET /shipment-movement/drs/detail — mirrors `DrsShipmentRowResponse`. */
export interface DrsShipmentRow {
  shipmentId: string;
  shipmentNumber: string;
  trackingNumber: string;
  receiverName: string;
  receiverAddress: string;
  receiverContact: string;
  paymentModeId: string;
  netAmount: number | null;
  status: ShipmentStatus;
  deliveredAt?: string | null;
  /** The shipment's E-Way Bill number, null where none exists or Part-A hasn't
   *  succeeded yet. */
  ewayBillNumber?: string | null;
  /** The booking branch's own city. */
  fromCity?: string | null;
  /** The destination pincode/area's resolved city. */
  toCity?: string | null;
}

/** Body of GET /shipment-movement/drs/detail — mirrors `DrsDetailResponse`. */
export interface DrsDetail {
  deliveryUserId: string;
  deliveryBranchId: string;
  runDate: string;
  drsNumber: string | null;
  shipments: DrsShipmentRow[];
}

/** Admin-side PAID / TO_PAY switch state for one BOOKED shipment — see
 *  `GET /shipments/{id}/payment-mode`. */
export interface PaymentModeTarget {
  id: string;
  name: string;
  /** DEBIT = switching to a collect-at-booking mode (wallet debited); CREDIT = back to To-Pay. */
  direction: 'DEBIT' | 'CREDIT';
  netAmount: number;
  walletAmount: number;
  sufficientBalance: boolean;
}

export interface PaymentModeChange {
  currentModeId: string;
  currentModeName: string;
  changeable: boolean;
  currentNetAmount: number | null;
  walletBalance: number;
  changed: boolean;
  changedFromModeName: string | null;
  changedAt: string | null;
  targets: PaymentModeTarget[];
}
