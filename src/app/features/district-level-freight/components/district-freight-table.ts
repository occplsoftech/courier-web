import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { UiTable, TableColumn, SortState } from '@shared/components/ui-table/ui-table';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { DistrictLevelFreight } from '@core/models/district-level-freight.model';

/** Which row actions the caller may see. Drives the kebab menu; the list computes it. */
export interface DistrictFreightPerms { update: boolean; lifecycle: boolean; delete: boolean; }

export type DistrictFreightAction = 'view' | 'edit' | 'activate' | 'deactivate' | 'delete';

/** District Level Freight table — From Station, District, all six weight-slab rates, ODA,
 *  status and actions, per the module's own spec. Branch/district names are resolved
 *  server-side onto the row already (DistrictLevelFreightMapper), so no name-map lookups
 *  are needed here, unlike RateTable. */
@Component({
  selector: 'app-district-freight-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, UiTable, StatusBadge, MatMenuModule, MatIconModule],
  template: `
    <app-table [columns]="columns" [rows]="rows()" [loading]="loading()" [sort]="sort()" [startIndex]="startIndex()"
               emptyTitle="No District Level Freight rates" emptyHint="Add a rate for a From Station + District to get started."
               (sortChange)="sortChange.emit($event)" (rowClick)="act('view', $event)">
      <ng-template #row let-r>
        <td><div class="cs">{{ r.branchName || '—' }}</div><span class="mono muted">{{ r.branchCode }}</span></td>
        <td><div class="cs">{{ r.districtName || '—' }}</div><span class="mono muted">{{ r.districtCode }}</span></td>
        <td class="mono">{{ r.rate1To15 | number: '1.2-2' }}</td>
        <td class="mono">{{ r.rate16To50 | number: '1.2-2' }}</td>
        <td class="mono">{{ r.rate51To100 | number: '1.2-2' }}</td>
        <td class="mono">{{ r.rate101To1000 | number: '1.2-2' }}</td>
        <td class="mono">{{ r.rate1001To1500 | number: '1.2-2' }}</td>
        <td class="mono">{{ r.rate1501To2000 | number: '1.2-2' }}</td>
        <td class="mono">{{ r.odaApplicable ? (r.odaCharge | number: '1.2-2') : 'N/A' }}</td>
        <td><app-status-badge [value]="r.status" /></td>
        <td class="col-actions" (click)="$event.stopPropagation()">
          <button class="kebab" [matMenuTriggerFor]="menu" aria-label="Actions"><mat-icon>more_vert</mat-icon></button>
          <mat-menu #menu="matMenu">
            <button mat-menu-item (click)="act('view', r)"><mat-icon>visibility</mat-icon><span>View</span></button>
            @if (perms().update) {
              <button mat-menu-item (click)="act('edit', r)"><mat-icon>edit</mat-icon><span>Edit</span></button>
            }
            @if (perms().lifecycle) {
              @if (r.status === 'INACTIVE') {
                <button mat-menu-item (click)="act('activate', r)"><mat-icon>check_circle</mat-icon><span>Activate</span></button>
              } @else {
                <button mat-menu-item (click)="act('deactivate', r)"><mat-icon>block</mat-icon><span>Deactivate</span></button>
              }
            }
            @if (perms().delete) {
              <button mat-menu-item class="danger" (click)="act('delete', r)"><mat-icon>delete</mat-icon><span>Delete</span></button>
            }
          </mat-menu>
        </td>
      </ng-template>
    </app-table>
  `,
  styles: [`
    .cs { font:600 17px var(--font-sans); }
    .mono { font:600 16px var(--font-mono, ui-monospace); color:var(--content-fg); }
    .muted { color:var(--content-muted); font-weight:500; }
    .col-actions { text-align:right; width:56px; }
    .kebab { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
    .danger { color:var(--danger); }
  `]
})
export class DistrictFreightTable {
  readonly rows = input<DistrictLevelFreight[]>([]);
  readonly startIndex = input(0);
  readonly loading = input(false);
  readonly sort = input<SortState | null>(null);
  readonly perms = input.required<DistrictFreightPerms>();

  readonly sortChange = output<SortState>();
  readonly action = output<{ type: DistrictFreightAction; row: DistrictLevelFreight }>();

  readonly columns: TableColumn<DistrictLevelFreight>[] = [
    { key: 'branch', header: 'From Station' },
    { key: 'district', header: 'District' },
    { key: 'rate1To15', header: '1-15 KG' },
    { key: 'rate16To50', header: '16-50 KG' },
    { key: 'rate51To100', header: '51-100 KG' },
    { key: 'rate101To1000', header: '101-1000 KG' },
    { key: 'rate1001To1500', header: '1001-1500 KG' },
    { key: 'rate1501To2000', header: '1501-2000 KG' },
    { key: 'odaCharge', header: 'ODA' },
    { key: 'status', header: 'Status', sortable: true, width: '110px' },
    { key: 'actions', header: '', width: '56px', align: 'right' }
  ];

  act(type: DistrictFreightAction, row: DistrictLevelFreight): void { this.action.emit({ type, row }); }
}
