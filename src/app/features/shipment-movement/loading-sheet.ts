import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiAutocomplete } from '@shared/components/ui-autocomplete/ui-autocomplete';
import { MasterDataService } from '@features/masters/master-data.service';
import { MASTER_DEFINITIONS } from '@features/masters/master.config';
import { ShipmentService } from '@features/shipment/shipment.service';
import { Manifest, Shipment } from '@core/models/shipment.model';
import { ManifestService } from '@features/manifest/manifest.service';
import { ManifestCard } from './components/manifest-card';
import { catchError, of } from 'rxjs';
import { CompanyProfileService } from '@features/company/company-profile.service';
import { printLetterhead, shortDate } from '@shared/utils/letterhead-print.util';
import { WarehouseIllustration } from '@shared/components/illustrations/warehouse-illustration';

/**
 * Loading Sheet — creating a manifest already is "loading sheet created" (V20, on direct
 * request: "manifest created as outscan created" — one milestone, not two, so there is
 * no separate scan action here any more). The brief's own page asked for "Search
 * Manifest / Display Shipments / Scan Tracking Number / Bulk Scan / Show Scan Count",
 * written when it assumed a manifest module already existed and scanning was its own
 * step; since neither was true (see MEMORY/modules/shipment-movement.md), this page
 * carries the "Create Manifest" form that makes one, then lists every open (not yet
 * dispatched) manifest as its own card — heading is the manifest number, its lane,
 * total weight and total parcel count, with the LR table underneath. See ManifestCard.
 */
