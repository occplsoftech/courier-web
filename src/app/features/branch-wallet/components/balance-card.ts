import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { formatMoney } from '@core/models/wallet.model';
import { WalletIllustration } from '@shared/components/illustrations/wallet-illustration';

type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/**
 * Money tile for the wallet dashboard — a bigger, currency-formatted sibling of the shared
 * StatisticCard. Renders a label, an amount in the wallet currency, an icon and an optional
 * hint line. Presentational only; loading shows a shimmer.
 */
@Component({
  selector: 'app-balance-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, WalletIllustration],
  template: `
    <div class="app-card bc" [class.bc--hero]="hero()">
      @if (hero()) { <app-wallet-illustration class="bc__ill" [size]="76" /> }
      <div class="bc__top">
        <span class="bc__icon" [attr.data-tone]="tone()"><mat-icon>{{ icon() }}</mat-icon></span>
        <p class="text-caption">{{ label() }}</p>
      </div>
      @if (loading()) {
        <div class="bc__sk"></div>
      } @else {
        <p class="bc__val num-tabular">{{ money() }}</p>
      }
      @if (hint()) { <p class="bc__hint">{{ hint() }}</p> }
    </div>
  `,
  styles: [`
    .bc { position:relative; display:flex; flex-direction:column; gap:10px; padding:18px 20px; overflow:hidden; }
    .bc--hero { background:linear-gradient(135deg,var(--brand-600),var(--brand-700)); border-color:transparent; color:#fff; }
    .bc--hero .text-caption, .bc--hero .bc__hint { color:rgba(255,255,255,.82); }
    .bc__ill { position:absolute; top:-14px; right:-10px; opacity:.9; pointer-events:none; }
    .bc__top { display:flex; align-items:center; gap:10px; }
    .bc__icon { display:grid; place-items:center; width:36px; height:36px; border-radius:10px; }
    .bc__icon mat-icon { font-size:20px; width:20px; height:20px; }
    .bc__icon[data-tone="brand"]   { background:var(--brand-50);   color:var(--brand-600); }
    .bc__icon[data-tone="success"] { background:var(--success-bg); color:var(--success); }
    .bc__icon[data-tone="warning"] { background:var(--warning-bg); color:var(--warning); }
    .bc__icon[data-tone="danger"]  { background:var(--danger-bg);  color:var(--danger); }
    .bc__icon[data-tone="info"]    { background:var(--info-bg);    color:var(--info); }
    .bc__icon[data-tone="neutral"] { background:var(--neutral-bg); color:var(--neutral); }
    .bc--hero .bc__icon { background:rgba(255,255,255,.18); color:#fff; }
    .bc__val { font:700 29px/1.05 var(--font-sans); letter-spacing:-.02em; margin:0; }
    .bc__hint { font:500 15px var(--font-sans); color:var(--content-muted); margin:0; }
    .bc__sk { width:120px; height:26px; border-radius:6px;
      background:linear-gradient(90deg,var(--surface-muted),var(--surface-border),var(--surface-muted));
      background-size:200% 100%; animation:sh 1.2s infinite; }
    @keyframes sh { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
  `]
})
export class BalanceCard {
  readonly label = input('');
  readonly amount = input<number | null>(0);
  readonly currency = input('INR');
  readonly icon = input('account_balance_wallet');
  readonly tone = input<Tone>('brand');
  readonly hint = input('');
  readonly hero = input(false);
  readonly loading = input(false);

  readonly money = computed(() => formatMoney(this.amount(), this.currency()));
}
