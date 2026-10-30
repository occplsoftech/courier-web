/**
 * Business Customer pricing — mirrors backend `com.courier.modules.customerpricing`
 * (`PricingZoneDtos` / `CustomerRateDtos`) one-to-one. A pricing zone belongs to one
 * customer and groups districts/cities; a zone has at most one rate card (header charges
 * plus per-kg weight slabs).
 */

export type ZoneStatus = 'ACTIVE' | 'INACTIVE';

export interface ZoneLocation {
  id: string;
  districtId: string;
  districtName?: string | null;
  /** Null = the whole district. */
  cityId?: string | null;
  cityName?: string | null;
}

export interface PricingZone {
  id: string;
  customerId: string;
  customerName?: string | null;
  zoneName: string;
  description?: string | null;
  status: ZoneStatus;
  hasRate: boolean;
  locations: ZoneLocation[];
  createdDate?: string | null;
  updatedDate?: string | null;
  version: number;
}

export interface LocationRequest { districtId: string; cityId?: string | null; }

export interface CreateZoneRequest {
  customerId: string;
  zoneName: string;
  description?: string | null;
  locations?: LocationRequest[];
}

export interface UpdateZoneRequest { zoneName: string; description?: string | null; version: number; }

export interface RateSlab {
  id?: string;
  minWeight: number;
  /** Null = no upper bound (only the last slab). */
  maxWeight?: number | null;
  ratePerKg: number;
}

export interface CustomerRate {
  id: string;
  zoneId: string;
  zoneName: string;
  customerId: string;
  customerName?: string | null;
  minChargeableWeight: number;
  docketCharge: number;
  mathadiCharge: number;
  packCharge: number;
  odaCharge: number;
  fuelSurchargePercent: number;
  fovPercent: number;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  status: ZoneStatus;
  /** The service type (AIR, SURFACE...) this card prices; null is the card for every service. */
  serviceTypeId?: string | null;
  serviceTypeCode?: string | null;
  serviceTypeName?: string | null;
  slabs: RateSlab[];
  createdDate?: string | null;
  updatedDate?: string | null;
  version: number;
}

/** Body of PUT /customer-rates/zone/{zoneId}; `version` only when a rate card already exists. */
export interface SaveRateRequest {
  minChargeableWeight?: number | null;
  docketCharge?: number | null;
  mathadiCharge?: number | null;
  packCharge?: number | null;
  odaCharge?: number | null;
  fuelSurchargePercent?: number | null;
  fovPercent?: number | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  slabs: RateSlab[];
  version?: number | null;
}

export interface CalculateRateRequest {
  customerId: string;
  districtId: string;
  cityId?: string | null;
  actualWeight: number;
  declaredValue?: number | null;
  odaApplicable: boolean;
  bookingDate?: string | null;
  serviceTypeId?: string | null;
}

export interface CalculateRateResponse {
  zoneId: string;
  zoneName: string;
  actualWeight: number;
  chargeableWeight: number;
  ratePerKg: number;
  freight: number;
  docketCharge: number;
  mathadiCharge: number;
  packCharge: number;
  odaCharge: number;
  fuelSurcharge: number;
  fovCharge: number;
  total: number;
}

/** Mirrors backend `BusinessCustomerDashboard` (GET /business-customers/dashboard). */
export interface BusinessDashboard {
  totals: {
    customers: number; activeCustomers: number; inactiveCustomers: number;
    bookingsThisMonth: number; bookingsTotal: number;
    totalQuantity: number; totalWeight: number; totalBusiness: number; paymentPending: number;
  };
  byPaymentMode: Record<string, number>;
  byBillingFrequency: Record<string, number>;
  customers: Array<{
    customerId: string; customerCode: string; displayName: string; mobile: string; status: string;
    paymentMode: string; billingFrequency: string;
    bookingsThisMonth: number; bookingsTotal: number;
    quantity: number; weight: number; businessAmount: number; pendingAmount: number; lastBookingAt?: string | null;
  }>;
}