@Component({
  selector: 'app-loading-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiLoader, UiButton, UiSelect, UiAutocomplete, ManifestCard, WarehouseIllustration],
  template: `
    <div class="page">
      <header class="page__head" data-tour="loading-sheet-head">
        <div class="page__head-row">
          <app-warehouse-illustration class="page__head-ill" [size]="52" />
          <div><h1 class="text-h1">Loading Sheet</h1>
          <p class="text-caption">Manifests ready to dispatch — creating one already counts as loading sheet created.</p></div>
        </div>
        <app-button variant="stroked" icon="refresh" (pressed)="loadOpenManifests()">Refresh</app-button>
      </header>

      <app-card title="Create Loading Sheet" subtitle="Send to a hub or to a branch, select the booked shipments, then create the sheet.">
        <div class="mode-toggle">
          <app-button [variant]="mode() === 'hub' ? 'primary' : 'stroked'" (pressed)="setMode('hub')">Send to Hub</app-button>
          <app-button [variant]="mode() === 'branch' ? 'primary' : 'stroked'" (pressed)="setMode('branch')">Send to Branch</app-button>
          @if (atHub()) {
            <app-button [variant]="mode() === 'lane' ? 'primary' : 'stroked'" (pressed)="setMode('lane')">By Delivery Branch (crossing hub)</app-button>
          }
        </div>
        <form [formGroup]="createForm" (ngSubmit)="createManifest()" class="df">
          @if (mode() === 'hub') {
            <app-autocomplete [control]="c('deliveryBranchId')" label="Hub" [options]="hubOptions()" placeholder="Search hub…" />
            @if (!hubOptions().length) { <p class="empty">No hub branch exists yet.</p> }
            @else if (!assignedHubId()) { <p class="text-caption">No hub is assigned to your branch — pick one here, or assign one under Masters › Assign Hub to Branch.</p> }
            @else if (!assignedHubUsable()) { <p class="text-caption">Your branch's assigned hub is inactive — pick another hub here, or reassign under Masters › Assign Hub to Branch.</p> }
            <p class="text-caption">Pick a hub, then select the shipments to send. They go to the hub first; the hub scans in the THC, then creates a Load Sheet or DRS from there.</p>
          } @else if (mode() === 'branch') {
            <app-autocomplete [control]="c('deliveryBranchId')" label="Branch" [options]="assignableBranchOptions()" placeholder="Search branch…" />
            <p class="text-caption">Pick a branch, then select the shipments currently at your branch to send to it.</p>
          } @else {
            <app-autocomplete [control]="c('deliveryBranchId')" label="Delivery Branch" [options]="branchOptions()" placeholder="Search branch…" />
            @if (!loadingBranches() && !branchOptions().length) {
              <p class="empty">No branch has a BOOKED shipment from your branch right now.</p>
            }
          }
          @if (c('deliveryBranchId').value) {
            @if (bookedShipments().length) {
              <div>
                <span class="text-caption">Booked shipments on this lane — select the ones to manifest</span>
                <div class="tbl__wrap">
                  <table class="tbl">
                    <thead>
                      <tr><th></th><th>#</th><th>Shipment No.</th><th>Sender → Receiver</th><th>From City → To City</th><th class="tbl--right">Weight</th></tr>
                    </thead>
                    <tbody>
                      @for (s of bookedShipments(); track s.id; let i = $index) {
                        <tr (click)="toggleShipment(s.id)">
                          <td><input type="checkbox" [checked]="isSelected(s.id)" (click)="$event.stopPropagation()" (change)="toggleShipment(s.id)" /></td>
                          <td>{{ i + 1 }}</td>
                          <td>{{ s.shipmentNumber }}</td>
                          <td>{{ s.senderName }} → {{ s.receiverName }}</td>
                          <td>{{ s.fromCity || '—' }} → {{ s.toCity || '—' }}</td>
                          <td class="tbl--right">{{ s.chargeableWeight }} kg</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            } @else {
              <p class="empty">{{ mode() === 'lane' ? 'No BOOKED shipments on this lane yet.' : 'No shipment at your branch is waiting to be sent.' }}</p>
            }
          }
          <div class="df__bar">
            <app-button type="submit" icon="add_box" [loading]="creating()" [disabled]="!myBranchId">Create Loading Sheet</app-button>
          </div>
        </form>
      </app-card>

      <div class="ml-head">
        <h2 class="text-h2 section-title">Open Loading Sheet</h2>
        <div class="ml-filters">
          <app-autocomplete [control]="filterBranchControl" [options]="allBranchOptions()" placeholder="All lanes" />
          <app-select [control]="sortControl" [options]="sortOptions" />
        </div>
      </div>

      @if (loadingManifests()) {
        <app-loader [minHeight]="120" caption="Loading…" />
      } @else if (!openManifests().length) {
        <app-card><p class="empty">No open manifests — create one above.</p></app-card>
      } @else {
        @for (m of openManifests(); track m.id) {
          <app-manifest-card [manifest]="m" [branchNames]="branchNames()"
            [showDispatchAction]="true" [showRemoveAction]="true" [showPrintAction]="true"
            (dispatch)="goToDispatch($event)" (removed)="onShipmentRemoved()" (print)="printLoadingSheet($event)" />
        }
      }
    </div>
  `,
  styles: [`
    .page__head { display:flex; justify-content:space-between; align-items:flex-start; }
    .ml-head { display:flex; justify-content:space-between; align-items:flex-end; flex-wrap:wrap; gap:12px; }
    .ml-filters { display:flex; gap:10px; min-width:220px; }
    .ml-filters app-select, .ml-filters app-autocomplete { min-width:170px; }
    .mode-toggle { display:flex; gap:8px; margin-bottom:12px; }
    .df { display:flex; flex-direction:column; gap:16px; }
    .df__bar { display:flex; justify-content:flex-end; gap:10px; }
    .section-title { margin:8px 0 0; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:20px; }
    .tbl__wrap { margin-top:8px; overflow-x:auto; border:1px solid var(--surface-border); border-radius:var(--r-field); max-height:320px; overflow-y:auto; }
    .tbl { width:100%; border-collapse:collapse; font:400 16px var(--font-sans); }
    .tbl th { text-align:left; padding:10px 14px; background:var(--surface-muted); color:var(--content-muted); font:600 14px var(--font-sans); text-transform:uppercase; letter-spacing:.03em; white-space:nowrap; position:sticky; top:0; }
    .tbl td { padding:10px 14px; border-top:1px solid var(--surface-border); white-space:nowrap; }
    .tbl tbody tr { cursor:pointer; }
    .tbl tbody tr:hover { background:var(--surface-muted); }
    .tbl--right { text-align:right; }
  `]
})
export class LoadingSheet implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly masterData = inject(MasterDataService);
  private readonly shipmentService = inject(ShipmentService);
  private readonly manifestService = inject(ManifestService);
  private readonly companyProfile = inject(CompanyProfileService);

  protected readonly myBranchId = this.auth.user()?.branchId ?? null;

  readonly creating = signal(false);
  readonly bookedShipments = signal<Shipment[]>([]);
  readonly branchOptions = signal<SelectOption[]>([]);
  readonly loadingBranches = signal(true);
  readonly branchNames = signal<Map<string, string>>(new Map());
  readonly openManifests = signal<Manifest[]>([]);
  readonly loadingManifests = signal(true);
  /** Ids of payment modes that are `collectAtDelivery` but NOT `cashOnDelivery` — same
   *  "To Pay Freight" definition THC's own print uses; see TripHireChallan.topayModeIds. */
  readonly topayModeIds = signal<Set<string>>(new Set());

  /** 'hub' (default) = pick a hub, then the shipments; 'branch' = pick a branch, then the shipments; 'lane' = the old branch-first flow, still needed for a crossing hub's own
   *  shipments (already carrying a real next-stop branch) or any legacy shipment. */
  readonly mode = signal<'hub' | 'branch' | 'lane'>('hub');
  readonly assignedHubId = signal<string | null>(null);
  readonly hubIds = signal<Set<string>>(new Set());
  protected readonly hubOptions = computed<SelectOption[]>(() =>
    this.allBranchOptions().filter((o) => this.hubIds().has(o.value) && o.value !== this.myBranchId));

  protected readonly allBranchOptions = computed<SelectOption[]>(() =>
    [...this.branchNames().entries()]
      .map(([id, label]) => ({ value: id, label }))
      .sort((a, b) => a.label.localeCompare(b.label)));

  /** Every branch but this one — Load Sheet's "assign a delivery branch" picker, once a
   *  destination city is chosen. Unlike `branchOptions`, not derived from any shipment's
   *  own data: nothing has decided a branch for these shipments yet, so any branch is a
   *  valid destination. */
  protected readonly assignableBranchOptions = computed<SelectOption[]>(() =>
    this.allBranchOptions().filter((o) => o.value !== this.myBranchId));

  readonly sortOptions: SelectOption[] = [
    { value: 'createdAt,desc', label: 'Newest First' },
    { value: 'createdAt,asc', label: 'Oldest First' },
    { value: 'manifestNumber,asc', label: 'Manifest No. (A–Z)' },
    { value: 'manifestNumber,desc', label: 'Manifest No. (Z–A)' }
  ];
  readonly filterBranchControl = new FormControl<string | null>(null);
  readonly sortControl = new FormControl<string>('createdAt,desc');

  readonly createForm: FormGroup = this.fb.group({
    deliveryBranchId: [null as string | null],
    shipmentIds: [[] as string[], Validators.required]
  });

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Operations' }, { label: 'Loading Sheet' }]);
    // Listeners first: the branch directory is cached, so its callback can fire synchronously and
    // preselect the assigned hub — a listener registered after that would miss the change and the
    // shipment list would never load.
    this.createForm.get('deliveryBranchId')!.valueChanges.subscribe((id) => {
      if (this.mode() === 'lane') this.loadBooked(id);
      else this.loadBookedForHub(id);
    });
    this.masterData.branchDirectory().subscribe((list) => {
      this.hubIds.set(new Set(list.filter((b) => b.branchType === 'HUB').map((b) => b.id)));
      this.assignedHubId.set(list.find((b) => b.id === this.myBranchId)?.assignedHubId ?? null);
      this.branchNames.set(new Map(list.map((b) =>
        [b.id, `${b.branchName} (${b.branchCode})${b.city ? ' — ' + b.city : ''}`])));
      this.applyAssignedHub();
      this.loadEligibleDeliveryBranches();
    });
    this.filterBranchControl.valueChanges.subscribe(() => this.loadOpenManifests());
    this.sortControl.valueChanges.subscribe(() => this.loadOpenManifests());
    this.masterData.list(MASTER_DEFINITIONS['payment-modes'], { page: 0, size: 100, status: 'ACTIVE' }).subscribe((p) =>
      this.topayModeIds.set(new Set(p.content
        .filter((r) => r['collectAtDelivery'] === true && r['cashOnDelivery'] !== true)
        .map((r) => r.id))));
    this.loadOpenManifests();
  }

  goToDispatch(m: Manifest): void {
    this.router.navigate(['/movement/trip-hire-challan'], { queryParams: { manifestNumber: m.manifestNumber } });
  }

  onShipmentRemoved(): void {
    this.loadOpenManifests();
    this.loadEligibleDeliveryBranches();
  }

  protected setMode(mode: 'hub' | 'branch' | 'lane'): void {
    this.mode.set(mode);
    this.createForm.reset({ deliveryBranchId: null, shipmentIds: [] });
    this.bookedShipments.set([]);
    this.applyAssignedHub();
  }

  /** Every branch can send to a hub or to a branch; only a hub also gets the crossing-lane mode. */
  protected atHub(): boolean { return !!this.myBranchId && this.hubIds().has(this.myBranchId); }

  protected assignedHubUsable(): boolean {
    const hubId = this.assignedHubId();
    return !!hubId && this.hubOptions().some((o) => o.value === hubId);
  }

  /** Hub mode is the default: preselects this branch's assigned hub (if it has one and it is
   *  still a pickable hub). */
  private applyAssignedHub(): void {
    const hubId = this.assignedHubId();
    if (this.mode() === 'hub' && hubId && !this.c('deliveryBranchId').value
        && this.hubOptions().some((o) => o.value === hubId)) {
      this.createForm.get('deliveryBranchId')!.setValue(hubId);
    }
  }

  protected c(name: string): FormControl { return this.createForm.get(name) as FormControl; }

  protected isSelected(shipmentId: string): boolean {
    return (this.c('shipmentIds').value as string[]).includes(shipmentId);
  }

  protected toggleShipment(shipmentId: string): void {
    const control = this.c('shipmentIds');
    const current = control.value as string[];
    control.setValue(
      current.includes(shipmentId) ? current.filter((id) => id !== shipmentId) : [...current, shipmentId]);
  }

  /**
   * Delivery Branch lists branches this branch actually has a shipment ready to hand off
   * to right now — never the signed-in user's own (current) branch, and never a branch
   * whose eligible shipments have already all been manifested. Matched on `currentLocationId`
   * (where a shipment physically is, not necessarily where it was booked — a shipment past
   * its first crossing hop sits at a hub, not its booking branch) and `status` BOOKED or
   * READY_FOR_MANIFEST (the crossing-hub equivalent of BOOKED, see
   * `ShipmentStatus.READY_FOR_MANIFEST`). Options are the shipments' own `nextLocationId`
   * (their immediate next stop — a further crossing hub, or the real delivery branch once
   * every hop is done), falling back to `deliveryBranchId` for a pre-crossing shipment with
   * no `nextLocationId` written. Derived from the shipments themselves, not the full branch
   * directory — a branch with nothing eligible simply doesn't appear.
   */
  private loadEligibleDeliveryBranches(): void {
    if (!this.myBranchId) { this.loadingBranches.set(false); return; }
    this.loadingBranches.set(true);
    this.shipmentService.list({
      page: 0, size: 200, currentLocationId: this.myBranchId,
      status: ['BOOKED', 'READY_FOR_MANIFEST'] as unknown as string, flowType: 'STANDARD'
    }).subscribe({
      next: (p) => {
        const names = this.branchNames();
        const eligible = new Set(
          p.content.map((s) => s.nextLocationId ?? s.deliveryBranchId)
            .filter((id): id is string => !!id && id !== this.myBranchId));
        const options = [...eligible]
          .map((id) => ({ value: id, label: names.get(id) ?? id }))
          .sort((a, b) => a.label.localeCompare(b.label));
        this.branchOptions.set(options);
        this.loadingBranches.set(false);
      },
      error: () => { this.branchOptions.set([]); this.loadingBranches.set(false); }
    });
  }

  loadOpenManifests(): void {
    this.loadingManifests.set(true);
    this.manifestService.list({
      page: 0, size: 50, status: 'CREATED', sort: this.sortControl.value || 'createdAt,desc',
      deliveryBranchId: this.filterBranchControl.value ?? undefined,
      flowType: 'STANDARD'
    }).subscribe({
      next: (p) => { this.openManifests.set(p.content); this.loadingManifests.set(false); },
      error: () => { this.openManifests.set([]); this.loadingManifests.set(false); }
    });
  }

  /** Hub mode's shipment picker — every shipment at this branch that no one has routed yet
   *  (no next stop, no delivery branch), whatever its destination: the hub sorts them onward. */
  private loadBookedForHub(hubId: string | null): void {
    this.bookedShipments.set([]);
    this.createForm.get('shipmentIds')!.setValue([]);
    if (!hubId || !this.myBranchId) return;
    this.shipmentService.list({
      page: 0, size: 100, currentLocationId: this.myBranchId, unassignedDeliveryBranch: true,
      status: ['BOOKED', 'READY_FOR_MANIFEST'] as unknown as string, flowType: 'STANDARD'
    }).subscribe({
      next: (p) => this.bookedShipments.set(p.content),
      error: () => this.bookedShipments.set([])
    });
  }

  private loadBooked(deliveryBranchId: string | null): void {
    this.bookedShipments.set([]);
    this.createForm.get('shipmentIds')!.setValue([]);
    if (!deliveryBranchId || !this.myBranchId) return;
    // Same current/next-location matching as loadEligibleDeliveryBranches — the shipment
    // picker for a chosen destination must use the identical criteria that produced it as
    // an option, or a crossing shipment picked as "eligible" here would vanish from the list.
    this.shipmentService.list({
      page: 0, size: 100, currentLocationId: this.myBranchId, nextLocationId: deliveryBranchId,
      status: ['BOOKED', 'READY_FOR_MANIFEST'] as unknown as string, flowType: 'STANDARD'
    }).subscribe({
      next: (p) => this.bookedShipments.set(p.content),
      error: () => this.bookedShipments.set([])
    });
  }

  createManifest(): void {
    if (this.createForm.invalid || !this.myBranchId) { this.createForm.markAllAsTouched(); return; }
    const v = this.createForm.getRawValue();
    const mode = this.mode();
    if (!v.deliveryBranchId) {
      this.notify.error(mode === 'hub' ? 'Pick a hub first.' : 'Pick a delivery branch first.');
      return;
    }
    this.creating.set(true);
    this.manifestService.create({
      bookingBranchId: this.myBranchId,
      deliveryBranchId: v.deliveryBranchId,
      deliveryMode: 'BRANCH_DELIVERY',
      destinationCity: null,
      shipmentIds: v.shipmentIds,
      hubTransfer: mode === 'hub'
    }).subscribe({
      next: (m) => {
        this.creating.set(false);
        this.notify.success(`Manifest ${m.manifestNumber} created.`);
        this.setMode(mode);
        this.loadOpenManifests();
        this.loadEligibleDeliveryBranches();
      },
      error: (e: HttpErrorResponse) => { this.creating.set(false); this.notify.error(e.error?.message ?? 'Could not create the manifest.'); }
    });
  }


  protected printLoadingSheet(m: Manifest): void {
    this.manifestService.shipments(m.id).subscribe({
      next: (shipments) => this.openLoadingSheetTab(m, shipments),
      error: () => this.openLoadingSheetTab(m, [])
    });
  }

  /** The house print header (shared `printLetterhead`): boxed letterhead with QR, details grid, then the shipments. */
  private openLoadingSheetTab(m: Manifest, shipments: Shipment[]): void {
    const topayIds = this.topayModeIds();
    const topay = (s: Shipment) => topayIds.has(s.paymentModeId) ? (s.netAmount ?? 0) : null;
    const created = m.createdAt ? new Date(m.createdAt) : null;
    const to = m.deliveryMode === 'DIRECT_COMPANY_DELIVERY' ? 'Direct Company Delivery'
      : (m.deliveryBranchId ? this.branchNames().get(m.deliveryBranchId) : null) ?? '—';
    const weight = shipments.reduce((a, s) => a + (s.chargeableWeight ?? 0), 0);
    const freight = shipments.reduce((a, s) => a + (topay(s) ?? 0), 0);
    this.companyProfile.get().pipe(catchError(() => of(null))).subscribe((company) => {
      const ok = printLetterhead({
        title: 'LOADING SHEET', company, logo: this.auth.companyLogo(), qr: m.manifestNumber,
        details: [
          [{ label: 'Manifest No', value: m.manifestNumber, big: true }, { label: 'Date', value: created ? `${shortDate(m.createdAt)} ${created.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : '—' }],
          [{ label: 'From Branch', value: this.branchNames().get(m.bookingBranchId) ?? '—', big: true }, { label: 'To Branch', value: to }],
          [{ label: 'Shipments', value: String(shipments.length), big: true }, { label: 'Weight (kg)', value: String(weight) }]],
        columns: [{ label: 'Sr No', width: '44px' }, { label: 'Shipment No', nowrap: true }, { label: 'Consignor' }, { label: 'Consignee' },
          { label: 'From City' }, { label: 'To City' }, { label: 'Booking Date', nowrap: true }, { label: 'Weight', right: true }, { label: 'To Pay Freight', right: true }],
        rows: shipments.map((s, i) => [String(i + 1), s.shipmentNumber, s.senderName ?? '', s.receiverName ?? '', s.fromCity ?? '—', s.toCity ?? '—',
          s.bookingDate ? new Date(s.bookingDate).toLocaleDateString('en-GB') : '—', String(s.chargeableWeight ?? ''), topay(s) != null ? String(topay(s)) : '']),
        totals: ['', 'Total', '', '', '', '', '', String(weight), String(freight)],
        signatures: ['Loaded by', 'Checked by'], tableFontPx: 13
      });
      if (!ok) this.notify.error('Pop-up blocked — allow pop-ups to print the loading sheet.');
    });
  }
}
