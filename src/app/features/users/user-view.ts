import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin } from 'rxjs';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AuthService } from '@core/auth/auth.service';
import { AppRole } from '@core/models/role.model';
import { CompanyRole } from '@core/models/role.model';
import { UserProfile } from '@core/models/user.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { UserStatusBadge } from './components/user-status-badge';
import { AssignRoleDialog } from './components/assign-role-dialog';
import { AssignBranchDialog } from './components/assign-branch-dialog';
import { AssignHubDialog } from './components/assign-hub-dialog';
import { ResetPasswordDialog } from './components/reset-password-dialog';
import { Lookup, UserService } from './user.service';

const ADMIN = [AppRole.COMPANY_ADMIN];
// A branch manager staffs their own branch: update/assign-role, scoped server-side by
// UserServiceImpl to their branch and to branch-assignable roles. Delete/reset-password
// stay COMPANY_ADMIN-only.
const BRANCH_STAFFING = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER];

/** View User — full read-only profile plus the gated action bar (lifecycle, roles, reset). */
@Component({
  selector: 'app-user-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, UiCard, UiLoader, UiButton, UserStatusBadge, MatMenuModule, MatIconModule],
  template: `
    <div class="page">
      @if (loading()) {
        <app-loader [minHeight]="320" caption="Loading…" />
      } @else if (!user()) {
        <app-card><p class="empty">User not found or outside your scope.</p></app-card>
      } @else {
        <header class="uv__banner app-card">
          <div class="uv__id">
            <span class="uv__av">{{ initials() }}</span>
            <div>
              <div class="uv__name"><h1 class="text-h1">{{ user()!.displayName }}</h1>
                <app-user-status-badge [status]="user()!.status" [locked]="user()!.isLocked" /></div>
              <p class="text-caption">{{ user()!.designation || '—' }}@if (user()!.department) { · {{ user()!.department }} }</p>
              <p class="text-caption">{{ user()!.email }} · {{ user()!.username || 'no username' }}</p>
            </div>
          </div>
          <div class="uv__actions">
            <app-button variant="stroked" icon="support_agent" (pressed)="raiseTicket()">Raise Ticket</app-button>
            @if (can().update) { <app-button variant="stroked" icon="edit" (pressed)="edit()">Edit</app-button> }
            @if (hasMenu()) {
              <button class="kebab" [matMenuTriggerFor]="menu"><mat-icon>more_vert</mat-icon></button>
              <mat-menu #menu="matMenu">
                @if (can().update) {
                  @if (disabled()) {
                    <button mat-menu-item (click)="lifecycle('activate')"><mat-icon>check_circle</mat-icon><span>Activate</span></button>
                  } @else {
                    <button mat-menu-item (click)="deactivate()"><mat-icon>block</mat-icon><span>Deactivate</span></button>
                  }
                  @if (user()!.isLocked) {
                    <button mat-menu-item (click)="lifecycle('unlock')"><mat-icon>lock_open</mat-icon><span>Unlock</span></button>
                  } @else {
                    <button mat-menu-item (click)="lock()"><mat-icon>lock</mat-icon><span>Lock</span></button>
                  }
                  <button mat-menu-item (click)="openBranch()"><mat-icon>store</mat-icon><span>Assign branch</span></button>
                  <button mat-menu-item (click)="openHub()"><mat-icon>hub</mat-icon><span>Assign hub</span></button>
                }
                @if (can().assignRole) { <button mat-menu-item (click)="openRoles()"><mat-icon>badge</mat-icon><span>Assign roles</span></button> }
                @if (can().resetPassword) { <button mat-menu-item (click)="openReset()"><mat-icon>lock_reset</mat-icon><span>Reset password</span></button> }
                @if (can().delete) { <button mat-menu-item class="danger" (click)="remove()"><mat-icon>delete</mat-icon><span>Delete</span></button> }
              </mat-menu>
            }
          </div>
        </header>

        <div class="uv__grid">
          <app-card title="Basic Information">
            <dl class="kv">
              <dt>Employee Code</dt><dd>{{ user()!.employeeCode || '—' }}</dd>
              <dt>Employee ID</dt><dd>{{ user()!.employeeId || '—' }}</dd>
              <dt>First Name</dt><dd>{{ user()!.firstName || '—' }}</dd>
              <dt>Middle Name</dt><dd>{{ user()!.middleName || '—' }}</dd>
              <dt>Last Name</dt><dd>{{ user()!.lastName || '—' }}</dd>
            </dl>
          </app-card>

          <app-card title="Contact">
            <dl class="kv">
              <dt>Email</dt><dd>{{ user()!.email }}</dd>
              <dt>Username</dt><dd>{{ user()!.username || '—' }}</dd>
              <dt>Mobile</dt><dd>{{ user()!.mobile || '—' }}</dd>
              <dt>Alternate Mobile</dt><dd>{{ user()!.alternateMobile || '—' }}</dd>
            </dl>
          </app-card>

          <app-card title="HR Details">
            <dl class="kv">
              <dt>Gender</dt><dd>{{ pretty(user()!.gender) }}</dd>
              <dt>Date of Birth</dt><dd>{{ user()!.dateOfBirth || '—' }}</dd>
              <dt>Designation</dt><dd>{{ user()!.designation || '—' }}</dd>
              <dt>Department</dt><dd>{{ user()!.department || '—' }}</dd>
              <dt>Joining Date</dt><dd>{{ user()!.joiningDate || '—' }}</dd>
              <dt>Reporting Manager</dt><dd>{{ managerName() }}</dd>
            </dl>
          </app-card>

          <app-card title="Security">
            <dl class="kv">
              <dt>Status</dt><dd>{{ pretty(user()!.status) }}</dd>
              <dt>Login Enabled</dt><dd>{{ loginEnabled() ? 'Yes' : 'No' }}</dd>
              <dt>Account Locked</dt><dd>{{ user()!.isLocked ? 'Yes' : 'No' }}</dd>
              <dt>Failed Attempts</dt><dd>{{ user()!.failedLoginCount }}</dd>
              <dt>Last Login</dt><dd>{{ user()!.lastLogin ? (user()!.lastLogin | date:'medium') : 'Never' }}</dd>
            </dl>
          </app-card>

          <app-card title="Assignment">
            <dl class="kv">
              <dt>Branch</dt><dd>{{ nameOf(branchNames(), user()!.branchId) }}</dd>
              <dt>Hub</dt><dd>{{ nameOf(hubNames(), user()!.hubId) }}</dd>
              <dt>Roles</dt><dd>
                @if (user()!.roles.length) {
                  <span class="chips">@for (r of user()!.roles; track r) { <span class="chip">{{ r }}</span> }</span>
                } @else { — }
              </dd>
            </dl>
          </app-card>

          @if (user()!.remarks) {
            <app-card title="Notes"><p class="text-body">{{ user()!.remarks }}</p></app-card>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .uv__banner { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:20px 24px; margin-bottom:16px; }
    .uv__id { display:flex; gap:16px; align-items:center; }
    .uv__av { width:56px; height:56px; border-radius:50%; background:var(--brand-100); color:var(--brand-700);
      display:grid; place-items:center; font:700 23px var(--font-sans); }
    .uv__name { display:flex; align-items:center; gap:12px; }
    .uv__actions { display:flex; gap:10px; align-items:center; }
    .kebab { border:0; background:var(--surface); cursor:pointer; color:var(--content-muted); display:inline-flex;
      padding:8px; border-radius:8px; border:1px solid var(--surface-border); }
    .kebab:hover { background:var(--surface-muted); }
    .danger { color:var(--danger); }
    .uv__grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
    .kv { display:grid; grid-template-columns:170px 1fr; gap:10px 16px; margin:0; }
    .kv dt { font:500 16px var(--font-sans); color:var(--content-muted); }
    .kv dd { font:600 17px var(--font-sans); color:var(--content-fg); margin:0; }
    .chips { display:flex; flex-wrap:wrap; gap:6px; }
    .chip { background:var(--brand-50); color:var(--brand-700); border:1px solid var(--brand-100);
      font:600 14px var(--font-sans); padding:2px 8px; border-radius:999px; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
    @media (max-width:860px){ .uv__grid{ grid-template-columns:1fr; } }
  `]
})
export class UserView implements OnInit {
  private readonly service = inject(UserService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(DialogService);

  readonly loading = signal(true);
  readonly user = signal<UserProfile | null>(null);
  readonly roles = signal<CompanyRole[]>([]);
  readonly branches = signal<Lookup[]>([]);
  readonly hubs = signal<Lookup[]>([]);
  readonly managers = signal<Lookup[]>([]);
  readonly branchNames = computed(() => new Map(this.branches().map((b) => [b.id, b.label])));
  readonly hubNames = computed(() => new Map(this.hubs().map((h) => [h.id, h.label])));
  private id = '';

  // No `permission` for resetPassword: the catalogue has no password-reset action for
  // USER (only CREATE/READ/UPDATE/DELETE/SEARCH/EXPORT/ASSIGN/ACTIVATE/DEACTIVATE) — ADMIN
  // (the role check alone) is the whole gate, same as several roles-only leaves in
  // navigation.config.ts.
  readonly can = computed(() => ({
    update: this.perms.canAccess({ roles: BRANCH_STAFFING, permissions: ['USER_UPDATE'] }),
    delete: this.perms.canAccess({ roles: ADMIN, permissions: ['USER_DELETE'] }),
    assignRole: this.perms.canAccess({ roles: BRANCH_STAFFING, permissions: ['USER_ASSIGN'] }),
    resetPassword: this.perms.canAccess({ roles: ADMIN })
  }));
  readonly hasMenu = computed(() => { const c = this.can(); return c.update || c.delete || c.assignRole || c.resetPassword; });
  readonly disabled = computed(() => { const s = this.user()?.status; return s === 'DISABLED' || s === 'PENDING'; });
  readonly loginEnabled = computed(() => { const u = this.user(); return !!u && u.status === 'ACTIVE' && !u.isLocked; });

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    forkJoin({ user: this.service.get(this.id), roles: this.service.roles(), branches: this.service.branches(), hubs: this.service.hubs(), managers: this.service.managers() })
      .subscribe({
        next: (l) => {
          this.user.set(l.user); this.roles.set(l.roles); this.branches.set(l.branches); this.hubs.set(l.hubs); this.managers.set(l.managers);
          this.breadcrumb.set([{ label: 'Users', route: '/users' }, { label: l.user.displayName }]);
          this.loading.set(false);
        },
        error: () => { this.user.set(null); this.loading.set(false); }
      });
  }

