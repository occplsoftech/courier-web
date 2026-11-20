import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { SortState, TableColumn, UiTable } from '@shared/components/ui-table/ui-table';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { MasterRecord } from '@core/models/master.model';
import { MasterColumn, MasterDefinition } from '../master.config';

/** Which row actions the caller may see. The list computes it from their permissions. */
export interface MasterPerms {
  update: boolean;
  delete: boolean;
}

export type MasterAction = 'view' | 'edit' | 'activate' | 'deactivate' | 'delete';

/**
 * One table for all twelve master lists.
 *
 * The columns come from the definition, so this component never names a field. Cells are
 * rendered through the column's `value()` projection; the two the shared screens style
 * specially are the code (monospace, because it is an identifier people compare by eye)
 * and the status (a badge).
 *
 * Row actions respect the business rules the backend enforces, so the menu does not offer
 * something that is going to come back 422: an active row shows Deactivate, an inactive one
 * shows Activate.
 */
@Component({
  selector: 'app-master-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiTable, StatusBadge, MatMenuModule, MatIconModule],
  template: `
    <app-table [columns]="tableColumns()" [rows]="rows()" [loading]="loading()" [sort]="sort()" [startIndex]="startIndex()"
               [emptyTitle]="'No ' + def().plural.toLowerCase()"
               [emptyHint]="emptyHint()"
               (sortChange)="sortChange.emit($event)" (rowClick)="act('view', $event)">
      <ng-template #row let-r>
        @for (col of def().columns; track col.key) {
          <td [style.text-align]="col.align || 'left'">
            @if (col.kind === 'status') {
              <app-status-badge [value]="asText(r[col.key])" />
            } @else if (col.key === 'code') {
              <span class="mono">{{ asText(r[col.key]) }}</span>
            } @else if (col.kind === 'boolean') {
              <span class="tag" [class.tag--ok]="!!r[col.key]">{{ render(col, r) }}</span>
            } @else if (col.key === 'name') {
              <span class="strong">{{ render(col, r) }}</span>
            } @else {
              {{ render(col, r) }}
            }
          </td>
        }
        <td class="col-actions" (click)="$event.stopPropagation()">
          <button class="kebab" [matMenuTriggerFor]="menu" aria-label="Actions">
            <mat-icon>more_vert</mat-icon>
          </button>
          <mat-menu #menu="matMenu">
            <button mat-menu-item (click)="act('view', r)">
              <mat-icon>visibility</mat-icon><span>View</span>
            </button>
            @if (perms().update) {
              <button mat-menu-item (click)="act('edit', r)">
                <mat-icon>edit</mat-icon><span>Edit</span>
              </button>
              @if (r.status === 'INACTIVE') {
                <button mat-menu-item (click)="act('activate', r)">
                  <mat-icon>check_circle</mat-icon><span>Activate</span>
                </button>
              } @else {
                <button mat-menu-item (click)="act('deactivate', r)">
                  <mat-icon>block</mat-icon><span>Deactivate</span>
                </button>
              }
            }
            @if (perms().delete) {
              <button mat-menu-item class="danger" (click)="act('delete', r)">
                <mat-icon>delete</mat-icon><span>Delete</span>
              </button>
            }
          </mat-menu>
        </td>
      </ng-template>
    </app-table>
  `,
  styles: [`
    .strong { font:600 17px var(--font-sans); }
    .mono { font:600 16px var(--font-mono, ui-monospace); color:var(--content-fg); }
    .tag { display:inline-block; background:var(--surface-muted); border:1px solid var(--surface-border);
      color:var(--content-muted); font:600 13px var(--font-sans); padding:2px 7px; border-radius:6px; }
    .tag--ok { background:var(--success-bg); color:var(--success); border-color:transparent; }
    .col-actions { text-align:right; width:56px; }
    .kebab { border:0; background:transparent; cursor:pointer; color:var(--content-muted);
      display:inline-flex; padding:4px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
  `]
})
export class MasterTable {
  readonly def = input.required<MasterDefinition>();
  readonly rows = input<MasterRecord[]>([]);
  readonly startIndex = input(0);
  readonly loading = input(false);
  readonly sort = input<SortState | null>(null);
  readonly perms = input.required<MasterPerms>();

  readonly sortChange = output<SortState>();
  readonly action = output<{ type: MasterAction; row: MasterRecord }>();

  /** The declared columns plus the actions column the template always renders. */
  readonly tableColumns = computed<TableColumn<MasterRecord>[]>(() => [
    ...this.def().columns.map((c) => ({
      key: c.key, header: c.header, sortable: c.sortable, width: c.width, align: c.align
    })),
    { key: '__actions', header: '', width: '56px', align: 'right' as const }
  ]);

  readonly emptyHint = computed(() => {
    const def = this.def();
    return def.seeded
      ? `Create one, or seed the standard ${def.plural.toLowerCase()} from the button above.`
      : `Create your first ${def.singular.toLowerCase()} to get started.`;
  });

  render(col: MasterColumn, row: MasterRecord): string {
    if (col.value) return col.value(row);
    return this.asText(row[col.key]);
  }

  asText(value: unknown): string {
    return value === null || value === undefined || value === '' ? '—' : String(value);
  }

  act(type: MasterAction, row: MasterRecord): void {
    this.action.emit({ type, row });
  }
}
