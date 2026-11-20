import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import {
  WalletTransactionSearchRequest, TransactionType, SubTransactionType,
  TRANSACTION_SUB_TYPES, prettyToken, subTypeLabel
} from '@core/models/wallet.model';

const TYPES: SelectOption[] = [{ value: 'CR', label: 'Credit' }, { value: 'DR', label: 'Debit' }];
const SUB_TYPES: SelectOption[] = TRANSACTION_SUB_TYPES.map((s) => ({ value: s, label: subTypeLabel(s) }));

/**
 * Advanced filter for the wallet ledger. Emits a WalletTransactionSearchRequest; the parent
 * merges it into the page query. Covers date range, transaction type, sub type, payment
 * status and reference id — the filters `GET /branch-wallet/transactions` accepts.
 */
@Component({
  selector: 'app-transaction-filter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiInput, UiSelect, UiButton],
  template: `
    <form [formGroup]="form" (ngSubmit)="apply()" class="tf">
      <div class="tf__row">
        <label class="dt"><span class="dt__l">From</span>
          <input class="dt__i" type="date" [formControl]="c('fromDate')" /></label>
        <label class="dt"><span class="dt__l">To</span>
          <input class="dt__i" type="date" [formControl]="c('toDate')" /></label>
      </div>
      <app-select [control]="c('transactionType')" label="Transaction Type" [options]="types" [multiple]="true" placeholder="Any type" />
      <app-select [control]="c('subTransactionType')" label="Sub Transaction Type" [options]="subTypes" [multiple]="true" placeholder="Any sub type" />
      <app-input [control]="c('referenceId')" label="Reference" placeholder="e.g. RZP-XXXX / UTR" [maxLength]="100" />

      <div class="tf__bar">
        <app-button variant="text" (pressed)="clear()">Clear all</app-button>
        <app-button type="submit" icon="filter_list">Apply filters</app-button>
      </div>
    </form>
  `,
  styles: [`
    .tf { display:flex; flex-direction:column; gap:16px; }
    .tf__row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .dt { display:flex; flex-direction:column; gap:6px; }
    .dt__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .dt__i { height:42px; padding:0 12px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-field); font:400 17px var(--font-sans); color:var(--content-fg); }
    .dt__i:focus { outline:0; border-color:var(--brand-500); box-shadow:0 0 0 3px var(--brand-100); }
    .tf__bar { display:flex; justify-content:space-between; gap:10px; margin-top:8px; }
    @media (max-width:400px) { .tf__row { grid-template-columns:1fr; } }
  `]
})
export class TransactionFilter {
  private readonly fb = inject(FormBuilder);
  readonly changed = output<WalletTransactionSearchRequest>();

  protected readonly types = TYPES;
  protected readonly subTypes = SUB_TYPES;

  protected readonly form: FormGroup = this.fb.group({
    fromDate: [''], toDate: [''],
    transactionType: [[] as string[]], subTransactionType: [[] as string[]],
    referenceId: ['']
  });

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  protected apply(): void {
    const v = this.form.getRawValue();
    const s = (x: string) => (x && x.trim() ? x.trim() : undefined);
    this.changed.emit({
      fromDate: s(v.fromDate), toDate: s(v.toDate),
      transactionType: v.transactionType?.length ? (v.transactionType as TransactionType[]) : undefined,
      subTransactionType: v.subTransactionType?.length ? (v.subTransactionType as SubTransactionType[]) : undefined,
      referenceId: s(v.referenceId)
    });
  }

  protected clear(): void {
    this.form.reset({ fromDate: '', toDate: '', transactionType: [], subTransactionType: [], referenceId: '' });
    this.changed.emit({});
  }
}
