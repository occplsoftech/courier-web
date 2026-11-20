import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map } from 'rxjs/operators';
import { of } from 'rxjs';
import { CompanyLetterhead, CompanyProfileService } from '@features/company/company-profile.service';
import { ActivatedRoute, Router } from '@angular/router';
import { environment } from '@env/environment';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import {
  WalletResponse, WalletTransaction, WalletTransactionSearchRequest, subTypeLabel
} from '@core/models/wallet.model';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { SortState } from '@shared/components/ui-table/ui-table';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { downloadCsv } from '@shared/utils/csv-export.util';
import { UiDrawer } from '@shared/components/ui-drawer/ui-drawer';
import { TransactionTable } from './components/transaction-table';
import { TransactionFilter } from './components/transaction-filter';
import { BranchWalletService } from './branch-wallet.service';
import { downloadReceipt } from './receipt.util';

const VIEWERS = [AppRole.SUPER_ADMIN, AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER, AppRole.FINANCE_USER];

/**
 * Wallet Transactions — the full ledger for the caller's branch wallet (or, for a
 * `COMPANY_ADMIN`, whichever branch `?branchId=` names): server pagination, sort,
 * debounced search, the advanced filter drawer and CSV export. Each entry with a settled
 * or absent payment can download an HTML receipt. API-only, no mock.
 */
@Component({
  selector: 'app-wallet-transactions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiPagination, UiSearch, UiButton, UiDrawer, TransactionTable, TransactionFilter],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">Wallet Transactions</h1>
          <p class="text-caption">{{ wallet()?.branchName || 'Branch wallet' }} — {{ page().totalElements }} entries.</p>
        </div>
        <div class="page__actions">
          <app-search placeholder="Search transaction no, reference…" (changed)="onSearch($event)" />
          <app-button variant="stroked" icon="filter_list" (pressed)="filterOpen.set(true)">
            Filters@if (activeFilters()) { <span class="fbadge">{{ activeFilters() }}</span> }
          </app-button>
          <app-button variant="stroked" icon="download" [loading]="exporting()" (pressed)="exportCsv()">Export</app-button>
        </div>
      </header>

      <app-transaction-table [rows]="page().content" [loading]="loading()" [sort]="sort()" [currency]="cur()"
        [startIndex]="page().page * page().size"
                             (sortChange)="onSort($event)" (receipt)="receipt($event)" />

      <app-pagination [page]="page()" (pageChange)="onPage($event)" />

      <app-drawer [open]="filterOpen()" title="Advanced filters" subtitle="Narrow the ledger." (closed)="filterOpen.set(false)">
        <app-transaction-filter (changed)="onFilter($event)" />
      </app-drawer>
    </div>
  `,
  styles: [`
    .fbadge { display:inline-grid; place-items:center; min-width:18px; height:18px; padding:0 5px; margin-left:2px;
      background:var(--brand-600); color:#fff; border-radius:999px; font:700 14px var(--font-sans); }
  `]
})
export class WalletTransactions implements OnInit {
  private readonly service = inject(BranchWalletService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly auth = inject(AuthService);
  private readonly companyProfile = inject(CompanyProfileService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly filterOpen = signal(false);
  readonly wallet = signal<WalletResponse | null>(null);
  private readonly company = signal<CompanyLetterhead | null>(null);
  readonly page = signal<Page<WalletTransaction>>(emptyPage<WalletTransaction>());
  readonly sort = signal<SortState | null>({ active: 'createdAt', direction: 'desc' });

  private readonly branchId = toSignal(
    this.route.queryParamMap.pipe(map((p) => p.get('branchId'))),
    { initialValue: null as string | null }
  );

  private query: PageQuery = { page: 0, size: 20, sort: 'createdAt,desc' };
  private readonly filters = signal<WalletTransactionSearchRequest>({});
  readonly activeFilters = computed(() =>
    Object.values(this.filters()).filter((v) => v != null && (!Array.isArray(v) || v.length)).length);
  readonly cur = computed(() => this.wallet()?.currency ?? 'INR');

  constructor() {
    this.companyProfile.get().pipe(catchError(() => of(null))).subscribe((c) => this.company.set(c));
    effect(() => {
      const branchId = this.branchId();
      this.service.get(branchId).subscribe({ next: (w) => this.wallet.set(w), error: () => this.wallet.set(null) });
      this.load(branchId);
    });
  }

  ngOnInit(): void {
    if (!this.perms.canAccess({ roles: VIEWERS, permissions: ['WALLET_READ', 'WALLET_SEARCH'] })) {
      this.router.navigate(['/unauthorized']); return;
    }
    this.breadcrumb.set([{ label: 'Finance' }, { label: 'Branch Wallet', route: '/finance/branch-wallet' },
      { label: 'Transactions' }]);
  }

  private buildQuery(branchId: string | null, size?: number): PageQuery {
    const f = this.filters();
    return {
      ...this.query, ...(size ? { size, page: 0 } : {}),
      ...(branchId ? { branchId } : {}),
      transactionType: f.transactionType as unknown as string | undefined,
      subTransactionType: f.subTransactionType as unknown as string | undefined,
      referenceId: f.referenceId,
      fromDate: f.fromDate, toDate: f.toDate
    };
  }

  private load(branchId: string | null): void {
    this.loading.set(true);
    this.service.transactions(this.buildQuery(branchId)).subscribe({
      next: (p) => { this.page.set(p); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  onSearch(t: string) { this.query = { ...this.query, search: t || undefined, page: 0 }; this.load(this.branchId()); }
  onPage(i: number) { this.query = { ...this.query, page: i }; this.load(this.branchId()); }
  onSort(s: SortState) { this.sort.set(s); this.query = { ...this.query, sort: `${s.active},${s.direction}`, page: 0 }; this.load(this.branchId()); }
  onFilter(f: WalletTransactionSearchRequest) { this.filters.set(f); this.query = { ...this.query, page: 0 }; this.filterOpen.set(false); this.load(this.branchId()); }

  receipt(t: WalletTransaction): void {
    const w = this.wallet();
    if (w) downloadReceipt(t, w, environment.appName, this.auth.companyLogo(), this.company());
    else this.notify.error('Wallet not loaded yet.');
  }

  exportCsv(): void {
    this.exporting.set(true);
    this.service.transactions(this.buildQuery(this.branchId(), 200)).subscribe({
      next: (p) => { this.download(p.content); this.exporting.set(false); },
      error: () => { this.exporting.set(false); this.notify.error('Export failed.'); }
    });
  }

  private download(rows: WalletTransaction[]): void {
    const header = ['createdAt', 'transactionNo', 'transactionType', 'subTransactionType', 'amount', 'balanceAfter', 'referenceId', 'paymentGateway'];
    const lines = rows.map((t) => [
      t.createdAt, t.transactionNo, t.transactionType, subTypeLabel(t.subTransactionType), t.amount, t.balanceAfter,
      t.referenceId, t.paymentGateway ?? ''
    ]);
    // balanceAfter (index 5) is a running balance, not additive — excluded from the total.
    downloadCsv(`wallet-transactions-${new Date().toISOString().slice(0, 10)}.csv`, header, lines, [4]);
    this.notify.info(`Exported ${rows.length} transaction(s).`);
  }
}
