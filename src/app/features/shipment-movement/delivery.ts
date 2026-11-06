import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, inject, signal, viewChild, effect, untracked } from '@angular/core';
import { ActingBranchService } from '@core/services/acting-branch.service';
import { ActAsBranch } from '@shared/components/act-as-branch/act-as-branch';
import jsQR from 'jsqr';
import { HttpErrorResponse } from '@angular/common/http';
import { DecimalPipe } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin } from 'rxjs';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { ShipmentStatusBadge } from '@features/shipment/components/shipment-status-badge';
import { ShipmentService } from '@features/shipment/shipment.service';
import { scanCandidates } from '@features/shipment/shipment-label-print.util';
import { ShipmentMovementService } from './shipment-movement.service';
import { Shipment, ShipmentStatus, UNDELIVERED_REASONS } from '@core/models/shipment.model';
import { PinIllustration } from '@shared/components/illustrations/pin-illustration';
import { MasterDataService } from '@features/masters/master-data.service';
import { MASTER_DEFINITIONS } from '@features/masters/master.config';
import { PaymentMode } from '@core/models/master.model';
import { PodService } from '@core/services/pod.service';
import { PodVerification } from '@core/models/pod.model';

type StatusFilter = 'ALL' | 'IN_SCAN' | 'OUT_FOR_DELIVERY' | 'DELIVERED';
const LIST_STATUSES: ShipmentStatus[] = ['IN_SCAN', 'OUT_FOR_DELIVERY', 'DELIVERED'];

/** Delivery — a filterable worklist of this branch's IN_SCAN / OUT_FOR_DELIVERY / DELIVERED
 *  orders (status + text search over tracking/shipment number/receiver), then a capture ->
 *  AI scoring -> decision flow for an OUT_FOR_DELIVERY row:
 *
 *  Upload POD (photo required, signature optional, real file picker) -> optionally scan the
 *  label's own QR (device camera, jsQR) -> "Run AI Verification" (PodService.verify, POD Auto
 *  Verification module) always lands PENDING — shows a manual "Check Review Status" refresh
 *  (a POD Review screen elsewhere approves/rejects it) alongside "Complete Delivery" (the
 *  existing, unchanged ShipmentMovementService.deliver — AI never itself marks a shipment
 *  DELIVERED, nor decides PASS/FAIL). FAIL (set only by a later human rejection) shows
 *  "Upload New POD" to recapture. The QR scan is optional at this screen (unlike the photo) —
 *  the backend falls back to decoding the QR out of the uploaded photo itself when no live
 *  scan was made; either way it's a real independent cross-check, not an echo of the
 *  already-selected shipment's own trackingNumber/shipmentNumber (sent regardless, below).
 *  See MEMORY/modules/pod-verification.md. */
