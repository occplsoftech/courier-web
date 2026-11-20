import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal, effect, untracked } from '@angular/core';
import { ActingBranchService } from '@core/services/acting-branch.service';
import { ActAsBranch } from '@shared/components/act-as-branch/act-as-branch';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { CompanyProfileService, CompanyLetterhead } from '@features/company/company-profile.service';
import { companyAddressLine, renderPrintHeader, PRINT_HEADER_CSS } from '@features/shipment/consignment-print.util';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { ShipmentService } from '@features/shipment/shipment.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { MASTER_DEFINITIONS } from '@features/masters/master.config';
import { VehicleService } from '@features/manifest/vehicle.service';
import { ShipmentMovementService } from './shipment-movement.service';
import { Shipment, MovementOutcome } from '@core/models/shipment.model';
import { RouteIllustration } from '@shared/components/illustrations/route-illustration';

/** Out For Delivery — every IN_SCAN shipment at my branch is listed and selectable up
 *  front (direct request: "without delivery partner selection all pending delivery
 *  shipment should be visible"), independent of whether a Delivery User is picked yet.
 *  Check off shipments, pick the Delivery User, optionally assign a Vehicle/Fuel
 *  Cost/Delivery Charge and verify a Delivery User OTP, then Generate DRS — the same
 *  Vehicle/Fuel Cost/OTP-verification shape Trip Hire Challan's own Dispatch action
 *  uses (`trip-hire-challan.ts`), adapted to a delivery user instead of a driver+
 *  manifest (there is still no separate DRS/batch table to hang vehicle/fuel/OTP state
 *  off before Generate DRS runs — see `ShipmentService.assignOutForDelivery`'s own doc).
 *  OTP verification is optional, same "does not gate the action" stance THC's own
 *  driver OTP takes.
 *  **Print DRS**: once Generate DRS succeeds, the DRS preview tab opens automatically
 *  (`window.open` + `document.write`, no PDF service, no new endpoint) with the assigned
 *  batch as a Delivery Run Sheet — every field it needs (tracking no., receiver, contact,
 *  payment mode, amount) is already on the list-row `Shipment` this page holds before
 *  assigning. That tab carries its own Print and Download PDF buttons (both
 *  `window.print()` — "Save as PDF" in the browser's print dialog *is* the PDF export).
 *  "Print DRS" on this page just reopens the same tab. The Amount column on the DRS
 *  itself only shows a figure for a `collectAtDelivery` payment mode (TO_PAY / COD) — a
 *  PAID or TBB row is money the delivery boy isn't collecting, so it prints blank and
 *  the footer total only adds up what's actually being collected on the round. */
