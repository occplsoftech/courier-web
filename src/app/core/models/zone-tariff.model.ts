/** Zone tariff (backend module `tariff`): company zones, rate cards with weight slabs and charges, and quotes. */

export type ZoneUsage = 'FROM' | 'TO' | 'BOTH';
export type TariffZoneStatus = 'ACTIVE' | 'INACTIVE';
export type LocationScope = 'STATE' | 'DISTRICT' | 'CITY' | 'PINCODE';
export type TariffStatus = 'ACTIVE' | 'INACTIVE';
export type SlabRateType = 'FIXED' | 'PER_EXTRA_KG';
export type TotalRounding = 'NONE' | 'NEAREST_RUPEE' | 'UP_RUPEE';
export type ChargeAppliesWhen = 'ALWAYS' | 'COD_ONLY' | 'ODA_ONLY';
export type ChargeCalcMethod = 'FLAT' | 'PERCENT_OF_FREIGHT' | 'PER_KG' | 'PER_PIECE' | 'PERCENT_OF_VALUE';

export const ZONE_USAGE_LABELS: Record<ZoneUsage, string> = {
  FROM: 'From (shipments start here)', TO: 'To (shipments delivered here)', BOTH: 'Both'
};
export const SCOPE_LABELS: Record<LocationScope, string> = {
  STATE: 'State', DISTRICT: 'District', CITY: 'City', PINCODE: 'Pincode'
};
export const ROUNDING_LABELS: Record<TotalRounding, string> = {
  NONE: 'No rounding', NEAREST_RUPEE: 'Nearest rupee', UP_RUPEE: 'Up to the next rupee'
};
export const APPLIES_LABELS: Record<ChargeAppliesWhen, string> = {
  ALWAYS: 'Always', COD_ONLY: 'Only for COD', ODA_ONLY: 'Only for ODA pincodes'
};
export const CALC_LABELS: Record<ChargeCalcMethod, string> = {
  FLAT: 'Flat amount', PERCENT_OF_FREIGHT: '% of freight', PER_KG: 'Per kg', PER_PIECE: 'Per piece',
  PERCENT_OF_VALUE: '% of declared value'
};

export interface TariffLocation {
  id: string | null;
  scope: LocationScope;
  /** "Mumbai, Mumbai district, Maharashtra", "Kerala", "400001 (Mumbai)". */
  label: string;
  stateId: string | null; stateName: string | null;
  districtId: string | null; districtName: string | null;
  cityId: string | null; cityName: string | null;
  pincode: string | null;
}

export interface TariffZone {
  id: string;
  code: string;
  name: string;
  usage: ZoneUsage;
  description: string | null;
  displayOrder: number;
  status: TariffZoneStatus;
  locationCount: number;
  /** Empty in lists; filled when one zone is fetched. */
  locations: TariffLocation[];
  createdDate: string;
  updatedDate: string;
  version: number;
}

/** Only the id for the scope is needed: STATE stateId, DISTRICT districtId, CITY cityId, PINCODE pincode. */
export interface TariffLocationRequest {
  scope: LocationScope;
  stateId?: string | null;
  districtId?: string | null;
  cityId?: string | null;
  pincode?: string | null;
}

export interface TariffZoneRequest {
  code: string;
  name: string;
  usage: ZoneUsage;
  description: string | null;
  displayOrder: number | null;
}

export interface CreateTariffZoneRequest extends TariffZoneRequest { locations: TariffLocationRequest[]; }
export interface UpdateTariffZoneRequest extends TariffZoneRequest { version: number; }

/** `zone` is null when no active zone covers the pincode for that direction. */
export interface ZoneResolution {
  pincode: string;
  direction: ZoneUsage;
  place: TariffLocation | null;
  zone: TariffZone | null;
  matchedBy: TariffLocation | null;
}

export interface RateSlab {
  id?: string;
  weightFromKg: number;
  weightToKg: number;
  rateType: SlabRateType;
  rate: number;
  /** PER_EXTRA_KG only; 1 kg when empty. */
  stepKg: number | null;
}

/** Every slab of one to zone × service type × package type. */
export interface RateLane {
  toZoneId: string; toZoneCode: string | null;
  serviceTypeId: string; serviceTypeCode: string | null;
  packageTypeId: string; packageTypeCode: string | null;
  slabs: RateSlab[];
}

export interface TariffCharge {
  id: string;
  code: string;
  name: string;
  toZoneId: string | null; toZoneCode: string | null;
  serviceTypeId: string | null; serviceTypeCode: string | null;
  packageTypeId: string | null; packageTypeCode: string | null;
  appliesWhen: ChargeAppliesWhen;
  calcMethod: ChargeCalcMethod;
  value: number;
  minAmount: number | null;
  maxAmount: number | null;
  taxable: boolean;
  displayOrder: number;
  status: TariffStatus;
}

export interface RateCard {
  id: string;
  code: string;
  name: string;
  fromZoneId: string;
  fromZoneCode: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  gstPercent: number;
  volumetricDivisor: number | null;
  totalRounding: TotalRounding;
  description: string | null;
  status: TariffStatus;
  laneCount: number;
  chargeCount: number;
  /** Empty in lists. */
  lanes: RateLane[];
  charges: TariffCharge[];
  createdDate: string;
  updatedDate: string;
  version: number;
}

export interface RateCardRequest {
  code: string;
  name: string;
  fromZoneId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  gstPercent: number | null;
  volumetricDivisor: number | null;
  totalRounding: TotalRounding;
  description: string | null;
  version?: number | null;
}

export interface LaneRequest {
  toZoneId: string;
  serviceTypeId: string;
  packageTypeId: string;
  slabs: RateSlab[];
}

export interface ChargeRequest {
  code: string;
  name: string;
  toZoneId: string | null;
  serviceTypeId: string | null;
  packageTypeId: string | null;
  appliesWhen: ChargeAppliesWhen;
  calcMethod: ChargeCalcMethod;
  value: number;
  minAmount: number | null;
  maxAmount: number | null;
  taxable: boolean;
  displayOrder: number | null;
  status: TariffStatus;
}

export interface QuoteRequest {
  originPincode: string;
  destinationPincode: string;
  serviceTypeId: string;
  packageTypeId: string;
  actualWeightKg: number;
  lengthCm: number | null; widthCm: number | null; heightCm: number | null;
  pieces: number | null;
  declaredValue: number | null;
  cod: boolean;
  bookingDate: string | null;
}

export interface QuoteZone { id: string; code: string; name: string; matchedBy: string; }

export interface QuoteResponse {
  rateCardId: string;
  rateCardCode: string;
  fromZone: QuoteZone;
  toZone: QuoteZone;
  serviceTypeCode: string;
  packageTypeCode: string;
  oda: boolean;
  actualWeightKg: number;
  volumetricWeightKg: number | null;
  chargeableWeightKg: number;
  freight: number;
  freightBasis: string;
  charges: { code: string; name: string; amount: number; taxable: boolean; basis: string }[];
  taxableAmount: number;
  taxes: { code: string; percent: number; amount: number }[];
  taxTotal: number;
  nonTaxableAmount: number;
  roundOff: number;
  total: number;
}
