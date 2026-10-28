import { Injectable, inject } from '@angular/core';
import { ApiService } from '@core/services/api.service';
import { API } from '@core/config/api-endpoints';
import {
  ChargeRequest, CreateTariffZoneRequest, LaneRequest, OptionsRequest, OptionsResponse, QuoteRequest, QuoteResponse, RateCard, RateCardRequest,
  TariffLocationRequest, TariffStatus, TariffZone, TariffZoneStatus, UpdateTariffZoneRequest, ZoneResolution, ZoneUsage
} from '@core/models/zone-tariff.model';

/** Zone tariff zones, rate cards (lanes, charges) and quotes — mirrors the backend endpoints one-to-one. */
@Injectable({ providedIn: 'root' })
export class ZoneTariffService {
  private readonly api = inject(ApiService);

  // ---- zones --------------------------------------------------------------------
  zones(filter: { usage?: ZoneUsage; status?: TariffZoneStatus; search?: string } = {}) {
    return this.api.get<TariffZone[]>(API.tariffZones, filter);
  }
  zone(id: string) { return this.api.get<TariffZone>(`${API.tariffZones}/${id}`); }
  createZone(body: CreateTariffZoneRequest) { return this.api.post<TariffZone>(API.tariffZones, body); }
  updateZone(id: string, body: UpdateTariffZoneRequest) { return this.api.put<TariffZone>(`${API.tariffZones}/${id}`, body); }
  addLocations(zoneId: string, locations: TariffLocationRequest[]) {
    return this.api.post<TariffZone>(`${API.tariffZones}/${zoneId}/locations`, { locations });
  }
  removeLocation(zoneId: string, locationId: string) {
    return this.api.delete<TariffZone>(`${API.tariffZones}/${zoneId}/locations/${locationId}`);
  }
  activateZone(id: string) { return this.api.patch<TariffZone>(`${API.tariffZones}/${id}/activate`, {}); }
  deactivateZone(id: string) { return this.api.patch<TariffZone>(`${API.tariffZones}/${id}/deactivate`, {}); }
  deleteZone(id: string) { return this.api.delete<void>(`${API.tariffZones}/${id}`); }
  resolve(pincode: string, direction: 'FROM' | 'TO') {
    return this.api.get<ZoneResolution>(`${API.tariffZones}/resolve`, { pincode, direction });
  }

  // ---- rate cards ----------------------------------------------------------------
  cards(filter: { fromZoneId?: string; status?: TariffStatus; search?: string } = {}) {
    return this.api.get<RateCard[]>(API.tariffRateCards, filter);
  }
  card(id: string) { return this.api.get<RateCard>(`${API.tariffRateCards}/${id}`); }
  createCard(body: RateCardRequest) { return this.api.post<RateCard>(API.tariffRateCards, body); }
  updateCard(id: string, body: RateCardRequest) { return this.api.put<RateCard>(`${API.tariffRateCards}/${id}`, body); }
  activateCard(id: string) { return this.api.patch<RateCard>(`${API.tariffRateCards}/${id}/activate`, {}); }
  deactivateCard(id: string) { return this.api.patch<RateCard>(`${API.tariffRateCards}/${id}/deactivate`, {}); }
  deleteCard(id: string) { return this.api.delete<void>(`${API.tariffRateCards}/${id}`); }

  /** Replaces every slab of one lane. */
  saveLane(cardId: string, body: LaneRequest) { return this.api.put<RateCard>(`${API.tariffRateCards}/${cardId}/lanes`, body); }
  deleteLane(cardId: string, lane: { toZoneId: string; serviceTypeId: string; packageTypeId: string }) {
    const q = new URLSearchParams({ toZoneId: lane.toZoneId, serviceTypeId: lane.serviceTypeId, packageTypeId: lane.packageTypeId });
    return this.api.delete<RateCard>(`${API.tariffRateCards}/${cardId}/lanes?${q}`);
  }

  addCharge(cardId: string, body: ChargeRequest) { return this.api.post<RateCard>(`${API.tariffRateCards}/${cardId}/charges`, body); }
  updateCharge(cardId: string, chargeId: string, body: ChargeRequest) {
    return this.api.put<RateCard>(`${API.tariffRateCards}/${cardId}/charges/${chargeId}`, body);
  }
  deleteCharge(cardId: string, chargeId: string) {
    return this.api.delete<RateCard>(`${API.tariffRateCards}/${cardId}/charges/${chargeId}`);
  }

  quote(body: QuoteRequest) { return this.api.post<QuoteResponse>(`${API.tariffRateCards}/quote`, body); }
  /** Every service and package type the applicable card has to the delivery zone, cheapest first. */
  quoteOptions(body: OptionsRequest) { return this.api.post<OptionsResponse>(`${API.tariffRateCards}/quote/options`, body); }
}
