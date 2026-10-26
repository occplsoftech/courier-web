import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { NotificationService } from '@core/services/notification.service';
import {
  CREDIT_SUB_TYPES, DEBIT_SUB_TYPES, SubTransactionType, WalletTransaction, formatMoney, subTypeLabel
} from '@core/models/wallet.model';
import { CustomerWalletService } from '../customer-wallet.service';

export interface CustomerWalletDialogData {
  mode: 'credit' | 'debit';
  customerId: string;
  customerName: string;
  currency: string;
  availableBalance: number;
}

const options = (types: SubTransactionType[]): SelectOption[] => types.map((s) => ({ value: s, label: subTypeLabel(s) }));

/**
 * A company admin's manual credit or debit of a customer's wallet. Settles at once and returns the ledger entry. A debit larger than
 * the available balance is refused by the server (no overdraft), and its message is shown as is. Nothing here computes a balance.
 */
@Component({
  selector: 'app-customer-wallet-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatDialogModule, UiInput, UiSelect, UiButton],
  template: `
    <div class="md">
      <h2 class="text-h2">{{ credit ? 'Credit' : 'Debit' }} wallet</h2>
      <p class="text-caption">{{ data.customerName }} · available {{ money(data.availableBalance) }}</p>
      <form [formGroup]="form" (ngSubmit)="save()" class="md__form">
        <label class="amt">
          <span class="amt__l">Amount<i>*</i></span>
          <div class="amt__wrap" [class.amt__wrap--err]="invalid('amount')">
            <span class="amt__cur">{{ data.currency }}</span>
            <input class="amt__i" type="number" min="0.01" step="0.01" formControlName="amount" placeholder="0.00" aria-label="Amount" />
          </div>
          @if (invalid('amount')) { <span class="amt__err">Enter an amount greater than zero.</span> }
        </label>
        <app-select [control]="c('subTransactionType')" label="Reason" [options]="reasons" placeholder="Select a reason" />
        <app-input [control]="c('referenceId')" label="Reference" placeholder="Optional — e.g. UTR / voucher" [maxLength]="100" />
        <app-input [control]="c('remarks')" label="Remarks" placeholder="Shown on the customer's statement" [maxLength]="500" />
        @if (error()) { <p class="amt__err" role="alert">{{ error() }}</p> }
        <div class="md__actions">
          <app-button variant="stroked" (pressed)="ref.close(null)">Cancel</app-button>
          <app-button type="submit" [icon]="credit ? 'add' : 'remove'" [loading]="busy()">{{ credit ? 'Credit' : 'Debit' }}</app-button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .md { padding:24px; width:440px; max-width:92vw; display:flex; flex-direction:column; gap:8px; }
    .md__form { display:flex; flex-direction:column; gap:16px; margin-top:8px; }
    .md__actions { display:flex; justify-content:flex-end; gap:10px; margin-top:4px; }
    .amt { display:flex; flex-direction:column; gap:6px; }
    .amt__l { font:500 13px var(--font-sans); color:var(--content-fg); }
    .amt__l i { color:var(--danger); margin-left:2px; font-style:normal; }
    .amt__wrap { display:flex; align-items:center; gap:8px; height:46px; padding:0 14px; background:var(--surface);
      border:1px solid var(--surface-border); border-radius:var(--r-field); transition:.15s; }
    .amt__wrap:focus-within { border-color:var(--brand-500); box-shadow:0 0 0 3px var(--brand-100); }
    .amt__wrap--err { border-color:var(--danger); }
    .amt__cur { font:600 13px var(--font-sans); color:var(--content-muted); }
    .amt__i { border:0; outline:0; background:transparent; flex:1; font:700 20px var(--font-sans); color:var(--content-fg); }
    .amt__err { font:500 12px var(--font-sans); color:var(--danger); margin:0; }
  `]
})
export class CustomerWalletDialog {
  readonly ref = inject(MatDialogRef<CustomerWalletDialog>);
  readonly data = inject<CustomerWalletDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(CustomerWalletService);
  private readonly notify = inject(NotificationService);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  protected readonly credit = this.data.mode === 'credit';
  protected readonly reasons = options(this.credit ? CREDIT_SUB_TYPES : DEBIT_SUB_TYPES);

  readonly form: FormGroup = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    subTransactionType: [(this.credit ? 'MCR' : 'MDB') as SubTransactionType, Validators.required],
    referenceId: ['', Validators.maxLength(100)],
    remarks: ['', Validators.maxLength(500)]
  });

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }
  protected invalid(name: string): boolean { const ct = this.c(name); return ct.invalid && (ct.touched || ct.dirty); }
  protected money(n: number): string { return formatMoney(n, this.data.currency); }

  save(): void {
    if (this.busy()) return;
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();
    const body = {
      amount: Number(v.amount),
      subTransactionType: v.subTransactionType as SubTransactionType,
      referenceId: v.referenceId?.trim() || null,
      remarks: v.remarks?.trim() || null
    };
    this.busy.set(true);
    this.error.set(null);
    const call = this.credit ? this.service.credit(this.data.customerId, body) : this.service.debit(this.data.customerId, body);
    call.subscribe({
      next: (t: WalletTransaction) => {
        this.busy.set(false);
        this.notify.success(this.credit ? 'Wallet credited.' : 'Wallet debited.');
        this.ref.close(t);
      },
      error: (e) => { this.busy.set(false); this.error.set(e?.error?.message ?? `Could not ${this.data.mode} the wallet.`); }
    });
  }
}
