import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { UiTable, TableColumn, SortState } from '@shared/components/ui-table/ui-table';
import { RateStatusBadge } from './rate-status-badge';
import { Rate } from '@core/models/rate.model';

/** Which row actions the caller may see. Drives the kebab menu; the list computes it. */
export interface RatePerms { update: boolean; lifecycle: boolean; }

export type RateAction = 'view' | 'edit' | 'activate' | 'deactivate';

/** Rate card table. Columns follow the backend list projection (RateSummaryResponse); the
 *  route/service/package/payment-mode ids are resolved to names by the caller (RateList)
 *  through name maps, the same pattern BranchTable uses for a manager id. */
@Component({
  selector: 'app-rate-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, UiTable, RateStatusBadge, MatMenuModule, MatIconModule],
  template: `
    <app-table [columns]="columns" [rows]="rows()" [loading]="loading()" [sort]="sort()" [startIndex]="startIndex()"
               emptyTitle="No rates" emptyHint="Create your first rate card to start pricing shipments."
               (sortChange)="sortChange.emit($event)" (rowClick)="act('view', $event)">
      <ng-template #row let-r>
        <td><span class="mono">{{ r.rateCode }}</span></td>
        <td><div class="cs">{{ r.rateName }}</div></td>
        <td>{{ routeNames().get(r.routeId) || '—' }}</td>
        <td>{{ serviceTypeNames().get(r.serviceTypeId) || '—' }}</td>
        <td>{{ packageTypeNames().get(r.packageTypeId) || '—' }}</td>
        <td>{{ paymentModeNames().get(r.paymentModeId) || '—' }}</td>
        <td class="mono">{{ r.minimumWeight }}–{{ r.maximumWeight }} {{ r.weightUnit }}</td>
        <td class="mono">{{ r.baseRate | number: '1.2-2' }}</td>
        <td><app-rate-status-badge [status]="r.status" /></td>
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
          </mat-menu>
        </td>
      </ng-template>
    </app-table>
  `,
  styles: [`
    .cs { font:600 17px var(--font-sans); }
    .mono { font:600 16px var(--font-mono, ui-monospace); color:var(--content-fg); }
    .col-actions { text-align:right; width:56px; }
    .kebab { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
  `]
})
export class RateTable {
  readonly rows = input<Rate[]>([]);
  readonly startIndex = input(0);
  readonly loading = input(false);
  readonly sort = input<SortState | null>(null);
  readonly perms = input.required<RatePerms>();
  readonly routeNames = input<Map<string, string>>(new Map());
  readonly serviceTypeNames = input<Map<string, string>>(new Map());
  readonly packageTypeNames = input<Map<string, string>>(new Map());
  readonly paymentModeNames = input<Map<string, string>>(new Map());

  readonly sortChange = output<SortState>();
  readonly action = output<{ type: RateAction; rate: Rate }>();

  readonly columns: TableColumn<Rate>[] = [
    { key: 'rateCode', header: 'Rate Code', sortable: true },
    { key: 'rateName', header: 'Rate Name', sortable: true },
    { key: 'route', header: 'Route' },
    { key: 'serviceType', header: 'Service Type' },
    { key: 'packageType', header: 'Package Type' },
    { key: 'paymentMode', header: 'Payment Mode' },
    { key: 'weight', header: 'Weight Slab' },
    { key: 'baseRate', header: 'Base Rate', sortable: true },
    { key: 'status', header: 'Status', sortable: true, width: '110px' },
    { key: 'actions', header: '', width: '56px', align: 'right' }
  ];

  act(type: RateAction, rate: Rate): void { this.action.emit({ type, rate }); }
}
