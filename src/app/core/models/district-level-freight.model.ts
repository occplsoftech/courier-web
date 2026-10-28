/**
 * District Level Freight models — mirror the backend `com.courier.modules.districtfreight`
 * module one-to-one. Rate setup: From Station (a branch) + Destination District + six
 * fixed weight-slab per-KG rates + a configurable ODA charge, plus the `/calculate`
 * live-preview endpoint Shipment Booking's own Freight Calculation section calls — the
 * same calculation the backend re-verifies authoritatively at Confirm Booking. No mock
 * shapes; every field is returned by, or accepted by, an endpoint.
 */

export type DistrictFreightStatus = 'ACTIVE' | 'INACTIVE';
export const DISTRICT_FREIGHT_STATUSES: DistrictFreightStatus[] = ['ACTIVE', 'INACTIVE'];

/** The six fixed weight slabs, in order — used to drive the form/table so the labels
 *  live in exactly one place. */
export const WEIGHT_SLABS: { key: WeightSlabKey; label: string }[] = [
  { key: 'rate1To15', label: '1 - 15 KG' },
  { key: 'rate16To50', label: '16 - 50 KG' },
  { key: 'rate51To100', label: '51 - 100 KG' },
  { key: 'rate101To1000', label: '101 - 1000 KG' },
  { key: 'rate1001To1500', label: '1001 - 1500 KG' },
  { key: 'rate1501To2000', label: '1501 - 2000 KG' }
];

export type WeightSlabKey =
  | 'rate1To15' | 'rate16To50' | 'rate51To100'
  | 'rate101To1000' | 'rate1001To1500' | 'rate1501To2000';

/** Full representation — mirrors backend `DistrictLevelFreightResponse`. Used for both
 *  the list (server-resolved branch/district labels included) and the detail view. */
export interface DistrictLevelFreight {
  id: string;
  companyId: string;
  branchId: string;
  branchCode: string | null;
  branchName: string | null;
  districtId: string;
  districtCode: string | null;
  districtName: string | null;
  rate1To15: number;
  rate16To50: number;
  rate51To100: number;
  rate101To1000: number;
  rate1001To1500: number;
  rate1501To2000: number;
  odaApplicable: boolean;
  odaCharge: number;
  status: DistrictFreightStatus;
  createdBy?: string | null;
  createdDate?: string | null;
  updatedBy?: string | null;
  updatedDate?: string | null;
  version: number;
}

/** Fields shared by create and update. */
export interface DistrictLevelFreightFields {
  branchId: string;
  districtId: string;
  rate1To15: number;
  rate16To50: number;
  rate51To100: number;
  rate101To1000: number;
  rate1001To1500: number;
  rate1501To2000: number;
  odaApplicable: boolean;
  odaCharge: number;
}

/** Body of POST /district-level-freight. A new row always starts ACTIVE. */
export type CreateDistrictLevelFreightRequest = DistrictLevelFreightFields;

/** Body of PUT /district-level-freight/{id}. */
export interface UpdateDistrictLevelFreightRequest extends DistrictLevelFreightFields {
  version: number;
}

/** Query params of GET /district-level-freight. No free-text search — station/district
 *  filtering is these two id lists, driven by the same picker dropdowns the form uses. */
export interface DistrictLevelFreightSearchRequest {
  branchId?: string[];
  districtId?: string[];
  status?: DistrictFreightStatus[];
}

export interface ImportRowResult {
  rowNumber: number;
  fromStation: string;
  district: string;
  outcome: 'WOULD_CREATE' | 'WOULD_UPDATE' | 'CREATED' | 'UPDATED' | 'ERROR';
  message: string | null;
}

export interface ImportSummaryResponse {
  dryRun: boolean;
  totalDataRows: number;
  succeeded: number;
  failed: number;
  rows: ImportRowResult[];
}

/** Body of POST /district-level-freight/calculate. */
export interface FreightCalculationRequest {
  bookingBranchId: string;
  destinationPincode: string;
  /** The specific Area of destinationPincode picked from its Area dropdown, if any —
   *  resolves District/ODA off that exact pincode-area link. */
  destinationAreaId?: string | null;
  chargeableWeight: number;
  /** A Business Customer — when it has an ACTIVE pricing zone covering the destination,
   *  freight is priced from that zone's rate card instead. */
  businessCustomerId?: string | null;
  /** Basis of the zone rate's FOV %. */
  declaredValue?: number | null;
  /** With both set, a zone tariff covering the booking branch's pincode prices the freight
   *  (after a Business Customer's own zone). */
  serviceTypeId?: string | null;
  packageTypeId?: string | null;
  /** Pieces, for per-piece tariff charges. */
  numberOfPackages?: number | null;
  /** Picks the tariff rate card valid on that date; today when empty. */
  bookingDate?: string | null;
}

/** Mirrors backend `FreightCalculationResponse` — every field Shipment Booking's own
 *  Freight Calculation card displays. `totalFreight = baseFreight + odaCharge`. */
export interface FreightCalculationResponse {
  matchedFreightId: string;
  bookingBranchId: string;
  bookingBranchCode: string;
  bookingBranchName: string;
  districtId: string;
  districtCode: string;
  districtName: string;
  destinationPincode: string;
  /** The destination pincode/area's resolved city — shown at booking instead of a
   *  Delivery Branch picker. */
  destinationCityName: string | null;
  chargeableWeight: number;
  weightSlabLabel: string;
  ratePerKg: number;
  baseFreight: number;
  odaApplicable: boolean;
  odaCharge: number;
  totalFreight: number;
  /** Set when a Business Customer pricing zone priced the booking ("Zone tariff CODE: FROM → TO" when the
   *  company zone tariff did); `weightSlabLabel` then names the zone or how the freight was worked out. */
  customerZoneName?: string | null;
  /** Zone rate's docket + mathadi + pack + fuel + FOV (or the tariff's charges) — the minimum Other Charges. */
  customerExtraCharges?: number;
}
