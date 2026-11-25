import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '@core/services/api.service';
import { API } from '@core/config/api-endpoints';
import {
  Customer, CustomerAddress, CustomerResponse, CreateCustomerRequest, UpdateCustomerRequest,
  CreateCustomerAddressRequest, UpdateCustomerAddressRequest
} from '@core/models/customer.model';
import { PageQuery } from '@core/models/page.model';

/** A geography row, reduced to what a cascading address picker needs. */
export interface GeographyOption { id: string; label: string; }

interface GeographyRow { id: string; code: string; name: string; }

/**
 * Customer administration — talks to /api/v1/customers via ApiService, mirroring the
 * backend endpoints one-to-one; no mock data. The optimistic-lock `version` travels in the
 * PUT body. Status (activate/deactivate) has its own endpoint, matching CustomerController.
 *
 * Address geography pickers read the shared global masters (`/global-masters/...`) rather
 * than anything company-scoped — country/state/district/city/area/pincode are one platform
 * catalogue, per decision 50 in AI_CONTEXT.md.
 */
@Injectable({ providedIn: 'root' })
export class CustomerService {
  private readonly api = inject(ApiService);

  // ---- reads ----------------------------------------------------------------
  list(query: PageQuery) { return this.api.page<Customer>(API.customers, query); }
  get(id: string) { return this.api.get<CustomerResponse>(`${API.customers}/${id}`); }

  // ---- writes -----------------------------------------------------------------
  create(body: CreateCustomerRequest) { return this.api.post<CustomerResponse>(API.customers, body); }
  update(id: string, body: UpdateCustomerRequest) {
    return this.api.put<CustomerResponse>(`${API.customers}/${id}`, body);
  }
  /** Sets the home branch (13.2); null fills it again from the branch serving the default pickup pincode. */
  setHomeBranch(id: string, branchId: string | null) {
    return this.api.patch<CustomerResponse>(`${API.customers}/${id}/home-branch`, { branchId });
  }

  // ---- brand logo (saved separately from the customer, so it never makes an open edit stale) -------
  logo(id: string) { return this.api.get<{ dataUrl: string | null }>(`${API.customers}/${id}/logo`); }
  uploadLogo(id: string, file: File) {
    const body = new FormData();
    body.append('file', file);
    return this.api.put<void>(`${API.customers}/${id}/logo`, body);
  }
  removeLogo(id: string) { return this.api.delete<void>(`${API.customers}/${id}/logo`); }

  // ---- lifecycle (idempotent) -------------------------------------------------
  activate(id: string) { return this.api.patch<CustomerResponse>(`${API.customers}/${id}/activate`, {}); }
  deactivate(id: string) { return this.api.patch<CustomerResponse>(`${API.customers}/${id}/deactivate`, {}); }

  // ---- addresses ---------------------------------------------------------------
  addAddress(customerId: string, body: CreateCustomerAddressRequest) {
    return this.api.post<CustomerAddress>(`${API.customers}/${customerId}/addresses`, body);
  }
  updateAddress(customerId: string, addressId: string, body: UpdateCustomerAddressRequest) {
    return this.api.put<CustomerAddress>(`${API.customers}/${customerId}/addresses/${addressId}`, body);
  }
  removeAddress(customerId: string, addressId: string) {
    return this.api.delete<void>(`${API.customers}/${customerId}/addresses/${addressId}`);
  }

  // ---- geography pickers (global masters, cascading) --------------------------
  countries() { return this.geography('countries'); }
  states(countryId: string) { return this.geography('states', { countryId }); }
  districts(stateId: string) { return this.geography('districts', { stateId }); }
  cities(districtId: string) { return this.geography('cities', { districtId }); }
  areas(cityId: string) { return this.geography('areas', { cityId }); }
  pincodes(areaId: string) { return this.geography('pincodes', { areaId }); }
  regionalZones() { return this.geography('regional-zones'); }

  private geography(path: string, filter?: Record<string, string>): Observable<GeographyOption[]> {
    return this.api
      .page<GeographyRow>(`${API.globalMasters}/${path}`, { page: 0, size: 200, status: 'ACTIVE', ...filter })
      .pipe(map((p) => p.content.map((r) => ({ id: r.id, label: `${r.name} (${r.code})` }))));
  }
}
