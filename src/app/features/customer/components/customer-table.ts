import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { UiTable, TableColumn, SortState } from '@shared/components/ui-table/ui-table';
import { CustomerStatusBadge } from './customer-status-badge';
import {
  BILLING_FREQUENCY_LABELS, BillingFrequency, Customer, CustomerPaymentMode, PAYMENT_MODE_LABELS
} from '@core/models/customer.model';

/** Which row actions the caller may see. Drives the kebab menu; the list computes it. */
export interface CustomerPerms { update: boolean; lifecycle: boolean; }

export type CustomerAction = 'view' | 'edit' | 'activate' | 'deactivate';

/** Customer directory table. Columns follow the backend list projection (CustomerSummaryResponse). */
@Component({
  selector: 'app-customer-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiTable, CustomerStatusBadge, MatMenuModule, MatIconModule],
  template: `
    <app-table [columns]="columns" [rows]="rows()" [loading]="loading()" [sort]="sort()" [startIndex]="startIndex()"
               emptyTitle="No customers" emptyHint="Register your first customer to get started."
               (sortChange)="sortChange.emit($event)" (rowClick)="act('view', $event)">
      <ng-template #row let-c>
        <td><span class="mono">{{ c.customerCode }}</span></td>
        <td><div class="cs">{{ c.displayName }}</div></td>
        <td>{{ pretty(c.customerType) }}</td>
        <td>{{ c.mobile }}</td>
        <td>{{ c.email || '—' }}</td>
        <td>{{ c.defaultPaymentMode ? paymentLabel(c.defaultPaymentMode) : '—' }}</td>
        <td>{{ c.billingFrequency ? frequencyLabel(c.billingFrequency) : '—' }}</td>
        <td><app-customer-status-badge [status]="c.status" /></td>
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
export class CustomerTable {
  readonly rows = input<Customer[]>([]);
  readonly startIndex = input(0);
  readonly loading = input(false);
  readonly sort = input<SortState | null>(null);
  readonly perms = input.required<CustomerPerms>();

  readonly sortChange = output<SortState>();
  readonly action = output<{ type: CustomerAction; customer: Customer }>();

  readonly columns: TableColumn<Customer>[] = [
    { key: 'customerCode', header: 'Customer Code', sortable: true },
    { key: 'displayName', header: 'Name' },
    { key: 'customerType', header: 'Type', sortable: true },
    { key: 'mobile', header: 'Mobile', sortable: true },
    { key: 'email', header: 'Email' },
    { key: 'defaultPaymentMode', header: 'Payment' },
    { key: 'billingFrequency', header: 'Billing' },
    { key: 'status', header: 'Status', sortable: true, width: '120px' },
    { key: 'actions', header: '', width: '56px', align: 'right' }
  ];

  act(type: CustomerAction, customer: Customer): void { this.action.emit({ type, customer }); }
  paymentLabel(v: CustomerPaymentMode): string { return PAYMENT_MODE_LABELS[v] ?? v; }
  frequencyLabel(v: BillingFrequency): string { return BILLING_FREQUENCY_LABELS[v] ?? v; }
  pretty(v: string): string { return (v || '').charAt(0) + (v || '').slice(1).toLowerCase(); }
}
