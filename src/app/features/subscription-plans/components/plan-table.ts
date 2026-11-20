import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { UiTable, TableColumn, SortState } from '@shared/components/ui-table/ui-table';
import { PlanStatusBadge } from './plan-status-badge';
import { SubscriptionPlan } from '@core/models/subscription-plan.model';

/** Which row actions the caller may see. Drives the kebab menu; the list computes it. */
export interface PlanPerms { create: boolean; update: boolean; delete: boolean; }

export type PlanAction = 'view' | 'edit' | 'activate' | 'deactivate' | 'delete';

/**
 * Subscription plan catalogue table. Columns mirror SubscriptionPlanSummary — the list
 * projection carries price/tier but not quotas or feature flags, those live on the
 * detail view. A per-row kebab exposes the lifecycle and delete actions, each hidden
 * without the permission.
 */
@Component({
  selector: 'app-plan-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, UiTable, PlanStatusBadge, MatMenuModule, MatIconModule],
  template: `
    <app-table [columns]="columns" [rows]="rows()" [loading]="loading()" [sort]="sort()" [startIndex]="startIndex()"
               emptyTitle="No subscription plans" emptyHint="Create your first plan to get started."
               (sortChange)="sortChange.emit($event)" (rowClick)="act('view', $event)">
      <ng-template #row let-r>
        <td><span class="mono">{{ r.planCode }}</span></td>
        <td><div class="cs">{{ r.planName }}</div></td>
        <td>{{ pretty(r.planType) }}</td>
        <td>{{ r.currency }} {{ r.monthlyPrice | number:'1.2-2' }}<span class="per">/mo</span></td>
        <td>{{ r.currency }} {{ r.yearlyPrice | number:'1.2-2' }}<span class="per">/yr</span></td>
        <td>{{ r.trialDays }} {{ r.trialDays === 1 ? 'day' : 'days' }}</td>
        <td><app-plan-status-badge [status]="r.isActive" /></td>
        <td class="col-actions" (click)="$event.stopPropagation()">
          <button class="kebab" [matMenuTriggerFor]="menu" aria-label="Actions"><mat-icon>more_vert</mat-icon></button>
          <mat-menu #menu="matMenu">
            <button mat-menu-item (click)="act('view', r)"><mat-icon>visibility</mat-icon><span>View</span></button>
            @if (perms().update) {
              <button mat-menu-item (click)="act('edit', r)"><mat-icon>edit</mat-icon><span>Edit</span></button>
              @if (!r.isActive) {
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
    .mono { font:600 16px var(--font-mono, var(--font-sans)); color:var(--content-fg); }
    .per { color:var(--content-muted); font-size:14px; margin-left:2px; }
    .col-actions { text-align:right; width:56px; }
    .kebab { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
    .danger { color:var(--danger); }
  `]
})
export class PlanTable {
  readonly rows = input<SubscriptionPlan[]>([]);
  readonly startIndex = input(0);
  readonly loading = input(false);
  readonly sort = input<SortState | null>(null);
  readonly perms = input.required<PlanPerms>();

  readonly sortChange = output<SortState>();
  readonly action = output<{ type: PlanAction; plan: SubscriptionPlan }>();

  readonly columns: TableColumn<SubscriptionPlan>[] = [
    { key: 'planCode', header: 'Plan Code', sortable: true },
    { key: 'planName', header: 'Plan Name', sortable: true },
    { key: 'planType', header: 'Tier', sortable: true },
    { key: 'monthlyPrice', header: 'Monthly', sortable: true },
    { key: 'yearlyPrice', header: 'Yearly', sortable: true },
    { key: 'trialDays', header: 'Trial', sortable: true },
    { key: 'isActive', header: 'Status', sortable: true, width: '110px' },
    { key: 'actions', header: '', width: '56px', align: 'right' }
  ];

  act(type: PlanAction, plan: SubscriptionPlan): void { this.action.emit({ type, plan }); }
  pretty(v: string): string { return (v || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }
}
