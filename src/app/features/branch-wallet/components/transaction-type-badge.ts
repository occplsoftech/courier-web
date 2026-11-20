import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TransactionType } from '@core/models/wallet.model';

/** Credit / Debit pill with a directional arrow — green up for credit, red down for debit. */
@Component({
  selector: 'app-transaction-type-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <span class="tt" [attr.data-type]="type()">
      <mat-icon>{{ type() === 'CR' ? 'south_west' : 'north_east' }}</mat-icon>
      {{ type() === 'CR' ? 'Credit' : 'Debit' }}
    </span>
  `,
  styles: [`
    .tt { display:inline-flex; align-items:center; gap:4px; height:22px; padding:0 9px 0 6px;
      border-radius:var(--r-pill); font:600 15px/1 var(--font-sans); }
    .tt mat-icon { font-size:14px; width:14px; height:14px; }
    .tt[data-type="CR"] { background:var(--success-bg); color:var(--success); }
    .tt[data-type="DR"]  { background:var(--danger-bg);  color:var(--danger); }
  `]
})
export class TransactionTypeBadge {
  readonly type = input.required<TransactionType>();
}
