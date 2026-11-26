import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { Manifest, Shipment } from '@core/models/shipment.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { ManifestService } from '@features/manifest/manifest.service';
import { ShipmentMovementService } from '../shipment-movement.service';

export interface Opt { value: string; label: string; }
export type AssignAction = 'branch' | 'delivery' | 'rto';

/**
 * "Assign Outscan Item", as on the earlier OCCPL portal's Scan → Pending Outscan → ASSIGN:
 * Action (Assign to Branch / Delivery / RTO), Branch or Delivery Boy, Co-Loader, SCAN AWB NUMBER (camera) and the AWB
 * chips (typed, scanned with a barcode gun, or ticked in the list), Forwarding Number, Bags Count.
 */
@Component({
  selector: 'app-outscan-assign-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, UiButton],
  template: `
    <div class="ovl" (keydown.escape)="cancel()">
      <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="as-title">
        <h2 id="as-title" class="dlg__t">Assign Outscan Item</h2>

        <label class="f"><span class="f__l">Action <b class="req">*</b></span>
          <select class="in" id="as-action" [value]="action()" (change)="setAction($any($event.target).value)">
            <option value="branch">Assign to Branch</option><option value="delivery">Assign to Delivery</option><option value="rto">Assign to RTO</option>
          </select></label>

        @switch (action()) {
          @case ('branch') {
            <label class="f"><span class="f__l">Branch <b class="req">*</b></span>
              <select class="in" id="as-branch" [value]="branchId()" (change)="branchId.set($any($event.target).value)">
                <option value="">Select branch or hub</option>@for (o of branches(); track o.value) { <option [value]="o.value">{{ o.label }}</option> }
              </select></label>
            <label class="f"><span class="f__l">Co-Loader</span>
              <select class="in" id="as-coloader" [value]="coLoaderId()" (change)="coLoaderId.set($any($event.target).value)">
                <option value="">None</option>@for (o of coLoaders(); track o.value) { <option [value]="o.value">{{ o.label }}</option> }
              </select></label>
            <details class="more"><summary>Own vehicle and driver (optional)</summary>
              <div class="g2">
                <label class="f"><span class="f__l">Vehicle</span><select class="in" [value]="vehicleId()" (change)="vehicleId.set($any($event.target).value)">
                  <option value="">None</option>@for (o of vehicles(); track o.value) { <option [value]="o.value">{{ o.label }}</option> }</select></label>
                <label class="f"><span class="f__l">Driver</span><select class="in" [value]="driverId()" (change)="driverId.set($any($event.target).value)">
                  <option value="">None</option>@for (o of users(); track o.value) { <option [value]="o.value">{{ o.label }}</option> }</select></label>
              </div></details>
          }
          @case ('delivery') {
            <label class="f"><span class="f__l">Delivery Boy <b class="req">*</b></span>
              <select class="in" id="as-boy" [value]="deliveryBy()" (change)="deliveryBy.set($any($event.target).value)">
                <option value="">Select delivery boy or co-loader</option>
                <optgroup label="Staff">@for (o of users(); track o.value) { <option [value]="'u:' + o.value">{{ o.label }}</option> }</optgroup>
                @if (coLoaders().length) { <optgroup label="Co-Loaders">@for (o of coLoaders(); track o.value) { <option [value]="'c:' + o.value">{{ o.label }}</option> }</optgroup> }
              </select></label>
            <div class="seg" role="radiogroup" aria-label="Create">
              <button type="button" class="pill" id="as-mk-drs" [class.pill--on]="make() === 'drs'" (click)="make.set('drs')">Create DRS</button>
              <button type="button" class="pill" id="as-mk-man" [class.pill--on]="make() === 'manifest'" (click)="make.set('manifest')">Create Manifest</button>
            </div>
          }
          @case ('rto') {
            <label class="f"><span class="f__l">Message <b class="req">*</b></span>
              <input class="in" id="as-msg" maxlength="300" [value]="message()" (input)="message.set($any($event.target).value)" placeholder="Why it goes back to the sender" /></label>
          }
        }

        <div><button type="button" class="scanbtn" (click)="openCamera()"><mat-icon>qr_code_scanner</mat-icon>SCAN AWB NUMBER</button></div>
        <label class="f"><span class="f__l">AWB Number <b class="req">*</b></span>
          <div class="chips" (click)="focusAwb()">
            @for (s of picked(); track s.id) { <span class="chip">{{ s.shipmentNumber }}<button type="button" (click)="remove(s.id); $event.stopPropagation()" [attr.aria-label]="'Remove ' + s.shipmentNumber"><mat-icon>cancel</mat-icon></button></span> }
            <input id="as-awb" class="chips__in" [value]="awbText()" (input)="awbText.set($any($event.target).value)" (keydown.enter)="addTyped(); $event.preventDefault()"
                   (keydown.tab)="addTyped()" (paste)="onPaste($event)" placeholder="Enter or scan AWB numbers" autocomplete="off" />
          </div></label>
        @if (awbError()) { <p class="err" role="alert">{{ awbError() }}</p> }

        @if (action() !== 'rto') {
          <div class="g2">
            <label class="f"><span class="f__l">Forwarding Number</span><input class="in" id="as-fwd" maxlength="60" [value]="forwardingNo()" (input)="forwardingNo.set($any($event.target).value)" /></label>
            <label class="f"><span class="f__l">Bags Count</span><input class="in" id="as-bags" inputmode="numeric" maxlength="4" [value]="bags()" (input)="bags.set(digits($event))" /></label>
          </div>
        }
        @if (error()) { <p class="err" role="alert">{{ error() }}</p> }

        <div class="acts"><button type="button" class="txt" (click)="cancel()">CANCEL</button>
          <app-button [loading]="busy()" (pressed)="assign()">ASSIGN</app-button></div>
      </div>

      @if (camera()) {
        <div class="cam" role="dialog" aria-modal="true" aria-label="Scan AWB">
          <div class="cam__box"><div class="cam__top"><b>Scan AWB</b><button type="button" class="x" (click)="closeCamera()" aria-label="Close">✕</button></div>
            <div class="cam__view"><video id="as-video" playsinline muted></video><div class="cam__frame"></div></div>
            <p class="cam__msg">{{ cameraMsg() }}</p></div>
        </div>
      }
    </div>
  `,
  styles: [`
    .ovl { position: fixed; inset: 0; z-index: 1000; background: rgb(15 16 32 / 55%); display: grid; place-items: center; padding: 16px; }
    .dlg { width: min(560px, 100%); max-height: calc(100vh - 32px); overflow: auto; background: var(--surface); border-radius: 18px; padding: 22px 24px;
      display: flex; flex-direction: column; gap: 12px; box-shadow: 0 30px 60px rgb(0 0 0 / 30%); }
    .dlg__t { margin: 0 0 4px; font: 600 22px var(--font-sans); }
    .f { display: flex; flex-direction: column; gap: 6px; } .f__l { font: 500 14px var(--font-sans); color: var(--content-muted); } .req { color: var(--danger); }
    .in { height: 46px; padding: 0 12px; border: 1px solid var(--surface-border); border-radius: var(--r-field); background: var(--surface); color: var(--content-fg); font: 400 16px var(--font-sans); }
    .g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .more summary { cursor: pointer; color: var(--content-muted); font: 500 14px var(--font-sans); margin-bottom: 8px; }
    .seg { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .pill { border: 1px solid var(--surface-border); background: var(--surface); color: var(--content-fg); border-radius: 10px; padding: 9px; font: 600 15px var(--font-sans); cursor: pointer; }
    .pill--on { background: var(--brand-50); border-color: var(--brand-600); color: var(--brand-700); }
    .scanbtn { display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 10px; padding: 10px 16px; background: var(--content-fg); color: #fff; font: 600 14px var(--font-sans); cursor: pointer; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-height: 50px; padding: 6px 8px; border: 2px solid var(--brand-600); border-radius: var(--r-field); cursor: text; }
    .chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 6px 4px 12px; border-radius: 999px; background: var(--surface-muted); font: 600 14px var(--font-sans); }
    .chip button { border: 0; background: none; padding: 0; cursor: pointer; color: var(--content-muted); display: grid; } .chip mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .chips__in { flex: 1; min-width: 180px; border: 0; outline: 0; background: transparent; font: 400 16px var(--font-sans); color: var(--content-fg); height: 34px; }
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
    @media (max-width: 560px) { .g2 { grid-template-columns: 1fr; } }
  `]
})
export class OutscanAssignDialog implements OnInit {
  /** Parcels pending outscan at this branch: only these can be assigned. */
  readonly pending = input.required<Shipment[]>();
  /** Ticked in the list: they start as chips. */
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

