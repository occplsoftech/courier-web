import { Injectable, inject } from '@angular/core';
import { ApiService } from '@core/services/api.service';
import { API } from '@core/config/api-endpoints';

export type Attribution = 'WORK' | 'ENTERED_BY';
export type PerformanceMetric = 'BOOKINGS' | 'COUNTER' | 'DELIVERIES' | 'WALLET' | 'HANDOVERS';
export type CashHandoverMode = 'CASH' | 'BANK_DEPOSIT' | 'UPI';

export const HANDOVER_MODES: { value: CashHandoverMode; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_DEPOSIT', label: 'Bank deposit' },
  { value: 'UPI', label: 'UPI' }
];

/** One user's figures — mirrors backend `UserPerformance.Row`. `userId` null: the branch total, or (system) the work
 *  done without a signed-in user (customer portal / API bookings). */
export interface UserPerformanceRow {
  userId: string | null;
  userName: string;
  system: boolean;
  booked: number; cancelled: number; bookingValue: number; bookedWeight: number;
  paidCount: number; toPayCount: number; codCount: number; creditCount: number;
  counterCash: number; counterOnline: number; counterPending: number;
  delivered: number; deliveryPending: number; failedAttempts: number; deliveryCash: number;
  successRate: number | null;
  walletDebit: number; walletRefund: number; walletNet: number; commission: number;
  cashCollected: number; openingOutstanding: number; handedOver: number; closingOutstanding: number;
}

export interface UserPerformanceReconciliation {
  walletDebits: number; walletCredits: number; attributedDebits: number; unattributedDebits: number;
}

export interface UserPerformanceResult {
  branchId: string; from: string; to: string; attribution: Attribution;
  /** Outstanding cash counts from this day; null = never set. */
  trackingFrom: string | null;
  /** false: the caller sees only their own row ("My Performance"). */
  teamView: boolean;
  canRecordHandover: boolean;
  rows: UserPerformanceRow[];
  total: UserPerformanceRow;
  reconciliation: UserPerformanceReconciliation | null;
}

export interface PerformanceDetailRow {
  day: string; at: string | null; reference: string; type: string; detail: string; status: string; amount: number;
}

export interface CashHandover {
  id: string; branchId: string; userId: string; userName: string | null;
  amount: number; mode: CashHandoverMode; reference: string | null; remarks: string | null; handoverDate: string;
  receivedBy: string; receivedByName: string | null; receivedAt: string;
  voided: boolean; voidedBy: string | null; voidedByName: string | null; voidedAt: string | null; voidReason: string | null;
}

export interface RecordCashHandoverRequest {
  branchId?: string | null; userId: string; amount: number; mode: CashHandoverMode;
  reference?: string | null; remarks?: string | null; handoverDate?: string | null;
}

export interface PerformanceQuery {
  branchId?: string | null; from?: string | null; to?: string | null; attribution?: Attribution;
}

/**
 * User Performance Report and cash handovers — `/api/v1/branch-wallet/user-performance` and
 * `/api/v1/branch-wallet/cash-handovers`. The backend decides scope: a company admin / finance user picks any branch,
 * a branch manager / accounts / hub manager / viewer sees every user of their own branch, anyone else only themselves.
 */
@Injectable({ providedIn: 'root' })
export class UserPerformanceService {
  private readonly api = inject(ApiService);
  private readonly base = `${API.branchWallet}/user-performance`;
  private readonly handovers = `${API.branchWallet}/cash-handovers`;

  report(q: PerformanceQuery) {
    return this.api.get<UserPerformanceResult>(this.base, clean(q));
  }

  details(q: PerformanceQuery, userId: string | null, metric: PerformanceMetric) {
    return this.api.get<PerformanceDetailRow[]>(`${this.base}/details`, clean({ ...q, userId, metric }));
  }

  listHandovers(q: PerformanceQuery, userId?: string | null) {
    return this.api.get<CashHandover[]>(this.handovers, clean({ branchId: q.branchId, from: q.from, to: q.to, userId }));
  }

  recordHandover(body: RecordCashHandoverRequest) {
    return this.api.post<CashHandover>(this.handovers, body);
  }

  voidHandover(id: string, reason: string) {
    return this.api.post<CashHandover>(`${this.handovers}/${id}/void`, { reason });
  }
}

function clean(q: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(q).filter(([, v]) => v !== null && v !== undefined && v !== ''));
}
