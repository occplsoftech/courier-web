import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { map, of, switchMap } from 'rxjs';
import { Manifest, Shipment } from '@core/models/shipment.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { ManifestService } from '@features/manifest/manifest.service';
import { ShipmentMovementService } from '../shipment-movement.service';

export interface Opt { value: string; label: string; }
export type AssignCreate = 'manifest' | 'drs';

/**
 * "Assign Outscan Item" (Scan → Pending Outscan → ASSIGN). Create one of:
 *  - Manifest (default): Branch, Co-Loader, Bags, optional own vehicle/driver; "With / Without Forwarder No." —
 *    with, every AWB needs the co-loader's own number (typed or scanned), saved on the shipment and printed.
 *  - DRS: Delivery Boy (staff or co-loader), optional vehicle — a local delivery run.
 * AWBs are scanned (barcode gun, typing or the camera) into a table with Qty and Actual wt.
 */
@Component({
  selector: 'app-outscan-assign-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule, UiButton],
  template: `
    <div class="ovl" (keydown.escape)="cancel()">
      <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="as-title">
        <h2 id="as-title" class="dlg__t">Assign Outscan Item</h2>

        <div class="f"><span class="f__l">Create <b class="req">*</b></span>
          <div class="seg" role="radiogroup" aria-label="Create">
            <button type="button" role="radio" class="opt" id="as-mk-man" [class.opt--on]="create() === 'manifest'" [attr.aria-checked]="create() === 'manifest'" (click)="setCreate('manifest')">
              <span class="dot"></span><span><b>Manifest</b><small>Send to a branch or hub</small></span></button>
            <button type="button" role="radio" class="opt" id="as-mk-drs" [class.opt--on]="create() === 'drs'" [attr.aria-checked]="create() === 'drs'" (click)="setCreate('drs')">
              <span class="dot"></span><span><b>DRS</b><small>Local delivery run</small></span></button>
          </div></div>

        @if (create() === 'manifest') {
          <label class="f"><span class="f__l">Branch <b class="req">*</b></span>
            <select class="in" id="as-branch" [value]="branchId()" (change)="branchId.set($any($event.target).value)">
              <option value="">Select branch or hub</option>@for (o of branches(); track o.value) { <option [value]="o.value">{{ o.label }}</option> }
            </select></label>
          <div class="g2">
            <label class="f"><span class="f__l">Co-Loader</span>
              <select class="in" id="as-coloader" [value]="coLoaderId()" (change)="coLoaderId.set($any($event.target).value)">
                <option value="">None</option>@for (o of coLoaders(); track o.value) { <option [value]="o.value">{{ o.label }}</option> }
              </select></label>
            <label class="f"><span class="f__l">Bags</span><input class="in" id="as-bags" inputmode="numeric" maxlength="4" [value]="bags()" (input)="bags.set(digits($event))" /></label>
          </div>
          <details class="more"><summary>Own vehicle and driver (optional)</summary>
            <div class="g2">
              <label class="f"><span class="f__l">Vehicle</span><select class="in" [value]="vehicleId()" (change)="vehicleId.set($any($event.target).value)">
                <option value="">None</option>@for (o of vehicles(); track o.value) { <option [value]="o.value">{{ o.label }}</option> }</select></label>
              <label class="f"><span class="f__l">Driver</span><select class="in" [value]="driverId()" (change)="driverId.set($any($event.target).value)">
                <option value="">None</option>@for (o of users(); track o.value) { <option [value]="o.value">{{ o.label }}</option> }</select></label>
            </div></details>
          <div class="seg seg--sm" role="radiogroup" aria-label="Forwarder number">
            <button type="button" role="radio" class="opt" id="as-fwd-no" [class.opt--on]="!withFwd()" [attr.aria-checked]="!withFwd()" (click)="withFwd.set(false)"><span class="dot"></span><b>Without Forwarder No.</b></button>
            <button type="button" role="radio" class="opt" id="as-fwd-yes" [class.opt--on]="withFwd()" [attr.aria-checked]="withFwd()" (click)="withFwd.set(true)"><span class="dot"></span><b>With Forwarder No.</b></button>
          </div>
        } @else {
          <div class="g2">
            <label class="f"><span class="f__l">Delivery Boy <b class="req">*</b></span>
              <select class="in" id="as-boy" [value]="deliveryBy()" (change)="deliveryBy.set($any($event.target).value)">
                <option value="">Select delivery boy or co-loader</option>
                <optgroup label="Staff">@for (o of users(); track o.value) { <option [value]="'u:' + o.value">{{ o.label }}</option> }</optgroup>
                @if (coLoaders().length) { <optgroup label="Co-Loaders">@for (o of coLoaders(); track o.value) { <option [value]="'c:' + o.value">{{ o.label }}</option> }</optgroup> }
              </select></label>
            <label class="f"><span class="f__l">Vehicle</span><select class="in" id="as-drs-veh" [value]="vehicleId()" (change)="vehicleId.set($any($event.target).value)">
              <option value="">None</option>@for (o of vehicles(); track o.value) { <option [value]="o.value">{{ o.label }}</option> }</select></label>
          </div>
        }

        <div class="f"><span class="f__l">AWB Number <b class="req">*</b></span>
          <div class="scan">
            <div class="scan__box"><mat-icon>qr_code_scanner</mat-icon>
              <input id="as-awb" [value]="awbText()" (input)="awbText.set($any($event.target).value)" (keydown.enter)="addTyped(); $event.preventDefault()"
                     (paste)="onPaste($event)" placeholder="Scan or type AWB, Enter to add" autocomplete="off" /></div>
            <button type="button" class="scanbtn" (click)="openCamera(null)"><mat-icon>photo_camera</mat-icon>SCAN</button>
          </div></div>
        @if (awbError()) { <p class="err" role="alert">{{ awbError() }}</p> }

        <div class="tw">
          <table class="t">
            <thead><tr><th>#</th><th>AWB</th><th>Receiver</th>
              @if (create() === 'drs') { <th>Address</th> } @else { <th>To</th> }
              <th class="n">Qty</th><th class="n">Actual wt</th>
              @if (showFwd()) { <th>Forwarder No. <b class="req">*</b></th> }
              <th></th></tr></thead>
            <tbody>
              @for (s of picked(); track s.id; let i = $index) {
                <tr>
                  <td class="muted">{{ i + 1 }}</td><td class="mono">{{ s.shipmentNumber }}</td><td>{{ s.receiverName }}</td>
                  @if (create() === 'drs') { <td class="addr">{{ s.receiverAddress || '—' }}</td> } @else { <td>{{ s.toCity || '—' }}</td> }
                  <td class="n">{{ s.numberOfPackages ?? 1 }}</td><td class="n">{{ s.actualWeight ?? s.chargeableWeight | number: '1.0-2' }} kg</td>
                  @if (showFwd()) {
                    <td><div class="fwd" [class.fwd--miss]="!fwdOf(s.id)">
                      <input [id]="'as-fwd-' + i" maxlength="60" [value]="fwdOf(s.id)" (input)="setFwd(s.id, $any($event.target).value)"
                             (keydown.enter)="nextFwd(i); $event.preventDefault()" placeholder="Enter or scan" [attr.aria-label]="'Forwarder number for ' + s.shipmentNumber" />
                      <button type="button" (click)="openCamera(s.id)" [attr.aria-label]="'Scan forwarder number for ' + s.shipmentNumber"><mat-icon>qr_code_scanner</mat-icon></button>
                    </div></td>
                  }
                  <td><button type="button" class="rm" (click)="remove(s.id)" [attr.aria-label]="'Remove ' + s.shipmentNumber"><mat-icon>close</mat-icon></button></td>
                </tr>
              } @empty {
                <tr><td [attr.colspan]="showFwd() ? 8 : 7" class="empty">No AWB added yet — scan or type one above.</td></tr>
              }
            </tbody>
            @if (picked().length) {
              <tfoot><tr><td></td><td colspan="3"><b>Total {{ picked().length }} AWB</b></td>
                <td class="n"><b>{{ totalQty() }}</b></td><td class="n"><b>{{ totalWt() | number: '1.0-2' }} kg</b></td>
                @if (showFwd()) { <td class="muted">{{ fwdDone() }} of {{ picked().length }} entered</td> }<td></td></tr></tfoot>
            }
          </table>
        </div>
        @if (error()) { <p class="err" role="alert">{{ error() }}</p> }

        <div class="acts"><button type="button" class="txt" (click)="cancel()">CANCEL</button>
          <app-button [loading]="busy()" [disabled]="!canAssign()" (pressed)="assign()">{{ create() === 'manifest' ? 'SAVE MANIFEST' : 'ASSIGN' }}</app-button></div>
      </div>

      @if (camera()) {
        <div class="cam" role="dialog" aria-modal="true" [attr.aria-label]="camFor() ? 'Scan forwarder number' : 'Scan AWB'">
          <div class="cam__box"><div class="cam__top"><b>{{ camFor() ? 'Scan Forwarder No.' : 'Scan AWB' }}</b><button type="button" class="x" (click)="closeCamera()" aria-label="Close">✕</button></div>
            <div class="cam__view"><video id="as-video" playsinline muted></video><div class="cam__frame"></div></div>
            <p class="cam__msg">{{ cameraMsg() }}</p></div>
        </div>
      }
    </div>
  `,
  styles: [`
    .ovl { position: fixed; inset: 0; z-index: 1000; background: rgb(15 16 32 / 55%); display: grid; place-items: center; padding: 16px; }
    .dlg { width: min(820px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; overflow-x: hidden; background: var(--surface); border-radius: 18px; padding: 22px 24px;
      display: flex; flex-direction: column; gap: 12px; box-shadow: 0 30px 60px rgb(0 0 0 / 30%); }
    .dlg__t { margin: 0 0 4px; font: 600 22px var(--font-sans); }
    .f { display: flex; flex-direction: column; gap: 6px; } .f__l { font: 500 14px var(--font-sans); color: var(--content-muted); } .req { color: var(--danger); }
    .in { height: 46px; padding: 0 12px; border: 1px solid var(--surface-border); border-radius: var(--r-field); background: var(--surface); color: var(--content-fg); font: 400 16px var(--font-sans); min-width: 0; }
    .g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .more summary { cursor: pointer; color: var(--content-muted); font: 500 14px var(--font-sans); margin-bottom: 8px; }
    .seg { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .opt { display: flex; align-items: center; gap: 10px; text-align: left; border: 1.5px solid var(--surface-border); background: var(--surface); color: var(--content-fg);
      border-radius: 12px; padding: 12px 14px; font: 400 15px var(--font-sans); cursor: pointer; }
    .opt b { display: block; font-weight: 600; } .opt small { display: block; color: var(--content-muted); font-size: 13px; }
    .seg--sm .opt { padding: 9px 12px; }
    .dot { flex: none; width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--surface-border); }
    .opt--on { background: var(--brand-50); border-color: var(--brand-600); color: var(--brand-700); }
    .opt--on .dot { border-color: var(--brand-600); box-shadow: inset 0 0 0 4px var(--brand-50); background: var(--brand-600); }
    .scan { display: flex; gap: 10px; min-width: 0; }
    .scan__box { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 48px; border: 2px solid var(--brand-600); border-radius: var(--r-field); }
    .scan__box mat-icon { color: var(--brand-600); }
    .scan__box input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: 400 16px var(--font-sans); color: var(--content-fg); }
    .scanbtn { flex: none; display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 10px; padding: 0 16px; background: var(--content-fg); color: #fff; font: 600 14px var(--font-sans); cursor: pointer; }
    .tw { overflow-x: auto; border: 1px solid var(--surface-border); border-radius: 12px; }
    .t { width: 100%; border-collapse: collapse; font: 400 14px var(--font-sans); }
    .t th { text-align: left; padding: 9px 10px; background: var(--surface-muted); color: var(--content-muted); font-weight: 600; white-space: nowrap; }
    .t td { padding: 8px 10px; border-top: 1px solid var(--surface-border); vertical-align: middle; }
    .t tfoot td { background: var(--surface-muted); }
    .n { text-align: right; white-space: nowrap; } .mono { font-family: var(--font-mono, monospace); font-weight: 600; white-space: nowrap; }
    .muted { color: var(--content-muted); } .addr { max-width: 220px; } .empty { text-align: center; color: var(--content-muted); padding: 18px; }
    .fwd { display: flex; align-items: center; border: 1px solid var(--surface-border); border-radius: 8px; min-width: 170px; }
    .fwd--miss { border-color: var(--danger); }
    .fwd input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; padding: 7px 8px; font: 400 14px var(--font-sans); color: var(--content-fg); }
    .fwd button, .rm { border: 0; background: none; cursor: pointer; color: var(--content-muted); display: grid; padding: 4px; }
    .fwd mat-icon, .rm mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .err { margin: 0; color: var(--danger); font: 500 14px var(--font-sans); }
    .acts { display: flex; justify-content: flex-end; align-items: center; gap: 16px; margin-top: 4px; }
    .txt { border: 0; background: none; font: 600 15px var(--font-sans); color: var(--content-muted); cursor: pointer; }
    .cam { position: fixed; inset: 0; z-index: 1010; background: rgb(15 16 32 / 92%); display: grid; place-items: center; padding: 16px; }
    .cam__box { width: min(420px, 100%); background: #0f1020; border-radius: 20px; overflow: hidden; color: #fff; }
    .cam__top { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: var(--occpl-gradient-brand, #b3123a); }
    .x { border: 0; background: none; color: #fff; font-size: 22px; cursor: pointer; }
    .cam__view { position: relative; aspect-ratio: 3 / 4; background: #000; } .cam__view video { width: 100%; height: 100%; object-fit: cover; }
    .cam__frame { position: absolute; left: 10%; right: 10%; top: 32%; height: 34%; border: 3px solid #fff; border-radius: 18px; box-shadow: 0 0 0 999px rgb(0 0 0 / 35%); }
    .cam__msg { margin: 0; padding: 12px 16px; text-align: center; color: #d5d7ea; }
    @media (max-width: 600px) { .g2 { grid-template-columns: 1fr; } .opt { padding: 10px; gap: 8px; } .opt small { display: none; } .dlg { padding: 18px 16px; } .scanbtn { padding: 0 12px; } }
  `]
})
export class OutscanAssignDialog implements OnInit {
  /** Parcels pending outscan at this branch: only these can be assigned. */
  readonly pending = input.required<Shipment[]>();
  /** Ticked in the list: they start in the table. */
  readonly preselected = input<string[]>([]);
  readonly branchId0 = input<string | null>(null, { alias: 'defaultBranchId' });
  readonly branches = input<Opt[]>([]);
  readonly hubIds = input<string[]>([]);
  readonly coLoaders = input<Opt[]>([]);
  readonly vehicles = input<Opt[]>([]);
  readonly users = input<Opt[]>([]);
  readonly myBranchId = input.required<string>();
  readonly done = output<string>();
  readonly closed = output<void>();

