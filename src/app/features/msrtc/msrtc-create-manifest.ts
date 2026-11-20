import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { MasterDataService } from '@features/masters/master-data.service';
import { ShipmentService } from '@features/shipment/shipment.service';
import { ManifestService } from '@features/manifest/manifest.service';
import { Shipment } from '@core/models/shipment.model';

/**
 * MSRTC Create Manifest — branch to branch only. The shipments were booked straight to a
 * delivery branch (see ShipmentCreate's MSRTC mode), so this screen just groups the ones
 * waiting at the caller's branch by that delivery branch and turns the chosen ones into a
 * manifest flagged `flowType: MSRTC`. Finalize Manifest (vehicle + driver, dispatch) is the
 * next menu item. Separate from Loading Sheet on purpose: no city, hub or crossing modes.
 */
@Component({
  selector: 'app-msrtc-create-manifest',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiButton, UiSelect],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Create Manifest</h1>
        <p class="text-caption">MSRTC — pick the delivery branch, select the booked shipments, then create the manifest.</p></div>
        <app-button variant="stroked" icon="refresh" (pressed)="reload()">Refresh</app-button>
      </header>

      <app-card title="New MSRTC Manifest" [subtitle]="'From ' + fromBranchLabel()">
        <div class="df">
          @if (!ownBranchId) {
            <app-select [control]="fromBranchControl" label="From Branch" [options]="fromBranchOptions()" placeholder="Select the branch you are sending from" />
            @if (!loadingBranches() && !fromBranchOptions().length) {
              <p class="empty">No MSRTC shipment is waiting at any branch.</p>
            }
          }
          @if (fromBranchId()) {
            <app-select [control]="toBranchControl" label="To Branch" [options]="toBranchOptions()" placeholder="Select the delivery branch" />
            @if (!loadingBranches() && !toBranchOptions().length) {
              <p class="empty">No MSRTC shipment is waiting at this branch.</p>
            }
          }
          @if (toBranchControl.value) {
            @if (shipments().length) {
              <div>
                <span class="text-caption">Booked MSRTC shipments for this branch — select the ones to manifest</span>
                <div class="tbl__wrap">
                  <table class="tbl">
                    <thead>
                      <tr>
                        <th><input type="checkbox" [checked]="allSelected()" (change)="toggleAll()" aria-label="Select all" /></th>
                        <th>#</th><th>Shipment No.</th><th>Sender → Receiver</th><th>To City</th><th class="tbl--right">Weight</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (s of shipments(); track s.id; let i = $index) {
                        <tr (click)="toggle(s.id)">
                          <td><input type="checkbox" [checked]="isSelected(s.id)" (click)="$event.stopPropagation()" (change)="toggle(s.id)" /></td>
                          <td>{{ i + 1 }}</td>
                          <td>{{ s.shipmentNumber }}</td>
                          <td>{{ s.senderName }} → {{ s.receiverName }}</td>
                          <td>{{ s.toCity || '—' }}</td>
                          <td class="tbl--right">{{ s.chargeableWeight }} kg</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            } @else if (!loadingShipments()) {
              <p class="empty">No booked MSRTC shipment for this branch yet.</p>
            }
          }
          <div class="df__bar">
            <span class="text-caption">{{ selected().size }} selected</span>
            <app-button icon="add_box" [loading]="creating()" [disabled]="!selected().size" (pressed)="create()">Create Manifest</app-button>
          </div>
        </div>
      </app-card>
    </div>
  `,
  styles: [`
    .page__head { display:flex; justify-content:space-between; align-items:flex-start; }
    .df { display:flex; flex-direction:column; gap:16px; }
    .df__bar { display:flex; justify-content:flex-end; align-items:center; gap:14px; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:20px; }
    .tbl__wrap { margin-top:8px; overflow-x:auto; border:1px solid var(--surface-border); border-radius:var(--r-field); max-height:360px; overflow-y:auto; }
    .tbl { width:100%; border-collapse:collapse; font:400 16px var(--font-sans); }
    .tbl th { text-align:left; padding:10px 14px; background:var(--surface-muted); color:var(--content-muted); font:600 14px var(--font-sans); text-transform:uppercase; letter-spacing:.03em; white-space:nowrap; position:sticky; top:0; }
    .tbl td { padding:10px 14px; border-top:1px solid var(--surface-border); white-space:nowrap; }
    .tbl tbody tr { cursor:pointer; }
    .tbl tbody tr:hover { background:var(--surface-muted); }
    .tbl--right { text-align:right; }
  `]
})
export class MsrtcCreateManifest implements OnInit {
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly masterData = inject(MasterDataService);
  private readonly shipmentService = inject(ShipmentService);
  private readonly manifestService = inject(ManifestService);

  protected readonly ownBranchId = this.auth.user()?.branchId ?? null;
  protected readonly fromBranchControl = new FormControl<string | null>(null);
  protected readonly toBranchControl = new FormControl<string | null>(null);

  private readonly fromBranchValue = signal<string | null>(this.ownBranchId);
  protected readonly fromBranchId = this.fromBranchValue.asReadonly();
  protected readonly branchNames = signal<Map<string, string>>(new Map());
  protected readonly fromBranchLabel = computed(() => {
    const id = this.fromBranchValue();
    return id ? (this.branchNames().get(id) ?? 'your branch') : 'a branch';
  });

  /** Every waiting MSRTC shipment — at the caller's own branch, or (branch-less admin) at
   *  any branch. Grouped below by from-branch (admin only) and then delivery branch. */
  private readonly waiting = signal<Shipment[]>([]);
  /** Only branches that actually have a waiting MSRTC shipment — admin's From Branch picker. */
  protected readonly fromBranchOptions = computed<SelectOption[]>(() => {
    const names = this.branchNames();
    const ids = new Set(this.waiting().map((s) => s.currentLocationId ?? s.bookingBranchId));
    return [...ids].map((id) => ({ value: id, label: names.get(id) ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });
  private readonly atFrom = computed(() => {
    const from = this.fromBranchValue();
    return this.waiting().filter((s) => (s.currentLocationId ?? s.bookingBranchId) === from);
  });
  protected readonly loadingBranches = signal(false);
  protected readonly loadingShipments = signal(false);
  protected readonly creating = signal(false);
  protected readonly selected = signal<Set<string>>(new Set());

  protected readonly toBranchOptions = computed<SelectOption[]>(() => {
    const names = this.branchNames();
    const ids = new Set(this.atFrom().map((s) => s.deliveryBranchId).filter((id): id is string => !!id));
    return [...ids].map((id) => ({ value: id, label: names.get(id) ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });
  private readonly toBranchValue = signal<string | null>(null);
  protected readonly shipments = computed(() =>
    this.atFrom().filter((s) => s.deliveryBranchId === this.toBranchValue()));
  protected readonly allSelected = computed(() =>
    this.shipments().length > 0 && this.shipments().every((s) => this.selected().has(s.id)));

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'MSRTC' }, { label: 'Create Manifest' }]);
    this.masterData.branchDirectory().subscribe((list) =>
      this.branchNames.set(new Map(list.map((b) => [b.id, b.branchName] as [string, string]))));
    this.fromBranchControl.valueChanges.subscribe((id) => {
      this.fromBranchValue.set(id);
      this.toBranchControl.setValue(null);
      this.selected.set(new Set());
    });
    this.toBranchControl.valueChanges.subscribe((id) => {
      this.toBranchValue.set(id);
      this.selected.set(new Set());
    });
    this.reload();
  }

  protected reload(): void {
    this.selected.set(new Set());
    this.loadingBranches.set(true);
    this.loadingShipments.set(true);
    // A branch user only ever sees their own branch's shipments; a branch-less admin loads
    // every waiting MSRTC shipment and picks the from-branch among those that have any.
    this.shipmentService.list({
      page: 0, size: 200, flowType: 'MSRTC',
      ...(this.ownBranchId ? { currentLocationId: this.ownBranchId } : {}),
      status: ['BOOKED', 'READY_FOR_MANIFEST'] as unknown as string
    }).subscribe({
      next: (p) => {
        this.waiting.set(p.content);
        this.loadingBranches.set(false);
        this.loadingShipments.set(false);
      },
      error: () => { this.waiting.set([]); this.loadingBranches.set(false); this.loadingShipments.set(false); }
    });
  }

  protected isSelected(id: string): boolean { return this.selected().has(id); }

  protected toggle(id: string): void {
    const next = new Set(this.selected());
    if (!next.delete(id)) next.add(id);
    this.selected.set(next);
  }

  protected toggleAll(): void {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.shipments().map((s) => s.id)));
  }

  protected create(): void {
    const from = this.fromBranchValue();
    const to = this.toBranchControl.value;
    if (!from || !to || !this.selected().size) return;
    this.creating.set(true);
    this.manifestService.create({
      bookingBranchId: from,
      deliveryBranchId: to,
      deliveryMode: 'BRANCH_DELIVERY',
      shipmentIds: [...this.selected()],
      flowType: 'MSRTC'
    }).subscribe({
      next: (m) => {
        this.creating.set(false);
        this.notify.success(`Manifest ${m.manifestNumber} created — finalize it next.`);
        this.router.navigate(['/msrtc/finalize-manifest'], { queryParams: { manifestNumber: m.manifestNumber } });
      },
      error: (e: HttpErrorResponse) => {
        this.creating.set(false);
        this.notify.error(e.error?.message ?? 'Could not create the manifest.');
      }
    });
  }
}
