/**
 * Master data — the twelve reference lists a company configures before it can book
 * anything. Mirrors `com.courier.modules.master` one for one.
 *
 * Every row shares the same head (code / name / description / status / displayOrder plus
 * audit and version), which is what lets one set of screens serve all twelve. Each list's
 * own fields extend {@link MasterRecord}.
 */

export type MasterStatus = 'ACTIVE' | 'INACTIVE';

export type WeightUnit = 'KG' | 'GRAM' | 'POUND';

export type DistanceUnit = 'KM';

/** The head every master row carries. */
export interface MasterRecord {
  id: string;
  companyId: string;
  code: string;
  name: string;
  description: string | null;
  status: MasterStatus;
  displayOrder: number;

  createdBy: string | null;
  createdDate: string | null;
  updatedBy: string | null;
  updatedDate: string | null;
  version: number;

  /** Anything a particular list adds. Typed per interface below; indexed for the shared screens. */
  [extra: string]: unknown;
}

// --- geography ---------------------------------------------------------------

export interface Country extends MasterRecord {
  isoCode2: string | null;
  isoCode3: string | null;
  dialCode: string | null;
  currencyCode: string | null;
}

export interface State extends MasterRecord {
  countryId: string;
  /** Resolved by the backend from the parent row — null when it could not be read. */
  countryName: string | null;
  gstStateCode: string | null;
}

export interface District extends MasterRecord {
  stateId: string;
  stateName: string | null;
}

export interface City extends MasterRecord {
  districtId: string;
  districtName: string | null;
  metro: boolean;
  cityTier: string | null;
}

export interface Area extends MasterRecord {
  cityId: string;
  cityName: string | null;
}

export interface Pincode extends MasterRecord {
  areaId: string;
  areaName: string | null;
  districtId: string | null;
  districtName: string | null;
  stateId: string | null;
  stateName: string | null;
  serviceable: boolean;
  codAvailable: boolean;
  prepaidAvailable: boolean;
  pickupAvailable: boolean;
  zone: string | null;
  odaApplicable: boolean;
}

/** `GET /global-masters/pincodes/{id}/areas` — one Area a pincode's postal record names,
 *  with its own ODA setting. `primary` marks the row matching the pincode's own `areaId`. */
export interface PincodeAreaRow {
  id: string;
  areaId: string;
  areaName: string | null;
  cityName: string | null;
  primary: boolean;
  odaApplicable: boolean;
  odaAmount: number | null;
  /** This area can be booked to (the pincode itself must be serviceable too). */
  serviceable: boolean;
}

/** `GET /global-masters/pincodes/lookup/{code}` — the Area (and its ancestor chain)
 *  auto-resolved from the postal directory for a raw pincode. `matched: false` means the
 *  directory has no record of it, not an error. */
/** `GET /global-masters/pincodes/{code}/geo` — read-only Area/City/District already on
 *  file for a pincode. `matched: false` means no pincode with this code is on file, not
 *  an error. Unlike `PincodeAreaLookup`, this never calls the postal directory or creates
 *  a row, so it is readable by any authenticated company user. */
export interface PincodeGeo {
  matched: boolean;
  areaName: string | null;
  cityName: string | null;
  districtName: string | null;
  stateName?: string | null;
}

export interface PincodeAreaLookup {
  matched: boolean;
  areaId: string | null;
  areaName: string | null;
  cityName: string | null;
  districtName: string | null;
  stateName: string | null;
  countryName: string | null;
  postOfficeName: string | null;
  alternateCount: number;
  /** Every Area this pincode will link once saved — the same rows the detail page's
   *  "Areas served" card shows after creation, primary first. Preview only: nothing here
   *  is saved until the pincode itself is. */
  areas: PincodeAreaPreview[];
}

export interface PincodeAreaPreview {
  areaId: string;
  areaName: string | null;
  cityName: string | null;
  primary: boolean;
}

// --- catalogues --------------------------------------------------------------

export interface VehicleType extends MasterRecord {
  capacityKg: number | null;
  capacityCft: number | null;
  wheelCount: number | null;
  requiresPermit: boolean;
}

export interface PackageType extends MasterRecord {
  documentType: boolean;
  fragileByDefault: boolean;
  maxWeightKg: number | null;
  defaultLengthCm: number | null;
  defaultWidthCm: number | null;
  defaultHeightCm: number | null;
}

export interface ServiceType extends MasterRecord {
  deliveryDays: number | null;
  express: boolean;
  cutoffTime: string | null;
  priority: number;
  /** cm3-per-kg divisor of L×W×H for this service; null = the default 5000. */
  volumetricDivisor?: number | null;
}

export interface PaymentMode extends MasterRecord {
  collectAtBooking: boolean;
  collectAtDelivery: boolean;
  requiresCreditAccount: boolean;
  cashOnDelivery: boolean;
}

/** Half-open band: `[minWeight, maxWeight)`. A 1 kg parcel falls in 1-5, not 0-1. */
export interface WeightSlab extends MasterRecord {
  minWeight: number;
  maxWeight: number;
  weightUnit: WeightUnit;
}

export interface Route extends MasterRecord {
  bookingBranchId: string;
  bookingBranchName: string | null;
  deliveryBranchId: string;
  deliveryBranchName: string | null;
  distanceKm: number | null;
  distanceUnit: DistanceUnit;
  transitDays: number;
  transitHours: number;
  via: string | null;
}

// --- bootstrap ---------------------------------------------------------------

/** What `POST /master/bootstrap` did, per list. A second run reports everything skipped. */
export interface MasterBootstrapResult {
  created: Record<string, number>;
  skipped: Record<string, number>;
}

/** An option in a parent picker: the active rows of another master. */
export interface MasterOption {
  value: string;
  label: string;
}

export const MASTER_STATUSES: readonly MasterStatus[] = ['ACTIVE', 'INACTIVE'];
export const WEIGHT_UNITS: readonly WeightUnit[] = ['KG', 'GRAM', 'POUND'];
export const DISTANCE_UNITS: readonly DistanceUnit[] = ['KM'];
export const CITY_TIERS = ['TIER_1', 'TIER_2', 'TIER_3', 'TIER_4'] as const;
