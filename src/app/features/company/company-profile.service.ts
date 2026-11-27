import { Injectable, inject } from '@angular/core';
import { ApiService } from '@core/services/api.service';
import { API } from '@core/config/api-endpoints';

/** The caller's own company letterhead — GET /company-profile. Any authenticated company
 *  user may read it (unlike `CompanyService`, which is SUPER_ADMIN-only); this is what a
 *  printed consignment note puts in its header. */
export interface CompanyLetterhead {
  companyName: string;
  logo: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  gstNumber: string | null;
  mobile: string | null;
  website: string | null;
  /** Support email, else the company's own: the DRS / manifest letterhead. */
  email?: string | null;
}

@Injectable({ providedIn: 'root' })
export class CompanyProfileService {
  private readonly api = inject(ApiService);

  get() {
    return this.api.get<CompanyLetterhead>(API.companyProfile);
  }
}
