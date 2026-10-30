/**
 * Pickup-Delivery Partner (PDP) rate cards — mirrors backend `com.courier.modules.pdp`
 * (`PdpRateDtos`). A partner is a Branch of type PICKUP_DELIVERY_PARTNER; its pickup and
 * delivery rate cards say what the PARTNER is paid, independent of the customer's freight.
 */

export type PdpRateType = 'PICKUP' | 'DELIVERY';
export type PdpRateStatus = 'ACTIVE' | 'INACTIVE';

export interface PdpRateSlab { id?: string; minWeight: number; maxWeight: number | null; ratePerKg: number; }

export interface PdpRate {
  id: string;
  branchId: string;
  branchCode?: string | null;
  branchName?: string | null;
  rateType: PdpRateType;
  /** Null = every district. */
  districtId?: string | null;
  minChargeableWeight: number;
  mathadiCharge: number;
  odaCharge: number;
  failedAttemptFee: number;
  returnFee: number;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  status: PdpRateStatus;
  slabs: PdpRateSlab[];
  createdDate?: string | null;
  updatedDate?: string | null;
  version: number;
}

export interface SavePdpRateRequest {
  branchId?: string;
  rateType?: PdpRateType;
  districtId?: string | null;
  minChargeableWeight: number | null;
  mathadiCharge: number | null;
  odaCharge: number | null;
  failedAttemptFee: number | null;
  returnFee: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  slabs: PdpRateSlab[];
  version?: number | null;
}

export interface CalculatePdpRateRequest {
  branchId: string;
  rateType: PdpRateType;
  districtId?: string | null;
  actualWeight: number;
  odaApplicable: boolean;
}

export interface CalculatePdpRateResponse {
  rateId: string;
  rateType: PdpRateType;
  actualWeight: number;
  chargeableWeight: number;
  ratePerKg: number;
  weightCharge: number;
  mathadiCharge: number;
  odaCharge: number;
  total: number;
}

// ---- Pickup requests (backend `com.courier.modules.pickup`) ------------------------------

export type PickupStatus =
  'REQUESTED' | 'ASSIGNED' | 'ACCEPTED' | 'OUT_FOR_PICKUP' | 'PICKED_UP' | 'BOOKED' | 'FAILED' | 'CANCELLED';

export interface PickupRequest {
  id: string;
  pickupNo: string;
  status: PickupStatus;
  customerId?: string | null;
  contactName: string;
  contactMobile: string;
  addressLine: string;
  city?: string | null;
  districtId?: string | null;
  pincode: string;
  expectedParcels: number;
  expectedWeightKg?: number | null;
  preferredDate?: string | null;
  preferredSlot?: string | null;
  remarks?: string | null;
  pdpBranchId?: string | null;
  pdpBranchCode?: string | null;
  pdpBranchName?: string | null;
  assignedAt?: string | null;
  acceptedAt?: string | null;
  startedAt?: string | null;
  pickedUpAt?: string | null;
  actualParcels?: number | null;
  actualWeightKg?: number | null;
  rejectReason?: string | null;
  failReason?: string | null;
  cancelReason?: string | null;
  shipmentId?: string | null;
  shipmentNo?: string | null;
  /** The branch this pickup belongs to (its pincode is mapped to it); it assigns the pickup. */
  bookingBranchId?: string | null;
  bookingBranchCode?: string | null;
  bookingBranchName?: string | null;
  createdDate?: string | null;
  updatedDate?: string | null;
  version: number;
}

export interface SavePickupRequest {
  contactName: string;
  contactMobile: string;
  addressLine: string;
  city?: string | null;
  pincode: string;
  expectedParcels: number | null;
  expectedWeightKg: number | null;
  preferredDate: string | null;
  preferredSlot: string | null;
  remarks: string | null;
  pdpBranchId?: string | null;
  version?: number | null;
}

export interface PickupStats { byStatus: Record<PickupStatus, number>; open: number; }

export const PICKUP_STATUS_LABEL: Record<PickupStatus, string> = {
  REQUESTED: 'Requested', ASSIGNED: 'Assigned', ACCEPTED: 'Accepted', OUT_FOR_PICKUP: 'Out for pickup',
  PICKED_UP: 'Picked up', BOOKED: 'Booked', FAILED: 'Failed', CANCELLED: 'Cancelled'
};

// ---- Earnings and billing statements (backend `PdpBillingDtos`) ---------------------------

export type PdpEarningStatus = 'ACCRUED' | 'UNRATED' | 'BILLED' | 'REVERSED';
export type PdpStatementStatus = 'DRAFT' | 'APPROVED' | 'PAID';

export interface PdpEarning {
  id: string;
  branchId: string;
  branchCode?: string | null;
  branchName?: string | null;
  earningType: PdpRateType;
  sourceId: string;
  referenceNo: string;
  earnedOn: string;
  status: PdpEarningStatus;
  pincode?: string | null;
  districtId?: string | null;
  actualWeightKg?: number | null;
  chargeableWeightKg?: number | null;
  ratePerKg?: number | null;
  weightCharge: number;
  mathadiCharge: number;
  odaCharge: number;
  totalAmount: number;
  remark?: string | null;
  statementId?: string | null;
}

export interface PdpStatement {
  id: string;
  statementNo: string;
  branchId: string;
  branchCode?: string | null;
  branchName?: string | null;
  periodFrom: string;
  periodTo: string;
  status: PdpStatementStatus;
  pickupCount: number;
  deliveryCount: number;
  pickupTotal: number;
  deliveryTotal: number;
  netPayable: number;
  approvedAt?: string | null;
  paidOn?: string | null;
  paymentRef?: string | null;
  remarks?: string | null;
  createdDate?: string | null;
  version: number;
}

export interface PdpStatementDetail { statement: PdpStatement; lines: PdpEarning[]; unratedInPeriod: number; }

export type PdpBillingFrequency = 'WEEKLY' | 'FIFTEEN_DAYS' | 'MONTHLY';

/** One partner's billing frequency and what is waiting to be statemented. */
export interface PdpBillingSchedule {
  branchId: string;
  branchCode: string;
  branchName: string;
  frequency: PdpBillingFrequency;
  lastBilledTo?: string | null;
  unbilledEarnings: number;
  dueFrom?: string | null;
  dueTo?: string | null;
  due: boolean;
}
