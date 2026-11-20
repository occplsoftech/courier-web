import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { ShipmentStatusBadge } from '@features/shipment/components/shipment-status-badge';
import { Shipment } from '@core/models/shipment.model';
import { ShipmentService } from '@features/shipment/shipment.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { ShipmentMovementService } from './shipment-movement.service';

/** Pending Delivery — this branch's own IN_SCAN / OUT_FOR_DELIVERY shipments, one row per
 *  order. Out For Delivery assigns in place (one click, needs the delivery-user picker
 *  above); Deliver navigates to the Delivery page instead of submitting inline — closing
 *  a delivery wants POD (signature/photo), OTP and remarks, not a bare API call. */
@Component({
  selector: 'app-pending-delivery',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiLoader, UiButton, UiSelect, ShipmentStatusBadge],
  template: `
    <div class="page">
      <header class="page__head" data-tour="pending-delivery-head">
        <div><h1 class="text-h1">Pending Delivery</h1>
          <p class="text-caption">Shipments received at {{ myBranchLabel() }}, waiting to go out or be delivered.</p></div>
        @if (myBranchId) {
          <app-button variant="stroked" icon="refresh" (pressed)="load()">Refresh</app-button>
        }
      </header>

      @if (!myBranchId) {
        <app-card><p class="empty">No branch assigned — ask an admin.</p></app-card>
      } @else {
        <app-card>
          <app-select [control]="deliveryUserControl" label="Delivery User (for DRS)" [options]="userOptions()" placeholder="Select delivery user" />
        </app-card>

        @if (loading()) {
          <app-loader [minHeight]="120" caption="Loading…" />
        } @else if (!pendingDelivery().length) {
          <app-card><p class="empty">Nothing pending delivery at your branch.</p></app-card>
        } @else {
          <app-card>
            <div class="tbl__wrap">
              <table class="tbl">
                <thead>
                  <tr><th>#</th><th>Shipment No.</th><th>Receiver</th><th>From Branch → To Branch</th><th>From City → To City</th><th>Status</th><th class="tbl--right">Actions</th></tr>
                </thead>
                <tbody>
                  @for (s of pendingDelivery(); track s.id; let i = $index) {
                    <tr>
                      <td>{{ i + 1 }}</td>
                      <td>{{ s.shipmentNumber }}</td>
                      <td>{{ s.receiverName }}</td>
                      <td>{{ branchNames().get(s.bookingBranchId) || '—' }} → {{ branchNames().get(s.deliveryBranchId ?? '') || '—' }}</td>
                      <td>{{ s.fromCity || '—' }} → {{ s.toCity || '—' }}</td>
                      <td><app-shipment-status-badge [status]="s.status" /></td>
                      <td class="tbl--right">
                        <div class="rowbtns">
                          <app-button variant="stroked" icon="directions_run"
                            [disabled]="s.status !== 'IN_SCAN' || !deliveryUserControl.value"
                            [loading]="assigningId() === s.id" (pressed)="outForDeliveryOne(s)">DRS</app-button>
                          <app-button icon="task_alt"
                            [disabled]="s.status !== 'OUT_FOR_DELIVERY'"
                            (pressed)="goToDeliver(s)">Deliver</app-button>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </app-card>
        }
      }
    </div>
  `,
  styles: [`
    .page__head { display:flex; justify-content:space-between; align-items:flex-start; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:20px; }
    .tbl__wrap { overflow-x:auto; border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .tbl { width:100%; border-collapse:collapse; font:400 16px var(--font-sans); }
    .tbl th { text-align:left; padding:10px 14px; background:var(--surface-muted); color:var(--content-muted); font:600 14px var(--font-sans); text-transform:uppercase; letter-spacing:.03em; white-space:nowrap; }
    .tbl td { padding:10px 14px; border-top:1px solid var(--surface-border); white-space:nowrap; }
    .tbl--right { text-align:right; }
    .rowbtns { display:flex; justify-content:flex-end; gap:8px; }
  `]
})
export class PendingDelivery implements OnInit {
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly shipmentService = inject(ShipmentService);
  private readonly masterData = inject(MasterDataService);
  private readonly movementService = inject(ShipmentMovementService);

  protected readonly myBranchId = this.auth.user()?.branchId ?? null;
  protected readonly myBranchLabel = () => 'your branch';

  readonly loading = signal(true);
  readonly pendingDelivery = signal<Shipment[]>([]);
  readonly userOptions = signal<SelectOption[]>([]);
  readonly assigningId = signal<string | null>(null);
  readonly deliveryUserControl = new FormControl<string | null>(null);
  /** Branch id -> "Name (CODE)" for the worklist's From Branch / To Branch column — same
   *  `branchDirectory()` lookup Loading Sheet/THC already use for the same reason. */
  readonly branchNames = signal<Map<string, string>>(new Map());

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Operations' }, { label: 'Pending Delivery' }]);
    if (!this.myBranchId) return;
    this.movementService.userOptions().subscribe((u) =>
      this.userOptions.set(u.map((x) => ({ value: x.id, label: x.label }))));
    this.masterData.branchDirectory().subscribe((list) =>
      this.branchNames.set(new Map(list.map((b) => [b.id, `${b.branchName} (${b.branchCode})`]))));
    this.load();
  }

  load(): void {
    if (!this.myBranchId) return;
    this.loading.set(true);
    forkJoin([
      this.shipmentService.list({ page: 0, size: 100, deliveryBranchId: this.myBranchId, status: 'IN_SCAN' }),
      this.shipmentService.list({ page: 0, size: 100, deliveryBranchId: this.myBranchId, status: 'OUT_FOR_DELIVERY' })
    ]).subscribe({
      next: ([inScan, outForDelivery]) => {
        this.pendingDelivery.set([...inScan.content, ...outForDelivery.content]);
        this.loading.set(false);
      },
      error: () => { this.pendingDelivery.set([]); this.loading.set(false); }
    });
  }

  outForDeliveryOne(s: Shipment): void {
    const deliveryUserId = this.deliveryUserControl.value;
    if (!deliveryUserId || this.assigningId()) return;
    this.assigningId.set(s.id);
    this.movementService.outForDelivery({ shipmentIds: [s.id], deliveryUserId }).subscribe({
      next: (r) => {
        this.assigningId.set(null);
        const failed = r.results.find((o) => !o.success);
        if (failed) this.notify.error(failed.message ?? 'Could not assign.');
        else this.notify.success(`${s.shipmentNumber} DRS.`);
        this.load();
      },
      error: (e: HttpErrorResponse) => { this.assigningId.set(null); this.notify.error(e.error?.message ?? 'Could not assign.'); }
    });
  }

  goToDeliver(s: Shipment): void {
    this.router.navigate(['/movement/delivery'], { queryParams: { trackingNumber: s.trackingNumber } });
  }
}
