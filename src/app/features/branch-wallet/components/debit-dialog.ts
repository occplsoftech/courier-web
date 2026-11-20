import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { NotificationService } from '@core/services/notification.service';
import {
  WalletTransaction, DebitRequest, SubTransactionType, DEBIT_SUB_TYPES, formatMoney, subTypeLabel
} from '@core/models/wallet.model';
import { BranchWalletService } from '../branch-wallet.service';

export interface DebitDialogData {
  branchId: string;
  walletName: string;
  currency: string;
  availableBalance: number;
}

const SUB_TYPES: SelectOption[] = DEBIT_SUB_TYPES.map((s) => ({ value: s, label: subTypeLabel(s) }));

/**
 * Manual debit (deduction) of a branch wallet by a COMPANY_ADMIN. Amount is capped at the
 * available balance client-side (the backend is the real guard). Settles immediately and
 * returns the WalletTransaction. No mock: posts straight to /debit.
 */
@Component({
  selector: 'app-debit-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatDialogModule, UiInput, UiSelect, UiButton],
  template: `
    <div class="md">
      <h2 class="text-h2">Debit wallet</h2>
      <p class="text-caption">{{ data.walletName }} · available {{ balance() }}</p>
      <form [formGroup]="form" (ngSubmit)="save()" class="md__form">
        <label class="amt">
          <span class="amt__l">Amount<i>*</i></span>
          <div class="amt__wrap" [class.amt__wrap--err]="invalid('amount')">
            <span class="amt__cur">{{ data.currency }}</span>
            <input class="amt__i" type="number" min="0.01" step="0.01" formControlName="amount" placeholder="0.00" />
          </div>
          @if (invalid('amount')) { <span class="amt__err">{{ amountError() }}</span> }
        </label>
        <app-select [control]="c('subTransactionType')" label="Reason" [options]="subTypes" placeholder="Select a reason" />
        <app-input [control]="c('referenceId')" label="Reference" placeholder="Optional — e.g. voucher / claim" [maxLength]="100" />
        <app-input [control]="c('remarks')" label="Remarks" placeholder="Optional note" [maxLength]="300" />
        <div class="md__actions">
          <app-button variant="stroked" (pressed)="ref.close(null)">Cancel</app-button>
          <app-button type="submit" variant="danger" icon="remove" [loading]="busy()">Debit</app-button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .md { padding:24px; width:440px; max-width:92vw; display:flex; flex-direction:column; gap:8px; }
    .md__form { display:flex; flex-direction:column; gap:16px; margin-top:8px; }
    .md__actions { display:flex; justify-content:flex-end; gap:10px; margin-top:4px; }
    .amt { display:flex; flex-direction:column; gap:6px; }
    .amt__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .amt__l i { color:var(--danger); margin-left:2px; font-style:normal; }
    .amt__wrap { display:flex; align-items:center; gap:8px; height:46px; padding:0 14px; background:var(--surface);
      border:1px solid var(--surface-border); border-radius:var(--r-field); transition:.15s; }
    .amt__wrap:focus-within { border-color:var(--brand-500); box-shadow:0 0 0 3px var(--brand-100); }
    .amt__wrap--err { border-color:var(--danger); }
    .amt__cur { font:600 16px var(--font-sans); color:var(--content-muted); }
    .amt__i { border:0; outline:0; background:transparent; flex:1; font:700 23px var(--font-sans); color:var(--content-fg); }
    .amt__err { font:500 15px var(--font-sans); color:var(--danger); }
  `]
})
export class DebitDialog {
  readonly ref = inject(MatDialogRef<DebitDialog>);
  readonly data = inject<DebitDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(BranchWalletService);
  private readonly notify = inject(NotificationService);

  readonly busy = signal(false);
  protected readonly subTypes = SUB_TYPES;

  protected readonly form: FormGroup = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(0.01), Validators.max(this.data.availableBalance)]],
    subTransactionType: ['MDB' as SubTransactionType, Validators.required],
    referenceId: ['', Validators.maxLength(100)],
    remarks: ['', Validators.maxLength(300)]
  });

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }
  protected invalid(name: string): boolean { const ct = this.c(name); return ct.invalid && (ct.touched || ct.dirty); }
  protected balance(): string { return formatMoney(this.data.availableBalance, this.data.currency); }
  protected amountError(): string {
    return this.c('amount').hasError('max') ? 'Exceeds the available balance.' : 'Enter an amount greater than zero.';
  }

  save(): void {
    if (this.busy()) return;
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();
    const body: DebitRequest = {
      branchId: this.data.branchId,
      amount: Number(v.amount),
      subTransactionType: v.subTransactionType as SubTransactionType,
      referenceId: v.referenceId?.trim() || null,
      remarks: v.remarks?.trim() || null
    };
    this.busy.set(true);
    this.service.debit(body).subscribe({
      next: (t: WalletTransaction) => { this.busy.set(false); this.notify.success('Wallet debited.'); this.ref.close(t); },
      error: (e) => { this.busy.set(false); this.notify.error(e?.error?.message ?? 'Could not debit the wallet.'); }
    });
  }
}
