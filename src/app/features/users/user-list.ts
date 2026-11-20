import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin } from 'rxjs';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AuthService } from '@core/auth/auth.service';
import { AppRole } from '@core/models/role.model';
import { AppUser, UserSearchRequest } from '@core/models/user.model';
import { CompanyRole } from '@core/models/role.model';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { SortState } from '@shared/components/ui-table/ui-table';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiDrawer } from '@shared/components/ui-drawer/ui-drawer';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { UserTable, UserPerms, UserAction } from './components/user-table';
import { UserFilter } from './components/user-filter';
import { AssignRoleDialog } from './components/assign-role-dialog';
import { AssignBranchDialog } from './components/assign-branch-dialog';
import { AssignHubDialog } from './components/assign-hub-dialog';
import { ResetPasswordDialog } from './components/reset-password-dialog';
import { Lookup, UserService } from './user.service';
import { downloadCsv } from '@shared/utils/csv-export.util';

const ADMIN = [AppRole.COMPANY_ADMIN];
// A branch manager staffs their own branch: create/update/assign-role, scoped server-side
// by UserServiceImpl to their branch and to branch-assignable roles. Delete stays
// COMPANY_ADMIN-only — UserServiceImpl never grants it to BRANCH_MANAGER.
const BRANCH_STAFFING = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER];

/**
 * User directory — server pagination, sort, debounced search, advanced filter drawer and
 * CSV export. Row actions (lifecycle, placement, roles, reset) route through confirms and
 * dialogs, each gated by permission. No mock data; every read/write hits the API.
 */
@Component({
  selector: 'app-user-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, UiPagination, UiSearch, UiButton, UiDrawer, UserTable, UserFilter],
  template: `
    <div class="page">
      <header class="page__head" data-tour="users-head">
        <div><h1 class="text-h1">Users</h1><p class="text-caption">Staff of your company — accounts, roles and placement.</p></div>
        <div class="page__actions">
          <app-search placeholder="Search name, email, code…" (changed)="onSearch($event)" />
          <app-button variant="stroked" icon="filter_list" (pressed)="filterOpen.set(true)">
            Filters@if (activeFilters()) { <span class="fbadge">{{ activeFilters() }}</span> }
          </app-button>
          <app-button variant="stroked" icon="download" [loading]="exporting()" (pressed)="exportCsv()">Export</app-button>
          @if (can().create) { <app-button icon="person_add" (pressed)="create()">New User</app-button> }
        </div>
      </header>

      <div class="tabs" role="tablist">
        <button type="button" class="tabs__item" [class.tabs__item--active]="tab() === 'company'"
                role="tab" [attr.aria-selected]="tab() === 'company'" (click)="setTab('company')">
          Company Users
        </button>
        <button type="button" class="tabs__item" [class.tabs__item--active]="tab() === 'cp'"
                role="tab" [attr.aria-selected]="tab() === 'cp'" (click)="setTab('cp')">
          CP Users
        </button>
        <button type="button" class="tabs__item" [class.tabs__item--active]="tab() === 'branch'"
                role="tab" [attr.aria-selected]="tab() === 'branch'" (click)="setTab('branch')">
          Branch Users
        </button>
        <button type="button" class="tabs__item" [class.tabs__item--active]="tab() === 'hub'"
                role="tab" [attr.aria-selected]="tab() === 'hub'" (click)="setTab('hub')">
          Hub Users
        </button>
      </div>

      <app-user-table [rows]="page().content" [loading]="loading()" [sort]="sort()" [perms]="tablePerms()"
        [startIndex]="page().page * page().size"
                      [branchNames]="branchNames()" [hubNames]="hubNames()"
                      (sortChange)="onSort($event)" (action)="onAction($event)" />

      <app-pagination [page]="page()" (pageChange)="onPage($event)" />

      <app-drawer [open]="filterOpen()" title="Advanced filters" subtitle="Narrow the directory." (closed)="filterOpen.set(false)">
        <app-user-filter [roles]="roles()" [branches]="branches()" [hubs]="hubs()" (changed)="onFilter($event)" />
      </app-drawer>
    </div>
  `,
  styles: [`
    .fbadge { display:inline-grid; place-items:center; min-width:18px; height:18px; padding:0 5px; margin-left:2px;
      background:var(--brand-600); color:#fff; border-radius:999px; font:700 14px var(--font-sans); }
    .tabs { display:flex; gap:4px; border-bottom:1px solid var(--border-default, #e2e8f0); margin-bottom:12px; }
    .tabs__item { padding:10px 4px; margin-right:20px; border:none; background:none; cursor:pointer;
      font:600 17px var(--font-sans); color:var(--text-secondary, #64748b); border-bottom:2px solid transparent; }
    .tabs__item--active { color:var(--brand-600); border-bottom-color:var(--brand-600); }
  `]
})
export class UserList implements OnInit {
  private readonly service = inject(UserService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(DialogService);

  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly filterOpen = signal(false);
  readonly tab = signal<'company' | 'cp' | 'branch' | 'hub'>('company');
  readonly page = signal<Page<AppUser>>(emptyPage<AppUser>());
  readonly sort = signal<SortState | null>({ active: 'displayName', direction: 'asc' });

  readonly roles = signal<CompanyRole[]>([]);
  readonly branches = signal<Lookup[]>([]);
  readonly hubs = signal<Lookup[]>([]);
  readonly branchNames = computed(() => new Map(this.branches().map((b) => [b.id, b.label])));
  readonly hubNames = computed(() => new Map(this.hubs().map((h) => [h.id, h.label])));

  private query: PageQuery = { page: 0, size: 20, sort: 'displayName,asc' };
  private filters = signal<UserSearchRequest>({});
  readonly activeFilters = computed(() => Object.values(this.filters()).filter((v) => v != null && (!Array.isArray(v) || v.length)).length);

  // No `permission` for resetPassword: the catalogue has no password-reset action for
  // USER — ADMIN (the role check alone) is the whole gate.
  readonly can = computed(() => ({
    create: this.perms.canAccess({ roles: BRANCH_STAFFING, permissions: ['USER_CREATE'] }),
    update: this.perms.canAccess({ roles: BRANCH_STAFFING, permissions: ['USER_UPDATE'] }),
    delete: this.perms.canAccess({ roles: ADMIN, permissions: ['USER_DELETE'] }),
    assignRole: this.perms.canAccess({ roles: BRANCH_STAFFING, permissions: ['USER_ASSIGN'] }),
    resetPassword: this.perms.canAccess({ roles: ADMIN })
  }));
  readonly tablePerms = computed<UserPerms>(() => ({
    update: this.can().update, delete: this.can().delete,
    assignRole: this.can().assignRole, resetPassword: this.can().resetPassword
  }));

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Management' }, { label: 'Users' }]);
    // Lookups feed the filter, table name maps and dialogs. Failures degrade to empty, not error.
    forkJoin({ roles: this.service.roles(), branches: this.service.branches(), hubs: this.service.hubs() })
      .subscribe({ next: (l) => { this.roles.set(l.roles); this.branches.set(l.branches); this.hubs.set(l.hubs); }, error: () => {} });
    this.load();
  }