@Component({
  selector: 'app-delivery',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, ReactiveFormsModule, ActAsBranch, MatIconModule, UiCard, UiLoader, UiButton, UiInput, UiSelect, ShipmentStatusBadge, PinIllustration],
  template: `
    <div class="page">
      <header class="page__head" data-tour="delivery-head">
        <div class="page__head-row">
          <app-pin-illustration class="page__head-ill" [size]="52" />
          <div><h1 class="text-h1">Delivery</h1>
          <p class="text-caption">Close a delivery against the consignee.</p></div>
        </div>
        @if (!shipment()) {
          <div class="head-actions">
            <app-act-as-branch />
            @if (myBranchId) {
              <app-button [variant]="directMode() ? 'stroked' : 'primary'" (pressed)="setDirectMode(false)">My Branch</app-button>
              <app-button [variant]="directMode() ? 'primary' : 'stroked'" (pressed)="setDirectMode(true)">Direct Company Delivery</app-button>
            }
            <app-button variant="stroked" icon="refresh" (pressed)="load()">Refresh</app-button>
          </div>
        }
      </header>

      @if (!myBranchId && !directMode()) {
        <app-card><p class="empty">No branch assigned — ask an admin.</p></app-card>
      } @else if (!shipment()) {
        <app-card>
          <div class="filters">
            <app-input [control]="searchControl" label="Search" placeholder="Tracking / Shipment No. / Receiver" />
            <app-select [control]="statusControl" label="Status" [options]="statusOptions" />
          </div>
        </app-card>

        @if (loading()) {
          <app-loader [minHeight]="120" caption="Loading…" />
        } @else if (!filteredShipments().length) {
          <app-card><p class="empty">{{ directMode() ? 'Nothing matches for Direct Company Delivery.' : 'Nothing matches at your branch.' }}</p></app-card>
        } @else {
          <app-card>
            <div class="tbl__wrap">
              <table class="tbl">
                <thead>
                  <tr><th>#</th><th>Shipment No.</th><th>Receiver</th><th>From Branch → To Branch</th><th>From City → To City</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  @for (s of filteredShipments(); track s.id; let i = $index) {
                    <tr [class.tbl__row--actionable]="s.status === 'OUT_FOR_DELIVERY'" (click)="selectShipment(s)">
                      <td>{{ i + 1 }}</td>
                      <td>{{ s.shipmentNumber }}</td>
                      <td>{{ s.receiverName }}</td>
                      <td>{{ branchNames().get(s.bookingBranchId) || '—' }} → {{ s.deliveryBranchId ? (branchNames().get(s.deliveryBranchId) || '—') : 'Direct Company Delivery' }}</td>
                      <td>{{ s.fromCity || '—' }} → {{ s.toCity || '—' }}</td>
                      <td><app-shipment-status-badge [status]="s.status" />
                        @if (s.undelivered?.open) {
                          <span class="ndr" [class.ndr--due]="s.undelivered!.returnDue">Attempt {{ s.undelivered!.attempts }} failed: {{ s.undelivered!.reasonLabel }}{{ s.undelivered!.returnDue ? ' · return due' : '' }}</span>
                        }
                      </td>
                      <td class="tbl--right">
                        @if (s.status === 'OUT_FOR_DELIVERY') {
                          <app-button icon="task_alt" (pressed)="selectShipment(s)">Deliver</app-button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </app-card>
        }
      }

      @if (shipment(); as s) {
        <app-card>
          <div class="sh">
            <div><strong>{{ s.shipmentNumber }}</strong>
              <span class="text-caption">{{ s.senderName }} → {{ s.receiverName }}, {{ s.receiverContact }}</span><br>
              <span class="text-caption">{{ branchNames().get(s.bookingBranchId) || '—' }} → {{ s.deliveryBranchId ? (branchNames().get(s.deliveryBranchId) || '—') : 'Direct Company Delivery' }} &nbsp;·&nbsp; {{ s.fromCity || '—' }} → {{ s.toCity || '—' }}</span></div>
            <app-button variant="stroked" icon="close" (pressed)="reset()">Back to List</app-button>
          </div>
          @if (paymentMode(); as pm) {
            <div class="pay">
              @if (pm.collectAtBooking) {
                <span class="pay__badge pay__badge--paid"><mat-icon>check_circle</mat-icon>{{ pm.name }}</span>
              } @else {
                <span class="pay__badge">{{ pm.name }}</span>
                @if (pm.collectAtDelivery && s.codAmount) {
                  <!-- portal COD: the goods value for the customer (freight was paid online) -->
                  <span class="pay__amount">Collect ₹{{ s.codAmount | number: '1.2-2' }} <span class="pay__hint">COD for the customer</span></span>
                } @else if (pm.collectAtDelivery && s.netAmount != null) {
                  <span class="pay__amount">Collect ₹{{ s.netAmount | number: '1.2-2' }}</span>
                }
              }
            </div>
          }
        </app-card>

        <app-card title="Could not deliver?">
          @if (!notDelivering()) {
            <app-button variant="stroked" icon="report" (pressed)="notDelivering.set(true)">Not delivered</app-button>
          } @else {
            <div class="nd">
              <label class="nd__field"><span>Reason</span>
                <select [value]="ndReason()" (change)="ndReason.set($any($event.target).value)">
                  <option value="">Choose a reason…</option>
                  @for (r of undeliveredReasons; track r.value) { <option [value]="r.value">{{ r.label }}</option> }
                </select></label>
              <label class="nd__field nd__field--wide"><span>Note {{ ndReason() === 'OTHER' ? '(required)' : '(optional)' }}</span>
                <input type="text" maxlength="255" [value]="ndNote()" (input)="ndNote.set($any($event.target).value)" placeholder="e.g. door locked, called twice" /></label>
            </div>
            <div class="nd__actions">
              <app-button icon="report" [loading]="savingNd()" [disabled]="!ndReason() || (ndReason() === 'OTHER' && !ndNote().trim())" (pressed)="markNotDelivered()">Record failed attempt</app-button>
              <app-button variant="stroked" (pressed)="notDelivering.set(false)" [disabled]="savingNd()">Cancel</app-button>
            </div>
            <p class="text-caption">The shipment goes back to your branch as In Scan, the customer is told, and you can send it out again.</p>
          }
        </app-card>

        <app-card title="Delivery Form">
          <form [formGroup]="form" (ngSubmit)="onEnter()" class="df">
            <div class="grid2">
              <app-input [control]="c('receiverName')" label="Receiver Name" [required]="true" [maxLength]="150" />
              <app-input [control]="c('otp')" label="OTP" placeholder="Optional" [maxLength]="10" />
            </div>
            <app-input [control]="c('remarks')" label="Remarks" placeholder="Optional" [maxLength]="500" />

            @if (!verification() || verification()!.verificationStatus === 'FAIL') {
              <div class="pod-row">
                <div class="pod">
                  <span class="pod__label">Photo <em>required</em></span>
                  <button type="button" class="pod__btn" (click)="photoFile.click()">
                    <mat-icon>photo_camera</mat-icon> {{ photo() ? photo()!.name : 'Choose file' }}
                  </button>
                  <input #photoFile type="file" accept="image/*" hidden (change)="onFile($event, 'photo')" />
                </div>
                <div class="pod">
                  <span class="pod__label">Signature <em>optional</em></span>
                  <button type="button" class="pod__btn" (click)="signatureFile.click()">
                    <mat-icon>draw</mat-icon> {{ signature() ? signature()!.name : 'Choose file' }}
                  </button>
                  <input #signatureFile type="file" accept="image/*" hidden (change)="onFile($event, 'signature')" />
                </div>
                <div class="pod">
                  <span class="pod__label">Label QR <em>optional</em></span>
                  @if (qrScanValue()) {
                    <div class="qr-chip">
                      <mat-icon>qr_code_2</mat-icon><span>{{ qrScanValue() }}</span>
                      <button type="button" class="qr-chip__clear" (click)="clearQrScan()">
                        <mat-icon>close</mat-icon>
                      </button>
                    </div>
                  } @else {
                    <button type="button" class="pod__btn" (click)="scanningQr() ? stopQrScan() : startQrScan()">
                      <mat-icon>{{ scanningQr() ? 'close' : 'qr_code_scanner' }}</mat-icon>
                      {{ scanningQr() ? 'Cancel Scan' : 'Scan QR' }}
                    </button>
                  }
                  <video #qrVideo playsinline muted class="qr-video" [class.qr-video--active]="scanningQr()"></video>
                </div>
              </div>
              <div class="df__bar">
                <app-button variant="stroked" icon="task_alt" [loading]="delivering()" [disabled]="!photo()" (pressed)="deliver()">
                  Mark as Delivered
                </app-button>
                <app-button icon="smart_toy" [loading]="verifying()" [disabled]="!photo()" (pressed)="runVerification()">
                  Run AI Verification
                </app-button>
              </div>
            }

            @if (verifying()) {
              <div class="ai-status ai-status--pending">
                <mat-icon>hourglass_top</mat-icon>
                <span>AI Verification — Processing…</span>
              </div>
            }

            @if (verification(); as v) {
              <div class="ai-result" [class.ai-result--pass]="v.verificationStatus === 'PASS'"
                   [class.ai-result--review]="v.verificationStatus === 'PENDING'"
                   [class.ai-result--fail]="v.verificationStatus === 'FAIL'">
                <div class="ai-result__head">
                  <mat-icon>{{ statusIcon(v) }}</mat-icon>
                  <strong>{{ statusLabel(v) }}</strong>
                  <span class="ai-result__score">{{ v.verificationScore }}/100</span>
                </div>
                <dl class="ai-result__grid">
                  <div><dt>Receiver</dt><dd>{{ v.detectedReceiverName || '—' }}</dd></div>
                  <div><dt>AWB</dt><dd>{{ v.detectedAwb || '—' }}</dd></div>
                  <div><dt>Date</dt><dd>{{ v.detectedDate || '—' }}</dd></div>
                  <div><dt>Signature</dt><dd>{{ v.signatureDetected ? 'Detected' : 'Not detected' }}</dd></div>
                  <div><dt>Image Quality</dt><dd>{{ v.imageQuality || '—' }}</dd></div>
                </dl>
                @if (v.verificationReasons.length) {
                  <ul class="ai-result__reasons">
                    @for (r of v.verificationReasons; track r) { <li>{{ r }}</li> }
                  </ul>
                }

                <div class="df__bar">
                  <app-button icon="task_alt" [loading]="delivering()" (pressed)="deliver()">Complete Delivery</app-button>
                  @if (v.verificationStatus === 'PENDING') {
                    <app-button variant="stroked" icon="refresh" [loading]="checkingReview()" (pressed)="checkReviewStatus()">
                      Check Review Status
                    </app-button>
                    <span class="ai-result__hint">Awaiting a company decision on this POD, but you can still complete delivery now.</span>
                  } @else if (v.verificationStatus === 'FAIL') {
                    <app-button variant="stroked" icon="upload" (pressed)="uploadNewPod()">Upload New POD</app-button>
                    <span class="ai-result__hint">This POD was rejected — you can still complete delivery, or capture a new POD first.</span>
                  }
                </div>
              </div>
            }
          </form>
        </app-card>
      }
    </div>
  `,
  styles: [`
    .ndr { display:block; margin-top:4px; font:600 11px var(--font-sans); color:var(--warning, #a15c00); }
    .ndr--due { color:var(--danger, #b3123a); }
    .nd { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
    .nd__field { display:flex; flex-direction:column; gap:4px; font:500 12px var(--font-sans); color:var(--content-muted); min-width:220px; }
    .nd__field--wide { flex:1; }
    .nd__field select, .nd__field input { padding:9px 10px; border:1px solid var(--surface-border); border-radius:var(--r-field); background:var(--surface); color:var(--content-fg); font:400 14px var(--font-sans); }
    .nd__actions { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:8px; }
    .page__head { display:flex; justify-content:space-between; align-items:flex-start; }
    .head-actions { display:flex; align-items:center; gap:8px; }
    .filters { display:flex; gap:16px; flex-wrap:wrap; }
    .filters app-input { flex:1; min-width:220px; }
    .filters app-select { min-width:200px; }
    .df { display:flex; flex-direction:column; gap:16px; }
    .df__bar { display:flex; justify-content:flex-end; align-items:center; gap:10px; }
    .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px 20px; }
    .pod-row { display:flex; gap:20px; flex-wrap:wrap; }
    .pod { display:flex; flex-direction:column; gap:8px; }
    .pod__label { font:600 12px var(--font-sans); color:var(--content-muted); }
    .pod__label em { font-style:normal; color:var(--content-muted); opacity:.7; }
    .pod__btn { display:inline-flex; align-items:center; gap:6px; align-self:flex-start;
      border:1px solid var(--surface-border); background:var(--surface); border-radius:var(--r-field);
      padding:6px 12px; font:600 12px var(--font-sans); color:var(--content-fg); cursor:pointer; }
    .pod__btn:disabled { opacity:.6; cursor:default; }
    .pod__btn mat-icon { font-size:16px; width:16px; height:16px; }
    .qr-chip { display:inline-flex; align-items:center; gap:6px; align-self:flex-start;
      border:1px solid var(--success-fg, #1a7f3c); background:var(--success-bg, #e6f7ec); border-radius:var(--r-field);
      padding:6px 10px; font:600 12px var(--font-sans); color:var(--content-fg); }
    .qr-chip mat-icon { font-size:16px; width:16px; height:16px; color:var(--success-fg, #1a7f3c); }
    .qr-chip__clear { display:inline-flex; border:0; background:none; cursor:pointer; padding:0; color:var(--content-muted); }
    .qr-chip__clear mat-icon { font-size:15px; width:15px; height:15px; }
    .qr-video { display:none; width:220px; height:165px; border-radius:var(--r-field); border:1px solid var(--surface-border); object-fit:cover; background:#000; }
    .qr-video--active { display:block; margin-top:8px; }
    .sh { display:flex; justify-content:space-between; align-items:center; gap:12px; }
    .sh strong { display:block; font:600 15px var(--font-sans); }
    .pay { display:flex; align-items:center; gap:10px; margin-top:12px; flex-wrap:wrap; }
    .pay__badge { display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border-radius:999px;
      font:600 12px var(--font-sans); background:var(--surface-muted); color:var(--content-fg); }
    .pay__badge--paid { background:var(--success-bg, #e6f7ec); color:var(--success-fg, #1a7f3c); }
    .pay__badge--paid mat-icon { font-size:15px; width:15px; height:15px; }
    .pay__amount { font:600 13px var(--font-sans); color:var(--content-fg); }
    .pay__hint { font:500 11px var(--font-sans); color:var(--content-muted); margin-left:4px; }
    .empty { font:400 14px var(--font-sans); color:var(--content-muted); text-align:center; padding:20px; }
    .tbl__wrap { overflow-x:auto; border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .tbl { width:100%; border-collapse:collapse; font:400 13px var(--font-sans); }
    .tbl th { text-align:left; padding:10px 14px; background:var(--surface-muted); color:var(--content-muted); font:600 11px var(--font-sans); text-transform:uppercase; letter-spacing:.03em; white-space:nowrap; }
    .tbl td { padding:10px 14px; border-top:1px solid var(--surface-border); white-space:nowrap; }
    .tbl--right { text-align:right; }
    .tbl__row--actionable { cursor:pointer; }
    .tbl__row--actionable:hover { background:var(--surface-muted); }
    .ai-status { display:flex; align-items:center; gap:8px; padding:10px 14px; border-radius:var(--r-field);
      background:var(--surface-muted); font:600 13px var(--font-sans); color:var(--content-muted); }
    .ai-result { display:flex; flex-direction:column; gap:12px; padding:14px 16px; border-radius:var(--r-field);
      border:1px solid var(--surface-border); }
    .ai-result--pass { border-color:var(--success-fg, #1a7f3c); background:var(--success-bg, #e6f7ec); }
    .ai-result--review { border-color:#b58900; background:#fff8e1; }
    .ai-result--fail { border-color:#c0392b; background:#fdecea; }
    .ai-result__head { display:flex; align-items:center; gap:8px; font:700 14px var(--font-sans); }
    .ai-result__score { margin-left:auto; font:600 13px var(--font-sans); color:var(--content-muted); }
    .ai-result__grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px 16px; margin:0; }
    .ai-result__grid dt { font:600 11px var(--font-sans); color:var(--content-muted); text-transform:uppercase; letter-spacing:.03em; }
    .ai-result__grid dd { margin:2px 0 0; font:500 13px var(--font-sans); }
    .ai-result__reasons { margin:0; padding-left:18px; font:400 13px var(--font-sans); color:var(--content-muted); }
    .ai-result__hint { font:400 12px var(--font-sans); color:var(--content-muted); }
    @media (max-width:760px){ .grid2 { grid-template-columns:1fr; } }
  `]
})
export class Delivery implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly shipmentService = inject(ShipmentService);
  private readonly movementService = inject(ShipmentMovementService);
  private readonly podService = inject(PodService);
  private readonly masters = inject(MasterDataService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly acting = inject(ActingBranchService);
  /** Own branch, or — for a branch-less admin — the branch/hub picked in "Act as". */
  protected get myBranchId(): string | null { return this.acting.effectiveId(); }
  /** Direct Company Delivery shipments have no delivery branch at all, so they never show
   *  up under "my branch" — this switches the worklist to every such shipment company-wide
   *  instead. Defaults on for a caller with no own branch (e.g. a pure COMPANY_ADMIN). */
  readonly directMode = signal(!this.acting.effectiveId());

  readonly shipment = signal<Shipment | null>(null);
  readonly paymentMode = signal<PaymentMode | null>(null);
  readonly delivering = signal(false);
  readonly verifying = signal(false);
  readonly checkingReview = signal(false);
  readonly verification = signal<PodVerification | null>(null);
  readonly photo = signal<File | null>(null);
  readonly signature = signal<File | null>(null);
  readonly qrScanValue = signal<string | null>(null);
  readonly scanningQr = signal(false);
  private readonly qrVideo = viewChild<ElementRef<HTMLVideoElement>>('qrVideo');
  private qrStream: MediaStream | null = null;
  private qrRafId: number | null = null;

  readonly shipments = signal<Shipment[]>([]);
  readonly loading = signal(true);
  /** Branch id -> "Name (CODE)" for the worklist's From Branch / To Branch column — same
   *  `branchDirectory()` lookup Loading Sheet/THC already use for the same reason. */
  readonly branchNames = signal<Map<string, string>>(new Map());
  readonly searchControl = new FormControl('');
  readonly statusControl = new FormControl<StatusFilter>('ALL');
  readonly statusOptions: SelectOption[] = [
    { value: 'ALL', label: 'In Scan + DRS + Delivered' },
    { value: 'IN_SCAN', label: 'In Scan' },
    { value: 'OUT_FOR_DELIVERY', label: 'DRS' },
    { value: 'DELIVERED', label: 'Delivered' }
  ];
  protected readonly filteredShipments = computed(() => {
    const q = (this.searchControl.value ?? '').trim().toLowerCase();
    if (!q) return this.shipments();
    const awb = scanCandidates(q)[1];
    return this.shipments().filter((s) =>
      s.trackingNumber.toLowerCase().includes(q) ||
      (awb !== undefined && s.trackingNumber.toLowerCase() === awb) ||
      s.shipmentNumber.toLowerCase().includes(q) ||
      s.receiverName.toLowerCase().includes(q));
  });

  readonly form: FormGroup = this.fb.group({
    receiverName: ['', [Validators.required, Validators.maxLength(150)]],
    remarks: ['', Validators.maxLength(500)],
    otp: ['', Validators.maxLength(10)]
  });

  private pendingTrackingNumber: string | null = null;

  constructor() {
    let first = true;
    effect(() => {
      const id = this.acting.effectiveId();
      if (first) { first = false; return; }
      untracked(() => {
        this.directMode.set(!id);
        
        this.load();
      });
    });
  }

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Operations' }, { label: 'Delivery' }]);
    this.statusControl.valueChanges.subscribe(() => this.load());
    this.pendingTrackingNumber = this.route.snapshot.queryParamMap.get('trackingNumber');
    if (this.pendingTrackingNumber) this.searchControl.setValue(this.pendingTrackingNumber);
    this.masters.branchDirectory().subscribe((list) =>
      this.branchNames.set(new Map(list.map((b) => [b.id, `${b.branchName} (${b.branchCode})`]))));
    this.load();
    this.destroyRef.onDestroy(() => this.stopQrScan());
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  /** Enter-key submit inside the form — routes to whichever action is currently valid,
   *  same as clicking the one visible primary button would. */
  protected onEnter(): void {
    if (this.verification()) this.deliver();
    else this.runVerification();
  }

  protected statusIcon(v: PodVerification): string {
    return v.verificationStatus === 'PASS' ? 'verified' : v.verificationStatus === 'PENDING' ? 'warning' : 'cancel';
  }

  protected statusLabel(v: PodVerification): string {
    return v.verificationStatus === 'PASS' ? 'Verified'
      : v.verificationStatus === 'PENDING' ? 'Pending Decision' : 'Verification Failed';
  }

  protected setDirectMode(directMode: boolean): void {
    this.directMode.set(directMode);
    this.load();
  }

  load(): void {
    if (!this.myBranchId && !this.directMode()) return;
    this.loading.set(true);
    const filter = this.statusControl.value ?? 'ALL';
    const statuses = filter === 'ALL' ? LIST_STATUSES : [filter as ShipmentStatus];
    // A hub's DRS shipments never get a delivery branch, so besides the ones addressed to this
    // branch, also list those physically here with none assigned — otherwise a hub (or a branch
    // that made a DRS for a hub-sorted shipment) could never capture their POD.
    const requests = statuses.flatMap((status) => this.directMode()
      ? [this.shipmentService.list({ page: 0, size: 100, unassignedDeliveryBranch: true, status })]
      : [this.shipmentService.list({ page: 0, size: 100, deliveryBranchId: this.myBranchId!, status }),
         this.shipmentService.list({ page: 0, size: 100, currentLocationId: this.myBranchId!, unassignedDeliveryBranch: true, status })]);
    forkJoin(requests).subscribe({
      next: (pages) => {
        const seen = new Set<string>();
        const list = pages.flatMap((p) => p.content).filter((s) => !seen.has(s.id) && !!seen.add(s.id));
        this.shipments.set(list);
        this.loading.set(false);
        if (this.pendingTrackingNumber) {
          const match = list.find((s) => s.trackingNumber === this.pendingTrackingNumber);
          this.pendingTrackingNumber = null;
          if (match) this.selectShipment(match);
        }
      },
      error: () => { this.shipments.set([]); this.loading.set(false); }
    });
  }

  protected readonly undeliveredReasons = UNDELIVERED_REASONS;
  readonly notDelivering = signal(false);
  readonly ndReason = signal('');
  readonly ndNote = signal('');
  readonly savingNd = signal(false);

  markNotDelivered(): void {
    const s = this.shipment();
    if (!s || !this.ndReason()) return;
    this.savingNd.set(true);
    this.movementService.markUndelivered(s.id, this.ndReason(), this.ndNote().trim() || null).subscribe({
      next: (r) => {
        this.savingNd.set(false);
        this.notify.success(`Attempt ${r.undelivered?.attempts ?? ''} recorded. ${s.shipmentNumber} is back at your branch.`);
        this.reset();
      },
      error: (e) => { this.savingNd.set(false); this.notify.error(e.error?.message ?? 'The failed attempt could not be recorded.'); }
    });
  }

  selectShipment(s: Shipment): void {
    if (s.status !== 'OUT_FOR_DELIVERY') {
      this.notify.error(`Shipment is ${s.status}, not OUT_FOR_DELIVERY.`);
      return;
    }
    this.shipment.set(s);
    this.paymentMode.set(null);
    this.verification.set(null);
    this.photo.set(null);
    this.signature.set(null);
    this.stopQrScan();
    this.qrScanValue.set(null);
    this.form.patchValue({ receiverName: s.receiverName });
    this.masters.get(MASTER_DEFINITIONS['payment-modes'], s.paymentModeId)
      .subscribe((pm) => this.paymentMode.set(pm as PaymentMode));
    // A prior PENDING/PASS may already exist (e.g. the delivery user navigated away and
    // back) — hydrate it silently so the AI step isn't repeated unnecessarily.
    this.podService.getLatest(s.id).subscribe({
      next: (v) => this.verification.set(v),
      error: () => this.verification.set(null)
    });
  }

  reset(): void {
    this.notDelivering.set(false);
    this.ndReason.set('');
    this.ndNote.set('');
    this.shipment.set(null);
    this.paymentMode.set(null);
    this.verification.set(null);
    this.photo.set(null);
    this.signature.set(null);
    this.stopQrScan();
    this.qrScanValue.set(null);
    this.form.reset();
    this.load();
  }

  onFile(event: Event, kind: 'photo' | 'signature'): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (kind === 'photo') this.photo.set(file); else this.signature.set(file);
  }

  uploadNewPod(): void {
    this.verification.set(null);
    this.photo.set(null);
    this.signature.set(null);
    this.qrScanValue.set(null);
  }

  runVerification(): void {
    const shipment = this.shipment();
    const photo = this.photo();
    if (!shipment || !photo) { this.notify.error('A delivery photo is required.'); return; }
    if (this.c('receiverName').invalid) { this.form.markAllAsTouched(); return; }

    this.verifying.set(true);
    this.podService.verify(shipment.id, {
      photo, signature: this.signature(),
      receiverName: this.c('receiverName').value.trim(),
      awbNumber: shipment.trackingNumber, shipmentNumber: shipment.shipmentNumber,
      deliveryDateTime: new Date().toISOString(),
      qrScanValue: this.qrScanValue()
    }).subscribe({
      next: (v) => { this.verifying.set(false); this.verification.set(v); },
      error: (e: HttpErrorResponse) => {
        this.verifying.set(false);
        this.notify.error(e.error?.message ?? 'POD verification failed.');
      }
    });
  }

  /** Opens the device camera and starts scanning frames for a QR code — decodes the label
   *  physically stuck to the parcel, an independent identifier the operator can't accidentally
   *  self-echo (unlike `awbNumber`/`shipmentNumber` above, which just restate the already-
   *  selected shipment). Stops itself the moment a QR decodes; `stopQrScan()` cancels early. */
  async startQrScan(): Promise<void> {
    if (this.scanningQr()) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch {
      this.notify.error('Camera access denied or unavailable.');
      return;
    }
    this.qrStream = stream;
    this.scanningQr.set(true);
    const video = this.qrVideo()?.nativeElement;
    if (!video) { this.stopQrScan(); return; }
    video.srcObject = stream;
    void video.play();
    this.scanFrames(video);
  }

  stopQrScan(): void {
    this.scanningQr.set(false);
    if (this.qrRafId != null) { cancelAnimationFrame(this.qrRafId); this.qrRafId = null; }
    this.qrStream?.getTracks().forEach((track) => track.stop());
    this.qrStream = null;
    const video = this.qrVideo()?.nativeElement;
    if (video) video.srcObject = null;
  }

  clearQrScan(): void {
    this.qrScanValue.set(null);
  }

  private scanFrames(video: HTMLVideoElement): void {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = (): void => {
      if (!this.scanningQr()) return;
      if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(frame.data, frame.width, frame.height);
        if (decoded?.data) {
          this.qrScanValue.set(decoded.data);
          this.notify.success('QR code scanned.');
          this.stopQrScan();
          return;
        }
      }
      this.qrRafId = requestAnimationFrame(tick);
    };
    this.qrRafId = requestAnimationFrame(tick);
  }

  checkReviewStatus(): void {
    const shipment = this.shipment();
    if (!shipment) return;
    this.checkingReview.set(true);
    this.podService.getLatest(shipment.id).subscribe({
      next: (v) => {
        this.checkingReview.set(false);
        this.verification.set(v);
        if (v.verificationStatus === 'PENDING') this.notify.error('Still awaiting a company decision.');
      },
      error: () => this.checkingReview.set(false)
    });
  }

  deliver(): void {
    const shipment = this.shipment();
    if (!shipment || this.form.invalid) { this.form.markAllAsTouched(); return; }
    if (!this.photo()) { this.notify.error('A delivery photo is required.'); return; }
    const v = this.form.getRawValue();
    this.delivering.set(true);
    this.movementService.deliver({
      shipmentId: shipment.id, receiverName: v.receiverName.trim(),
      remarks: v.remarks?.trim() || null, otp: v.otp?.trim() || null,
      // POD was already captured and stored by PodService.verify — nothing left to attach.
      signatureUrl: null, photoUrl: null
    }).subscribe({
      next: () => {
        this.delivering.set(false);
        this.notify.success(`Shipment ${shipment.shipmentNumber} delivered.`);
        this.reset();
      },
      error: (e: HttpErrorResponse) => { this.delivering.set(false); this.notify.error(e.error?.message ?? 'Could not close the delivery.'); }
    });
  }
}
