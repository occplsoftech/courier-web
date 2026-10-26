import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { AppRole } from '@core/models/role.model';
import { TopupRequest, TopupRequestStatus, formatMoney } from '@core/models/wallet.model';
import { PageQuery } from '@core/models/page.model';
import { BranchService } from '@features/branch/branch.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiAutocomplete } from '@shared/components/ui-autocomplete/ui-autocomplete';
import { BranchWalletService } from './branch-wallet.service';

const ADMINS = [AppRole.COMPANY_ADMIN];

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: '', label: 'All' }
];

/** Top-up Requests — a company admin's approval queue for branch and customer top-up asks; a branch
 *  manager sees the same list scoped to their own branch (read-only, no approve/reject).
 *  Approving credits the wallet server-side (`WalletService.credit`); nothing here calls
 *  the money path directly. */
@Component({
  selector: 'app-topup-requests',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, DatePipe, UiCard, UiLoader, UiButton, UiSelect, UiAutocomplete],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Top-up Requests</h1>
          <p class="text-caption">{{ isAdmin() ? 'Branches and customers asking to fund their wallet — approve to credit, reject to decline.' : 'Your branch\\'s top-up requests and their status.' }}</p></div>
        <app-button variant="stroked" icon="refresh" (pressed)="load()">Refresh</app-button>
      </header>

      <app-card>
        <div class="filters">
          <app-select [control]="statusControl" label="Status" [options]="statusOptions" />
          @if (isAdmin()) {
            <app-autocomplete [control]="branchControl" label="Branch" [options]="branchOptions()" placeholder="All branches" />
          }
        </div>
      </app-card>

      @if (loading()) {
        <app-loader [minHeight]="160" caption="Loading…" />
      } @else if (!rows().length) {
        <app-card><p class="empty">No requests match.</p></app-card>
      } @else {
        <app-card>
          <div class="tbl__wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>#</th><th>For</th><th>Amount</th><th>Remarks</th><th>Proof</th><th>Status</th><th>Requested</th>
                  @if (isAdmin()) { <th class="tbl--right">Actions</th> }
                </tr>
              </thead>
              <tbody>
                @for (r of rows(); track r.id; let i = $index) {
                  <tr>
                    <td>{{ i + 1 }}</td>
                    <td>
                      @if (r.customerId) { <a class="link-btn" [routerLink]="['/customers', r.customerId]">Customer</a> } @else { Branch }
                    </td>
                    <td class="mono">{{ money(r.requestedAmount) }}</td>
                    <td>{{ r.remarks || '—' }}</td>
                    <td>
                      @if (r.proofImageUrl) {
                        <button type="button" class="link-btn" (click)="viewProof(r)">View</button>
                      } @else { — }
                    </td>
                    <td><span class="badge" [class]="'badge--' + r.status.toLowerCase()">{{ r.status }}</span></td>
                    <td class="text-caption">{{ r.createdAt | date: 'medium' }}</td>
                    @if (isAdmin()) {
                      <td class="tbl--right">
                        @if (r.status === 'PENDING') {
                          <div class="rowbtns">
                            <app-button variant="stroked" icon="close" [loading]="decidingId() === r.id" (pressed)="reject(r)">Reject</app-button>
                            <app-button icon="check" [loading]="decidingId() === r.id" (pressed)="approve(r)">Approve</app-button>
                          </div>
                        } @else {
                          <span class="text-caption">{{ r.decisionRemarks || '—' }}</span>
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </app-card>
      }
    </div>
  `,
  styles: [`
    .page__head { display:flex; justify-content:space-between; align-items:flex-start; }
    .filters { display:flex; gap:16px; flex-wrap:wrap; }
    .filters app-select, .filters app-autocomplete { min-width:200px; }
    .empty { font:400 14px var(--font-sans); color:var(--content-muted); text-align:center; padding:20px; }
    .tbl__wrap { overflow-x:auto; border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .tbl { width:100%; border-collapse:collapse; font:400 13px var(--font-sans); }
    .tbl th { text-align:left; padding:10px 14px; background:var(--surface-muted); color:var(--content-muted); font:600 11px var(--font-sans); text-transform:uppercase; letter-spacing:.03em; white-space:nowrap; }
    .tbl td { padding:10px 14px; border-top:1px solid var(--surface-border); white-space:nowrap; }
    .tbl--right { text-align:right; }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .rowbtns { display:flex; justify-content:flex-end; gap:8px; }
    .link-btn { border:none; background:none; padding:0; font:600 13px var(--font-sans); color:var(--brand-500); cursor:pointer; text-decoration:underline; }
    .badge { display:inline-flex; padding:3px 10px; border-radius:999px; font:600 11px var(--font-sans); text-transform:uppercase; letter-spacing:.03em; }
    .badge--pending { background:var(--warning-bg); color:var(--warning); }
    .badge--approved { background:var(--success-bg); color:var(--success); }
    .badge--rejected { background:var(--danger-bg); color:var(--danger); }
  `]
})
export class TopupRequests implements OnInit {
  private readonly service = inject(BranchWalletService);
  private readonly branches = inject(BranchService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly confirmDialog = inject(DialogService);

  readonly isAdmin = computed(() => this.perms.hasAnyRole(ADMINS));
  readonly loading = signal(true);
  readonly rows = signal<TopupRequest[]>([]);
  readonly branchOptions = signal<SelectOption[]>([]);
  readonly decidingId = signal<string | null>(null);

  readonly statusOptions = STATUS_OPTIONS;
  readonly statusControl = new FormControl<string>('PENDING');
  readonly branchControl = new FormControl<string | null>(null);

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Finance' }, { label: 'Branch Wallet', route: '/finance/branch-wallet' }, { label: 'Top-up Requests' }]);
    if (this.isAdmin()) {
      this.branches.list({ page: 0, size: 100, sort: 'branchName,asc' }).subscribe({
        next: (p) => this.branchOptions.set(p.content.map((b) => ({ value: b.id, label: `${b.branchName} (${b.branchCode})` }))),
        error: () => this.branchOptions.set([])
      });
      this.branchControl.valueChanges.subscribe(() => this.load());
    }
    this.statusControl.valueChanges.subscribe(() => this.load());
    this.load();
  }

  money(n: number): string { return formatMoney(n); }

  viewProof(r: TopupRequest): void {
    if (!r.proofImageUrl) return;
    this.confirmDialog.previewImage(r.proofImageUrl, `Top-up proof — ${this.money(r.requestedAmount)}`);
  }

  load(): void {
    this.loading.set(true);
    const status = this.statusControl.value;
    const branchId = this.branchControl.value;
    const query: PageQuery = {
      page: 0, size: 100, sort: 'createdAt,desc',
      ...(status ? { status } : {}),
      ...(branchId ? { branchId } : {})
    };
    this.service.topupRequests(query).subscribe({
      next: (p) => { this.rows.set(p.content); this.loading.set(false); },
      error: () => { this.rows.set([]); this.loading.set(false); }
    });
  }

  approve(r: TopupRequest): void {
    this.confirmDialog.prompt({
      title: 'Approve top-up request',
      message: `${this.money(r.requestedAmount)} will be credited to the branch wallet immediately.`,
      label: 'Remarks (optional)', placeholder: 'Approved against this month\'s float…',
      confirmLabel: 'Approve'
    }).subscribe((remarks) => {
      if (remarks === undefined) return;
      this.decide(r, 'APPROVED', remarks);
    });
  }

  reject(r: TopupRequest): void {
    this.confirmDialog.prompt({
      title: 'Reject top-up request',
      message: `"${this.money(r.requestedAmount)}" will be rejected. Nothing is credited.`,
      label: 'Remarks (optional)', placeholder: 'Not needed this cycle…',
      confirmLabel: 'Reject', danger: true
    }).subscribe((remarks) => {
      if (remarks === undefined) return;
      this.decide(r, 'REJECTED', remarks);
    });
  }

  private decide(r: TopupRequest, outcome: TopupRequestStatus, remarks: string): void {
    this.decidingId.set(r.id);
    const call = outcome === 'APPROVED'
      ? this.service.approveTopupRequest(r.id, { remarks: remarks.trim() || null })
      : this.service.rejectTopupRequest(r.id, { remarks: remarks.trim() || null });
    call.subscribe({
      next: () => {
        this.decidingId.set(null);
        this.notify.success(outcome === 'APPROVED' ? 'Request approved, wallet credited.' : 'Request rejected.');
        this.load();
      },
      error: (e: HttpErrorResponse) => {
        this.decidingId.set(null);
        this.notify.error(e.error?.message ?? 'Could not decide the request.');
      }
    });
  }
}
