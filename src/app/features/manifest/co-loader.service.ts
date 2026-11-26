import { Injectable, inject } from '@angular/core';
import { ApiService } from '@core/services/api.service';
import { CoLoader } from '@core/models/shipment.model';

/** Masters → Co-Loaders: GET/POST/PUT /api/v1/co-loaders. */
@Injectable({ providedIn: 'root' })
export class CoLoaderService {
  private readonly api = inject(ApiService);
  list(all = false) { return this.api.get<CoLoader[]>('/co-loaders', { all }); }
  create(body: Partial<CoLoader>) { return this.api.post<CoLoader>('/co-loaders', body); }
  update(id: string, body: Partial<CoLoader>) { return this.api.put<CoLoader>(`/co-loaders/${id}`, body); }
}
