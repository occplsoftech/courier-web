import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { UiTable, TableColumn, SortState } from '@shared/components/ui-table/ui-table';
import { BranchStatusBadge } from './branch-status-badge';
import { Branch } from '@core/models/branch.model';

/** Which row actions the caller may see. Drives the kebab menu; the list computes it. */
export interface BranchPerms { update: boolean; delete: boolean; impersonate: boolean; }

export type BranchAction = 'view' | 'edit' | 'activate' | 'deactivate' | 'assign-manager' | 'delete' | 'login-as';

/**
 * Branch directory table. Columns follow the backend list projection
 * (BranchSummaryResponse). The spec's "Owner" maps to the branch **manager** (resolved from
 * the supplied id→name map) and "Mobile"/"Hub Count" are dropped — the summary carries no
 * mobile, and a branch has no hub relation in this backend (hubs are their own module; a
 * user carries `hub_id`). Location and capability flags fill the row instead; full contact
 * is on the detail view. A per-row kebab exposes gated actions.
 */
@Component({
  selector: 'app-branch-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiTable, BranchStatusBadge, MatMenuModule, MatIconModule],
  template: `
    <app-table [columns]="columns" [rows]="rows()" [loading]="loading()" [sort]="sort()" [startIndex]="startIndex()"
               emptyTitle="No branches" emptyHint="Create your first branch to get started."
               (sortChange)="sortChange.emit($event)" (rowClick)="act('view', $event)">
      <ng-template #row let-b>
        <td><span class="mono">{{ b.branchCode }}</span></td>
        <td><div class="cs">{{ b.branchName }}</div></td>
        <td>{{ pretty(b.branchType) }}</td>
        <td>{{ location(b) }}</td>
        <td>{{ managerName(b.managerId) }}</td>
        <td>
          @if (b.allowBooking) { <span class="tag tag--ok">Booking</span> }
          @if (b.allowDelivery) { <span class="tag tag--ok">Delivery</span> }
          @if (!b.allowBooking && !b.allowDelivery) { <span class="tag">—</span> }
        </td>
        <td><app-branch-status-badge [status]="b.status" /></td>
        <td class="col-actions" (click)="$event.stopPropagation()">
          <button class="kebab" [matMenuTriggerFor]="menu" aria-label="Actions"><mat-icon>more_vert</mat-icon></button>
          <mat-menu #menu="matMenu">
            <button mat-menu-item (click)="act('view', b)"><mat-icon>visibility</mat-icon><span>View</span></button>
            @if (perms().impersonate && b.status === 'ACTIVE') {
              <button mat-menu-item (click)="act('login-as', b)"><mat-icon>admin_panel_settings</mat-icon><span>Login as Branch</span></button>
            }
            @if (perms().update) {
              <button mat-menu-item (click)="act('edit', b)"><mat-icon>edit</mat-icon><span>Edit</span></button>
              <button mat-menu-item (click)="act('assign-manager', b)"><mat-icon>person_pin</mat-icon><span>Assign Manager</span></button>
              @if (b.status === 'INACTIVE') {
                <button mat-menu-item (click)="act('activate', b)"><mat-icon>check_circle</mat-icon><span>Activate</span></button>
              } @else {
                <button mat-menu-item (click)="act('deactivate', b)"><mat-icon>block</mat-icon><span>Deactivate</span></button>
              }
            }
            @if (perms().delete) {
              <button mat-menu-item class="danger" (click)="act('delete', b)"><mat-icon>delete</mat-icon><span>Delete</span></button>
            }
          </mat-menu>
        </td>
      </ng-template>
    </app-table>
  `,
  styles: [`
    .cs { font:600 17px var(--font-sans); }
    .mono { font:600 16px var(--font-mono, ui-monospace); color:var(--content-fg); }
    .tag { display:inline-block; background:var(--surface-muted); border:1px solid var(--surface-border); color:var(--content-muted);
      font:600 13px var(--font-sans); padding:2px 7px; border-radius:6px; margin-right:6px; }
    .tag--ok { background:var(--success-bg); color:var(--success); border-color:transparent; }
    .col-actions { text-align:right; width:56px; }
    .kebab { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
    .danger { color:var(--danger); }
  `]
})
export class BranchTable {
  readonly rows = input<Branch[]>([]);
  readonly startIndex = input(0);
  readonly loading = input(false);
  readonly sort = input<SortState | null>(null);
  readonly perms = input.required<BranchPerms>();
  /** id → display name for managers, so a UUID never shows in the Owner column. */
  readonly managerNames = input<ReadonlyMap<string, string>>(new Map());

  readonly sortChange = output<SortState>();
  readonly action = output<{ type: BranchAction; branch: Branch }>();

  readonly columns: TableColumn<Branch>[] = [
    { key: 'branchCode', header: 'Branch Code', sortable: true },
    { key: 'branchName', header: 'Branch Name', sortable: true },
    { key: 'branchType', header: 'Type', sortable: true },
    { key: 'location', header: 'Location' },
    { key: 'manager', header: 'Manager' },
    { key: 'capabilities', header: 'Capabilities' },
    { key: 'status', header: 'Status', sortable: true, width: '120px' },
    { key: 'actions', header: '', width: '56px', align: 'right' }
  ];

  act(type: BranchAction, branch: Branch): void { this.action.emit({ type, branch }); }
  pretty(v: string): string { return (v || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }
  location(b: Branch): string { return [b.city, b.state].filter(Boolean).join(', ') || '—'; }
  managerName(id?: string | null): string { return id ? (this.managerNames().get(id) ?? '—') : 'Unassigned'; }
}
