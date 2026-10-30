import { Injectable, inject } from '@angular/core';
import { ApiService } from '@core/services/api.service';
import { API } from '@core/config/api-endpoints';
import { Customer } from '@core/models/customer.model';
import {
  CalculateRateRequest, CalculateRateResponse, CreateZoneRequest, CustomerRate, LocationRequest,
  BusinessDashboard, PricingZone, SaveRateRequest, UpdateZoneRequest, ZoneStatus
} from '@core/models/pricing-zone.model';

export interface RateImportRow { row: number; zone: string | null; districts: string[]; serviceType: string; ok: boolean; error: string | null; slabsSummary: string | null; }
export interface RateImportPreview { rows: RateImportRow[]; okCount: number; errorCount: number; zoneCount: number; }
export interface RateImportResult { zonesCreated: number; zonesReused: number; cardsSaved: number; }

function formOf(file: File): FormData { const f = new FormData(); f.append('file', file); return f; }

/** Pricing zones and per-zone rate cards — mirrors the backend endpoints one-to-one. */
@Injectable({ providedIn: 'root' })
export class BusinessCustomerService {
  private readonly api = inject(ApiService);

  // ---- customers (pickers) ---------------------------------------------------
  /** Active BUSINESS customers for the customer dropdowns. */
  businessCustomers() {
    return this.api.page<Customer>(API.customers, {
      page: 0, size: 100, sort: 'customerCode,asc',
      customerType: ['BUSINESS'] as unknown as string, status: ['ACTIVE'] as unknown as string
    });
  }

  dashboard() { return this.api.get<BusinessDashboard>(API.businessDashboard); }

  // ---- zones --------------------------------------------------------------------
  zones(filter: { customerId?: string; status?: ZoneStatus; search?: string } = {}) {
    return this.api.get<PricingZone[]>(API.pricingZones, filter);
  }
  zone(id: string) { return this.api.get<PricingZone>(`${API.pricingZones}/${id}`); }
  createZone(body: CreateZoneRequest) { return this.api.post<PricingZone>(API.pricingZones, body); }
  updateZone(id: string, body: UpdateZoneRequest) { return this.api.put<PricingZone>(`${API.pricingZones}/${id}`, body); }
  addLocation(zoneId: string, body: LocationRequest) {
    return this.api.post<PricingZone>(`${API.pricingZones}/${zoneId}/locations`, body);
  }
  removeLocation(zoneId: string, locationId: string) {
    return this.api.delete<PricingZone>(`${API.pricingZones}/${zoneId}/locations/${locationId}`);
  }
  activateZone(id: string) { return this.api.patch<PricingZone>(`${API.pricingZones}/${id}/activate`, {}); }
  deactivateZone(id: string) { return this.api.patch<PricingZone>(`${API.pricingZones}/${id}/deactivate`, {}); }
  deleteZone(id: string) { return this.api.delete<void>(`${API.pricingZones}/${id}`); }

  // ---- rates ---------------------------------------------------------------------
  rates(customerId?: string) { return this.api.get<CustomerRate[]>(API.customerRates, { customerId }); }
  /** Emits `undefined` when the zone has no rate card yet (the backend omits `data`). */
  rateSource(customerId: string) { return this.api.get<{ customerId: string; useBusinessRates: boolean }>(`${API.customerRates}/customer/${customerId}/source`); }
  setRateSource(customerId: string, useBusinessRates: boolean) { return this.api.put<{ customerId: string; useBusinessRates: boolean }>(`${API.customerRates}/customer/${customerId}/source`, { useBusinessRates }); }
  /** The zone's card for one service type (`serviceTypeId` omitted = the card for every service). */
  rate(zoneId: string, serviceTypeId?: string | null) { return this.api.get<CustomerRate | undefined>(`${API.customerRates}/zone/${zoneId}`, { serviceTypeId: serviceTypeId ?? undefined }); }
  /** Every card of a zone: the all-services card and one per service type. */
  cards(zoneId: string) { return this.api.get<CustomerRate[]>(`${API.customerRates}/zone/${zoneId}/cards`); }
  saveRate(zoneId: string, body: SaveRateRequest, serviceTypeId?: string | null) { return this.api.put<CustomerRate>(`${API.customerRates}/zone/${zoneId}${qs(serviceTypeId)}`, body); }
  activateRate(zoneId: string, serviceTypeId?: string | null) { return this.api.patch<CustomerRate>(`${API.customerRates}/zone/${zoneId}/activate${qs(serviceTypeId)}`, {}); }
  deactivateRate(zoneId: string, serviceTypeId?: string | null) { return this.api.patch<CustomerRate>(`${API.customerRates}/zone/${zoneId}/deactivate${qs(serviceTypeId)}`, {}); }
  deleteRate(zoneId: string, serviceTypeId?: string | null) { return this.api.delete<void>(`${API.customerRates}/zone/${zoneId}${qs(serviceTypeId)}`); }
  /** The company's active service types (AIR, SURFACE, CARGO, PREMIUM...) a rate card can be set for. */
  serviceTypes() { return this.api.page<{ id: string; code: string; name: string }>('/master/service-types', { page: 0, size: 100, sort: 'name,asc', status: ['ACTIVE'] as unknown as string }); }
  // ---- import from Excel ------------------------------------------------------------
  importTemplate() { return this.api.getBlob(`${API.customerRates}/import/template`); }
  importPreview(customerId: string, file: File) { return this.api.post<RateImportPreview>(`${API.customerRates}/import/preview?customerId=${customerId}`, formOf(file)); }
  importApply(customerId: string, file: File) { return this.api.post<RateImportResult>(`${API.customerRates}/import?customerId=${customerId}`, formOf(file)); }
  calculate(body: CalculateRateRequest) { return this.api.post<CalculateRateResponse>(`${API.customerRates}/calculate`, body); }
}

function qs(serviceTypeId?: string | null): string { return serviceTypeId ? `?serviceTypeId=${encodeURIComponent(serviceTypeId)}` : ''; }
