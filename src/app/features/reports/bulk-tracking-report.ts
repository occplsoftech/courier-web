import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { BulkTrackRow } from '@core/models/shipment.model';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { TableColumn, UiTable } from '@shared/components/ui-table/ui-table';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { MasterDataService } from '@features/masters/master-data.service';
import { ShipmentStatusBadge } from '../shipment/components/shipment-status-badge';
import { ShipmentService } from '../shipment/shipment.service';
import { downloadCsv } from '@shared/utils/csv-export.util';

const MAX_NUMBERS = 200;

/**
 * Bulk Shipment Tracking — paste any mix of tracking (AWB) or shipment numbers,
 * comma/space/newline separated, and get one table row back per number: matched
 * shipment details, or a plain "Not Found" row. One request (`POST /shipments/track/bulk`)
 * for the whole batch, not one `GET /shipments/track/{n}` per number.
 */
@Component({
  selector: 'app-bulk-tracking-report',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, DatePipe, FormsModule, UiTable, UiButton, ShipmentStatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Bulk Shipment Tracking</h1>
          <p class="text-caption">Paste up to {{ MAX_NUMBERS }} tracking or shipment numbers, comma or newline separated.</p></div>
      </header>

      <div class="input-card app-card">
        <textarea rows="4" placeholder="e.g. AWB1234567, SHP-000123, AWB1234568"
                  [(ngModel)]="rawInput" (keydown.control.enter)="track()"></textarea>
        <div class="input-actions">
          <span class="text-caption">{{ parsedCount() }} number(s) entered @if (parsedCount() > MAX_NUMBERS) { <span class="over">— max {{ MAX_NUMBERS }}</span> }</span>
          <div class="input-actions__buttons">
            <app-button variant="stroked" (pressed)="clear()">Clear</app-button>
            <app-button [loading]="loading()" [disabled]="!parsedCount() || parsedCount() > MAX_NUMBERS" (pressed)="track()">Track</app-button>
          </div>
        </div>
      </div>

      @if (results(); as rows) {
        <div class="stats">
          <div class="stat"><span class="stat__l">Searched</span><span class="stat__v">{{ rows.length }}</span></div>
          <div class="stat"><span class="stat__l">Found</span><span class="stat__v">{{ foundCount() }}</span></div>
          <div class="stat"><span class="stat__l">Not Found</span><span class="stat__v">{{ rows.length - foundCount() }}</span></div>
        </div>

        <div class="results-head">
          <app-button variant="stroked" icon="download" [disabled]="!rows.length" (pressed)="exportCsv()">Export</app-button>
        </div>

        <app-table [columns]="columns" [rows]="rows" [loading]="loading()" [idKey]="'number'"
                   emptyTitle="No results" emptyHint="Track some numbers to see results here." (rowClick)="view($event)">
          <ng-template #row let-r>
            <td><span class="mono">{{ r.number }}</span></td>
            @if (r.found) {
              <td><span class="mono">{{ r.shipment.shipmentNumber }}</span></td>
              <td><span class="mono awb">{{ r.shipment.trackingNumber }}</span></td>
              <td>{{ r.shipment.bookingDate }}</td>
              <td>{{ branchLabel(r.shipment.bookingBranchId) }}</td>
              <td>{{ branchLabel(r.shipment.deliveryBranchId) }}</td>
              <td>{{ r.shipment.status === 'DELIVERED' ? '—' : ('Stock at ' + branchLabel(r.shipment.currentLocationId ?? '')) }}</td>
              <td>{{ r.shipment.senderName }}</td>
              <td>{{ r.shipment.receiverName }}</td>
              <td class="num">{{ r.shipment.chargeableWeight | number: '1.3-3' }} kg</td>
              <td class="num">{{ r.shipment.netAmount != null ? ('₹' + (r.shipment.netAmount | number: '1.2-2')) : '—' }}</td>
              <td>{{ r.shipment.receivedAt ? (r.shipment.receivedAt | date: 'dd MMM y, h:mm a') : '—' }}</td>
              <td>{{ r.shipment.deliveredAt ? (r.shipment.deliveredAt | date: 'dd MMM y, h:mm a') : '—' }}</td>
              <td><app-shipment-status-badge [status]="r.shipment.status" /></td>
            } @else {
              <td colspan="13" class="not-found">Not Found</td>
            }
          </ng-template>
        </app-table>
      }
    </div>
  `,
  styles: [`
    .page__head { margin-bottom:12px; }
    .input-card { padding:14px 16px; display:flex; flex-direction:column; gap:10px; margin-bottom:16px; }
    .input-card textarea { width:100%; resize:vertical; padding:10px 12px; border:1px solid var(--surface-border);
      border-radius:var(--r-field); font:400 17px var(--font-sans); color:var(--content-fg); background:var(--surface); }
    .input-actions { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
    .input-actions__buttons { display:flex; gap:8px; }
    .over { color:var(--danger-600, #d33); font-weight:600; }
    .stats { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
    .stat { display:flex; flex-direction:column; gap:4px; padding:12px 18px; min-width:120px;
      background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .stat__l { font:500 15px var(--font-sans); color:var(--content-muted); }
    .stat__v { font:700 23px var(--font-sans); color:var(--content-fg); }
    .results-head { display:flex; justify-content:flex-end; margin-bottom:10px; }
    .mono { font:600 16px var(--font-mono, ui-monospace); color:var(--content-fg); }
    .awb { color:var(--brand-600); }
    .num { text-align:right; }
    .not-found { color:var(--content-muted); font-style:italic; }
  `]
})
export class BulkTrackingReport implements OnInit {
  private readonly service = inject(ShipmentService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  protected readonly MAX_NUMBERS = MAX_NUMBERS;
  protected readonly branchOptions = signal<SelectOption[]>([]);
  protected readonly loading = signal(false);
  protected readonly results = signal<BulkTrackRow[] | null>(null);
  protected rawInput = '';

  protected readonly columns: TableColumn<BulkTrackRow>[] = [
    { key: 'number', header: 'Entered Number' },
    { key: 'shipmentNumber', header: 'Shipment No.' },
    { key: 'trackingNumber', header: 'AWB' },
    { key: 'bookingDate', header: 'Booking Date' },
    { key: 'bookingBranchId', header: 'Booking Branch' },
    { key: 'deliveryBranchId', header: 'Delivery Branch' },
    { key: 'currentLocationId', header: 'Current Location' },
    { key: 'senderName', header: 'Sender' },
    { key: 'receiverName', header: 'Receiver' },
    { key: 'chargeableWeight', header: 'Chargeable Wt.', align: 'right' as const },
    { key: 'netAmount', header: 'Amount', align: 'right' as const },
    { key: 'receivedAt', header: 'Received Date' },
    { key: 'deliveredAt', header: 'Delivery Date' },
    { key: 'status', header: 'Status', width: '160px' }
  ];

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Reports' }, { label: 'Bulk Shipment Tracking' }]);
    this.masters.options('branches').subscribe((o) => this.branchOptions.set(o));
  }

  private parsedNumbers(): string[] {
    const seen = new Set<string>();
    for (const n of this.rawInput.split(/[\s,]+/)) {
      const trimmed = n.trim();
      if (trimmed) seen.add(trimmed);
    }
    return [...seen];
  }

  protected parsedCount(): number { return this.parsedNumbers().length; }
  protected foundCount(): number { return (this.results() ?? []).filter((r) => r.found).length; }

  clear(): void { this.rawInput = ''; this.results.set(null); }

  track(): void {
    const numbers = this.parsedNumbers();
    if (!numbers.length || numbers.length > MAX_NUMBERS) return;
    this.loading.set(true);
    this.service.bulkTrack(numbers).subscribe({
      next: (res) => { this.results.set(res.results); this.loading.set(false); },
      error: () => { this.loading.set(false); this.notify.error('Bulk tracking failed.'); }
    });
  }

  protected branchLabel(id: string | null | undefined): string { return this.branchOptions().find((o) => o.value === id)?.label ?? '—'; }

  view(r: BulkTrackRow): void {
    if (r.found && r.shipment) this.router.navigate(['/shipments', r.shipment.id]);
  }

  exportCsv(): void {
    const rows = this.results() ?? [];
    const header = ['enteredNumber', 'found', 'shipmentNumber', 'trackingNumber', 'bookingDate',
      'bookingBranch', 'deliveryBranch', 'currentLocation', 'sender', 'receiver', 'chargeableWeight',
      'netAmount', 'receivedDate', 'deliveryDate', 'status'];
    const lines = rows.map((r) => [
      r.number, r.found ? 'Yes' : 'No',
      r.shipment?.shipmentNumber ?? '', r.shipment?.trackingNumber ?? '', r.shipment?.bookingDate ?? '',
      r.shipment ? this.branchLabel(r.shipment.bookingBranchId) : '',
      r.shipment ? this.branchLabel(r.shipment.deliveryBranchId) : '',
      r.shipment && r.shipment.status !== 'DELIVERED' ? 'Stock at ' + this.branchLabel(r.shipment.currentLocationId ?? '') : '',
      r.shipment?.senderName ?? '', r.shipment?.receiverName ?? '',
      r.shipment?.chargeableWeight ?? '', r.shipment?.netAmount ?? '',
      r.shipment?.receivedAt ?? '', r.shipment?.deliveredAt ?? '', r.shipment?.status ?? ''
    ]);
    downloadCsv(`bulk-shipment-tracking-${new Date().toISOString().slice(0, 10)}.csv`, header, lines, [10, 11]);
    this.notify.info(`Exported ${rows.length} row(s).`);
  }
}