@Component({
  selector: 'app-out-for-delivery',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, ActAsBranch, UiCard, UiLoader, UiButton, UiInput, UiSelect, RouteIllustration],
  template: `
    <div class="page">
      <header class="page__head" data-tour="out-for-delivery-head">
        <div class="page__head-row">
          <app-route-illustration class="page__head-ill" [size]="52" />
          <div><h1 class="text-h1">DRS</h1>
          <p class="text-caption">Assign received shipments to a delivery user.</p></div>
        </div>
        <div class="head-actions">
          <app-act-as-branch />
          @if (myBranchId) {
            <app-button [variant]="!directMode() && !hubMode() ? 'primary' : 'stroked'" (pressed)="setMode('branch')">My Branch</app-button>
            <app-button [variant]="hubMode() ? 'primary' : 'stroked'" (pressed)="setMode('hub')">Hub Shipments</app-button>
            <app-button [variant]="directMode() ? 'primary' : 'stroked'" (pressed)="setMode('direct')">Direct Company Delivery</app-button>
          }
          <app-button variant="stroked" icon="refresh" (pressed)="load()">Refresh</app-button>
        </div>
      </header>

      @if (!myBranchId && !directMode()) {
        <app-card><p class="empty">No branch assigned — ask an admin.</p></app-card>
      } @else {
        <app-card title="Shipments" [subtitle]="hubMode() ? 'Shipments received at this hub, waiting to be delivered straight from here on a DRS.' : directMode() ? 'Direct Company Delivery shipments waiting to go on DRS — no delivery branch involved.' : 'IN_SCAN shipments waiting to go on DRS at your branch.'">
          @if (loading()) {
            <app-loader [minHeight]="120" caption="Loading…" />
          } @else if (!shipments().length) {
            <p class="empty">Nothing waiting — every received shipment is already on DRS.</p>
          } @else {
            <div class="tbl__wrap">
              <table class="tbl">
                <thead>
                  <tr>
                    <th><input type="checkbox" [checked]="allSelected()" (change)="toggleAll($event)" /></th>
                    <th>#</th>
                    <th>Shipment No.</th>
                    <th>Receiver</th>
                    <th>Contact</th>
                    <th>From Branch → To Branch</th>
                    <th>From City → To City</th>
                    <th class="tbl--right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  @for (s of shipments(); track s.id; let i = $index) {
                    <tr>
                      <td><input type="checkbox" [checked]="isSelected(s.id)" (change)="toggleOne(s.id)" /></td>
                      <td>{{ i + 1 }}</td>
                      <td>{{ s.shipmentNumber }}</td>
                      <td>{{ s.receiverName }}</td>
                      <td>{{ s.receiverContact }}</td>
                      <td>{{ branchNames().get(s.bookingBranchId) || '—' }} → {{ s.deliveryBranchId ? (branchNames().get(s.deliveryBranchId) || '—') : 'Direct Company Delivery' }}</td>
                      <td>{{ s.fromCity || '—' }} → {{ s.toCity || '—' }}</td>
                      <td class="tbl--right">{{ s.netAmount ?? 0 }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </app-card>

        @if (shipments().length) {
          <app-card title="Assign Delivery User & Vehicle">
            <form [formGroup]="form" (ngSubmit)="assign()" class="df">
              <div class="grid2">
                <app-select [control]="c('deliveryUserId')" label="Delivery User" [options]="userOptions()" placeholder="Select delivery user" />
                <app-select [control]="c('vehicleId')" label="Vehicle" [options]="vehicleOptions()" placeholder="Select vehicle (optional)" [allowEmpty]="true" emptyLabel="None" />
              </div>

              <div class="otp">
                @if (!otpVerified()) {
                  <app-button type="button" variant="stroked" icon="sms" [loading]="sendingOtp()"
                    [disabled]="!c('deliveryUserId').value || resendCooldown() > 0" (pressed)="requestOtp()">
                    {{ otpRequested() ? (resendCooldown() > 0 ? 'Resend OTP (' + resendCooldown() + 's)' : 'Resend OTP') : 'Send Delivery User OTP (optional)' }}
                  </app-button>
                  @if (otpRequested()) {
                    <span class="text-caption">Sent to {{ maskedMobile() }} — valid {{ otpExpiresInMinutes() }} min.</span>
                    <app-input [control]="otpControl" type="tel" label="Enter OTP" placeholder="4-digit code" [maxLength]="4" />
                    <app-button type="button" icon="check" [loading]="verifyingOtp()" (pressed)="verifyOtp()">Verify OTP</app-button>
                  }
                } @else {
                  <span class="otp__ok">✓ Delivery User OTP verified</span>
                }
              </div>

              <div class="grid2">
                <app-input [control]="c('fuelCost')" type="number" label="Fuel Cost" placeholder="0.00" />
                <app-input [control]="c('deliveryCharge')" type="number" label="Delivery Charge" placeholder="0.00" />
              </div>

              <div class="df__bar">
                <app-button type="submit" icon="directions_run" [loading]="assigning()" [disabled]="!selectedIds().size">Generate DRS</app-button>
              </div>
            </form>
          </app-card>
        }

        @if (outcomes().length) {
          <app-card [title]="'Result (' + successCount() + ' of ' + outcomes().length + ' assigned)'">
            @if (drsNumber()) { <p class="text-caption">DRS No. <span class="mono">{{ drsNumber() }}</span></p> }
            <div class="ol">
              @for (o of outcomes(); track o.reference) {
                <div class="ol__row" [class.ol__row--fail]="!o.success">
                  <span>{{ o.reference }}</span>
                  @if (o.message) { <span class="text-caption">— {{ o.message }}</span> }
                </div>
              }
            </div>
            @if (printableShipments().length) {
              <div class="df__bar">
                <app-button variant="stroked" icon="print" (pressed)="printDrs()">Print DRS</app-button>
              </div>
            }
          </app-card>
        }
      }
    </div>
  `,
  styles: [`
    .head-actions { display:flex; align-items:center; gap:8px; }
    .df { display:flex; flex-direction:column; gap:16px; }
    .df__bar { display:flex; justify-content:flex-end; gap:10px; }
    .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px 20px; }
    .otp { display:flex; flex-wrap:wrap; align-items:flex-end; gap:12px; padding:12px; background:var(--surface-muted); border-radius:var(--r-field); }
    .otp app-input { min-width:160px; }
    .otp__ok { font:600 17px var(--font-sans); color:var(--success-600, #1a7f37); }
    .ol { display:flex; flex-direction:column; gap:6px; }
    .ol__row { display:flex; align-items:center; gap:8px; font:400 16px var(--font-sans); color:var(--success-600, #16a34a); }
    .ol__row--fail { color:var(--danger-600, #dc2626); }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:20px; }
    .tbl__wrap { overflow-x:auto; border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .tbl { width:100%; border-collapse:collapse; font:400 16px var(--font-sans); }
    .tbl th { text-align:left; padding:10px 14px; background:var(--surface-muted); color:var(--content-muted); font:600 14px var(--font-sans); text-transform:uppercase; letter-spacing:.03em; white-space:nowrap; }
    .tbl td { padding:10px 14px; border-top:1px solid var(--surface-border); white-space:nowrap; }
    .tbl--right { text-align:right; }
    .mono { font:600 16px var(--font-mono, ui-monospace); color:var(--content-fg); }
    @media (max-width:760px){ .grid2 { grid-template-columns:1fr; } }
  `]
})
export class OutForDelivery implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly route = inject(ActivatedRoute);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly shipmentService = inject(ShipmentService);
  private readonly masterData = inject(MasterDataService);
  private readonly vehicleService = inject(VehicleService);
  private readonly movementService = inject(ShipmentMovementService);
  private readonly companyProfile = inject(CompanyProfileService);

  protected readonly acting = inject(ActingBranchService);
  /** Own branch, or — for a branch-less admin — the branch/hub picked in "Act as". */
  protected get myBranchId(): string | null { return this.acting.effectiveId(); }
  /** Direct Company Delivery shipments have no delivery branch at all, so they never show
   *  up under "my branch" — this switches the worklist to every such IN_SCAN shipment
   *  company-wide instead. Defaults on for a caller with no own branch (e.g. a pure
   *  COMPANY_ADMIN), since "my branch" would otherwise have nothing to show them. */
  readonly directMode = signal(!this.acting.effectiveId());
  /** Hub delivery: shipments received (in-scanned) at this hub with no delivery branch,
   *  delivered from here instead of going on another Load Sheet. */
  readonly hubMode = signal(false);
  /** Company letterhead for the DRS header — same `CompanyProfileService` the LR and THC
   *  prints use, so every printed document shares one masthead. */
  readonly companyLetterhead = signal<CompanyLetterhead | null>(null);

  readonly loading = signal(true);
  readonly assigning = signal(false);
  readonly shipments = signal<Shipment[]>([]);
  readonly userOptions = signal<SelectOption[]>([]);
  readonly vehicleOptions = signal<SelectOption[]>([]);
  readonly paymentModeOptions = signal<SelectOption[]>([]);
  /** Ids of payment modes flagged `collectAtDelivery` (TO_PAY / COD) — the only ones the
   *  DRS's Amount column shows a figure for; see the class doc for why. */
  readonly collectAtDeliveryModeIds = signal<Set<string>>(new Set());
  readonly branchLabel = signal('');
  /** Branch id -> "Name (CODE)" for the worklist's From Branch / To Branch column — same
   *  `branchDirectory()` lookup Loading Sheet/THC already use for the same reason. */
  readonly branchNames = signal<Map<string, string>>(new Map());
  readonly outcomes = signal<MovementOutcome[]>([]);
  readonly drsNumber = signal<string | null>(null);
  readonly printableShipments = signal<Shipment[]>([]);
  readonly successCount = computed(() => this.outcomes().filter((o) => o.success).length);
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly allSelected = computed(() =>
    this.shipments().length > 0 && this.selectedIds().size === this.shipments().length);

  /** Delivery User OTP — optional, same "sending/verifying works end to end but doesn't
   *  block the action" stance THC's driver OTP takes. Reset whenever the delivery user
   *  selection changes so a code issued for one is never shown as verified for another. */
  readonly sendingOtp = signal(false);
  readonly verifyingOtp = signal(false);
  readonly otpRequested = signal(false);
  readonly otpVerified = signal(false);
  readonly maskedMobile = signal('');
  readonly otpExpiresInMinutes = signal(5);
  readonly otpControl = new FormControl('', [Validators.pattern(/^\d{4}$/)]);
  /** Seconds left before Resend OTP is clickable again — same THC convention. */
  readonly resendCooldown = signal(0);
  private resendTimer: ReturnType<typeof setInterval> | null = null;

  readonly form: FormGroup = this.fb.group({
    deliveryUserId: [null as string | null, Validators.required],
    vehicleId: [null as string | null],
    fuelCost: [null as number | null, Validators.min(0)],
    deliveryCharge: [null as number | null, Validators.min(0)]
  });

  constructor() {
    let first = true;
    effect(() => {
      const id = this.acting.effectiveId();
      if (first) { first = false; return; }
      untracked(() => {
        this.directMode.set(!id);
        this.hubMode.set(false);
        this.load();
      });
    });
  }

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Operations' }, { label: 'DRS' }]);
    this.movementService.userOptions().subscribe((u) =>
      this.userOptions.set(u.map((x) => ({ value: x.id, label: x.label }))));
    this.vehicleService.list(true).subscribe((v) =>
      this.vehicleOptions.set(v.map((x) => ({ value: x.id, label: x.vehicleNumber }))));
    this.companyProfile.get().pipe(catchError(() => of(null))).subscribe((c) => this.companyLetterhead.set(c));
    this.masterData.options('payment-modes').subscribe((o) => this.paymentModeOptions.set(o));
    this.masterData.list(MASTER_DEFINITIONS['payment-modes'], { page: 0, size: 100, status: 'ACTIVE' }).subscribe((p) =>
      this.collectAtDeliveryModeIds.set(new Set(p.content.filter((r) => r['collectAtDelivery'] === true).map((r) => r.id))));
    this.masterData.branchDirectory().subscribe((list) => {
      this.branchNames.set(new Map(list.map((b) => [b.id, `${b.branchName} (${b.branchCode})`])));
      if (this.myBranchId) {
        const b = list.find((x) => x.id === this.myBranchId);
        this.branchLabel.set(b ? `${b.branchName} (${b.branchCode})` : '');
      }
    });
    // In Scan at a hub links here with ?tab=hub: open straight on the hub's own shipments.
    if (this.route.snapshot.queryParamMap.get('tab') === 'hub') this.hubMode.set(true);
    this.c('deliveryUserId').valueChanges.subscribe(() => this.resetOtpState());
    // Digits-only, 4 chars max — strips anything a paste or a non-numeric keyboard slips
    // in, since the field itself (a plain text input) doesn't block that on its own.
    this.otpControl.valueChanges.subscribe((v) => {
      const digits = (v ?? '').replace(/\D/g, '').slice(0, 4);
      if (digits !== v) this.otpControl.setValue(digits, { emitEvent: false });
    });
    this.load();
  }

  ngOnDestroy(): void {
    this.stopResendCooldown();
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  protected setMode(mode: 'branch' | 'hub' | 'direct'): void {
    this.directMode.set(mode === 'direct');
    this.hubMode.set(mode === 'hub');
    this.load();
  }

  load(): void {
    if (!this.myBranchId && !this.directMode()) return;
    if (this.hubMode() && !this.myBranchId) return;
    this.loading.set(true);
    this.selectedIds.set(new Set());
    this.shipmentService.list(this.hubMode()
      ? { page: 0, size: 100, currentLocationId: this.myBranchId!, unassignedDeliveryBranch: true, status: 'READY_FOR_MANIFEST' }
      : this.directMode()
      ? { page: 0, size: 100, unassignedDeliveryBranch: true, status: 'IN_SCAN' }
      : { page: 0, size: 100, deliveryBranchId: this.myBranchId!, status: 'IN_SCAN' }
    ).subscribe({
      next: (p) => { this.shipments.set(p.content); this.loading.set(false); },
      error: () => { this.shipments.set([]); this.loading.set(false); }
    });
  }

  toggleOne(id: string): void {
    const next = new Set(this.selectedIds());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.selectedIds.set(next);
  }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedIds.set(checked ? new Set(this.shipments().map((s) => s.id)) : new Set());
  }

  isSelected(id: string): boolean { return this.selectedIds().has(id); }

  private resetOtpState(): void {
    this.otpRequested.set(false);
    this.otpVerified.set(false);
    this.maskedMobile.set('');
    this.otpControl.reset();
    this.stopResendCooldown();
  }

  requestOtp(): void {
    const deliveryUserId = this.c('deliveryUserId').value;
    if (!deliveryUserId) return;
    this.sendingOtp.set(true);
    this.movementService.requestDeliveryOtp(deliveryUserId).subscribe({
      next: (r) => {
        this.sendingOtp.set(false);
        this.otpRequested.set(true);
        this.otpVerified.set(false);
        this.maskedMobile.set(r.maskedMobile);
        this.otpExpiresInMinutes.set(r.expiresInMinutes);
        this.otpControl.reset();
        this.notify.success(`OTP sent to ${r.maskedMobile}.`);
        this.startResendCooldown();
      },
      error: (e: HttpErrorResponse) => { this.sendingOtp.set(false); this.notify.error(e.error?.message ?? 'Could not send OTP.'); }
    });
  }

  private startResendCooldown(): void {
    this.stopResendCooldown();
    this.resendCooldown.set(15);
    this.resendTimer = setInterval(() => {
      const next = this.resendCooldown() - 1;
      if (next <= 0) { this.stopResendCooldown(); return; }
      this.resendCooldown.set(next);
    }, 1000);
  }

  private stopResendCooldown(): void {
    if (this.resendTimer !== null) { clearInterval(this.resendTimer); this.resendTimer = null; }
    this.resendCooldown.set(0);
  }

  verifyOtp(): void {
    const deliveryUserId = this.c('deliveryUserId').value;
    const otp = this.otpControl.value?.trim();
    if (!deliveryUserId || !otp) return;
    this.verifyingOtp.set(true);
    this.movementService.verifyDeliveryOtp(deliveryUserId, otp).subscribe({
      next: () => {
        this.verifyingOtp.set(false);
        this.otpVerified.set(true);
        this.notify.success('OTP verified.');
      },
      error: (e: HttpErrorResponse) => { this.verifyingOtp.set(false); this.notify.error(e.error?.message ?? 'Incorrect OTP.'); }
    });
  }

  assign(): void {
    if (this.form.invalid || !this.selectedIds().size) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();
    const shipmentIds = Array.from(this.selectedIds());
    const selected = this.shipments().filter((s) => shipmentIds.includes(s.id));
    this.assigning.set(true);
    this.movementService.outForDelivery({
      shipmentIds, deliveryUserId: v.deliveryUserId,
      vehicleId: v.vehicleId, fuelCost: v.fuelCost, deliveryCharge: v.deliveryCharge
    }).subscribe({
      next: (r) => {
        this.assigning.set(false);
        this.outcomes.set(r.results);
        this.drsNumber.set(r.drsNumber);
        const assignedNumbers = new Set(r.results.filter((o) => o.success).map((o) => o.reference));
        this.printableShipments.set(selected.filter((s) => assignedNumbers.has(s.shipmentNumber)));
        this.deliveryUserLabel = this.label(v.deliveryUserId, this.userOptions());
        if (r.failureCount) this.notify.error(`${r.failureCount} of ${r.results.length} could not be assigned.`);
        else this.notify.success(`${r.successCount} shipment(s) assigned.`);
        this.selectedIds.set(new Set());
        this.load();
        if (this.printableShipments().length) this.printDrs();
      },
      error: (e: HttpErrorResponse) => { this.assigning.set(false); this.notify.error(e.error?.message ?? 'Could not assign.'); }
    });
  }

  private deliveryUserLabel = '';

  private label(id: string | null | undefined, options: SelectOption[]): string {
    return options.find((o) => o.value === id)?.label ?? id ?? '—';
  }

  private esc(s: string | null | undefined): string {
    return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  printDrs(): void {
    const rows = this.printableShipments();
    if (!rows.length) return;
    const win = window.open('', '_blank', 'width=800,height=900');
    if (!win) { this.notify.error('Pop-up blocked — allow pop-ups to print the DRS.'); return; }
    const company = this.companyLetterhead();
    const companyName = company?.companyName ?? this.auth.companyName() ?? '';
    const companyLogo = company?.logo ?? this.auth.companyLogo();
    const companyAddress = companyAddressLine(company);
    const companyGst = company?.gstNumber ?? null;
    const companyContact = company?.mobile ?? null;
    const drsNo = this.drsNumber() ?? '—';
    const collectIds = this.collectAtDeliveryModeIds();
    const collectAmount = (s: Shipment): number | null => collectIds.has(s.paymentModeId) ? (s.netAmount ?? 0) : null;
    const totalAmount = rows.reduce((sum, s) => sum + (collectAmount(s) ?? 0), 0);
    const tableRows = rows.map((s, i) => `<tr>
      <td class="center">${i + 1}</td>
      <td>${this.esc(s.shipmentNumber)}</td>
      <td>${this.esc(s.ewayBillNumber) || '—'}</td>
      <td>${this.esc(s.receiverName)}</td>
      <td>${this.esc(s.receiverContact)}</td>
      <td>${this.esc(s.fromCity) || '—'}</td>
      <td>${this.esc(s.toCity) || '—'}</td>
      <td>${this.esc(this.label(s.paymentModeId, this.paymentModeOptions()))}</td>
      <td class="right">${collectAmount(s) ?? '—'}</td>
      <td class="c-sign"></td>
      <td class="c-stamp"></td>
    </tr>`).join('');
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>DRS ${this.esc(this.deliveryUserLabel)}</title>
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 20px; background: #f3f3f3; font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 9px; }
        .toolbar { width: 900px; margin: 0 auto 10px; }
        button { padding: 5px 12px; margin-right: 5px; border: 1px solid #000; background: #eee; cursor: pointer; font-size: 12px; }
        .sheet { width: 900px; margin: auto; background: #fff; border: 1px solid #000; }
        .title { text-align: center; font-size: 15px; font-weight: bold; padding: 4px 0; border-bottom: 1px solid #000; }
        ${PRINT_HEADER_CSS}
        .head, .head .co, .head .lrbox { border-color: #000; border-width: 1px; }
        .meta { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid #000; }
        .meta div { padding: 4px 6px; border-right: 1px solid #000; }
        .meta div:nth-child(4n) { border-right: 0; }
        .label { font-weight: bold; display: block; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th, td { border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 3px 4px; vertical-align: middle; min-height: 19px; word-wrap: break-word; overflow-wrap: break-word; }
        th:last-child, td:last-child { border-right: 0; }
        th { font-weight: bold; text-align: center; background: #fafafa; font-size: 8px; }
        td { font-size: 8px; }
        td.center, th.center { text-align: center; }
        td.right, th.right { text-align: right; }
        .c-sr { width: 26px; }
        .c-amount { width: 60px; }
        .c-sign, .c-stamp { width: 100px; }
        td.c-sign, td.c-stamp { min-height: 34px; height: 34px; }
        .total-row td { font-weight: bold; min-height: 22px; }
        .footer { display: grid; grid-template-columns: 1fr 150px; min-height: 38px; }
        .footer-left { padding: 5px; border-right: 1px solid #000; }
        .footer-right { text-align: center; padding: 5px; font-weight: bold; }
        .signature { height: 22px; margin-top: 2px; }
        @media print {
          body { background: #fff; padding: 0; margin: 0; }
          .toolbar { display: none; }
          .sheet { width: 100%; }
          @page { size: A4 portrait; margin: 8mm; }
        }
        @media screen and (max-width: 950px) { .sheet, .toolbar { width: 100%; overflow-x: auto; } }
      </style></head><body>

      <div class="toolbar">
        <button onclick="window.print()">Print</button>
        <button onclick="window.print()">Download PDF</button>
      </div>

      <div class="sheet">
        <div class="title">DELIVERY RUN SHEET (DRS)</div>

        ${renderPrintHeader(
          { companyName, companyLogo, companyAddress, companyGst, companyContact, companyWebsite: null },
          { label: 'DRS No', value: drsNo, barcodeValue: drsNo !== '—' ? drsNo : undefined, qrValue: drsNo !== '—' ? drsNo : undefined }
        )}

        <div class="meta">
          <div><span class="label">BRANCH</span>${this.esc(this.branchLabel())}</div>
          <div><span class="label">DELIVERY BOY</span>${this.esc(this.deliveryUserLabel)}</div>
          <div><span class="label">DATE</span>${this.esc(new Date().toLocaleDateString('en-GB'))}</div>
          <div><span class="label">SHIPMENTS</span>${rows.length}</div>
        </div>

        <table>
          <thead><tr>
            <th class="c-sr">SR<br>NO.</th>
            <th>SHIPMENT NO.</th>
            <th>E-WAY BILL NO.</th>
            <th>RECEIVER</th>
            <th>CONTACT</th>
            <th>FROM CITY</th>
            <th>TO CITY</th>
            <th>PAYMENT</th>
            <th class="c-amount right">AMOUNT</th>
            <th class="c-sign">RECEIVER SIGN</th>
            <th class="c-stamp">STAMP</th>
          </tr></thead>
          <tbody>${tableRows || '<tr><td colspan="11" class="center">No shipments</td></tr>'}</tbody>
          <tfoot><tr class="total-row">
            <td colspan="8" class="right">Total to Collect</td>
            <td class="right">${totalAmount}</td>
            <td></td>
            <td></td>
          </tr></tfoot>
        </table>

        <div class="footer">
          <div class="footer-left"><strong>${this.esc(companyName)}</strong></div>
          <div class="footer-right">SIGNATURE<div class="signature"></div></div>
        </div>
      </div>
    </body></html>`);
    win.document.close();
    win.focus();
  }
}
