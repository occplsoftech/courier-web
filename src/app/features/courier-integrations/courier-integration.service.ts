import { Injectable, inject } from '@angular/core';
import { ApiService } from '@core/services/api.service';
import { API } from '@core/config/api-endpoints';

/** One form field of a courier. A secret's value is never returned: only whether it is set. */
export interface IntegrationField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  help: string | null;
  value: string | null;
  set: boolean;
}

/**
 * COMPANY = saved by this company's administrator; ENVIRONMENT = the server's built-in account (nothing saved
 * here yet); NONE = not connected.
 */
export type IntegrationSource = 'COMPANY' | 'ENVIRONMENT' | 'NONE';

export interface CourierIntegration {
  code: string;
  name: string;
  /** False: the portal has no integration code for this courier yet, so it cannot be connected. */
  available: boolean;
  note: string | null;
  source: IntegrationSource;
  enabled: boolean;
  connected: boolean;
  credentialsUnreadable: boolean;
  fields: IntegrationField[];
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  /** The courier's logo as a data URL, or null. */
  logoDataUrl: string | null;
  /** Where this courier pushes status updates for the company; null until the courier has been saved. */
  webhookUrl?: string | null;
  /** False for a courier without status webhooks (sKart): statuses come from the hourly check only. */
  statusPush?: boolean;
}

export interface SaveIntegrationRequest {
  enabled: boolean;
  /** Field key to value. A secret left out or blank keeps the stored one. */
  values: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class CourierIntegrationService {
  private readonly api = inject(ApiService);

  list() { return this.api.get<CourierIntegration[]>(API.courierIntegrations); }
  save(code: string, body: SaveIntegrationRequest) {
    return this.api.put<CourierIntegration>(`${API.courierIntegrations}/${encodeURIComponent(code)}`, body);
  }
  test(code: string) {
    return this.api.post<CourierIntegration>(`${API.courierIntegrations}/${encodeURIComponent(code)}/test`, {});
  }
  uploadLogo(code: string, file: File) {
    const body = new FormData();
    body.append('file', file);
    return this.api.put<void>(`${API.courierIntegrations}/${encodeURIComponent(code)}/logo`, body);
  }
  removeLogo(code: string) {
    return this.api.delete<void>(`${API.courierIntegrations}/${encodeURIComponent(code)}/logo`);
  }
  disconnect(code: string) {
    return this.api.delete<CourierIntegration>(`${API.courierIntegrations}/${encodeURIComponent(code)}`);
  }
}
