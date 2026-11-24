import { Injectable, inject } from '@angular/core';
import { HttpContext } from '@angular/common/http';
import { ApiService, SILENT_ERRORS } from '@core/services/api.service';
import { API } from '@core/config/api-endpoints';
import { FreightCalculationRequest, FreightCalculationResponse } from '@core/models/district-level-freight.model';

/**
 * Shipment Booking's live freight preview — POST /district-level-freight/calculate. Pure
 * preview: the backend recomputes and re-verifies this same figure authoritatively at
 * Confirm Booking (`ShipmentServiceImpl.create`/`update`), never trusting what this call
 * returned.
 */
@Injectable({ providedIn: 'root' })
export class FreightCalculationService {
  private readonly api = inject(ApiService);

  /** `silent`: a service with no freight for this lane is expected (the caller leaves it out), so no error toast. */
  calculate(body: FreightCalculationRequest, opts?: { silent?: boolean }) {
    const context = opts?.silent ? new HttpContext().set(SILENT_ERRORS, true) : undefined;
    return this.api.post<FreightCalculationResponse>(API.districtLevelFreightCalculate, body, context);
  }
}
