import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { environment } from '@env/environment';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { WalletResponse, WalletTransaction, RechargeOrderResponse, formatMoney } from '@core/models/wallet.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { RazorpayService } from '@core/services/razorpay.service';
import { CompanyLetterhead, CompanyProfileService } from '@features/company/company-profile.service';
import { BranchWalletService } from './branch-wallet.service';
import { downloadReceipt } from './receipt.util';

const RECHARGERS = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER, AppRole.FINANCE_USER];
const QUICK = [500, 1000, 2000, 5000, 10000];

type Phase = 'form' | 'processing' | 'success' | 'failed';

/**
 * Recharge Wallet — a dedicated page for topping up the caller's branch wallet (or, for a
 * `COMPANY_ADMIN`, whichever branch `?branchId=` names) via Razorpay Checkout: open a
 * gateway order, run Checkout, then settle the signed result. This is the only recharge
 * path the backend supports — there is no offline/manual recharge call; an admin tops up
 * offline money through the Credit action instead. If no gateway is configured, opening the
 * order 422s with the backend's own message. Nothing is invented — the order and every
 * amount come from the backend.
 */
@Component({
  selector: 'app-wallet-recharge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatIconModule, UiCard, UiLoader, UiButton, UiInput],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Recharge Wallet</h1>
          <p class="text-caption">{{ wallet()?.branchName || 'Branch wallet' }} — top up the prepaid balance.</p></div>
      </header>

      @if (loading()) {
        <app-loader [minHeight]="320" caption="Loading wallet…" />
      } @else if (!wallet()) {
        <app-card><p class="empty">Wallet not found or outside your scope.</p></app-card>
      } @else {
        <div class="rc">
          <app-card title="Amount" subtitle="Enter how much to add — you'll pay through Razorpay Checkout.">
            @if (phase() === 'success') {
              <div class="state state--ok">
                <mat-icon>check_circle</mat-icon>
                <div><strong>Recharge successful</strong>
                  <p>{{ money(settled()!.amount) }} added</p></div>
              </div>
              <div class="state__bar">
                <app-button variant="stroked" icon="receipt_long" (pressed)="receipt()">Download Receipt</app-button>
                <app-button icon="add_card" (pressed)="reset()">New Recharge</app-button>
              </div>
            } @else if (phase() === 'failed') {
              <div class="state state--err">
                <mat-icon>error</mat-icon>
                <div><strong>Recharge not completed</strong><p>{{ error() }}</p></div>
              </div>
              <div class="state__bar"><app-button icon="refresh" (pressed)="reset()">Try Again</app-button></div>
            } @else {
              <form [formGroup]="form" (ngSubmit)="pay()" class="rform">
                <label class="amt">
                  <span class="amt__l">Amount<i>*</i></span>
                  <div class="amt__wrap" [class.amt__wrap--err]="invalid('amount')">
                    <span class="amt__cur">{{ cur() }}</span>
                    <input class="amt__i" type="number" min="1" max="999999" step="1" maxlength="6" formControlName="amount" placeholder="0.00" (input)="clampAmount($event)" />
                  </div>
                  @if (invalid('amount')) { <span class="amt__err">Enter an amount up to 999999.</span> }
                </label>
                <div class="quick">
                  @for (q of quick; track q) {
                    <button type="button" class="quick__b" (click)="add(q)">+{{ money(q) }}</button>
                  }
                </div>
                <app-input [control]="c('remarks')" label="Remarks" placeholder="Optional note" [maxLength]="300" />
                <div class="rform__bar">
                  <app-button variant="stroked" (pressed)="back()">Cancel</app-button>
                  <app-button type="submit" icon="lock" [loading]="phase() === 'processing'">
                    Pay {{ money(amount()) }}
                  </app-button>
                </div>
              </form>
            }
          </app-card>

          <aside class="rc__side">
            <app-card title="Wallet">
              <dl class="kv">
                <dt>Wallet No</dt><dd class="mono">{{ wallet()!.walletNumber }}</dd>
                <dt>Available</dt><dd class="strong">{{ money(wallet()!.availableBalance) }}</dd>
                <dt>Total</dt><dd>{{ money(wallet()!.totalBalance) }}</dd>
                <dt>Hold</dt><dd>{{ money(wallet()!.holdBalance) }}</dd>
              </dl>
            </app-card>
            <app-card title="Payment Status">
              <ol class="steps">
                <li [class.on]="stepDone(1)" [class.cur]="phase() === 'form'"><span>1</span>Enter amount</li>
                <li [class.on]="stepDone(2)" [class.cur]="phase() === 'processing'"><span>2</span>Authorise payment</li>
                <li [class.on]="stepDone(3)" [class.cur]="phase() === 'success'"><span>3</span>Wallet credited</li>
              </ol>
            </app-card>
          </aside>
        </div>
      }
    </div>
  `,
  styles: [`
    .rc { display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:16px; align-items:start; }
    .rform { display:flex; flex-direction:column; gap:16px; }
    .rform__bar { display:flex; justify-content:flex-end; gap:10px; margin-top:4px; }
    .amt { display:flex; flex-direction:column; gap:6px; }
    .amt__l { font:500 16px var(--font-sans); color:var(--content-fg); } .amt__l i { color:var(--danger); margin-left:2px; font-style:normal; }
    .amt__wrap { display:flex; align-items:center; gap:8px; height:52px; padding:0 16px; background:var(--surface);
      border:1px solid var(--surface-border); border-radius:var(--r-field); transition:.15s; }
    .amt__wrap:focus-within { border-color:var(--brand-500); box-shadow:0 0 0 3px var(--brand-100); }
    .amt__wrap--err { border-color:var(--danger); }
    .amt__cur { font:600 17px var(--font-sans); color:var(--content-muted); }
    .amt__i { border:0; outline:0; background:transparent; flex:1; font:700 27px var(--font-sans); color:var(--content-fg); }
    .amt__err { font:500 15px var(--font-sans); color:var(--danger); }
    .quick { display:flex; flex-wrap:wrap; gap:8px; }
    .quick__b { border:1px solid var(--surface-border); background:var(--surface); color:var(--content-fg);
      font:600 16px var(--font-sans); padding:6px 12px; border-radius:999px; cursor:pointer; }
    .quick__b:hover { background:var(--brand-50); border-color:var(--brand-200); color:var(--brand-700); }
    .state { display:flex; gap:12px; align-items:flex-start; padding:16px; border-radius:var(--r-field); }
    .state mat-icon { font-size:28px; width:28px; height:28px; flex:0 0 auto; }
    .state strong { font:700 18px var(--font-sans); } .state p { margin:2px 0 0; font:400 16px var(--font-sans); color:var(--content-muted); }
    .state--ok { background:var(--success-bg); } .state--ok mat-icon { color:var(--success); }
    .state--err { background:var(--danger-bg); } .state--err mat-icon { color:var(--danger); }
    .state__bar { display:flex; justify-content:flex-end; gap:10px; margin-top:16px; }
    .kv { display:grid; grid-template-columns:auto 1fr; gap:10px 16px; margin:0; }
    .kv dt { font:500 16px var(--font-sans); color:var(--content-muted); }
    .kv dd { font:600 17px var(--font-sans); color:var(--content-fg); margin:0; text-align:right; }
    .kv .strong { color:var(--brand-700); font-weight:700; } .mono { font-family:var(--font-mono, ui-monospace); }
    .steps { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:14px; }
    .steps li { display:flex; align-items:center; gap:10px; font:500 16px var(--font-sans); color:var(--content-muted); }
    .steps li span { display:grid; place-items:center; width:24px; height:24px; border-radius:999px; flex:0 0 auto;
      background:var(--surface-muted); color:var(--content-muted); font:700 15px var(--font-sans); border:1px solid var(--surface-border); }
    .steps li.on { color:var(--content-fg); } .steps li.on span { background:var(--success); color:#fff; border-color:transparent; }
    .steps li.cur span { background:var(--brand-600); color:#fff; border-color:transparent; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
    @media (max-width:860px){ .rc { grid-template-columns:1fr; } }
  `]
})
export class WalletRecharge implements OnInit {
  private readonly service = inject(BranchWalletService);
  private readonly razorpay = inject(RazorpayService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly auth = inject(AuthService);
  private readonly companyProfile = inject(CompanyProfileService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly loading = signal(true);
  readonly wallet = signal<WalletResponse | null>(null);
  private readonly company = signal<CompanyLetterhead | null>(null);
  readonly phase = signal<Phase>('form');
  readonly settled = signal<WalletTransaction | null>(null);
  readonly error = signal('');

  private readonly branchId = toSignal(
    this.route.queryParamMap.pipe(map((p) => p.get('branchId'))),
    { initialValue: null as string | null }
  );

  protected readonly quick = QUICK;
  readonly cur = computed(() => this.wallet()?.currency ?? 'INR');

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
  money(n: number | null | undefined): string { return formatMoney(n, this.cur()); }
  add(n: number): void { this.c('amount').setValue((Number(this.c('amount').value) || 0) + n); this.c('amount').markAsDirty(); }

  clampAmount(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.value.length > 6) {
      input.value = input.value.slice(0, 6);
      this.c('amount').setValue(Number(input.value));
    }
  }
  stepDone(n: number): boolean {
    const p = this.phase();
    if (n === 1) return p !== 'form';
    if (n === 2) return p === 'success';
    return p === 'success';
  }

  constructor() {
    this.companyProfile.get().pipe(catchError(() => of(null))).subscribe((c) => this.company.set(c));
    effect(() => {
      const branchId = this.branchId();
      this.loading.set(true);
      this.service.get(branchId).subscribe({
        next: (w) => { this.wallet.set(w); this.loading.set(false); },
        error: () => { this.wallet.set(null); this.loading.set(false); }
      });
    });
  }

  ngOnInit(): void {
    if (!this.perms.canAccess({ roles: RECHARGERS, permissions: ['WALLET_RECHARGE'] })) {
      this.router.navigate(['/unauthorized']); return;
    }
    this.breadcrumb.set([{ label: 'Finance' }, { label: 'Branch Wallet', route: '/finance/branch-wallet' },
      { label: 'Recharge' }]);
  }

  back(): void {
    const branchId = this.branchId();
    this.router.navigate(['/finance/branch-wallet'], { queryParams: branchId ? { branchId } : {} });
  }
  reset(): void { this.phase.set('form'); this.settled.set(null); this.error.set(''); this.form.reset(); }

  receipt(): void {
    const w = this.wallet(); const t = this.settled();
    if (w && t) downloadReceipt(t, w, environment.appName, this.auth.companyLogo(), this.company());
  }

  pay(): void {
    if (this.phase() === 'processing') return;
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();
    this.phase.set('processing');
    this.service.openRechargeOrder({
      branchId: this.branchId(),
      amount: Number(v.amount),
      remarks: v.remarks?.trim() || null
    }).subscribe({
      next: (order) => this.runCheckout(order),
      error: (e) => this.fail(e?.error?.message ?? 'Could not start the recharge.')
    });
  }

  private runCheckout(order: RechargeOrderResponse): void {
    this.razorpay.checkout(order, environment.appName).then((r) => {
      this.service.recharge({
        branchId: this.branchId(),
        gatewayOrderId: r.razorpay_order_id,
        paymentReference: r.razorpay_payment_id,
        signature: r.razorpay_signature
      }).subscribe({
        next: (t) => this.done(t),
        error: (e) => this.fail(e?.error?.message ?? 'Payment could not be verified.')
      });
    }).catch((e: Error) => this.fail(e?.message === 'DISMISSED' ? 'Payment was cancelled.' : (e?.message ?? 'Payment failed.')));
  }

  private done(t: WalletTransaction): void {
    this.settled.set(t);
    this.notify.success('Wallet recharged.');
    this.service.get(this.branchId()).subscribe({ next: (w) => this.wallet.set(w), error: () => {} });
    this.phase.set('success');
  }

  private fail(msg: string): void { this.error.set(msg); this.phase.set('failed'); this.notify.error(msg); }
}
