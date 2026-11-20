import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { WalletStatusBadge } from './wallet-status-badge';
import { WalletResponse, formatMoney } from '@core/models/wallet.model';

/**
 * Identity banner for the wallet dashboard — avatar, owning branch, wallet number, status and
 * the headline available balance. Presentational only.
 */
@Component({
  selector: 'app-wallet-summary-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, WalletStatusBadge],
  template: `
    <div class="ws">
      <span class="ws__av"><mat-icon>account_balance_wallet</mat-icon></span>
      <div class="ws__body">
        <div class="ws__name">
          <h1 class="text-h1">{{ wallet().branchName || 'Branch Wallet' }}</h1>
          <app-wallet-status-badge [status]="wallet().status" />
        </div>
        <div class="ws__tags">
          <span class="tag mono"><mat-icon>tag</mat-icon>{{ wallet().walletNumber }}</span>
          @if (wallet().branchCode) { <span class="tag"><mat-icon>store</mat-icon>{{ wallet().branchCode }}</span> }
          <span class="tag"><mat-icon>payments</mat-icon>{{ wallet().currency }}</span>
        </div>
      </div>
      <div class="ws__bal">
        <p class="text-caption">Available Balance</p>
        <p class="ws__amt num-tabular">{{ available() }}</p>
      </div>
    </div>
  `,
  styles: [`
    .ws { display:flex; gap:16px; align-items:center; }
    .ws__av { width:56px; height:56px; border-radius:14px; background:var(--brand-100); color:var(--brand-700);
      display:grid; place-items:center; flex:0 0 auto; }
    .ws__av mat-icon { font-size:28px; width:28px; height:28px; }
    .ws__body { flex:1; min-width:0; }
    .ws__name { display:flex; align-items:center; gap:12px; }
    .ws__tags { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
    .tag { display:inline-flex; align-items:center; gap:3px; background:var(--surface-muted); border:1px solid var(--surface-border);
      color:var(--content-muted); font:600 14px var(--font-sans); padding:2px 8px; border-radius:6px; }
    .tag mat-icon { font-size:13px; width:13px; height:13px; }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .ws__bal { text-align:right; flex:0 0 auto; }
    .ws__amt { font:700 27px/1.1 var(--font-sans); letter-spacing:-.02em; margin:2px 0 0; color:var(--brand-700); }
    @media (max-width:640px){ .ws { flex-wrap:wrap; } .ws__bal { text-align:left; } }
  `]
})
export class WalletSummaryCard {
  readonly wallet = input.required<WalletResponse>();
  readonly available = computed(() => formatMoney(this.wallet().availableBalance, this.wallet().currency));
}
