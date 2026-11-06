import { Injectable, inject } from '@angular/core';
import { map } from 'rxjs/operators';
import { ApiService } from '@core/services/api.service';
import { API } from '@core/config/api-endpoints';
import {
  BulkMovementResult, DispatchManifestRequest, DispatchManifestResponse,
  InScanRequest, OutForDeliveryRequest, DeliverRequest, ShipmentResponse,
  DrsSummary, DrsDetail, OverrideStatusRequest, OverrideStatusResponse
} from '@core/models/shipment.model';
import { UserService, Lookup } from '@features/users/user.service';

/**
 * Dispatch -> In Scan -> Out For Delivery -> Deliver — talks to
 * /api/v1/shipment-movement, mirroring ShipmentMovementController one-to-one. No mock data.
 * Loading Sheet is no longer a separate step (V20, on direct request) — adding a shipment to
 * a manifest already is "loading sheet created"; see ManifestService.create.
 */
@Injectable({ providedIn: 'root' })
export class ShipmentMovementService {
  private readonly api = inject(ApiService);
  private readonly users = inject(UserService);

  dispatch(body: DispatchManifestRequest) {
    return this.api.post<DispatchManifestResponse>(`${API.shipmentMovement}/dispatch`, body);
  }
  /** Sends a 6-digit OTP to the assigned driver's mobile — must be verified before
   *  `dispatch()` accepts that driver. */
  requestDispatchOtp(manifestId: string, driverUserId: string) {
    return this.api.post<{ maskedMobile: string; expiresInMinutes: number }>(
      `${API.shipmentMovement}/dispatch-otp/request`, { manifestId, driverUserId });
  }
  verifyDispatchOtp(manifestId: string, driverUserId: string, otp: string) {
    return this.api.post<void>(`${API.shipmentMovement}/dispatch-otp/verify`, { manifestId, driverUserId, otp });
  }
  inScan(body: InScanRequest) {
    return this.api.post<BulkMovementResult>(`${API.shipmentMovement}/in-scan`, body);
  }
  /** Uploads a photo taken while receiving shipments (not tied to any one shipment yet) —
   *  pass the returned URL into inScan()'s photoUrl. */
  uploadInScanPhoto(file: File) {
    const body = new FormData();
    body.append('file', file);
    return this.api.post<{ url: string }>(`${API.shipmentMovement}/in-scan-upload`, body);
  }
  outForDelivery(body: OutForDeliveryRequest) {
    return this.api.post<BulkMovementResult>(`${API.shipmentMovement}/out-for-delivery`, body);
  }
  /** Sends a 4-digit OTP to the delivery user's mobile — same optional-verification
   *  pattern as the driver dispatch OTP; does not gate outForDelivery(). */
  requestDeliveryOtp(deliveryUserId: string) {
    return this.api.post<{ maskedMobile: string; expiresInMinutes: number }>(
      `${API.shipmentMovement}/delivery-otp/request`, { deliveryUserId });
  }
  verifyDeliveryOtp(deliveryUserId: string, otp: string) {
    return this.api.post<void>(`${API.shipmentMovement}/delivery-otp/verify`, { deliveryUserId, otp });
  }
  /** A delivery attempt failed: the shipment goes back to the branch with the reason. */
  markUndelivered(shipmentId: string, reason: string, note: string | null) {
    return this.api.post<ShipmentResponse>(`${API.shipmentMovement}/${shipmentId}/undelivered`, { reason, note });
  }

  deliver(body: DeliverRequest) {
    return this.api.post<ShipmentResponse>(`${API.shipmentMovement}/deliver`, body);
  }

  /** Opt-in per company (Company Settings > Shipment > Manual Status Override).
   *  COMPANY_ADMIN/BRANCH_MANAGER only — see backend `ShipmentService.overrideStatus`'s
   *  own doc for when a real side-effecting method runs vs. a raw status write. */
  overrideStatus(shipmentId: string, body: OverrideStatusRequest) {
    return this.api.post<OverrideStatusResponse>(
      `${API.shipmentMovement}/${shipmentId}/override-status`, body);
  }

  /** Uploads one POD file (photo or signature capture) to the configured object store and
   *  returns its URL — pass that straight into deliver()'s signatureUrl/photoUrl. */
  uploadPodFile(shipmentId: string, file: File, kind: 'PHOTO' | 'SIGNATURE') {
    const body = new FormData();
    body.append('file', file);
    body.append('kind', kind);
    return this.api.post<{ url: string }>(`${API.shipmentMovement}/${shipmentId}/pod-upload`, body);
  }

  /** DRS Report list — one row per delivery user + delivery branch + calendar day.
   *  from/to default to the trailing 30 days server-side when omitted. deliveryBranchId
   *  restricts server-side — pass the caller's own branch for a BRANCH_MANAGER so other
   *  branches' rows never leave the server. */
  listDrs(from?: string | null, to?: string | null, deliveryBranchId?: string | null) {
    return this.api.get<DrsSummary[]>(`${API.shipmentMovement}/drs`, { from, to, deliveryBranchId });
  }

  /** DRS Report detail — every shipment on one DRS run. */
  drsDetail(deliveryUserId: string, deliveryBranchId: string, runDate: string) {
    return this.api.get<DrsDetail>(`${API.shipmentMovement}/drs/detail`,
      { deliveryUserId, deliveryBranchId, runDate });
  }

  /** Active company users, for the driver/delivery-user pickers — same shape
   *  BranchService.managers() already uses for its own manager picker. */
  userOptions() {
    return this.users
      .list({ page: 0, size: 100, sort: 'firstName,asc', status: 'ACTIVE' })
      .pipe(map((p): Lookup[] => p.content.map((u) => ({
        id: u.id, label: u.displayName, hint: u.designation || u.email
      }))));
  }

  /** Delivery-user id -> {name, mobile}, for DRS Report/Detail's employee contact column —
   *  userOptions()'s Lookup has no mobile slot, and reusing `hint` there would break every
   *  other picker that already relies on it showing designation/email. */
  userDirectory() {
    return this.users
      .list({ page: 0, size: 100, sort: 'firstName,asc', status: 'ACTIVE' })
      .pipe(map((p) => new Map(p.content.map((u) => [u.id, { name: u.displayName, mobile: u.mobile || '—' }]))));
  }
}