  protected readonly action = signal<AssignAction>('branch');
  protected readonly branchId = signal('');
  protected readonly coLoaderId = signal('');
  protected readonly vehicleId = signal('');
  protected readonly driverId = signal('');
  protected readonly deliveryBy = signal('');
  protected readonly make = signal<'drs' | 'manifest'>('drs');
  protected readonly message = signal('');
  protected readonly forwardingNo = signal('');
  protected readonly bags = signal('');
  protected readonly awbText = signal('');
  protected readonly awbError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  private readonly pickedIds = signal<string[]>([]);
  protected readonly picked = computed(() => {
    const byId = new Map(this.pending().map((s) => [s.id, s]));
    return this.pickedIds().map((id) => byId.get(id)).filter((s): s is Shipment => !!s);
  });

  protected readonly camera = signal(false);
  protected readonly cameraMsg = signal('');
  private stream: MediaStream | null = null;
  private stopScan = false;

  ngOnInit(): void {
    this.pickedIds.set(this.preselected().filter((id) => this.pending().some((s) => s.id === id)));
    if (this.branchId0()) this.branchId.set(this.branchId0()!);
    this.destroyRef.onDestroy(() => this.closeCamera());
    setTimeout(() => document.getElementById('as-awb')?.focus());
  }

  protected setAction(a: AssignAction): void { this.action.set(a); this.error.set(null); }
  protected focusAwb(): void { document.getElementById('as-awb')?.focus(); }
  protected digits(e: Event): string { const el = e.target as HTMLInputElement; el.value = el.value.replace(/\D/g, '').slice(0, 4); return el.value; }
  protected remove(id: string): void { this.pickedIds.update((l) => l.filter((x) => x !== id)); }

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
    const parts = this.awbText().split(/[\s,;]+/).filter(Boolean);
    parts.forEach((p) => this.addAwb(p));
    this.awbText.set('');
  }
  protected onPaste(e: ClipboardEvent): void {
    const text = e.clipboardData?.getData('text') ?? '';
    if (/[\s,;]/.test(text.trim())) { e.preventDefault(); text.split(/[\s,;]+/).filter(Boolean).forEach((p) => this.addAwb(p)); }
  }

  protected cancel(): void { this.closeCamera(); this.closed.emit(); }

  // ---- camera scan (the browser's barcode reader)
  protected openCamera(): void {
    this.camera.set(true);
    this.stopScan = false;
    const Detector = (window as unknown as { BarcodeDetector?: new (o: unknown) => { detect(v: unknown): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      this.cameraMsg.set('This browser cannot read barcodes with the camera. Use Chrome or Edge, or a barcode gun / typing in the AWB box.');
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
        this.cameraMsg.set('Point the camera at the AWB barcode. Each one read is added.');
        let last = '';
        const loop = () => {
          if (this.stopScan) return;
          det.detect(video).then((codes) => {
            const v = codes[0]?.rawValue?.trim();
            if (v && v !== last) { last = v; this.cameraMsg.set(this.addAwb(v) ? `✓ Added ${v}` : (this.awbError() ?? '')); }
            setTimeout(loop, 300);
          }).catch(() => setTimeout(loop, 500));
        };
        loop();
      });
    }).catch((e: DOMException) => this.cameraMsg.set(e?.name === 'NotAllowedError'
      ? 'Camera permission was refused. Allow the camera for this site, or type the AWB.' : 'Could not start the camera.'));
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
    const bags = this.bags() ? Number(this.bags()) : null;
    const fwd = this.forwardingNo().trim() || null;
    switch (this.action()) {
      case 'branch': {
        const dest = this.branchId();
        if (!dest) { this.error.set('Select the branch.'); return; }
        if (!!this.vehicleId() !== !!this.driverId()) { this.error.set('Give both the vehicle and the driver, or neither.'); return; }
        this.busy.set(true);
        let sheet: Manifest | null = null;
        this.manifests.create({ bookingBranchId: this.myBranchId(), deliveryBranchId: dest, deliveryMode: 'BRANCH_DELIVERY', destinationCity: null,
          shipmentIds: ids, remarks: null, hubTransfer: this.hubIds().includes(dest) }).pipe(
          switchMap((m) => { sheet = m; return this.movement.dispatch({ manifestId: m.id, vehicleId: this.vehicleId() || null, driverUserId: this.driverId() || null,
            coLoaderId: this.coLoaderId() || null, forwardingNumber: fwd, bagsCount: bags, departureTime: null, fuelCost: null, driverAdvance: null, tollAmount: null, otherAmount: null }); })
        ).subscribe({
          next: (r) => { this.busy.set(false); this.done.emit(`${rows.length} AWB(s) outscanned to ${this.label(this.branches(), dest)} — manifest ${r.manifestNumber}.`); },
          error: (e: HttpErrorResponse) => {
            this.busy.set(false);
            const made = sheet as Manifest | null;
            this.error.set(made ? `Manifest ${made.manifestNumber} was created but not dispatched: ${e.error?.message ?? 'refused'}`
              : e.error?.message ?? 'Could not outscan.');
          }
        });
        return;
      }
      case 'delivery': {
        const who = this.deliveryBy();
        if (!who) { this.error.set('Select the delivery boy or co-loader.'); return; }
        const userId = who.startsWith('u:') ? who.slice(2) : null;
        const coLoaderId = who.startsWith('c:') ? who.slice(2) : null;
        this.busy.set(true);
        if (this.make() === 'drs') {
          this.movement.outForDelivery({ shipmentIds: ids, deliveryUserId: userId, coLoaderId }).subscribe({
            next: (r) => {
              this.busy.set(false);
              const bad = r.results.filter((x) => !x.success);
              if (bad.length) this.error.set(`${bad.length} not assigned — ${bad.map((x) => `${x.reference}: ${x.message ?? 'failed'}`).join('; ')}`);
              if (r.successCount) this.done.emit(`${r.successCount} AWB(s) out for delivery${r.drsNumber ? ' — DRS ' + r.drsNumber : ''}.`);
            },
            error: (e: HttpErrorResponse) => { this.busy.set(false); this.error.set(e.error?.message ?? 'Could not create the DRS.'); }
          });
        } else {
          // Create Manifest: a direct-delivery loading sheet handed to the co-loader / delivery boy, dispatched at once.
          this.manifests.create({ bookingBranchId: this.myBranchId(), deliveryBranchId: null, deliveryMode: 'DIRECT_COMPANY_DELIVERY',
            destinationCity: rows[0].toCity ?? null, shipmentIds: ids, remarks: null }).pipe(
            switchMap((m) => this.movement.dispatch({ manifestId: m.id, vehicleId: null, driverUserId: userId, coLoaderId,
              forwardingNumber: fwd, bagsCount: bags, departureTime: null, fuelCost: null, driverAdvance: null, tollAmount: null, otherAmount: null }))
          ).subscribe({
            next: (r) => { this.busy.set(false); this.done.emit(`${rows.length} AWB(s) on delivery manifest ${r.manifestNumber}.`); },
            error: (e: HttpErrorResponse) => { this.busy.set(false); this.error.set(e.error?.message ?? 'Could not create the manifest.'); }
          });
        }
        return;
      }
      case 'rto': {
        const why = this.message().trim();
        if (!why) { this.error.set('Enter the message: why it goes back to the sender.'); return; }
        this.busy.set(true);
        forkJoin(rows.map((s) => this.movement.returnToSender(s.id, why).pipe(
          map(() => ({ ref: s.shipmentNumber, ok: true, msg: '' })),
          catchError((e: HttpErrorResponse) => of({ ref: s.shipmentNumber, ok: false, msg: e.error?.message ?? 'failed' })))))
          .subscribe((res) => {
            this.busy.set(false);
            const bad = res.filter((x) => !x.ok);
            if (bad.length) this.error.set(`${bad.length} not returned — ${bad.map((x) => `${x.ref}: ${x.msg}`).join('; ')}`);
            const ok = res.length - bad.length;
            if (ok) this.done.emit(`${ok} AWB(s) returned to the sender.`);
          });
        return;
      }
    }
  }

  private label(opts: Opt[], id: string): string { return opts.find((o) => o.value === id)?.label ?? 'the branch'; }
}