  private reload(): void { this.service.get(this.id).subscribe((u) => this.user.set(u)); }
  private isSelf(): boolean { return this.auth.user()?.userId === this.id; }

  initials(): string { const u = this.user(); return (u?.displayName || u?.email || '?').split(/[\s@.]/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join(''); }
  pretty(v?: string): string { return v ? v.charAt(0) + v.slice(1).toLowerCase() : '—'; }
  nameOf(map: Map<string, string>, id?: string | null): string { return id ? (map.get(id) ?? '—') : '—'; }
  managerName(): string { const id = this.user()?.reportingManagerId; return id ? (this.managers().find((m) => m.id === id)?.label ?? '—') : '—'; }

  edit(): void { this.router.navigate(['/users', this.id, 'edit']); }

  raiseTicket(): void {
    const branchId = this.user()?.branchId ?? undefined;
    this.router.navigate(['/support/tickets/new'], { queryParams: branchId ? { branchId } : {} });
  }

  lifecycle(op: 'activate' | 'unlock'): void {
    this.service[op](this.id).subscribe({ next: () => { this.notify.success(`User ${op}d.`); this.reload(); }, error: () => this.notify.error(`Could not ${op} the user.`) });
  }

  deactivate(): void {
    if (this.isSelf()) { this.notify.error('You cannot deactivate your own account.'); return; }
    this.confirm.confirm({ title: 'Deactivate user', message: `${this.user()!.displayName} will no longer be able to sign in.`, confirmLabel: 'Deactivate', danger: true })
      .subscribe((ok) => { if (ok) this.service.deactivate(this.id).subscribe({ next: () => { this.notify.success('User deactivated.'); this.reload(); }, error: () => this.notify.error('Could not deactivate.') }); });
  }

  lock(): void {
    if (this.isSelf()) { this.notify.error('You cannot lock your own account.'); return; }
    this.confirm.confirm({ title: 'Lock user', message: `${this.user()!.displayName} will be hard-locked and signed out.`, confirmLabel: 'Lock', danger: true })
      .subscribe((ok) => { if (ok) this.service.lock(this.id, 'Locked by administrator').subscribe({ next: () => { this.notify.success('User locked.'); this.reload(); }, error: () => this.notify.error('Could not lock.') }); });
  }

  remove(): void {
    if (this.isSelf()) { this.notify.error('You cannot delete your own account.'); return; }
    this.confirm.confirm({ title: 'Delete user', message: `${this.user()!.displayName} will be removed. Email, username and employee code stay reserved.`, confirmLabel: 'Delete', danger: true })
      .subscribe((ok) => { if (ok) this.service.remove(this.id).subscribe({ next: () => { this.notify.success('User deleted.'); this.router.navigate(['/users']); }, error: () => this.notify.error('Could not delete.') }); });
  }

  openRoles(): void {
    this.dialog.open(AssignRoleDialog, { data: { userId: this.id, displayName: this.user()!.displayName, current: this.user()!.roles, roles: this.roles() }, autoFocus: false, panelClass: 'app-dialog' })
      .afterClosed().subscribe(() => this.reload());
  }
  openBranch(): void {
    this.dialog.open(AssignBranchDialog, { data: { userId: this.id, displayName: this.user()!.displayName, currentId: this.user()!.branchId ?? null, options: this.branches() }, autoFocus: false, panelClass: 'app-dialog' })
      .afterClosed().subscribe((r) => { if (r) this.user.set(r); });
  }
  openHub(): void {
    this.dialog.open(AssignHubDialog, { data: { userId: this.id, displayName: this.user()!.displayName, currentId: this.user()!.hubId ?? null, options: this.hubs() }, autoFocus: false, panelClass: 'app-dialog' })
      .afterClosed().subscribe((r) => { if (r) this.user.set(r); });
  }
  openReset(): void {
    this.dialog.open(ResetPasswordDialog, { data: { userId: this.id, displayName: this.user()!.displayName }, autoFocus: false, panelClass: 'app-dialog' })
      .afterClosed().subscribe((done) => { if (done) this.reload(); });
  }
}
