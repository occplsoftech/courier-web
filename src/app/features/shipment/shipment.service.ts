import { Injectable, inject } from '@angular/core';
import { ApiService } from '@core/services/api.service';
import { API } from '@core/config/api-endpoints';
import { PageQuery } from '@core/models/page.model';
import {
  Shipment, ShipmentResponse, ShipmentCharge, ShipmentStatusHistoryEntry, ShipmentDocument,
  ShipmentItem, CreateShipmentRequest, UpdateShipmentRequest, AddShipmentDocumentRequest,
  PricingRequest, PricingResponse, TimelineStep, ShipmentDrs, ShipmentSearchRequest, ShipmentSummaryStats,
  BranchCommissionSummary, BranchPerformanceSummary, VendorAuditRow, BulkTrackResponse, PaymentModeChange,
  ForwardOptions, ForwardResult, ResolveForwardResult
} from '@core/models/shipment.model';

/**
 * Shipment Booking — talks to /api/v1/shipments via ApiService, mirroring
 * ShipmentController one-to-one; no mock data. The optimistic-lock `version` travels in
 * the PUT body. `preview` calls the Pricing Engine directly (`POST /pricing/calculate`)
 * for the wizard's live Step 3 preview — read-only, prices nothing, books nothing; the
 * actual booking re-prices through the same engine inside `POST /shipments`.
 */
@Injectable({ providedIn: 'root' })
export class ShipmentService {
  private readonly api = inject(ApiService);

  // ---- reads ------------------------------------------------------------------
  list(query: PageQuery) { return this.api.page<Shipment>(API.shipments, query); }
  /** Unpaged aggregates for the Booking/Delivery Report summary row — same filters as
   *  `list`, minus paging. */
  summary(filters: ShipmentSearchRequest) {
    return this.api.get<ShipmentSummaryStats>(`${API.shipments}/summary`, filters as Record<string, unknown>);
  }
  /** Branch-wise commission totals for the Commission Report's summary table — same filters as `list`. */
  commissionSummary(filters: ShipmentSearchRequest) {
    return this.api.get<BranchCommissionSummary[]>(
      `${API.shipments}/commission-summary`, filters as Record<string, unknown>);
  }
  /** Shipment volume/outcome totals grouped by booking branch — the Branch Performance
   *  Report's summary table. Same filters as `list`. */
  branchPerformance(filters: ShipmentSearchRequest) {
    return this.api.get<BranchPerformanceSummary[]>(
      `${API.shipments}/branch-performance`, filters as Record<string, unknown>);
  }
  /** Per-branch vendor-audit reconciliation totals for the Vendor Audit Report — same
   *  filters as `list`. */
  vendorAudit(filters: ShipmentSearchRequest) {
    return this.api.get<VendorAuditRow[]>(`${API.shipments}/vendor-audit`, filters as Record<string, unknown>);
  }
  get(id: string) { return this.api.get<ShipmentResponse>(`${API.shipments}/${id}`); }
  getByTrackingNumber(trackingNumber: string) {
    return this.api.get<ShipmentResponse>(`${API.shipments}/track/${trackingNumber}`);
  }
  /** Bulk Shipment Tracking report — one row per number pasted in, matched or not. */
  bulkTrack(numbers: string[]) {
    return this.api.post<BulkTrackResponse>(`${API.shipments}/track/bulk`, { numbers });
  }
  items(id: string) { return this.api.get<ShipmentItem[]>(`${API.shipments}/${id}/items`); }
  charges(id: string) { return this.api.get<ShipmentCharge>(`${API.shipments}/${id}/charges`); }
  /** The DRS row for this shipment — null until it is Out For Delivery. */
  deliveryRun(id: string) { return this.api.get<ShipmentDrs | null>(`${API.shipments}/${id}/delivery-run`); }
  history(id: string) { return this.api.get<ShipmentStatusHistoryEntry[]>(`${API.shipments}/${id}/history`); }
  documents(id: string) { return this.api.get<ShipmentDocument[]>(`${API.shipments}/${id}/documents`); }
  timeline(id: string) { return this.api.get<TimelineStep[]>(`${API.shipments}/${id}/timeline`); }

  // ---- writes -----------------------------------------------------------------
  create(body: CreateShipmentRequest) { return this.api.post<ShipmentResponse>(API.shipments, body); }
  update(id: string, body: UpdateShipmentRequest) {
    return this.api.put<ShipmentResponse>(`${API.shipments}/${id}`, body);
  }
  /** COMPANY_ADMIN only — recalculated charges at `ratePerKg`, nothing saved. */
  previewRatePerKg(id: string, ratePerKg: number) {
    return this.api.get<ShipmentCharge>(`${API.shipments}/${id}/rate-per-kg/preview`, { ratePerKg });
  }
  /** COMPANY_ADMIN only — see ShipmentController.updateRatePerKg. */
  updateRatePerKg(id: string, version: number, ratePerKg: number) {
    return this.api.put<ShipmentCharge>(`${API.shipments}/${id}/rate-per-kg`, { version, ratePerKg });
  }
  /** COMPANY_ADMIN only — see ShipmentController.paymentModeOptions. */
  paymentModeChange(id: string) {
    return this.api.get<PaymentModeChange>(`${API.shipments}/${id}/payment-mode`);
  }
  /** COMPANY_ADMIN only, BOOKED only — debits or credits the booking wallet. */
  changePaymentMode(id: string, version: number, paymentModeId: string) {
    return this.api.put<PaymentModeChange>(`${API.shipments}/${id}/payment-mode`, { version, paymentModeId });
  }
  /** The connected couriers' own prices for a shipment a hub holds (the courier collects from the hub). */
  /** Settle a forward the courier never confirmed: cancel it at the courier, or record the AWB the courier gave. */
  resolveForward(id: string, courierTookIt: boolean, awb?: string) {
    return this.api.post<ResolveForwardResult>(`${API.shipments}/${id}/forwarding/resolve`, { courierTookIt, awb: awb ?? null });
  }

  forwardOptions(id: string) { return this.api.get<ForwardOptions>(`${API.shipments}/${id}/forwarding/options`); }
  /** Hands the shipment to the chosen courier service (priced afresh on the server). */
  forward(id: string, providerCode: string, serviceCode: string) {
    return this.api.post<ForwardResult>(`${API.shipments}/${id}/forwarding`, { providerCode, serviceCode });
  }
  cancel(id: string, remarks: string) {
    return this.api.post<ShipmentResponse>(
      `${API.shipments}/${id}/cancel?remarks=${encodeURIComponent(remarks)}`, {});
  }
  addDocument(id: string, body: AddShipmentDocumentRequest) {
    return this.api.post<ShipmentDocument>(`${API.shipments}/${id}/documents`, body);
  }

  /** Uploads a shipment photo (JPEG/PNG/WEBP/HEIC) and records it against the shipment
   *  immediately — unlike POD upload there is no separate confirm step, so the returned
   *  URL is only for showing a fresh preview, not for feeding into another call. */
  uploadImage(id: string, file: File) {
    const body = new FormData();
    body.append('file', file);
    return this.api.post<{ url: string }>(`${API.shipments}/${id}/image-upload`, body);
  }

  // ---- pricing preview (Pricing Engine, not this module's own) -----------------
  preview(body: PricingRequest) {
    return this.api.post<PricingResponse>(`${API.pricing}/calculate`, body);
  }
}
