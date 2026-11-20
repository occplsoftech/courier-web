import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { UiTable, TableColumn, SortState } from '@shared/components/ui-table/ui-table';
import { RoleStatusBadge } from './role-status-badge';
import { CompanyRole } from '@core/models/role.model';

/** Which row actions the caller may see. Drives the kebab menu; the list computes it. */
export interface RolePerms { create: boolean; update: boolean; delete: boolean; }

export type RoleAction = 'view' | 'edit' | 'activate' | 'deactivate' | 'clone' | 'delete';

/**
 * Role directory table. Columns are the list projection the backend actually returns
 * (RoleSummaryResponse carries no description/createdDate — those live on the detail view).
 * A per-row kebab exposes the lifecycle, clone and delete actions, each hidden without the
 * permission and against the business rules (system/default roles are undeletable, the
 * default role is not deactivatable — mirrors the backend 422s).
 */
@Component({
  selector: 'app-role-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiTable, RoleStatusBadge, MatMenuModule, MatIconModule],
  template: `
    <app-table [columns]="columns" [rows]="rows()" [loading]="loading()" [sort]="sort()" [startIndex]="startIndex()"
               emptyTitle="No roles" emptyHint="Create your first role to get started."
               (sortChange)="sortChange.emit($event)" (rowClick)="act('view', $event)">
      <ng-template #row let-r>
        <td><span class="mono">{{ r.roleCode }}</span></td>
        <td><div class="cs">{{ r.roleName }}</div></td>
        <td>{{ pretty(r.roleType) }}</td>
        <td>{{ r.permissionCount }} {{ r.permissionCount === 1 ? 'permission' : 'permissions' }}</td>
        <td>
          @if (r.isSystemRole) { <span class="tag">System</span> }
          @if (r.isDefault) { <span class="tag tag--brand">Default</span> }
          @if (!r.isSystemRole && !r.isDefault) { <span class="tag tag--soft">Custom</span> }
        </td>
        <td><app-role-status-badge [status]="r.status" /></td>
        <td class="col-actions" (click)="$event.stopPropagation()">
          <button class="kebab" [matMenuTriggerFor]="menu" aria-label="Actions"><mat-icon>more_vert</mat-icon></button>
          <mat-menu #menu="matMenu">
            <button mat-menu-item (click)="act('view', r)"><mat-icon>visibility</mat-icon><span>View</span></button>
            @if (perms().update) {
              <button mat-menu-item (click)="act('edit', r)"><mat-icon>edit</mat-icon><span>Edit</span></button>
              @if (r.status === 'INACTIVE') {
                <button mat-menu-item (click)="act('activate', r)"><mat-icon>check_circle</mat-icon><span>Activate</span></button>
              } @else if (!r.isDefault) {
                <button mat-menu-item (click)="act('deactivate', r)"><mat-icon>block</mat-icon><span>Deactivate</span></button>
              }
            }
            @if (perms().create) {
              <button mat-menu-item (click)="act('clone', r)"><mat-icon>content_copy</mat-icon><span>Clone</span></button>
            }
            @if (perms().delete && !r.isSystemRole && !r.isDefault) {
              <button mat-menu-item class="danger" (click)="act('delete', r)"><mat-icon>delete</mat-icon><span>Delete</span></button>
            }
          </mat-menu>
        </td>
      </ng-template>
    </app-table>
  `,
  styles: [`
    .cs { font:600 17px var(--font-sans); }
    .mono { font:600 16px var(--font-mono, var(--font-sans)); color:var(--content-fg); }
    .tag { display:inline-block; background:var(--surface-muted); border:1px solid var(--surface-border); color:var(--content-muted);
      font:600 14px var(--font-sans); padding:2px 8px; border-radius:6px; margin-right:6px; }
    .tag--brand { background:var(--brand-50); color:var(--brand-700); border-color:var(--brand-100); }
    .tag--soft { background:transparent; }
    .col-actions { text-align:right; width:56px; }
    .kebab { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
    .danger { color:var(--danger); }
  `]
})
export class RoleTable {
  readonly rows = input<CompanyRole[]>([]);
  readonly startIndex = input(0);
  readonly loading = input(false);
  readonly sort = input<SortState | null>(null);
  readonly perms = input.required<RolePerms>();

  readonly sortChange = output<SortState>();
  readonly action = output<{ type: RoleAction; role: CompanyRole }>();

  readonly columns: TableColumn<CompanyRole>[] = [
    { key: 'roleCode', header: 'Role Code', sortable: true },
    { key: 'roleName', header: 'Role Name', sortable: true },
    { key: 'roleType', header: 'Type', sortable: true },
    { key: 'permissionCount', header: 'Grants' },
    { key: 'flags', header: 'Flags' },
    { key: 'status', header: 'Status', sortable: true, width: '120px' },
    { key: 'actions', header: '', width: '56px', align: 'right' }
  ];

  act(type: RoleAction, role: CompanyRole): void { this.action.emit({ type, role }); }
  pretty(v: string): string { return (v || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }
}