  private readonly manifests = inject(ManifestService);
  private readonly movement = inject(ShipmentMovementService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly create = signal<AssignCreate>('manifest');
  protected readonly withFwd = signal(false);
  protected readonly branchId = signal('');
  protected readonly coLoaderId = signal('');
  protected readonly vehicleId = signal('');
  protected readonly driverId = signal('');
  protected readonly deliveryBy = signal('');
  protected readonly bags = signal('');
  protected readonly awbText = signal('');
  protected readonly awbError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  private readonly pickedIds = signal<string[]>([]);
  /** shipment id → the co-loader's number for it ("With Forwarder No."). */
  private readonly fwd = signal<Record<string, string>>({});

  protected readonly picked = computed(() => {
    const byId = new Map(this.pending().map((s) => [s.id, s]));
    return this.pickedIds().map((id) => byId.get(id)).filter((s): s is Shipment => !!s);
  });
  protected readonly showFwd = computed(() => this.create() === 'manifest' && this.withFwd());
  protected readonly totalQty = computed(() => this.picked().reduce((a, s) => a + (s.numberOfPackages ?? 1), 0));
  protected readonly totalWt = computed(() => this.picked().reduce((a, s) => a + Number(s.actualWeight ?? s.chargeableWeight ?? 0), 0));
  protected readonly fwdDone = computed(() => this.picked().filter((s) => this.fwdOf(s.id)).length);
  protected readonly canAssign = computed(() => !!this.picked().length && (!this.showFwd() || this.fwdDone() === this.picked().length));

  protected readonly camera = signal(false);
  /** null: the camera reads AWBs; a shipment id: it reads that row's forwarder number. */
  protected readonly camFor = signal<string | null>(null);
  protected readonly cameraMsg = signal('');
  private stream: MediaStream | null = null;
  private stopScan = false;

  ngOnInit(): void {
    this.pickedIds.set(this.preselected().filter((id) => this.pending().some((s) => s.id === id)));
    if (this.branchId0()) this.branchId.set(this.branchId0()!);
    this.destroyRef.onDestroy(() => this.closeCamera());
    setTimeout(() => document.getElementById('as-awb')?.focus());
  }

  protected setCreate(c: AssignCreate): void { this.create.set(c); this.vehicleId.set(''); this.error.set(null); }
  protected digits(e: Event): string { const el = e.target as HTMLInputElement; el.value = el.value.replace(/\D/g, '').slice(0, 4); return el.value; }
  protected remove(id: string): void { this.pickedIds.update((l) => l.filter((x) => x !== id)); }
  protected fwdOf(id: string): string { return (this.fwd()[id] ?? '').trim(); }
  protected setFwd(id: string, v: string): void { this.fwd.update((m) => ({ ...m, [id]: v.slice(0, 60) })); }
  protected nextFwd(i: number): void {
    const next = document.getElementById('as-fwd-' + (i + 1)) as HTMLInputElement | null;
    (next ?? document.getElementById('as-awb'))?.focus();
  }

  /** One typed / scanned AWB (shipment or tracking number): added if it is pending outscan here. */
  addAwb(raw: string): boolean {
    const v = raw.trim().toUpperCase();
    if (!v) return false;
    const hit = this.pending().find((s) => s.shipmentNumber?.toUpperCase() === v || s.trackingNumber?.toUpperCase() === v);
    if (!hit) { this.awbError.set(`AWB ${v} is not pending outscan at this branch.`); return false; }
    if (this.pickedIds().includes(hit.id)) { this.awbError.set(`AWB ${v} is already added.`); return false; }
    this.pickedIds.update((l) => [...l, hit.id]);
    this.awbError.set(null);
    return true;
  }
  protected addTyped(): void {
    this.awbText().split(/[\s,;]+/).filter(Boolean).forEach((p) => this.addAwb(p));
    this.awbText.set('');
  }
  protected onPaste(e: ClipboardEvent): void {
    const text = e.clipboardData?.getData('text') ?? '';
    if (/[\s,;]/.test(text.trim())) { e.preventDefault(); text.split(/[\s,;]+/).filter(Boolean).forEach((p) => this.addAwb(p)); }
  }

  protected cancel(): void { this.closeCamera(); this.closed.emit(); }

  // ---- camera scan (the browser's barcode reader): AWBs, or one row's forwarder number (barcode or QR)
  protected openCamera(forRow: string | null): void {
    this.camFor.set(forRow);
    this.camera.set(true);
    this.stopScan = false;
    const Detector = (window as unknown as { BarcodeDetector?: new (o: unknown) => { detect(v: unknown): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      this.cameraMsg.set('This browser cannot read barcodes with the camera. Use Chrome or Edge, a barcode gun, or type it.');
      return;
    }
    this.cameraMsg.set('Starting the camera…');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then((s) => {
      this.stream = s;
      const video = document.getElementById('as-video') as HTMLVideoElement | null;
      if (!video) return;
      video.srcObject = s;
      return video.play().then(() => {
        const det = new Detector({ formats: ['code_128', 'code_39', 'qr_code', 'ean_13', 'codabar', 'itf', 'data_matrix'] });
        this.cameraMsg.set(forRow ? 'Point the camera at the forwarder barcode or QR.' : 'Point the camera at the AWB barcode. Each one read is added.');
        let last = '';
        const loop = () => {
          if (this.stopScan) return;
          det.detect(video).then((codes) => {
            const v = codes[0]?.rawValue?.trim();
            if (v && v !== last) {
              last = v;
              if (forRow) { this.setFwd(forRow, v); this.closeCamera(); return; }
              this.cameraMsg.set(this.addAwb(v) ? `✓ Added ${v}` : (this.awbError() ?? ''));
            }
            setTimeout(loop, 300);
          }).catch(() => setTimeout(loop, 500));
        };
        loop();
      });
    }).catch((e: DOMException) => this.cameraMsg.set(e?.name === 'NotAllowedError'
      ? 'Camera permission was refused. Allow the camera for this site, or type it.' : 'Could not start the camera.'));
  }
  protected closeCamera(): void {
    this.stopScan = true;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.camera.set(false);
  }

  // ---- assign
  protected assign(): void {
    this.addTyped();
    const rows = this.picked();
    if (!rows.length) { this.error.set('Add at least one AWB.'); return; }
    this.error.set(null);
    const ids = rows.map((s) => s.id);
    if (this.create() === 'manifest') {
      const dest = this.branchId();
      if (!dest) { this.error.set('Select the branch.'); return; }
      if (!!this.vehicleId() !== !!this.driverId()) { this.error.set('Give both the vehicle and the driver, or neither.'); return; }
      let forwarderNumbers: Record<string, string> | null = null;
      if (this.withFwd()) {
        const missing = rows.filter((s) => !this.fwdOf(s.id));
        if (missing.length) { this.error.set(`Enter the forwarder number for ${missing.map((s) => s.shipmentNumber).join(', ')}.`); return; }
        forwarderNumbers = Object.fromEntries(rows.map((s) => [s.id, this.fwdOf(s.id)]));
      }
      const bags = this.bags() ? Number(this.bags()) : null;
      this.busy.set(true);
      let sheet: Manifest | null = null;
      this.manifests.create({ bookingBranchId: this.myBranchId(), deliveryBranchId: dest, deliveryMode: 'BRANCH_DELIVERY', destinationCity: null,
        shipmentIds: ids, remarks: null, hubTransfer: this.hubIds().includes(dest) }).pipe(
        // A draft (Created): trip details and forwarder numbers are saved on it; it leaves only on Dispatch (Manifest tab).
        switchMap((m) => { sheet = m; return this.manifests.updateDraft(m.id, { coLoaderId: this.coLoaderId() || null,
          vehicleId: this.vehicleId() || null, driverUserId: this.driverId() || null, bagsCount: bags }); }),
        switchMap((m) => forwarderNumbers ? this.manifests.setForwarderNumbers(m.id, forwarderNumbers).pipe(map(() => m)) : of(m))
      ).subscribe({
        next: (m) => { this.busy.set(false);
          this.done.emit(`Manifest ${m.manifestNumber} saved with ${rows.length} AWB(s) to ${this.label(this.branches(), dest)}. Dispatch it from the Manifest tab.`); },
        error: (e: HttpErrorResponse) => {
          this.busy.set(false);
          const made = sheet as Manifest | null;
          this.error.set(made ? `Manifest ${made.manifestNumber} was created but its details were not saved: ${e.error?.message ?? 'refused'} — open it from the Manifest tab.`
            : e.error?.message ?? 'Could not save the manifest.');
        }
      });
      return;
    }
    const who = this.deliveryBy();
    if (!who) { this.error.set('Select the delivery boy or co-loader.'); return; }
    this.busy.set(true);
    this.movement.outForDelivery({ shipmentIds: ids, deliveryUserId: who.startsWith('u:') ? who.slice(2) : null,
      coLoaderId: who.startsWith('c:') ? who.slice(2) : null, vehicleId: this.vehicleId() || null }).subscribe({
      next: (r) => {
        this.busy.set(false);
        const bad = r.results.filter((x) => !x.success);
        if (bad.length) this.error.set(`${bad.length} not assigned — ${bad.map((x) => `${x.reference}: ${x.message ?? 'failed'}`).join('; ')}`);
        if (r.successCount) this.done.emit(`${r.successCount} AWB(s) out for delivery${r.drsNumber ? ' — DRS ' + r.drsNumber : ''}.`);
      },
      error: (e: HttpErrorResponse) => { this.busy.set(false); this.error.set(e.error?.message ?? 'Could not create the DRS.'); }
    });
  }

  private label(opts: Opt[], id: string): string { return opts.find((o) => o.value === id)?.label ?? 'the branch'; }
}
