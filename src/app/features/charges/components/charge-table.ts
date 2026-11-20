import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { UiTable, TableColumn, SortState } from '@shared/components/ui-table/ui-table';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { Charge } from '@core/models/charge.model';

/** Which row actions the caller may see. Drives the kebab menu; the list computes it. */
export interface ChargePerms { update: boolean; lifecycle: boolean; delete: boolean; }

export type ChargeAction = 'view' | 'edit' | 'activate' | 'deactivate' | 'delete';

/** Charge list table. Columns follow the backend list projection (ChargeSummaryResponse);
 *  the service type id is resolved to a name by the caller (ChargeList) through a name
 *  map, the same pattern RateTable uses for its combination ids. */
@Component({
  selector: 'app-charge-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiTable, StatusBadge, MatMenuModule, MatIconModule],
  template: `
    <app-table [columns]="columns" [rows]="rows()" [loading]="loading()" [sort]="sort()" [startIndex]="startIndex()"
               emptyTitle="No charges" emptyHint="Create your first charge to start configuring pricing/commission settings."
               (sortChange)="sortChange.emit($event)" (rowClick)="act('view', $event)">
      <ng-template #row let-c>
        <td><div class="cs">{{ c.chargeName }}</div></td>
        <td>{{ serviceTypeNames().get(c.serviceTypeId) || '—' }}</td>
        <td>{{ c.isQtyLevel ? 'Per Piece' : '—' }}</td>
        <td><app-status-badge [value]="c.status" /></td>
        <td class="col-actions" (click)="$event.stopPropagation()">
          <button class="kebab" [matMenuTriggerFor]="menu" aria-label="Actions"><mat-icon>more_vert</mat-icon></button>
          <mat-menu #menu="matMenu">
            <button mat-menu-item (click)="act('view', c)"><mat-icon>visibility</mat-icon><span>View</span></button>
            @if (perms().update) {
              <button mat-menu-item (click)="act('edit', c)"><mat-icon>edit</mat-icon><span>Edit</span></button>
            }
            @if (perms().lifecycle) {
              @if (c.status === 'INACTIVE') {
                <button mat-menu-item (click)="act('activate', c)"><mat-icon>check_circle</mat-icon><span>Activate</span></button>
              } @else {
                <button mat-menu-item (click)="act('deactivate', c)"><mat-icon>block</mat-icon><span>Deactivate</span></button>
              }
            }
            @if (perms().delete) {
              <button mat-menu-item (click)="act('delete', c)"><mat-icon>delete</mat-icon><span>Delete</span></button>
            }
          </mat-menu>
        </td>
      </ng-template>
    </app-table>
  `,
  styles: [`
    .cs { font:600 17px var(--font-sans); }
    .col-actions { text-align:right; width:56px; }
    .kebab { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
  `]
})
export class ChargeTable {
  readonly rows = input<Charge[]>([]);
  readonly startIndex = input(0);
  readonly loading = input(false);
  readonly sort = input<SortState | null>(null);
  readonly perms = input.required<ChargePerms>();
  readonly serviceTypeNames = input<Map<string, string>>(new Map());

  readonly sortChange = output<SortState>();
  readonly action = output<{ type: ChargeAction; charge: Charge }>();

  readonly columns: TableColumn<Charge>[] = [
    { key: 'chargeName', header: 'Charge Name', sortable: true },
    { key: 'serviceType', header: 'Service Type' },
    { key: 'isQtyLevel', header: 'Slab Basis', width: '110px' },
    { key: 'status', header: 'Status', sortable: true, width: '110px' },
    { key: 'actions', header: '', width: '56px', align: 'right' }
  ];

  act(type: ChargeAction, charge: Charge): void { this.action.emit({ type, charge }); }
}
