import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { map } from 'rxjs/operators';
import { environment } from '@env/environment';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { NotificationService } from '@core/services/notification.service';
import { WalletTransaction, RechargeRequest, RechargeOrderResponse, formatMoney } from '@core/models/wallet.model';
import { BranchWalletService } from '../branch-wallet.service';
import { RazorpayService } from '@core/services/razorpay.service';

export interface RechargeDialogData {
  branchId: string;
  walletName: string;
  currency: string;
}

const QUICK = [500, 1000, 2000, 5000];

/**
 * Quick wallet recharge via Razorpay Checkout: open a gateway order (POST recharge/order),
 * hand it to Checkout, then settle the signed result (POST recharge) — the only recharge
 * path the backend supports. Returns the settled WalletTransaction. No amounts or keys are
 * invented — the order comes from the backend. If no gateway is configured, the order call
 * 422s with the backend's own message; a company admin can credit the wallet manually instead.
 */
@Component({
  selector: 'app-recharge-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatDialogModule, UiInput, UiButton],
  template: `
    <div class="md">
      <h2 class="text-h2">Recharge wallet</h2>
      <p class="text-caption">{{ data.walletName }}</p>
      <form [formGroup]="form" (ngSubmit)="pay()" class="md__form">
        <label class="amt">
          <span class="amt__l">Amount<i>*</i></span>
          <div class="amt__wrap" [class.amt__wrap--err]="invalid('amount')">
            <span class="amt__cur">{{ data.currency }}</span>
            <input class="amt__i" type="number" min="1" max="999999" step="1" maxlength="6" formControlName="amount" placeholder="0.00" (input)="clampAmount($event)" />
          </div>
          @if (invalid('amount')) { <span class="amt__err">Enter an amount up to 999999.</span> }
        </label>
        <div class="quick">
          @for (q of quick; track q) {
            <button type="button" class="quick__b" (click)="setAmount(q)">+{{ money(q) }}</button>
          }
        </div>
        <app-input [control]="c('remarks')" label="Remarks" placeholder="Optional note" [maxLength]="300" />
        <div class="md__actions">
          <app-button variant="stroked" (pressed)="ref.close(null)">Cancel</app-button>
          <app-button type="submit" icon="lock" [loading]="busy()">Pay {{ money(amount()) }}</app-button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .md { padding:24px; width:460px; max-width:92vw; display:flex; flex-direction:column; gap:8px; }
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
    .quick { display:flex; flex-wrap:wrap; gap:8px; }
    .quick__b { border:1px solid var(--surface-border); background:var(--surface); color:var(--content-fg);
      font:600 16px var(--font-sans); padding:6px 12px; border-radius:999px; cursor:pointer; }
    .quick__b:hover { background:var(--brand-50); border-color:var(--brand-200); color:var(--brand-700); }
  `]
})
export class RechargeDialog {
  readonly ref = inject(MatDialogRef<RechargeDialog>);
  readonly data = inject<RechargeDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(BranchWalletService);
  private readonly razorpay = inject(RazorpayService);
  private readonly notify = inject(NotificationService);

  readonly busy = signal(false);
  protected readonly quick = QUICK;

  protected readonly form: FormGroup = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(1), Validators.max(999999)]],
    remarks: ['', Validators.maxLength(300)]
  });

  // FormControl.value is a plain property, not a signal — computed() would never see a
  // dependency to invalidate on and would freeze at the initial value. valueChanges is the
  // reactive source that actually fires as the user types.
  protected readonly amount = toSignal(
    this.form.controls['amount'].valueChanges.pipe(map((v) => Number(v) || 0)),
    { initialValue: 0 }
  );
  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }
  protected invalid(name: string): boolean { const ct = this.c(name); return ct.invalid && (ct.touched || ct.dirty); }
  protected money(n: number): string { return formatMoney(n, this.data.currency); }
  protected setAmount(n: number): void { this.c('amount').setValue((Number(this.c('amount').value) || 0) + n); this.c('amount').markAsDirty(); }

  protected clampAmount(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.value.length > 6) {
      input.value = input.value.slice(0, 6);
      this.c('amount').setValue(Number(input.value));
    }
  }

  pay(): void {
    if (this.busy()) return;
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();
    this.busy.set(true);
    this.service.openRechargeOrder({
      branchId: this.data.branchId,
      amount: Number(v.amount),
      remarks: v.remarks?.trim() || null
    }).subscribe({
      next: (order) => this.runCheckout(order),
      error: (e) => { this.busy.set(false); this.notify.error(e?.error?.message ?? 'Could not start the recharge.'); }
    });
  }

  private runCheckout(order: RechargeOrderResponse): void {
    this.razorpay.checkout(order, environment.appName).then((r) => {
      const body: RechargeRequest = {
        branchId: this.data.branchId,
        gatewayOrderId: r.razorpay_order_id,
        paymentReference: r.razorpay_payment_id,
        signature: r.razorpay_signature
      };
      this.service.recharge(body).subscribe({
        next: (t: WalletTransaction) => { this.busy.set(false); this.notify.success('Wallet recharged.'); this.ref.close(t); },
        error: (e) => { this.busy.set(false); this.notify.error(e?.error?.message ?? 'Payment could not be verified.'); }
      });
    }).catch((e: Error) => {
      this.busy.set(false);
      if (e?.message !== 'DISMISSED') this.notify.error(e?.message ?? 'Payment failed.');
    });
  }
}
