import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { DrsDetail } from '@core/models/shipment.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { MasterDataService } from '@features/masters/master-data.service';
import { ShipmentMovementService } from '@features/shipment-movement/shipment-movement.service';
import { ShipmentStatusBadge } from '../shipment/components/shipment-status-badge';

/** DRS Report's detail page — every shipment on one DRS run (delivery user + delivery
 *  branch + calendar day), the same fields Out For Delivery's Print DRS renders. */
@Component({
  selector: 'app-drs-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, UiCard, UiLoader, UiButton, ShipmentStatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">DRS Detail</h1>
          @if (detail(); as d) {
            <p class="text-caption">
              @if (d.drsNumber) { <span class="mono">{{ d.drsNumber }}</span> · }
              {{ userLabel(d.deliveryUserId) }} ({{ userContact(d.deliveryUserId) }}) · {{ branchLabel(d.deliveryBranchId) }} · {{ d.runDate }}
            </p>
          }
        </div>
        <app-button variant="stroked" icon="arrow_back" (pressed)="back()">Back</app-button>
      </header>

      @if (loading()) {
        <app-loader [minHeight]="160" caption="Loading…" />
      } @else if (!detail() || !detail()!.shipments.length) {
        <app-card><p class="empty">No shipments on this DRS run.</p></app-card>
      } @else {
        <app-card [title]="detail()!.shipments.length + ' shipment(s)'">
          <div class="tbl__wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>#</th><th>Shipment No.</th><th>E-Way Bill No.</th><th>Receiver</th><th>Address</th><th>Contact</th><th>From</th><th>To</th><th>Payment</th>
                  <th class="tbl--right">Amount</th><th>Status</th><th>Delivered At</th>
                </tr>
              </thead>
              <tbody>
                @for (s of detail()!.shipments; track s.shipmentId; let i = $index) {
                  <tr>
                    <td>{{ i + 1 }}</td>
                    <td class="mono">{{ s.shipmentNumber }}</td>
                    <td class="mono">{{ s.ewayBillNumber || '—' }}</td>
                    <td>{{ s.receiverName }}</td>
                    <td class="tbl--address">{{ s.receiverAddress || '—' }}</td>
                    <td class="mono">{{ s.receiverContact }}</td>
                    <td>{{ s.fromCity || '—' }}</td>
                    <td>{{ s.toCity || '—' }}</td>
                    <td>{{ paymentModeLabel(s.paymentModeId) }}</td>
                    <td class="tbl--right">{{ s.netAmount != null ? ('₹' + (s.netAmount | number: '1.2-2')) : '—' }}</td>
                    <td><app-shipment-status-badge [status]="s.status" /></td>
                    <td>{{ s.deliveredAt ? (s.deliveredAt | date: 'dd MMM y, h:mm a') : '—' }}</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr><td colspan="9">Total</td><td class="tbl--right">₹{{ totalAmount() | number: '1.2-2' }}</td><td colspan="2"></td></tr>
              </tfoot>
            </table>
          </div>
        </app-card>
      }
    </div>
  `,
  styles: [`
    .page__head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:12px; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:20px; }
    .tbl__wrap { overflow-x:auto; border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .tbl { width:100%; border-collapse:collapse; font:400 16px var(--font-sans); }
    .tbl th { text-align:left; padding:10px 14px; background:var(--surface-muted); color:var(--content-muted); font:600 14px var(--font-sans); text-transform:uppercase; letter-spacing:.03em; white-space:nowrap; }
    .tbl td { padding:10px 14px; border-top:1px solid var(--surface-border); white-space:nowrap; }
    .tbl tfoot td { font-weight:600; border-top:2px solid var(--surface-border); }
    .tbl--right { text-align:right; }
    .tbl--address { white-space:normal; min-width:200px; }
    .mono { font:600 16px var(--font-mono, ui-monospace); color:var(--content-fg); }
  `]
})
export class DrsDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly masters = inject(MasterDataService);
  private readonly movementService = inject(ShipmentMovementService);

  protected readonly loading = signal(true);
  protected readonly detail = signal<DrsDetail | null>(null);
  protected readonly paymentModeOptions = signal<SelectOption[]>([]);

  private readonly branches = signal<Map<string, string>>(new Map());
  private readonly users = signal<Map<string, string>>(new Map());
  private readonly userContacts = signal<Map<string, { name: string; mobile: string }>>(new Map());

  protected readonly totalAmount = () =>
    (this.detail()?.shipments ?? []).reduce((sum, s) => sum + (s.netAmount ?? 0), 0);

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Reports' }, { label: 'DRS Report', route: '/reports/drs' }, { label: 'Detail' }]);
    this.masters.options('payment-modes').subscribe((o) => this.paymentModeOptions.set(o));
    this.masters.branchDirectory().subscribe((list) =>
      this.branches.set(new Map(list.map((b) => [b.id, `${b.branchName} (${b.branchCode})`]))));
    this.movementService.userOptions().subscribe((list) =>
      this.users.set(new Map(list.map((u) => [u.id, u.label]))));
    this.movementService.userDirectory().subscribe((m) => this.userContacts.set(m));

    const { deliveryUserId, deliveryBranchId, runDate } = this.route.snapshot.params;
    this.movementService.drsDetail(deliveryUserId, deliveryBranchId, runDate).subscribe({
      next: (d) => { this.detail.set(d); this.loading.set(false); },
      error: () => { this.loading.set(false); this.notify.error('Could not load this DRS run.'); }
    });
  }

  protected userLabel(id: string): string { return this.users().get(id) ?? id; }
  protected userContact(id: string): string { return this.userContacts().get(id)?.mobile ?? '—'; }
  protected branchLabel(id: string): string { return this.branches().get(id) ?? id; }
  protected paymentModeLabel(id: string): string { return this.paymentModeOptions().find((o) => o.value === id)?.label ?? '—'; }

  back(): void { this.router.navigate(['/reports/drs']); }
}
