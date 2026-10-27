import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { Page } from '@core/models/page.model';
import { WalletTransaction, formatMoney, prettyToken } from '@core/models/wallet.model';
import { CustomerWallet, CustomerWalletService } from '../customer-wallet.service';
import { CustomerWalletDialog } from './customer-wallet-dialog';

const PAGE_SIZE = 10;

/**
 * A business customer's prepaid wallet on the customer page: balance, the latest ledger entries, and — for a company admin —
 * manual credit and debit. The customer tops it up in the portal (or asks for a top-up, approved under Top-up Requests); this is
 * where staff see the result and correct it. Money moves only on the server; this card never computes a balance.
 */
@Component({
  selector: 'app-customer-wallet-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, UiCard, UiButton],
  template: `
    <app-card title="Wallet" subtitle="Prepaid balance this customer pays for courier bookings from.">
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      } @else if (!wallet()) {
        <p class="muted">Loading…</p>
      } @else {
        <div class="summary">
          <div>
            <p class="label">Available</p>
            <p class="amount" data-testid="available">{{ money(wallet()!.availableBalance) }}</p>
          </div>
          <dl class="kv">
            <dt>Wallet</dt><dd class="mono">{{ wallet()!.walletNumber }}</dd>
            <dt>Status</dt><dd><span class="badge" [class.badge--ok]="wallet()!.status === 'ACTIVE'">{{ wallet()!.status }}</span></dd>
            @if (wallet()!.holdBalance > 0) { <dt>On hold</dt><dd>{{ money(wallet()!.holdBalance) }}</dd> }
          </dl>
          @if (canAdjust()) {
            <div class="bar">
              <app-button icon="add" (pressed)="adjust('credit')">Credit</app-button>
              <app-button variant="stroked" icon="remove" (pressed)="adjust('debit')">Debit</app-button>
            </div>
          }
        </div>

        @if (entries(); as p) {
          @if (!p.content.length) {
            <p class="muted">No transactions yet.</p>
          } @else {
            <div class="scroll">
              <table class="tbl">
                <thead><tr><th>Date</th><th>Details</th><th class="r">Amount</th><th class="r">Balance</th></tr></thead>
                <tbody>
                  @for (t of p.content; track t.id) {
                    <tr>
                      <td>{{ t.createdAt | date: 'dd MMM y, HH:mm' }}</td>
                      <td>{{ t.subTransactionTypeLabel || pretty(t.subTransactionType) }}
                        <span class="sub">{{ t.transactionNo }}@if (t.remarks) { · {{ t.remarks }} }</span></td>
                      <td class="r amt" [class.cr]="t.transactionType === 'CR'" [class.dr]="t.transactionType === 'DR'">
                        {{ t.transactionType === 'CR' ? '+' : '−' }}{{ money(t.amount) }}</td>
                      <td class="r mono">{{ money(t.balanceAfter) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (p.totalPages > 1) {
              <nav class="pager" aria-label="Wallet statement pages">
                <app-button variant="stroked" [disabled]="p.page === 0" (pressed)="load(p.page - 1)">Previous</app-button>
                <span class="muted">Page {{ p.page + 1 }} of {{ p.totalPages }}</span>
                <app-button variant="stroked" [disabled]="p.page + 1 >= p.totalPages" (pressed)="load(p.page + 1)">Next</app-button>
              </nav>
            }
          }
        }
      }
    </app-card>
  `,
  styles: [`
    .muted { color:var(--content-muted); font:400 14px var(--font-sans); margin:0; }
    .error { color:var(--danger); font:500 14px var(--font-sans); margin:0; }
    .summary { display:flex; align-items:center; gap:28px; flex-wrap:wrap; padding-bottom:14px; }
    .label { margin:0; font:600 12px var(--font-sans); text-transform:uppercase; letter-spacing:.06em; color:var(--content-muted); }
    .amount { margin:2px 0 0; font:800 28px var(--font-sans); letter-spacing:-.02em; color:var(--content-fg); }
    .kv { display:grid; grid-template-columns:auto 1fr; gap:6px 14px; margin:0; }
    .kv dt { font:500 13px var(--font-sans); color:var(--content-muted); }
    .kv dd { font:600 14px var(--font-sans); color:var(--content-fg); margin:0; }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .badge { display:inline-flex; padding:2px 10px; border-radius:999px; font:600 11px var(--font-sans); background:var(--warning-bg); color:var(--warning); }
    .badge--ok { background:var(--success-bg); color:var(--success); }
    .bar { display:flex; gap:10px; margin-left:auto; }
    .scroll { overflow-x:auto; border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .tbl { width:100%; border-collapse:collapse; font:400 13px var(--font-sans); }
    .tbl th { text-align:left; padding:10px 14px; background:var(--surface-muted); color:var(--content-muted); font:600 11px var(--font-sans); text-transform:uppercase; letter-spacing:.03em; white-space:nowrap; }
    .tbl td { padding:10px 14px; border-top:1px solid var(--surface-border); vertical-align:top; }
    .r { text-align:right; white-space:nowrap; }
    .sub { display:block; color:var(--content-muted); font-size:12px; }
    .amt { font-weight:700; font-family:var(--font-mono, ui-monospace); }
    .cr { color:var(--success); } .dr { color:var(--danger); }
    .pager { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:12px; }
  `]
})
export class CustomerWalletCard implements OnInit {
  readonly customerId = input.required<string>();
  readonly customerName = input<string>('');
  /** Whether the signed-in user may credit and debit (COMPANY_ADMIN). Reading is gated by the page that shows the card. */
  readonly canAdjust = input(false);

  private readonly service = inject(CustomerWalletService);
  private readonly dialog = inject(MatDialog);

  readonly wallet = signal<CustomerWallet | null>(null);
  readonly entries = signal<Page<WalletTransaction> | null>(null);
  readonly error = signal<string | null>(null);
  protected readonly currency = computed(() => this.wallet()?.currency ?? 'INR');

  ngOnInit(): void {
    this.refresh();
  }

  protected money(n: number): string { return formatMoney(n, this.currency()); }
  protected pretty(v: string): string { return prettyToken(v); }

  load(page: number): void {
    this.service.transactions(this.customerId(), { page, size: PAGE_SIZE }).subscribe({
      next: (p) => this.entries.set(p),
      error: (e) => this.fail(e?.error?.message ?? 'The wallet statement could not be loaded.')
    });
  }

  adjust(mode: 'credit' | 'debit'): void {
    const w = this.wallet();
    if (!w) return;
    this.dialog.open(CustomerWalletDialog, {
      autoFocus: false, panelClass: 'app-dialog',
      data: { mode, customerId: this.customerId(), customerName: this.customerName(), currency: w.currency, availableBalance: w.availableBalance }
    }).afterClosed().subscribe((entry) => { if (entry) this.refresh(); });
  }

  /** The wallet and its statement load side by side and usually fail together: keep the first message. */
  private fail(message: string): void { this.error.update((current) => current ?? message); }

  private refresh(): void {
    this.service.wallet(this.customerId()).subscribe({
      next: (w) => this.wallet.set(w),
      error: (e) => this.fail(e?.error?.message ?? 'The wallet could not be loaded.')
    });
    this.load(0);
  }
}
