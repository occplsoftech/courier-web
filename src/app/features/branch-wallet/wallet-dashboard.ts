import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map } from 'rxjs/operators';
import { of } from 'rxjs';
import { CompanyLetterhead, CompanyProfileService } from '@features/company/company-profile.service';
import { ActivatedRoute, Router } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { environment } from '@env/environment';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { WalletResponse, WalletSummary, WalletTransaction, formatMoney } from '@core/models/wallet.model';
import { BranchService } from '@features/branch/branch.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { UiAutocomplete } from '@shared/components/ui-autocomplete/ui-autocomplete';
import { BalanceCard } from './components/balance-card';
import { WalletStatusBadge } from './components/wallet-status-badge';
import { TransactionTable } from './components/transaction-table';
import { RechargeDialog } from './components/recharge-dialog';
import { CreditDialog } from './components/credit-dialog';
import { DebitDialog } from './components/debit-dialog';
import { RequestTopupDialog } from './components/request-topup-dialog';
import { BranchWalletService } from './branch-wallet.service';
import { downloadReceipt } from './receipt.util';

const VIEWERS = [AppRole.SUPER_ADMIN, AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER, AppRole.FINANCE_USER];
const RECHARGERS = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER, AppRole.FINANCE_USER];
// Alongside Recharge (direct, self-service), a branch manager may also ask the company
// admin to fund the wallet instead — Request Top-up moves nothing until approved.
const REQUESTERS = [AppRole.BRANCH_MANAGER];
const ADMINS = [AppRole.COMPANY_ADMIN];

/**
 * Branch Wallet — the wallet of the caller's own branch. There is no wallet id in the URL
 * on purpose (the backend has none either): a branch user always sees their own wallet, and
 * a `COMPANY_ADMIN` — who has no branch of their own — picks one, carried as `?branchId=`
 * so the choice survives a refresh or a link. Shows current / available / hold balances,
 * today's credit + debit, the last recharge, today's credit commission, booking/delivery
 * pending commission, and the most recent ledger entries. Money
 * actions (recharge / credit / debit) are gated and open their dialogs, each refreshing the
 * wallet on success. API-only, no mock.
 */
