import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AuthService } from '@core/auth/auth.service';
import { AppRole } from '@core/models/role.model';
import { Branch, BranchSearchRequest } from '@core/models/branch.model';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { SortState } from '@shared/components/ui-table/ui-table';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiDrawer } from '@shared/components/ui-drawer/ui-drawer';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { MatDialog } from '@angular/material/dialog';
import { BranchTable, BranchPerms, BranchAction } from './components/branch-table';
import { BranchFilter } from './components/branch-filter';
import { AssignManagerDialog } from './components/assign-manager-dialog';
import { BranchService, Lookup } from './branch.service';
import { downloadCsv } from '@shared/utils/csv-export.util';

const UPDATERS = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER];
const WRITERS = [AppRole.COMPANY_ADMIN];

/**
 * Branch directory — server pagination, sort, debounced search, advanced filter drawer and
 * CSV export. Row actions (lifecycle, assign-manager, delete) route through confirms/dialogs,
 * each gated by permission. Manager ids are resolved to names via the users lookup. No mock.
 */
@Component({
  selector: 'app-branch-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiPagination, UiSearch, UiButton, UiDrawer, BranchTable, BranchFilter],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Branches</h1><p class="text-caption">Your company's booking &amp; delivery offices — {{ page().totalElements }} in all.</p></div>
        <div class="page__actions">
          <app-search placeholder="Search code, name, email, city…" (changed)="onSearch($event)" />
          <app-button variant="stroked" icon="filter_list" (pressed)="filterOpen.set(true)">
            Filters@if (activeFilters()) { <span class="fbadge">{{ activeFilters() }}</span> }
          </app-button>
          <app-button variant="stroked" icon="download" [loading]="exporting()" (pressed)="exportCsv()">Export</app-button>
          @if (can().create) { <app-button icon="add" (pressed)="create()">New Branch</app-button> }
        </div>
      </header>

      <app-branch-table [rows]="page().content" [loading]="loading()" [sort]="sort()" [perms]="tablePerms()"
        [startIndex]="page().page * page().size"
                        [managerNames]="managerNames()" (sortChange)="onSort($event)" (action)="onAction($event)" />

      <app-pagination [page]="page()" (pageChange)="onPage($event)" />

      <app-drawer [open]="filterOpen()" title="Advanced filters" subtitle="Narrow the branch list." (closed)="filterOpen.set(false)">
        <app-branch-filter (changed)="onFilter($event)" />
      </app-drawer>
    </div>
  `,
  styles: [`
    .fbadge { display:inline-grid; place-items:center; min-width:18px; height:18px; padding:0 5px; margin-left:2px;
      background:var(--brand-600); color:#fff; border-radius:999px; font:700 14px var(--font-sans); }
  `]
})
export class BranchList implements OnInit {
  private readonly service = inject(BranchService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly router = inject(Router);
  private readonly confirm = inject(DialogService);
  private readonly dialog = inject(MatDialog);
  private readonly auth = inject(AuthService);

  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly filterOpen = signal(false);
  readonly page = signal<Page<Branch>>(emptyPage<Branch>());
  readonly sort = signal<SortState | null>({ active: 'branchCode', direction: 'asc' });

  private readonly managers = signal<Lookup[]>([]);
  readonly managerNames = computed(() => new Map(this.managers().map((m) => [m.id, m.label])));

  private query: PageQuery = { page: 0, size: 20, sort: 'branchCode,asc' };
  private readonly filters = signal<BranchSearchRequest>({});
  readonly activeFilters = computed(() =>
    Object.values(this.filters()).filter((v) => v != null && (!Array.isArray(v) || v.length)).length);

  readonly can = computed(() => ({
    create: this.perms.canAccess({ roles: WRITERS, permissions: ['BRANCH_CREATE'] }),
    update: this.perms.canAccess({ roles: UPDATERS, permissions: ['BRANCH_UPDATE'] }),
    delete: this.perms.canAccess({ roles: WRITERS, permissions: ['BRANCH_DELETE'] }),
    // COMPANY_ADMIN only — same actor the backend's @PreAuthorize on
    // AuthService#impersonateBranch requires, mirroring the SUPER_ADMIN-only
    // "Login as" gate on the Companies list.
    impersonate: this.auth.roles().includes(AppRole.COMPANY_ADMIN)
  }));
  readonly tablePerms = computed<BranchPerms>(() => ({
    update: this.can().update, delete: this.can().delete, impersonate: this.can().impersonate
  }));

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Organization' }, { label: 'Branches' }]);
    this.service.managers().subscribe({ next: (m) => this.managers.set(m), error: () => {} });
    this.load();
  }

  private buildQuery(size?: number): PageQuery {
    const f = this.filters();
    return {
      ...this.query, ...(size ? { size, page: 0 } : {}),
      branchType: f.branchType as unknown as string | undefined,
      status: f.status as unknown as string | undefined,
      city: f.city, state: f.state, postalCode: f.postalCode,
      allowBooking: f.allowBooking, allowDelivery: f.allowDelivery, allowPickup: f.allowPickup
    };
  }

  private load(): void {
    this.loading.set(true);
    this.service.list(this.buildQuery()).subscribe({
      next: (p) => { this.page.set(p); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  onSearch(t: string) { this.query = { ...this.query, search: t || undefined, page: 0 }; this.load(); }
  onPage(i: number) { this.query = { ...this.query, page: i }; this.load(); }
  onSort(s: SortState) { this.sort.set(s); this.query = { ...this.query, sort: `${s.active},${s.direction}`, page: 0 }; this.load(); }
  onFilter(f: BranchSearchRequest) { this.filters.set(f); this.query = { ...this.query, page: 0 }; this.filterOpen.set(false); this.load(); }

  create() { this.router.navigate(['/branches/new']); }

  onAction({ type, branch }: { type: BranchAction; branch: Branch }): void {
    switch (type) {
      case 'view': return void this.router.navigate(['/branches', branch.id]);
      case 'edit': return void this.router.navigate(['/branches', branch.id, 'edit']);
      case 'activate': return this.lifecycle(branch, 'activate');
      case 'deactivate': return this.confirmDeactivate(branch);
      case 'assign-manager': return this.assignManager(branch);
      case 'delete': return this.deleteBranch(branch);
      case 'login-as': return this.impersonateBranch(branch);
    }
  }

  /** No password step-up (unlike "Login as company") — see AuthService#impersonateBranch. */
  private impersonateBranch(branch: Branch): void {
    this.confirm.confirm({
      title: 'Login as branch',
      message: `You'll be signed in as "${branch.branchName}"'s own branch manager. Your current session is kept and you can exit back to it any time.`,
      confirmLabel: 'Login as'
    }).subscribe((ok) => {
      if (!ok) return;
      this.auth.impersonateBranch(branch.id).subscribe({
        next: () => { this.notify.success(`Signed in as ${branch.branchName}'s manager.`); this.router.navigate(['/dashboard']); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not start the impersonation session.')
      });
    });
  }

  private lifecycle(branch: Branch, op: 'activate' | 'deactivate'): void {
    this.service[op](branch.id).subscribe({
      next: () => { this.notify.success(`Branch ${op}d.`); this.load(); },
      error: (e) => this.notify.error(e?.error?.message ?? `Could not ${op} the branch.`)
    });
  }

  private confirmDeactivate(branch: Branch): void {
    this.confirm.confirm({
      title: 'Deactivate branch',
      message: `"${branch.branchName}" will stop accepting operations until reactivated.`,
      confirmLabel: 'Deactivate', danger: true
    }).subscribe((ok) => { if (ok) this.lifecycle(branch, 'deactivate'); });
  }

  private assignManager(branch: Branch): void {
    this.dialog.open(AssignManagerDialog, {
      autoFocus: false, panelClass: 'app-dialog',
      data: { branchId: branch.id, branchName: branch.branchName, currentId: branch.managerId ?? null, options: this.managers() }
    }).afterClosed().subscribe((updated) => { if (updated) this.load(); });
  }

  private deleteBranch(branch: Branch): void {
    this.confirm.confirm({
      title: 'Delete branch',
      message: `"${branch.branchName}" will be removed. Its code stays reserved and cannot be reused.`,
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.remove(branch.id).subscribe({
        next: () => { this.notify.success('Branch deleted.'); this.load(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not delete the branch.')
      });
    });
  }

  exportCsv(): void {
    this.exporting.set(true);
    this.service.list(this.buildQuery(100)).subscribe({
      next: (p) => { this.download(p.content); this.exporting.set(false); },
      error: () => { this.exporting.set(false); this.notify.error('Export failed.'); }
    });
  }

  private download(rows: Branch[]): void {
    const header = ['branchCode', 'branchName', 'branchType', 'city', 'state', 'postalCode', 'manager', 'allowBooking', 'allowDelivery', 'status'];
    const lines = rows.map((r) => [
      r.branchCode, r.branchName, r.branchType, r.city, r.state, r.postalCode,
      r.managerId ? (this.managerNames().get(r.managerId) ?? r.managerId) : '', r.allowBooking, r.allowDelivery, r.status
    ]);
    downloadCsv(`branches-${new Date().toISOString().slice(0, 10)}.csv`, header, lines);
    this.notify.info(`Exported ${rows.length} branch(es).`);
  }
}
