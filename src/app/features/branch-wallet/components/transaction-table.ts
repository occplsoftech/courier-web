import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { UiTable, TableColumn, SortState } from '@shared/components/ui-table/ui-table';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { TransactionTypeBadge } from './transaction-type-badge';
import { WalletTransaction, formatMoney, prettyToken } from '@core/models/wallet.model';

/**
 * Wallet ledger table. Columns: Date, Transaction No, Type, Sub Type, Amount (signed +
 * coloured), Balance After, Reference, Payment Status. A "receipt" action is offered only
 * on entries with a settled payment (or no payment attached at all, e.g. a manual credit).
 * Presentational; sort + actions bubble up to the page.
 */
@Component({
  selector: 'app-transaction-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatIconModule, UiTable, StatusBadge, TransactionTypeBadge],
  template: `
    <app-table [columns]="columns" [rows]="rows()" [loading]="loading()" [sort]="sort()" [startIndex]="startIndex()"
               emptyTitle="No transactions" emptyHint="Recharge or a manual credit will appear here."
               (sortChange)="sortChange.emit($event)">
      <ng-template #row let-t>
        <td><div class="tc">{{ t.createdAt | date:'dd MMM y' }}</div>
            <div class="tc__sub">{{ t.createdAt | date:'HH:mm' }}</div></td>
        <td><span class="mono">{{ t.transactionNo }}</span></td>
        <td><app-transaction-type-badge [type]="t.transactionType" /></td>
        <td>{{ t.subTransactionTypeLabel || pretty(t.subTransactionType) }}</td>
        <td class="amt" [class.amt--cr]="t.transactionType === 'CR'" [class.amt--dr]="t.transactionType === 'DR'">
          {{ t.transactionType === 'CR' ? '+' : '−' }}{{ money(t.amount) }}
        </td>
        <td class="mono">{{ money(t.balanceAfter) }}</td>
        <td>{{ t.referenceId || '—' }}</td>
        <td class="col-actions">
          <button class="rcpt" (click)="receipt.emit(t)" aria-label="Download receipt" title="Download receipt">
            <mat-icon>receipt_long</mat-icon>
          </button>
        </td>
      </ng-template>
    </app-table>
  `,
  styles: [`
    .tc { font:600 16px var(--font-sans); }
    .tc__sub { font:400 15px var(--font-sans); color:var(--content-muted); }
    .mono { font:600 16px var(--font-mono, ui-monospace); color:var(--content-fg); }
    .amt { font:700 17px var(--font-mono, ui-monospace); white-space:nowrap; }
    .amt--cr { color:var(--success); }
    .amt--dr { color:var(--danger); }
    .dash { color:var(--content-muted); }
    .col-actions { text-align:right; width:48px; }
    .rcpt { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .rcpt:hover { background:var(--surface-muted); color:var(--brand-600); }
  `]
})
export class TransactionTable {
  readonly rows = input<WalletTransaction[]>([]);
  readonly startIndex = input(0);
  readonly loading = input(false);
  readonly sort = input<SortState | null>(null);
  /** Wallet currency, so amounts format consistently even though a txn carries no currency. */
  readonly currency = input('INR');

  readonly sortChange = output<SortState>();
  readonly receipt = output<WalletTransaction>();

  readonly columns: TableColumn<WalletTransaction>[] = [
    { key: 'createdAt', header: 'Date', sortable: true },
    { key: 'transactionNo', header: 'Transaction No', sortable: true },
    { key: 'transactionType', header: 'Type', sortable: true, width: '110px' },
    { key: 'subTransactionType', header: 'Sub Type' },
    { key: 'amount', header: 'Amount', sortable: true, align: 'left' },
    { key: 'balanceAfter', header: 'Balance After' },
    { key: 'referenceId', header: 'Reference' },
    { key: 'actions', header: '', width: '48px', align: 'right' }
  ];

  pretty(v: string): string { return prettyToken(v); }
  money(n: number): string { return formatMoney(n, this.currency()); }
}