@Component({
  selector: 'app-wallet-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiLoader, UiButton, UiAutocomplete, BalanceCard, WalletStatusBadge, TransactionTable],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Branch Wallet</h1><p class="text-caption">Prepaid balance, ledger and top-up.</p></div>
      </header>

      @if (isAdmin()) {
        <app-card>
          <app-autocomplete [control]="branchControl" label="Branch" [options]="branchOptions()"
                      placeholder="Search branch to view its wallet…" />
        </app-card>
      }

      @if (needsBranchPick()) {
        <app-card><p class="empty">Select a branch above to see its wallet.</p></app-card>
      } @else if (loading()) {
        <app-loader [minHeight]="320" caption="Loading wallet…" />
      } @else if (!summary()) {
        <app-card><p class="empty">Wallet not found or outside your scope.</p></app-card>
      } @else {
        <header class="wd__banner app-card">
          <div class="wd__id">
            <h2 class="text-h2">{{ summary()!.branchName || 'Branch Wallet' }}</h2>
            <div class="wd__tags">
              <app-wallet-status-badge [status]="summary()!.status" />
              <span class="tag mono">{{ summary()!.walletNumber }}</span>
              @if (summary()!.branchCode) { <span class="tag">{{ summary()!.branchCode }}</span> }
            </div>
          </div>
          <div class="wd__actions">
            <app-button variant="stroked" icon="support_agent" (pressed)="raiseTicket()">Raise Ticket</app-button>
            @if (can().recharge) { <app-button icon="add_card" (pressed)="recharge()">Recharge</app-button> }
            @if (can().requestTopup) { <app-button icon="send" (pressed)="requestTopup()">Request Top-up</app-button> }
            @if (can().credit) { <app-button variant="stroked" icon="add" (pressed)="credit()">Credit</app-button> }
            @if (can().debit) { <app-button variant="stroked" icon="remove" (pressed)="debit()">Debit</app-button> }
            @if (isAdmin()) { <app-button variant="stroked" icon="fact_check" (pressed)="topupRequests()">Top-up Requests</app-button> }
          </div>
        </header>

        <section class="wd__grid" data-tour="wallet-grid">
          <app-balance-card [hero]="true" label="Available Balance" icon="account_balance_wallet"
                            [amount]="summary()!.availableBalance" [currency]="cur()" hint="Spendable now" />
          <app-balance-card label="Total Balance" icon="savings" tone="info"
                            [amount]="summary()!.totalBalance" [currency]="cur()" hint="Available + hold" />
          <app-balance-card label="Hold Balance" icon="lock" tone="warning"
                            [amount]="summary()!.holdBalance" [currency]="cur()" hint="Reserved against pending ops" />
          <app-balance-card label="Today's Credit" icon="trending_up" tone="success"
                            [amount]="summary()!.todayCredit" [currency]="cur()" [hint]="today" />
          <app-balance-card label="Today's Debit" icon="trending_down" tone="danger"
                            [amount]="summary()!.todayDebit" [currency]="cur()" [hint]="today" />
          <app-balance-card label="Last Recharge" icon="add_card" tone="brand"
                            [amount]="summary()!.lastRechargeAmount ?? 0" [currency]="cur()" [hint]="lastRechargeHint()" />
        </section>

        <section class="wd__grid" data-tour="commission-grid">
          <app-balance-card label="Today's Credit Commission" icon="paid" tone="success"
                            [amount]="summary()!.todayCreditCommission" [currency]="cur()" [hint]="today" />
          <app-balance-card label="Booking Pending Commission" icon="hourglass_top" tone="warning"
                            [amount]="summary()!.bookingPendingCommission" [currency]="cur()"
                            hint="Not yet dispatched" />
          <app-balance-card label="Delivery Pending Commission" icon="hourglass_bottom" tone="warning"
                            [amount]="summary()!.deliveryPendingCommission" [currency]="cur()"
                            hint="TO_PAY/COD, not yet delivered" />
        </section>

        <app-card title="Recent Transactions" subtitle="The latest activity on this wallet.">
          <div card-actions>
            <app-button variant="text" icon="open_in_new" (pressed)="allTransactions()">View all</app-button>
          </div>
          <app-transaction-table [rows]="recent()" [loading]="txnLoading()" [currency]="cur()" (receipt)="receipt($event)" />
        </app-card>
      }
    </div>
  `,
  styles: [`
    .wd__banner { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:20px 24px; margin-bottom:16px; }
    .wd__id { min-width:0; }
    .wd__tags { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-top:6px; }
    .tag { display:inline-flex; align-items:center; background:var(--surface-muted); border:1px solid var(--surface-border);
      color:var(--content-muted); font:600 14px var(--font-sans); padding:2px 8px; border-radius:6px; }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .wd__actions { display:flex; gap:10px; align-items:center; flex:0 0 auto; }
    .wd__grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; margin-bottom:16px; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
    @media (max-width:960px){ .wd__grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    @media (max-width:600px){ .wd__grid { grid-template-columns:1fr; } .wd__banner { flex-wrap:wrap; } }
  `]
})
export class WalletDashboard implements OnInit {
  private readonly service = inject(BranchWalletService);
  private readonly branches = inject(BranchService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly auth = inject(AuthService);
  private readonly companyProfile = inject(CompanyProfileService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);

  private readonly company = signal<CompanyLetterhead | null>(null);
  readonly loading = signal(true);
  readonly txnLoading = signal(true);
  readonly needsBranchPick = signal(false);
  readonly summary = signal<WalletSummary | null>(null);
  readonly recent = signal<WalletTransaction[]>([]);
  readonly branchOptions = signal<SelectOption[]>([]);
  readonly today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  readonly isAdmin = computed(() => this.perms.hasAnyRole(ADMINS));
  readonly branchControl = new FormControl<string | null>(null);

  private readonly branchIdParam = toSignal(
    this.route.queryParamMap.pipe(map((p) => p.get('branchId'))),
    { initialValue: null as string | null }
  );

  readonly cur = computed(() => this.summary()?.currency ?? 'INR');
  // No `permission` for credit/debit: the catalogue's WALLET module offers only READ/
  // UPDATE/SEARCH/EXPORT/RECHARGE — a manual admin credit/debit is a business action
  // with no corresponding right to grant or revoke, so ADMINS (the role check alone)
  // is the whole gate, same as several roles-only leaves in navigation.config.ts.
  readonly can = computed(() => ({
    recharge: this.perms.canAccess({ roles: RECHARGERS, permissions: ['WALLET_RECHARGE'] }),
    requestTopup: this.perms.canAccess({ roles: REQUESTERS, permissions: [] }),
    credit: this.perms.canAccess({ roles: ADMINS }),
    debit: this.perms.canAccess({ roles: ADMINS })
  }));

  constructor() {
    this.companyProfile.get().pipe(catchError(() => of(null))).subscribe((c) => this.company.set(c));
    effect(() => {
      const branchId = this.branchIdParam();
      this.branchControl.setValue(branchId, { emitEvent: false });
      if (this.isAdmin() && !branchId) {
        this.needsBranchPick.set(true);
        this.loading.set(false);
        return;
      }
      this.needsBranchPick.set(false);
      this.load(branchId);
    });
  }

  ngOnInit(): void {
    if (!this.perms.canAccess({ roles: VIEWERS, permissions: ['WALLET_READ'] })) {
      this.router.navigate(['/unauthorized']); return;
    }
    this.breadcrumb.set([{ label: 'Finance' }, { label: 'Branch Wallet' }]);
    if (this.isAdmin()) this.loadBranches();

    this.branchControl.valueChanges.subscribe((branchId) => {
      this.router.navigate([], { relativeTo: this.route, queryParams: { branchId: branchId || null } });
    });
  }

  private loadBranches(): void {
    this.branches.list({ page: 0, size: 100, sort: 'branchName,asc' }).subscribe({
      next: (p) => this.branchOptions.set(p.content.map((b) => ({ value: b.id, label: `${b.branchName} (${b.branchCode})` }))),
      error: () => this.branchOptions.set([])
    });
  }

  lastRechargeHint(): string {
    const at = this.summary()?.lastRechargeAt;
    return at ? new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No recharge yet';
  }

  private load(branchId: string | null): void {
    this.loading.set(true);
    this.service.summary(branchId).subscribe({
      next: (s) => {
        this.summary.set(s);
        this.breadcrumb.set([{ label: 'Finance' }, { label: s.branchName || 'Branch Wallet' }]);
        this.loading.set(false);
        this.loadRecent(branchId);
      },
      error: () => { this.summary.set(null); this.loading.set(false); }
    });
  }

  private loadRecent(branchId: string | null): void {
    this.txnLoading.set(true);
    this.service.transactions({ ...(branchId ? { branchId } : {}), page: 0, size: 8, sort: 'createdAt,desc' }).subscribe({
      next: (p) => { this.recent.set(p.content); this.txnLoading.set(false); },
      error: () => { this.recent.set([]); this.txnLoading.set(false); }
    });
  }

  money(n: number): string { return formatMoney(n, this.cur()); }

  private queryParams() {
    const branchId = this.branchIdParam();
    return branchId ? { branchId } : {};
  }

  allTransactions(): void { this.router.navigate(['/finance/branch-wallet/transactions'], { queryParams: this.queryParams() }); }

  raiseTicket(): void {
    this.router.navigate(['/support/tickets/new'], { queryParams: { branchId: this.summary()!.branchId } });
  }

  recharge(): void {
    const s = this.summary()!;
    this.dialog.open(RechargeDialog, {
      autoFocus: false, panelClass: 'app-dialog',
      data: { branchId: s.branchId, walletName: s.branchName || s.walletNumber, currency: s.currency }
    }).afterClosed().subscribe((t) => { if (t) this.load(this.branchIdParam()); });
  }

  credit(): void {
    const s = this.summary()!;
    this.dialog.open(CreditDialog, {
      autoFocus: false, panelClass: 'app-dialog',
      data: { branchId: s.branchId, walletName: s.branchName || s.walletNumber, currency: s.currency, currentBalance: s.totalBalance }
    }).afterClosed().subscribe((t) => { if (t) this.load(this.branchIdParam()); });
  }

  debit(): void {
    const s = this.summary()!;
    this.dialog.open(DebitDialog, {
      autoFocus: false, panelClass: 'app-dialog',
      data: { branchId: s.branchId, walletName: s.branchName || s.walletNumber, currency: s.currency, availableBalance: s.availableBalance }
    }).afterClosed().subscribe((t) => { if (t) this.load(this.branchIdParam()); });
  }

  requestTopup(): void {
    const s = this.summary()!;
    this.dialog.open(RequestTopupDialog, {
      autoFocus: false, panelClass: 'app-dialog',
      data: { branchId: s.branchId, walletName: s.branchName || s.walletNumber, currency: s.currency }
    }).afterClosed().subscribe();
  }

  topupRequests(): void { this.router.navigate(['/finance/branch-wallet/topup-requests']); }

  receipt(t: WalletTransaction): void {
    const s = this.summary();
    if (!s) return;
    const w: WalletResponse = {
      id: s.walletId, companyId: '', walletNumber: s.walletNumber, branchId: s.branchId,
      branchCode: s.branchCode, branchName: s.branchName, status: s.status,
      availableBalance: s.availableBalance, holdBalance: s.holdBalance, totalBalance: s.totalBalance,
      currency: s.currency, createdAt: '', updatedAt: '', version: 0
    };
    downloadReceipt(t, w, environment.appName, this.auth.companyLogo(), this.company());
  }
}
