import { Injectable, inject } from '@angular/core';
import { ApiService } from '@core/services/api.service';
import { API } from '@core/config/api-endpoints';
import { PageQuery } from '@core/models/page.model';
import {
  Manifest, CreateManifestRequest, ManifestSearchRequest, ManifestSummaryStats, Shipment
} from '@core/models/shipment.model';

/**
 * The minimal Manifest module Shipment Movement needs underneath it — see
 * MEMORY/modules/shipment-movement.md. Talks to /api/v1/manifests, mirroring
 * ManifestController one-to-one; no mock data.
 */
@Injectable({ providedIn: 'root' })
export class ManifestService {
  private readonly api = inject(ApiService);

  create(body: CreateManifestRequest) { return this.api.post<Manifest>(API.manifests, body); }
  get(id: string) { return this.api.get<Manifest>(`${API.manifests}/${id}`); }
  list(query: PageQuery) { return this.api.page<Manifest>(API.manifests, query); }
  /** Unpaged aggregates for the THC Report summary row — same filters as `list`, minus paging. */
  summary(filters: ManifestSearchRequest) {
    return this.api.get<ManifestSummaryStats>(`${API.manifests}/summary`, filters as Record<string, unknown>);
  }
  shipments(id: string) { return this.api.get<Shipment[]>(`${API.manifests}/${id}/shipments`); }
  /** Load Sheet's own "which city am I creating this for" picker — every distinct
   *  destination city among this branch's own BOOKED/READY_FOR_MANIFEST shipments with no
   *  delivery branch resolved yet. */
  eligibleDestinations(bookingBranchId: string) {
    return this.api.get<string[]>(`${API.manifests}/eligible-destinations`, { bookingBranchId });
  }
  removeShipment(id: string, shipmentId: string) {
    return this.api.delete<void>(`${API.manifests}/${id}/shipments/${shipmentId}`);
  }

  // ---- draft (CREATED) editing, before Dispatch
  addShipments(id: string, shipmentIds: string[]) {
    return this.api.post<Manifest>(`${API.manifests}/${id}/shipments`, { shipmentIds });
  }
  /** Co-loader, own vehicle / driver, bags. */
  updateDraft(id: string, body: { coLoaderId: string | null; vehicleId: string | null; driverUserId: string | null; bagsCount: number | null }) {
    return this.api.patch<Manifest>(`${API.manifests}/${id}`, body);
  }
  /** Shipment id → the co-loader's number for that AWB; blank clears. */
  setForwarderNumbers(id: string, forwarderNumbers: Record<string, string>) {
    return this.api.put<void>(`${API.manifests}/${id}/forwarder-numbers`, { forwarderNumbers });
  }
  /** Its AWBs go back to Pending Outscan. */
  deleteDraft(id: string) { return this.api.delete<void>(`${API.manifests}/${id}`); }
}
