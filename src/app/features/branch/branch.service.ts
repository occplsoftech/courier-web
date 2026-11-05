import { Injectable, inject } from '@angular/core';
import { map } from 'rxjs/operators';
import { ApiService } from '@core/services/api.service';
import { API } from '@core/config/api-endpoints';
import {
  AddBranchPincodesResult, Branch, BranchPincode, BranchResponse, CreateBranchRequest,
  UpdateBranchRequest
} from '@core/models/branch.model';
import { AppUser } from '@core/models/user.model';
import { PageQuery } from '@core/models/page.model';

/** A resolved id → label pair, for the manager dropdown and the id→name map. */
export interface Lookup { id: string; label: string; hint?: string; }

/** A geography row, reduced to what the cascading Country/State/District/City picker needs. */
export interface GeographyOption { id: string; name: string; }

interface GeographyRow { id: string; code: string; name: string; }

/**
 * Branch administration — talks to /api/v1/branches via ApiService, mirroring the backend
 * endpoints one-to-one; no mock data. The optimistic-lock `version` travels in the PUT
 * body. Status (activate/deactivate) and the manager (assign-manager) each have their own
 * endpoint, matching BranchController; they are not part of the update body.
 */
@Injectable({ providedIn: 'root' })
export class BranchService {
  private readonly api = inject(ApiService);

  // ---- reads ----------------------------------------------------------------
  list(query: PageQuery) { return this.api.page<Branch>(API.branches, query); }
  get(id: string) { return this.api.get<BranchResponse>(`${API.branches}/${id}`); }

  // ---- writes ---------------------------------------------------------------
  create(body: CreateBranchRequest) { return this.api.post<BranchResponse>(API.branches, body); }
  update(id: string, body: UpdateBranchRequest) { return this.api.put<BranchResponse>(`${API.branches}/${id}`, body); }
  remove(id: string) { return this.api.delete<void>(`${API.branches}/${id}`); }

  // ---- lifecycle + assignment (idempotent / own endpoints) -----------------
  activate(id: string) { return this.api.patch<BranchResponse>(`${API.branches}/${id}/activate`, {}); }
  deactivate(id: string) { return this.api.patch<BranchResponse>(`${API.branches}/${id}/deactivate`, {}); }
  /** Set (or clear, with null) the branch manager — a company user. */
  assignManager(id: string, managerId: string | null) {
    return this.api.patch<BranchResponse>(`${API.branches}/${id}/assign-manager`, { managerId });
  }

  /** Set (or clear, with null) the hub this branch's Loading Sheets default to. */
  assignHub(id: string, hubId: string | null) {
    return this.api.patch<Branch>(`${API.branches}/${id}/assign-hub`, { hubId });
  }

  /** The name this branch's pickup address has at Delhivery / Shiprocket; blank clears it. */
  setCourierPickupLocation(id: string, name: string) {
    return this.api.patch<BranchResponse>(`${API.branches}/${id}/courier-pickup-location`, { name });
  }

  // ---- lookups (for dropdowns / id→name resolution) -------------------------
  /** Active company users, as options for the manager picker and the table's name map. */
  managers() {
    return this.api
      .page<AppUser>(API.users, { page: 0, size: 100, sort: 'firstName,asc', status: 'ACTIVE' })
      .pipe(map((p): Lookup[] => p.content.map((u) => ({
        id: u.id, label: u.displayName, hint: u.designation || u.email
      }))));
  }

  // ---- pincode mapping (own endpoints) ---------------------------------------
  branchPincodes(id: string) { return this.api.get<BranchPincode[]>(`${API.branches}/${id}/pincodes`); }
  addBranchPincodes(id: string, pincodeIds: string[]) {
    return this.api.post<AddBranchPincodesResult>(`${API.branches}/${id}/pincodes`, { pincodeIds });
  }
  removeBranchPincode(id: string, mappingId: string) {
    return this.api.delete<void>(`${API.branches}/${id}/pincodes/${mappingId}`);
  }

  // ---- geography pickers (global masters, cascading) --------------------------
  countries() { return this.geography('countries'); }
  states(countryId: string) { return this.geography('states', { countryId }); }
  districts(stateId: string) { return this.geography('districts', { stateId }); }
  cities(districtId: string) { return this.geography('cities', { districtId }); }

  private geography(path: string, filter?: Record<string, string>) {
    return this.api
      .page<GeographyRow>(`${API.globalMasters}/${path}`, { page: 0, size: 200, status: 'ACTIVE', ...filter })
      .pipe(map((p): GeographyOption[] => p.content.map((r) => ({ id: r.id, name: `${r.name} (${r.code})` }))));
  }
}
