import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { UiTable, TableColumn, SortState } from '@shared/components/ui-table/ui-table';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { ShipmentStatusBadge } from './shipment-status-badge';
import { Shipment, CANCELLABLE_STATUSES } from '@core/models/shipment.model';

export interface ShipmentPerms { update: boolean; cancel: boolean; }
export type ShipmentAction = 'view' | 'edit' | 'cancel';

/** Shipment list table. Columns follow the backend list projection (ShipmentSummaryResponse). */
@Component({
  selector: 'app-shipment-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, UiTable, ShipmentStatusBadge, MatMenuModule, MatIconModule],
  template: `
    <app-table [columns]="visibleColumns()" [rows]="rows()" [loading]="loading()" [sort]="sort()" [startIndex]="startIndex()"
               emptyTitle="No shipments" emptyHint="Book your first shipment to get started."
               emptyIllustration="package"
               (sortChange)="sortChange.emit($event)" (rowClick)="act('view', $event)">
      <ng-template #row let-s>
        <td><span class="mono">{{ s.shipmentNumber }}</span></td>
        <td><span class="mono awb">{{ s.trackingNumber }}</span></td>
        <td>{{ s.bookingDate }}</td>
        <td>{{ branchLabel(s.bookingBranchId) }}</td>
        <td>{{ branchLabel(s.deliveryBranchId) }}</td>
        <td>{{ s.fromCity || '—' }}</td>
        <td>{{ s.toCity || '—' }}</td>
        <td>{{ s.senderName }}</td>
        <td class="mono">{{ s.senderContact }}</td>
        <td>{{ s.receiverName }}</td>
        <td class="mono">{{ s.receiverContact }}</td>
        <td>{{ paymentModeLabel(s.paymentModeId) }}</td>
        <td>{{ s.deliveryType === 'DOOR' ? 'Door Delivery' : 'Office Delivery' }}</td>
        <td class="num">{{ s.chargeableWeight | number: '1.3-3' }} kg</td>
        <td class="num">{{ s.netAmount != null ? ('₹' + (s.netAmount | number: '1.2-2')) : '—' }}</td>
        <td class="num">{{ s.commissionOnBasicFreight != null ? ('₹' + (s.commissionOnBasicFreight | number: '1.2-2')) : '—' }}</td>
        <td class="num">{{ s.branchCommissionOnOtherAmount != null ? ('₹' + (s.branchCommissionOnOtherAmount | number: '1.2-2')) : '—' }}</td>
        @if (showCompanyCommission()) {
          <td class="num">{{ s.companyCommissionOnBasicFreight != null ? ('₹' + (s.companyCommissionOnBasicFreight | number: '1.2-2')) : '—' }}</td>
        }
        <td class="num">{{ s.totalCommission != null ? ('₹' + (s.totalCommission | number: '1.2-2')) : '—' }}</td>
        <td><app-shipment-status-badge [status]="s.status" />@if (s.rto) { <span class="rto-tag" title="Being (or was) returned to the sender">RTO</span> }@if (s.returnPickup) { <span class="rp-tag" title="Return pickup: collected from the customer's buyer, delivered to the customer">Return pickup</span> }</td>
        <td class="col-actions" (click)="$event.stopPropagation()">
          <button class="kebab" [matMenuTriggerFor]="menu" aria-label="Actions"><mat-icon>more_vert</mat-icon></button>
          <mat-menu #menu="matMenu">
            <button mat-menu-item (click)="act('view', s)"><mat-icon>visibility</mat-icon><span>View</span></button>
            @if (perms().update && isEditable(s)) {
              <button mat-menu-item (click)="act('edit', s)"><mat-icon>edit</mat-icon><span>Edit</span></button>
            }
            @if (perms().cancel && isCancellable(s)) {
              <button mat-menu-item class="danger" (click)="act('cancel', s)"><mat-icon>cancel</mat-icon><span>Cancel</span></button>
            }
          </mat-menu>
        </td>
      </ng-template>
    </app-table>
  `,
  styles: [`
    .rp-tag { display:inline-block; margin-left:6px; padding:1px 6px; border-radius:999px; background:#fff4e0; color:#9a5b00; font:700 10px var(--font-sans); letter-spacing:.04em; vertical-align:middle; }
    .rto-tag { display:inline-block; margin-left:6px; padding:1px 6px; border-radius:999px; background:#fdecef; color:#b3123a; font:700 10px var(--font-sans); letter-spacing:.04em; vertical-align:middle; }
    .mono { font:600 13px var(--font-mono, ui-monospace); color:var(--content-fg); }
    .awb { color:var(--brand-600); }
    .num { text-align:right; }
    .col-actions { text-align:right; width:56px; }
    .kebab { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
    .danger { color:var(--danger); }
  `]
})
export class ShipmentTable {
  readonly rows = input<Shipment[]>([]);
  readonly startIndex = input(0);
  readonly loading = input(false);
  readonly sort = input<SortState | null>(null);
  readonly perms = input.required<ShipmentPerms>();
  /** Resolves `bookingBranchId`/`deliveryBranchId` to a name — every field the list
   *  projection (`ShipmentSummaryResponse`) carries is shown; branch is the one that's an
   *  id rather than a plain string. */
  readonly branchOptions = input<SelectOption[]>([]);
  readonly paymentModeOptions = input<SelectOption[]>([]);

