import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { UiTable, TableColumn, SortState } from '@shared/components/ui-table/ui-table';
import { UserStatusBadge } from './user-status-badge';
import { AppUser } from '@core/models/user.model';

/** Which row actions the current user may see. Drives the actions menu; the list computes it. */
export interface UserPerms { update: boolean; delete: boolean; assignRole: boolean; resetPassword: boolean; }

export type UserAction =
  | 'view' | 'edit' | 'activate' | 'deactivate' | 'lock' | 'unlock'
  | 'reset-password' | 'assign-role' | 'assign-branch' | 'assign-hub' | 'delete';

/**
 * User directory table. Columns per the spec; a per-row kebab menu exposes the lifecycle
 * and assignment actions, each hidden when the caller lacks the permission. Branch and hub
 * ids are resolved to names through the supplied maps (list projection carries ids only).
 */
@Component({
  selector: 'app-user-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiTable, UserStatusBadge, MatMenuModule, MatIconModule],
  template: `
    <app-table [columns]="columns" [rows]="rows()" [loading]="loading()" [sort]="sort()" [startIndex]="startIndex()"
               emptyTitle="No users" emptyHint="Create your first user to get started."
               (sortChange)="sortChange.emit($event)" (rowClick)="act('view', $event)">
      <ng-template #row let-u>
        <td>{{ u.employeeCode || '—' }}</td>
        <td>
          <div class="ux">
            <span class="ux__av">{{ initials(u) }}</span>
            <div><div class="cs">{{ u.displayName }}</div><div class="text-caption">{{ u.email }}</div></div>
          </div>
        </td>
        <td>{{ u.username || '—' }}</td>
        <td>{{ u.mobile || '—' }}</td>
        <td>{{ nameOf(branchNames(), u.branchId) }}</td>
        <td>{{ nameOf(hubNames(), u.hubId) }}</td>
        <td><app-user-status-badge [status]="u.status" [locked]="u.isLocked" /></td>
        <td class="col-actions" (click)="$event.stopPropagation()">
          <button class="kebab" [matMenuTriggerFor]="menu" aria-label="Actions"><mat-icon>more_vert</mat-icon></button>
          <mat-menu #menu="matMenu">
            <button mat-menu-item (click)="act('view', u)"><mat-icon>visibility</mat-icon><span>View</span></button>
            @if (perms().update) {
              <button mat-menu-item (click)="act('edit', u)"><mat-icon>edit</mat-icon><span>Edit</span></button>
              @if (u.status === 'DISABLED' || u.status === 'PENDING') {
                <button mat-menu-item (click)="act('activate', u)"><mat-icon>check_circle</mat-icon><span>Activate</span></button>
              } @else {
                <button mat-menu-item (click)="act('deactivate', u)"><mat-icon>block</mat-icon><span>Deactivate</span></button>
              }
              @if (u.isLocked) {
                <button mat-menu-item (click)="act('unlock', u)"><mat-icon>lock_open</mat-icon><span>Unlock</span></button>
              } @else {
                <button mat-menu-item (click)="act('lock', u)"><mat-icon>lock</mat-icon><span>Lock</span></button>
              }
              <button mat-menu-item (click)="act('assign-branch', u)"><mat-icon>store</mat-icon><span>Assign branch</span></button>
              <button mat-menu-item (click)="act('assign-hub', u)"><mat-icon>hub</mat-icon><span>Assign hub</span></button>
            }
            @if (perms().assignRole) {
              <button mat-menu-item (click)="act('assign-role', u)"><mat-icon>badge</mat-icon><span>Assign roles</span></button>
            }
            @if (perms().resetPassword) {
              <button mat-menu-item (click)="act('reset-password', u)"><mat-icon>lock_reset</mat-icon><span>Reset password</span></button>
            }
            @if (perms().delete) {
              <button mat-menu-item class="danger" (click)="act('delete', u)"><mat-icon>delete</mat-icon><span>Delete</span></button>
            }
          </mat-menu>
        </td>
      </ng-template>
    </app-table>
  `,
  styles: [`
    .cs { font:600 17px var(--font-sans); }
    .ux { display:flex; align-items:center; gap:10px; }
    .ux__av { width:32px; height:32px; border-radius:50%; background:var(--brand-100); color:var(--brand-700);
      display:grid; place-items:center; font:700 15px var(--font-sans); }
    .col-actions { text-align:right; width:56px; }
    .kebab { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
    .danger { color:var(--danger); }
  `]
})
export class UserTable {
  readonly rows = input<AppUser[]>([]);
  readonly startIndex = input(0);
  readonly loading = input(false);
  readonly sort = input<SortState | null>(null);
  readonly perms = input.required<UserPerms>();
  readonly branchNames = input<Map<string, string>>(new Map());
  readonly hubNames = input<Map<string, string>>(new Map());

  readonly sortChange = output<SortState>();
  readonly action = output<{ type: UserAction; user: AppUser }>();

  readonly columns: TableColumn<AppUser>[] = [
    { key: 'employeeCode', header: 'Employee Code', sortable: true },
    { key: 'displayName', header: 'Name', sortable: true },
    { key: 'username', header: 'Username', sortable: true },
    { key: 'mobile', header: 'Mobile' },
    { key: 'branch', header: 'Branch' },
    { key: 'hub', header: 'Hub' },
    { key: 'status', header: 'Status', sortable: true, width: '120px' },
    { key: 'actions', header: '', width: '56px', align: 'right' }
  ];

  act(type: UserAction, user: AppUser): void { this.action.emit({ type, user }); }
  nameOf(map: Map<string, string>, id?: string | null): string { return id ? (map.get(id) ?? '—') : '—'; }
  initials(u: AppUser): string {
    return (u.displayName || u.email || '?').split(/[\s@.]/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('');
  }
}
