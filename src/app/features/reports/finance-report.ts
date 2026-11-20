import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { WalletSummary } from '@core/models/wallet.model';
import { TableColumn } from '@shared/components/ui-table/ui-table';
import { UiTable } from '@shared/components/ui-table/ui-table';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { BranchWalletService } from '@features/branch-wallet/branch-wallet.service';
import { downloadCsv } from '@shared/utils/csv-export.util';

/**
 * Finance Report — a branch-scoped caller (has `myBranchId`) sees their own wallet's
 * existing `summary()` (nothing new); a company-wide caller (`COMPANY_ADMIN`/
 * `FINANCE_USER`, no own branch) sees `companySummary()`'s one row per active branch plus
 * a summed total row. Read-only — recharge/credit/debit stay on Branch Wallet's own pages.
 */
@Component({
  selector: 'app-finance-report',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, UiTable, UiButton],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Finance Report</h1>
          <p class="text-caption">Wallet position {{ myBranchId ? 'for your branch' : 'across every branch' }}.</p></div>
        <div class="page__actions">
          <app-button variant="stroked" icon="refresh" (pressed)="load()">Refresh</app-button>
          @if (!myBranchId) {
            <app-button variant="stroked" icon="download" [loading]="exporting()" (pressed)="exportCsv()">Export</app-button>
          }
        </div>
      </header>

      <div class="stats">
        <div class="stat"><span class="stat__l">{{ myBranchId ? 'Balance' : 'Total Balance' }}</span>
          <span class="stat__v">{{ loading() ? '—' : ('₹' + (totals().balance | number: '1.2-2')) }}</span></div>
        <div class="stat"><span class="stat__l">Today's Credit</span>
          <span class="stat__v">{{ loading() ? '—' : ('₹' + (totals().todayCredit | number: '1.2-2')) }}</span></div>
        <div class="stat"><span class="stat__l">Today's Debit</span>
          <span class="stat__v">{{ loading() ? '—' : ('₹' + (totals().todayDebit | number: '1.2-2')) }}</span></div>
        <div class="stat"><span class="stat__l">Lifetime Credit</span>
          <span class="stat__v">{{ loading() ? '—' : ('₹' + (totals().totalCredit | number: '1.2-2')) }}</span></div>
        <div class="stat"><span class="stat__l">Lifetime Debit</span>
          <span class="stat__v">{{ loading() ? '—' : ('₹' + (totals().totalDebit | number: '1.2-2')) }}</span></div>
      </div>

      @if (!myBranchId) {
        <app-table [columns]="columns" [rows]="rows()" [loading]="loading()"
                   emptyTitle="No branches" emptyHint="No active branch has a wallet yet." (rowClick)="view($event)">
          <ng-template #row let-w>
            <td>{{ w.branchName || '—' }}</td>
            <td class="mono">{{ w.branchCode || '—' }}</td>
            <td class="num">₹{{ w.availableBalance | number: '1.2-2' }}</td>
            <td class="num">₹{{ w.todayCredit | number: '1.2-2' }}</td>
            <td class="num">₹{{ w.todayDebit | number: '1.2-2' }}</td>
            <td class="num">₹{{ w.totalCredit | number: '1.2-2' }}</td>
            <td class="num">₹{{ w.totalDebit | number: '1.2-2' }}</td>
            <td class="num">{{ w.transactionCount }}</td>
          </ng-template>
        </app-table>
      } @else {
        <p class="text-caption hint">Full ledger and recharge live on
          <a (click)="router.navigate(['/finance/branch-wallet'])">Branch Wallet</a>.</p>
      }
    </div>
  `,
  styles: [`
    .page__head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:12px; }
    .page__actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .stats { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
    .stat { display:flex; flex-direction:column; gap:4px; padding:12px 18px; min-width:150px;
      background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .stat__l { font:500 15px var(--font-sans); color:var(--content-muted); }
    .stat__v { font:700 23px var(--font-sans); color:var(--content-fg); }
    .mono { font:600 16px var(--font-mono, ui-monospace); color:var(--content-fg); }
    .num { text-align:right; }
    .hint { margin-top:12px; }
    .hint a { color:var(--brand-600); cursor:pointer; }
  `]
})
export class FinanceReport implements OnInit {
  private readonly service = inject(BranchWalletService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);
  protected readonly router = inject(Router);

  protected readonly myBranchId = this.auth.user()?.branchId ?? null;

  protected readonly loading = signal(true);
  protected readonly exporting = signal(false);
  protected readonly rows = signal<WalletSummary[]>([]);

  protected readonly columns: TableColumn<WalletSummary>[] = [
    { key: 'branchName', header: 'Branch' },
    { key: 'branchCode', header: 'Code' },
    { key: 'availableBalance', header: 'Balance', align: 'right' },
    { key: 'todayCredit', header: "Today's Credit", align: 'right' },
    { key: 'todayDebit', header: "Today's Debit", align: 'right' },
    { key: 'totalCredit', header: 'Lifetime Credit', align: 'right' },
    { key: 'totalDebit', header: 'Lifetime Debit', align: 'right' },
    { key: 'transactionCount', header: 'Entries', align: 'right' }
  ];

  protected readonly totals = computed(() => {
    const rows = this.rows();
    if (this.myBranchId) {
      const r = rows[0];
      return {
        balance: r?.availableBalance ?? 0, todayCredit: r?.todayCredit ?? 0, todayDebit: r?.todayDebit ?? 0,
        totalCredit: r?.totalCredit ?? 0, totalDebit: r?.totalDebit ?? 0
      };
    }
    return rows.reduce((t, r) => ({
      balance: t.balance + r.availableBalance, todayCredit: t.todayCredit + r.todayCredit,
      todayDebit: t.todayDebit + r.todayDebit, totalCredit: t.totalCredit + r.totalCredit,
      totalDebit: t.totalDebit + r.totalDebit
    }), { balance: 0, todayCredit: 0, todayDebit: 0, totalCredit: 0, totalDebit: 0 });
  });

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Reports' }, { label: 'Finance Report' }]);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    if (this.myBranchId) {
      this.service.summary(this.myBranchId).subscribe({
        next: (s) => { this.rows.set([s]); this.loading.set(false); },
        error: () => this.loading.set(false)
      });
    } else {
      this.service.companySummary().subscribe({
        next: (rows) => { this.rows.set(rows); this.loading.set(false); },
        error: () => this.loading.set(false)
      });
    }
  }

  view(w: WalletSummary): void {
    if (!this.myBranchId) this.router.navigate(['/finance/branch-wallet'], { queryParams: { branchId: w.branchId } });
  }

  exportCsv(): void {
    this.exporting.set(true);
    this.service.companySummary().subscribe({
      next: (rows) => { this.download(rows); this.exporting.set(false); },
      error: () => { this.exporting.set(false); this.notify.error('Export failed.'); }
    });
  }

  private download(rows: WalletSummary[]): void {
    const header = ['branch', 'branchCode', 'availableBalance', 'todayCredit', 'todayDebit',
      'totalCredit', 'totalDebit', 'transactionCount'];
    const lines = rows.map((r) => [r.branchName, r.branchCode, r.availableBalance, r.todayCredit,
      r.todayDebit, r.totalCredit, r.totalDebit, r.transactionCount]);
    downloadCsv(`finance-report-${new Date().toISOString().slice(0, 10)}.csv`, header, lines, [2, 3, 4, 5, 6, 7]);
    this.notify.info(`Exported ${rows.length} branch row(s).`);
  }
}
