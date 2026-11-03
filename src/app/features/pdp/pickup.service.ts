import { Injectable, inject } from '@angular/core';
import { ApiService } from '@core/services/api.service';
import { API } from '@core/config/api-endpoints';
import { Page, PageQuery } from '@core/models/page.model';
import { PickupRequest, PickupStats, PickupStatus, SavePickupRequest } from '@core/models/pdp.model';

/** Pickup requests — mirrors backend `/api/v1/pickups` one-to-one. */
@Injectable({ providedIn: 'root' })
export class PickupService {
  private readonly api = inject(ApiService);

  list(query: PageQuery & { status?: PickupStatus; pdpBranchId?: string }) {
    return this.api.page<PickupRequest>(API.pickups, query);
  }
  stats() { return this.api.get<PickupStats>(`${API.pickups}/stats`); }
  get(id: string) { return this.api.get<PickupRequest>(`${API.pickups}/${id}`); }
  create(body: SavePickupRequest) { return this.api.post<PickupRequest>(API.pickups, body); }
  update(id: string, body: SavePickupRequest) { return this.api.put<PickupRequest>(`${API.pickups}/${id}`, body); }
  assign(id: string, pdpBranchId: string) { return this.api.patch<PickupRequest>(`${API.pickups}/${id}/assign`, { pdpBranchId }); }
  /** Partner mapped to the pickup's pincode (Pincode Branch Mapping); undefined when none. */
  /** Active pickup partners this user may assign a pickup to (admin and branch managers). */
  assignablePartners() { return this.api.get<Array<{ id: string; code: string; name: string }>>(`${API.pickups}/partners`); }
  suggestedPartner(id: string) { return this.api.get<string | undefined>(`${API.pickups}/${id}/suggested-partner`); }
  accept(id: string) { return this.api.patch<PickupRequest>(`${API.pickups}/${id}/accept`, {}); }
  reject(id: string, reason: string) { return this.api.patch<PickupRequest>(`${API.pickups}/${id}/reject`, { reason }); }
  start(id: string) { return this.api.patch<PickupRequest>(`${API.pickups}/${id}/start`, {}); }
  complete(id: string, actualParcels: number, actualWeightKg: number) {
    return this.api.patch<PickupRequest>(`${API.pickups}/${id}/complete`, { actualParcels, actualWeightKg });
  }
  fail(id: string, reason: string) { return this.api.patch<PickupRequest>(`${API.pickups}/${id}/fail`, { reason }); }
  linkShipment(id: string, body: { shipmentId: string; shipmentNo?: string }) {
    return this.api.patch<PickupRequest>(`${API.pickups}/${id}/shipment`, body);
  }
  /** Parcel photos the customer attached to the portal booking behind this pickup (none for staff-made pickups). */
  photos(id: string) { return this.api.get<{ id: string; fileName: string; contentType: string }[]>(`${API.pickups}/${id}/photos`); }
  photoFile(id: string, photoId: string) { return this.api.getBlob(`${API.pickups}/${id}/photos/${photoId}/file`); }
  cancel(id: string, reason: string) { return this.api.patch<PickupRequest>(`${API.pickups}/${id}/cancel`, { reason }); }
}
