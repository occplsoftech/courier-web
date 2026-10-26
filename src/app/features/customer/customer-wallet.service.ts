import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { API } from '@core/config/api-endpoints';
import { Page, PageQuery } from '@core/models/page.model';
import { SubTransactionType, WalletStatus, WalletTransaction } from '@core/models/wallet.model';

/** A business customer's prepaid wallet. Read-only: the balance moves only through ledger entries. */
export interface CustomerWallet {
  id: string;
  customerId: string;
  walletNumber: string;
  status: WalletStatus;
  availableBalance: number;
  holdBalance: number;
  totalBalance: number;
  currency: string;
  createdAt: string;
}

/** Body of a manual credit or debit. The customer is in the path; the reason defaults server-side (MCR / MDB). */
export interface CustomerWalletAdjustment {
  amount: number;
  subTransactionType?: SubTransactionType | null;
  referenceId?: string | null;
  remarks?: string | null;
}

/**
 * Staff side of a customer's wallet (`/customers/{id}/wallet`). Reads are COMPANY_ADMIN / FINANCE_USER; credit and debit are
 * COMPANY_ADMIN. Opening the wallet of a customer that has none yet creates it, which is why a read can never 404 for a customer
 * that exists.
 */
@Injectable({ providedIn: 'root' })
export class CustomerWalletService {
  private readonly api = inject(ApiService);

  wallet(customerId: string) { return this.api.get<CustomerWallet>(API.customerWallet(customerId)); }

  transactions(customerId: string, query: PageQuery): Observable<Page<WalletTransaction>> {
    return this.api.page<WalletTransaction>(`${API.customerWallet(customerId)}/transactions`, query);
  }

  credit(customerId: string, body: CustomerWalletAdjustment) {
    return this.api.post<WalletTransaction>(`${API.customerWallet(customerId)}/credit`, body);
  }

  debit(customerId: string, body: CustomerWalletAdjustment) {
    return this.api.post<WalletTransaction>(`${API.customerWallet(customerId)}/debit`, body);
  }
}
