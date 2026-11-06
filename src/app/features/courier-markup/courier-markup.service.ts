import { Injectable, inject } from '@angular/core';
import { ApiService } from '@core/services/api.service';
import { API } from '@core/config/api-endpoints';

/** Charge lines a markup can apply to. TAX is never marked up. */
export const MARKUP_COMPONENTS = ['FREIGHT', 'FUEL_SURCHARGE', 'COD', 'REMOTE_AREA', 'HANDLING', 'INSURANCE', 'OTHER'] as const;
export type MarkupComponent = (typeof MARKUP_COMPONENTS)[number] | 'TAX';

/** A markup rule for outside couriers. A null providerCode / customerId means "all couriers" / "all customers". */
export interface MarkupRule {
  id: string;
  providerCode: string | null;
  customerId: string | null;
  enabled: boolean;
  percent: number;
  appliesTo: MarkupComponent[];
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CreateMarkupRule {
  providerCode: string | null;
  customerId: string | null;
  enabled: boolean;
  percent: number;
  appliesTo: MarkupComponent[];
  effectiveFrom: string | null;
  effectiveTo: string | null;
  notes: string | null;
}

/** The markup that applies right now; ruleId is null when it is the company default. */
export interface MarkupCheck {
  ruleId: string | null;
  isDefault: boolean;
  enabled: boolean;
  percent: number;
  appliesTo: MarkupComponent[];
  gstPercent: number;
}

export type RuleState = 'IN_FORCE' | 'UPCOMING' | 'ENDED' | 'OFF';

/** Where a rule stands at `now`: switched off wins over the dates only while it would otherwise be in force. */
export function ruleState(r: MarkupRule, now = Date.now()): RuleState {
  if (r.effectiveTo && Date.parse(r.effectiveTo) <= now) return 'ENDED';
  if (Date.parse(r.effectiveFrom) > now) return 'UPCOMING';
  return r.enabled ? 'IN_FORCE' : 'OFF';
}

@Injectable({ providedIn: 'root' })
export class CourierMarkupService {
  private readonly api = inject(ApiService);

  list() { return this.api.get<MarkupRule[]>(API.pricingMarkupRules); }
  create(body: CreateMarkupRule) { return this.api.post<MarkupRule>(API.pricingMarkupRules, body); }
  end(id: string) { return this.api.post<MarkupRule>(`${API.pricingMarkupRules}/${encodeURIComponent(id)}/end`, {}); }
  check(providerCode: string | null, customerId: string | null) {
    const q: Record<string, string> = {};
    if (providerCode) q['providerCode'] = providerCode;
    if (customerId) q['customerId'] = customerId;
    return this.api.get<MarkupCheck>(`${API.pricingMarkupRules}/check`, q);
  }
}