  /** Branch logins don't see the company's own commission. */
  readonly showCompanyCommission = input(true);

  readonly sortChange = output<SortState>();
  readonly action = output<{ type: ShipmentAction; shipment: Shipment }>();

  readonly columns: TableColumn<Shipment>[] = [
    { key: 'shipmentNumber', header: 'Shipment No.', sortable: true },
    { key: 'trackingNumber', header: 'AWB', sortable: true },
    { key: 'bookingDate', header: 'Booking Date', sortable: true },
    { key: 'bookingBranchId', header: 'Booking Branch' },
    { key: 'deliveryBranchId', header: 'Delivery Branch' },
    { key: 'fromCity', header: 'From City' },
    { key: 'toCity', header: 'To City' },
    { key: 'senderName', header: 'Sender' },
    { key: 'senderContact', header: 'Sender Contact' },
    { key: 'receiverName', header: 'Receiver' },
    { key: 'receiverContact', header: 'Receiver Contact' },
    { key: 'paymentModeId', header: 'Payment Mode' },
    { key: 'deliveryType', header: 'Delivery Type' },
    { key: 'chargeableWeight', header: 'Chargeable Wt.', sortable: true, align: 'right' },
    { key: 'netAmount', header: 'Total Amount', align: 'right' },
    { key: 'commissionOnBasicFreight', header: 'Commission on Basic Freight', align: 'right' },
    { key: 'branchCommissionOnOtherAmount', header: 'Branch Commission on Other Amount', align: 'right' },
    { key: 'companyCommissionOnBasicFreight', header: 'Company Commission on Basic Freight', align: 'right' },
    { key: 'totalCommission', header: 'Total Commission', align: 'right' },
    { key: 'status', header: 'Status', sortable: true, width: '160px' },
    { key: 'actions', header: '', width: '56px', align: 'right' }
  ];

  readonly visibleColumns = computed(() => this.showCompanyCommission()
    ? this.columns
    : this.columns.filter((c) => c.key !== 'companyCommissionOnBasicFreight'));

  act(type: ShipmentAction, shipment: Shipment): void { this.action.emit({ type, shipment }); }
  isEditable(s: Shipment): boolean { return s.status === 'BOOKED'; }
  isCancellable(s: Shipment): boolean { return CANCELLABLE_STATUSES.includes(s.status); }
  branchLabel(id: string): string { return this.branchOptions().find((o) => o.value === id)?.label ?? '—'; }
  paymentModeLabel(id: string): string { return this.paymentModeOptions().find((o) => o.value === id)?.label ?? '—'; }
}