  private buildQuery(size?: number): PageQuery {
    const f = this.filters();
    return {
      ...this.query, ...(size ? { size, page: 0 } : {}),
      status: f.status as unknown as string | undefined, locked: f.locked, branchId: f.branchId, hubId: f.hubId,
      department: f.department, designation: f.designation, roleCode: f.roleCode,
      joinedFrom: f.joinedFrom, joinedTo: f.joinedTo,
      placement: this.tab().toUpperCase()
    };
  }

  setTab(tab: 'company' | 'cp' | 'branch' | 'hub'): void {
    if (this.tab() === tab) return;
    this.tab.set(tab);
    this.query = { ...this.query, page: 0 };
    this.load();
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
  onSort(s: SortState) {
    this.sort.set(s);
    const key = s.active === 'displayName' ? 'displayName' : s.active;
    this.query = { ...this.query, sort: `${key},${s.direction}`, page: 0 };
    this.load();
  }
  onFilter(f: UserSearchRequest) { this.filters.set(f); this.query = { ...this.query, page: 0 }; this.filterOpen.set(false); this.load(); }

  create() { this.router.navigate(['/users/new']); }

  onAction({ type, user }: { type: UserAction; user: AppUser }): void {
    switch (type) {
      case 'view': return void this.router.navigate(['/users', user.id]);
      case 'edit': return void this.router.navigate(['/users', user.id, 'edit']);
      case 'activate': return this.lifecycle(user, 'activate');
      case 'deactivate': return this.guardedLifecycle(user, 'deactivate', 'Deactivate user', `${user.displayName} will no longer be able to sign in.`);
      case 'unlock': return this.lifecycle(user, 'unlock');
      case 'lock': return this.lockUser(user);
      case 'delete': return this.deleteUser(user);
      case 'assign-role': return this.openRoles(user);
      case 'assign-branch': return this.openBranch(user);
      case 'assign-hub': return this.openHub(user);
      case 'reset-password': return this.openReset(user);
    }
  }

  private isSelf(user: AppUser): boolean { return this.auth.user()?.userId === user.id; }

  private lifecycle(user: AppUser, op: 'activate' | 'deactivate' | 'unlock'): void {
    this.service[op](user.id).subscribe({
      next: () => { this.notify.success(`User ${op}d.`); this.load(); },
      error: () => this.notify.error(`Could not ${op} the user.`)
    });
  }

  private guardedLifecycle(user: AppUser, op: 'deactivate', title: string, message: string): void {
    if (this.isSelf(user)) { this.notify.error('You cannot deactivate your own account.'); return; }
    this.confirm.confirm({ title, message, confirmLabel: 'Deactivate', danger: true }).subscribe((ok) => { if (ok) this.lifecycle(user, op); });
  }

  private lockUser(user: AppUser): void {
    if (this.isSelf(user)) { this.notify.error('You cannot lock your own account.'); return; }
    this.confirm.confirm({ title: 'Lock user', message: `${user.displayName} will be hard-locked and signed out until an admin unlocks them.`, confirmLabel: 'Lock', danger: true })
      .subscribe((ok) => {
        if (!ok) return;
        this.service.lock(user.id, 'Locked by administrator').subscribe({
          next: () => { this.notify.success('User locked.'); this.load(); },
          error: () => this.notify.error('Could not lock the user.')
        });
      });
  }

  private deleteUser(user: AppUser): void {
    if (this.isSelf(user)) { this.notify.error('You cannot delete your own account.'); return; }
    this.confirm.confirm({ title: 'Delete user', message: `${user.displayName} will be removed. Their email, username and employee code stay reserved.`, confirmLabel: 'Delete', danger: true })
      .subscribe((ok) => {
        if (!ok) return;
        this.service.remove(user.id).subscribe({
          next: () => { this.notify.success('User deleted.'); this.load(); },
          error: () => this.notify.error('Could not delete the user.')
        });
      });
  }

  private openRoles(user: AppUser): void {
    // The list projection carries only a count; fetch the full user for the held role codes.
    this.service.get(user.id).subscribe((full) => {
      this.dialog.open(AssignRoleDialog, {
        data: { userId: user.id, displayName: user.displayName, current: full.roles, roles: this.roles() },
        autoFocus: false, panelClass: 'app-dialog'
      }).afterClosed().subscribe(() => this.load());
    });
  }

  private openBranch(user: AppUser): void {
    this.dialog.open(AssignBranchDialog, {
      data: { userId: user.id, displayName: user.displayName, currentId: user.branchId ?? null, options: this.branches() },
      autoFocus: false, panelClass: 'app-dialog'
    }).afterClosed().subscribe((r) => { if (r) this.load(); });
  }

  private openHub(user: AppUser): void {
    this.dialog.open(AssignHubDialog, {
      data: { userId: user.id, displayName: user.displayName, currentId: user.hubId ?? null, options: this.hubs() },
      autoFocus: false, panelClass: 'app-dialog'
    }).afterClosed().subscribe((r) => { if (r) this.load(); });
  }

  private openReset(user: AppUser): void {
    this.dialog.open(ResetPasswordDialog, {
      data: { userId: user.id, displayName: user.displayName }, autoFocus: false, panelClass: 'app-dialog'
    });
  }

  exportCsv(): void {
    this.exporting.set(true);
    this.service.list(this.buildQuery(100)).subscribe({
      next: (p) => { this.download(p.content); this.exporting.set(false); },
      error: () => { this.exporting.set(false); this.notify.error('Export failed.'); }
    });
  }

  private download(rows: AppUser[]): void {
    const cols: (keyof AppUser)[] = ['employeeCode', 'displayName', 'email', 'username', 'mobile', 'designation', 'department', 'status'];
    const lines = rows.map((r) => cols.map((c) => r[c] as string | number | boolean));
    downloadCsv(`users-${new Date().toISOString().slice(0, 10)}.csv`, cols, lines);
    this.notify.info(`Exported ${rows.length} user(s).`);
  }
}
