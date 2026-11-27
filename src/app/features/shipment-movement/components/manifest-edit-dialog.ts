import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { map, of, switchMap } from 'rxjs';
import { Manifest, Shipment } from '@core/models/shipment.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { startBarcodeCamera } from '@shared/utils/barcode-camera.util';
import { ManifestService } from '@features/manifest/manifest.service';
import { ShipmentMovementService } from '../shipment-movement.service';

export interface Opt { value: string; label: string; }

/**
 * Edit a draft (Created) manifest from Scan → Manifest tab, then Dispatch it: trip details (co-loader, own vehicle and
 * driver, bags), With / Without Forwarder No., scan more Pending Outscan AWBs in, remove AWBs (back to Pending Outscan),
 * a forwarder number per AWB (typed or scanned), and Qty / Wt through the normal Edit Shipment page (freight is
 * recalculated there; the AWB comes back onto this manifest when it is saved).
 */
@Component({
  selector: 'app-manifest-edit-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule, UiButton],
  template: `
    <div class="ovl" (keydown.escape)="close()">
      <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="me-title">
        @if (!confirming()) {
          <h2 id="me-title" class="dlg__t">Edit Manifest {{ manifest().manifestNumber }} <span class="st">Created</span></h2>
          <div class="g5">
            <div class="f"><span class="f__l">Branch</span><div class="in in--ro"><mat-icon>lock</mat-icon>{{ toLabel() }}</div></div>
            <label class="f"><span class="f__l">Co-Loader</span><select class="in" id="me-cl" [value]="coLoaderId()" (change)="coLoaderId.set($any($event.target).value)">
              <option value="">None</option>@for (o of coLoaders(); track o.value) { <option [value]="o.value" [selected]="o.value === coLoaderId()">{{ o.label }}</option> }</select></label>
            <label class="f"><span class="f__l">Vehicle</span><select class="in" [value]="vehicleId()" (change)="vehicleId.set($any($event.target).value)">
              <option value="">None</option>@for (o of vehicles(); track o.value) { <option [value]="o.value" [selected]="o.value === vehicleId()">{{ o.label }}</option> }</select></label>
            <label class="f"><span class="f__l">Driver</span><select class="in" [value]="driverId()" (change)="driverId.set($any($event.target).value)">
              <option value="">None</option>@for (o of users(); track o.value) { <option [value]="o.value" [selected]="o.value === driverId()">{{ o.label }}</option> }</select></label>
            <label class="f"><span class="f__l">Bags</span><input class="in" id="me-bags" inputmode="numeric" maxlength="4" [value]="bags()" (input)="bags.set(digits($event))" /></label>
          </div>
          <div class="seg" role="radiogroup" aria-label="Forwarder number">
            <button type="button" role="radio" class="opt" id="me-fwd-no" [class.opt--on]="!withFwd()" [attr.aria-checked]="!withFwd()" (click)="withFwd.set(false)"><span class="dot"></span><b>Without Forwarder No.</b></button>
            <button type="button" role="radio" class="opt" id="me-fwd-yes" [class.opt--on]="withFwd()" [attr.aria-checked]="withFwd()" (click)="withFwd.set(true)"><span class="dot"></span><b>With Forwarder No.</b></button>
          </div>
          <div class="scan">
            <div class="scan__box"><mat-icon>qr_code_scanner</mat-icon>
              <input id="me-awb" [value]="awbText()" (input)="awbText.set($any($event.target).value)" (keydown.enter)="addTyped(); $event.preventDefault()"
                     placeholder="Scan or type AWB to add to this manifest" autocomplete="off" /></div>
            <button type="button" class="scanbtn" (click)="openCamera(null)"><mat-icon>photo_camera</mat-icon>SCAN</button>
          </div>
          @if (awbError()) { <p class="err" role="alert">{{ awbError() }}</p> }
          <div class="tw"><table class="t">
            <thead><tr><th>#</th><th>AWB</th><th>Receiver</th><th>To</th><th class="n">Qty</th><th class="n">Actual wt</th>
              @if (withFwd()) { <th>Forwarder No. <b class="req">*</b></th> }<th></th></tr></thead>
            <tbody>
              @for (s of rows(); track s.id; let i = $index) {
                <tr><td class="muted">{{ i + 1 }}</td><td class="mono">{{ s.shipmentNumber }}</td><td>{{ s.receiverName }}</td><td>{{ s.toCity || '—' }}</td>
                  <td class="n">{{ s.numberOfPackages ?? 1 }}</td><td class="n">{{ s.actualWeight ?? s.chargeableWeight | number: '1.0-2' }} kg</td>
                  @if (withFwd()) {
                    <td><div class="fwd" [class.fwd--miss]="!fwdOf(s.id)">
                      <input [id]="'me-fwd-' + i" maxlength="60" [value]="fwdOf(s.id)" (input)="setFwd(s.id, $any($event.target).value)" placeholder="Enter or scan"
                             [attr.aria-label]="'Forwarder number for ' + s.shipmentNumber" />
                      <button type="button" (click)="openCamera(s.id)" [attr.aria-label]="'Scan forwarder number for ' + s.shipmentNumber"><mat-icon>qr_code_scanner</mat-icon></button></div></td>
                  }
                  <td class="acts-c"><button type="button" class="pill" (click)="editLoad(s)" [disabled]="busy()"><mat-icon>edit</mat-icon>Qty / Wt</button>
                    <button type="button" class="pill pill--rm" (click)="remove(s)" [disabled]="busy()"><mat-icon>close</mat-icon>Remove</button></td></tr>
              } @empty { <tr><td [attr.colspan]="withFwd() ? 8 : 7" class="empty">No AWB on this manifest — scan one above, or delete the manifest.</td></tr> }
            </tbody>
            @if (rows().length) {
              <tfoot><tr><td></td><td colspan="3"><b>Total {{ rows().length }} AWB</b></td><td class="n"><b>{{ totalQty() }}</b></td>
                <td class="n"><b>{{ totalWt() | number: '1.0-2' }} kg</b></td>@if (withFwd()) { <td class="muted">{{ fwdDone() }} of {{ rows().length }} entered</td> }<td></td></tr></tfoot>
            }
          </table></div>
          @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
          <div class="acts"><button type="button" class="txt" (click)="close()">CLOSE</button>
            <button type="button" class="pill pill--save" id="me-save" (click)="save()" [disabled]="busy()">SAVE CHANGES</button>
            <app-button icon="local_shipping" [loading]="busy()" [disabled]="!canDispatch()" (pressed)="askDispatch()">DISPATCH</app-button></div>
        } @else {
          <h2 id="me-title" class="dlg__t">Dispatch {{ manifest().manifestNumber }}?</h2>
          <p class="sum">To <b>{{ toLabel() }}</b> · Co-loader <b>{{ label(coLoaders(), coLoaderId()) || 'None' }}</b>
            @if (vehicleId() || driverId()) { · {{ label(vehicles(), vehicleId()) || '—' }} / {{ label(users(), driverId()) || '—' }} }
            · {{ rows().length }} AWB · {{ totalQty() }} pcs · {{ totalWt() | number: '1.0-2' }} kg · {{ bags() || 0 }} bag(s)</p>
          <p class="muted">The AWBs move to Outscan and show in the branch's Pending Inscan. The manifest is locked after this.</p>
          @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
          <div class="acts"><button type="button" class="txt" (click)="confirming.set(false)">CANCEL</button>
            <app-button icon="local_shipping" [loading]="busy()" (pressed)="dispatch()">DISPATCH</app-button></div>
        }
      </div>
      @if (camera()) {
        <div class="cam" role="dialog" aria-modal="true" aria-label="Scan">
          <div class="cam__box"><div class="cam__top"><b>{{ camFor() ? 'Scan Forwarder No.' : 'Scan AWB' }}</b><button type="button" class="x" (click)="closeCamera()" aria-label="Close">✕</button></div>
            <div class="cam__view"><video id="me-video" playsinline muted></video><div class="cam__frame"></div></div>
            <p class="cam__msg">{{ cameraMsg() }}</p></div>
        </div>
      }
    </div>
  `,
  styles: [`
    .ovl { position: fixed; inset: 0; z-index: 1000; background: rgb(15 16 32 / 55%); display: grid; place-items: center; padding: 16px; }
    .dlg { width: min(1000px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; overflow-x: hidden; background: var(--surface); border-radius: 18px;
      padding: 22px 24px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 30px 60px rgb(0 0 0 / 30%); }
    .dlg__t { margin: 0 0 4px; font: 600 22px var(--font-sans); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .st { padding: 3px 10px; border-radius: 999px; background: #fff7e6; color: #b45309; font: 600 13px var(--font-sans); }
    .f { display: flex; flex-direction: column; gap: 6px; min-width: 0; } .f__l { font: 500 14px var(--font-sans); color: var(--content-muted); } .req { color: var(--danger); }
    .in { height: 44px; padding: 0 12px; border: 1px solid var(--surface-border); border-radius: var(--r-field); background: var(--surface); color: var(--content-fg); font: 400 15px var(--font-sans); min-width: 0; }
    .in--ro { display: flex; align-items: center; gap: 6px; background: var(--surface-muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .in--ro mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--content-muted); }
    .g5 { display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr .6fr; gap: 12px; }
    .seg { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; max-width: 560px; }
    .opt { display: flex; align-items: center; gap: 10px; border: 1.5px solid var(--surface-border); background: var(--surface); color: var(--content-fg); border-radius: 12px; padding: 9px 12px; font: 400 15px var(--font-sans); cursor: pointer; }
    .dot { flex: none; width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--surface-border); }
    .opt--on { background: var(--brand-50); border-color: var(--brand-600); color: var(--brand-700); } .opt--on .dot { border-color: var(--brand-600); box-shadow: inset 0 0 0 4px var(--brand-50); background: var(--brand-600); }
    .scan { display: flex; gap: 10px; min-width: 0; }
    .scan__box { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 46px; border: 2px solid var(--brand-600); border-radius: var(--r-field); }
    .scan__box mat-icon { color: var(--brand-600); } .scan__box input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: 400 16px var(--font-sans); color: var(--content-fg); }
    .scanbtn { flex: none; display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 10px; padding: 0 16px; background: var(--content-fg); color: #fff; font: 600 14px var(--font-sans); cursor: pointer; }
    .tw { overflow-x: auto; border: 1px solid var(--surface-border); border-radius: 12px; }
    .t { width: 100%; border-collapse: collapse; font: 400 14px var(--font-sans); }
    .t th { text-align: left; padding: 9px 10px; background: var(--surface-muted); color: var(--content-muted); font-weight: 600; white-space: nowrap; }
    .t td { padding: 7px 10px; border-top: 1px solid var(--surface-border); vertical-align: middle; } .t tfoot td { background: var(--surface-muted); }
    .n { text-align: right; white-space: nowrap; } .mono { font-family: var(--font-mono, monospace); font-weight: 600; white-space: nowrap; }
    .muted { color: var(--content-muted); } .empty { text-align: center; color: var(--content-muted); padding: 18px; }
    .fwd { display: flex; align-items: center; border: 1px solid var(--surface-border); border-radius: 8px; min-width: 160px; } .fwd--miss { border-color: var(--danger); }
    .fwd input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; padding: 7px 8px; font: 400 14px var(--font-sans); color: var(--content-fg); }
    .fwd button { border: 0; background: none; cursor: pointer; color: var(--content-muted); display: grid; padding: 4px; } .fwd mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .acts-c { white-space: nowrap; text-align: right; }
    .pill { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--surface-border); background: var(--surface); color: var(--content-fg); border-radius: 999px; padding: 5px 11px; font: 600 13px var(--font-sans); cursor: pointer; }
    .pill mat-icon { font-size: 16px; width: 16px; height: 16px; } .pill--rm { color: var(--danger); } .pill--save { color: var(--brand-700); border-color: var(--brand-600); padding: 9px 16px; border-radius: 10px; }
    .err { margin: 0; color: var(--danger); font: 500 14px var(--font-sans); } .sum { margin: 0; font: 400 15px/1.6 var(--font-sans); }
    .acts { display: flex; justify-content: flex-end; align-items: center; gap: 14px; margin-top: 4px; flex-wrap: wrap; }
    .txt { border: 0; background: none; font: 600 15px var(--font-sans); color: var(--content-muted); cursor: pointer; }
    .cam { position: fixed; inset: 0; z-index: 1010; background: rgb(15 16 32 / 92%); display: grid; place-items: center; padding: 16px; }
    .cam__box { width: min(420px, 100%); background: #0f1020; border-radius: 20px; overflow: hidden; color: #fff; }
    .cam__top { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: var(--occpl-gradient-brand, #b3123a); }
    .x { border: 0; background: none; color: #fff; font-size: 22px; cursor: pointer; }
    .cam__view { position: relative; aspect-ratio: 3 / 4; background: #000; } .cam__view video { width: 100%; height: 100%; object-fit: cover; }
    .cam__frame { position: absolute; left: 10%; right: 10%; top: 32%; height: 34%; border: 3px solid #fff; border-radius: 18px; box-shadow: 0 0 0 999px rgb(0 0 0 / 35%); }
    .cam__msg { margin: 0; padding: 12px 16px; text-align: center; color: #d5d7ea; }
    @media (max-width: 760px) { .g5 { grid-template-columns: 1fr 1fr; } .seg { grid-template-columns: 1fr 1fr; } .dlg { padding: 18px 16px; } }
  `]
})
export class ManifestEditDialog implements OnInit {
  readonly manifest = input.required<Manifest>();
  /** Parcels pending outscan at this branch: what can be scanned onto the manifest. */
  readonly pending = input<Shipment[]>([]);
  readonly branches = input<Opt[]>([]);
  readonly coLoaders = input<Opt[]>([]);
  readonly vehicles = input<Opt[]>([]);
  readonly users = input<Opt[]>([]);
  /** Open straight on the Dispatch confirmation (the row's Dispatch button). */
  readonly startDispatch = input(false);
  /** Something changed on the server (AWB added / removed, dispatched): the list should reload. Text = a message to show. */
  readonly changed = output<string | null>();
  readonly closed = output<void>();

  private readonly manifests = inject(ManifestService);
  private readonly movement = inject(ShipmentMovementService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly rows = signal<Shipment[]>([]);
  protected readonly coLoaderId = signal('');
  protected readonly vehicleId = signal('');
  protected readonly driverId = signal('');
  protected readonly bags = signal('');
  protected readonly withFwd = signal(false);
  private readonly fwd = signal<Record<string, string>>({});
  protected readonly awbText = signal('');
  protected readonly awbError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly confirming = signal(false);

  protected readonly totalQty = computed(() => this.rows().reduce((a, s) => a + (s.numberOfPackages ?? 1), 0));
  protected readonly totalWt = computed(() => this.rows().reduce((a, s) => a + Number(s.actualWeight ?? s.chargeableWeight ?? 0), 0));
  protected readonly fwdDone = computed(() => this.rows().filter((s) => this.fwdOf(s.id)).length);
  protected readonly canDispatch = computed(() => !!this.rows().length && (!this.withFwd() || this.fwdDone() === this.rows().length));
  protected readonly toLabel = computed(() => this.label(this.branches(), this.manifest().deliveryBranchId ?? '') || 'Direct delivery');

  protected readonly camera = signal(false);
  protected readonly camFor = signal<string | null>(null);
  protected readonly cameraMsg = signal('');
  private stopCamera: (() => void) | null = null;

  ngOnInit(): void {
    const m = this.manifest();
    this.coLoaderId.set(m.coLoaderId ?? '');
    this.vehicleId.set(m.vehicleId ?? '');
    this.driverId.set(m.driverUserId ?? '');
    this.bags.set(m.bagsCount != null ? String(m.bagsCount) : '');
    this.destroyRef.onDestroy(() => this.closeCamera());
    this.load(true);
  }

  private load(first = false): void {
    this.manifests.shipments(this.manifest().id).subscribe({
      next: (rows) => {
        this.rows.set(rows);
        // Keep what was typed here; fill the rest from what is saved.
        this.fwd.update((cur) => Object.fromEntries(rows.map((s) => [s.id, cur[s.id] ?? s.forwarderNumber ?? ''])));
        if (first) {
          this.withFwd.set(rows.some((s) => !!s.forwarderNumber));
          if (this.startDispatch()) this.askDispatch();
        }
      },
      error: (e: HttpErrorResponse) => this.error.set(e.error?.message ?? 'Could not load this manifest.')
    });
  }

  protected label(opts: Opt[], id: string | null | undefined): string { return id ? (opts.find((o) => o.value === id)?.label ?? '') : ''; }
  protected digits(e: Event): string { const el = e.target as HTMLInputElement; el.value = el.value.replace(/\D/g, '').slice(0, 4); return el.value; }
  protected fwdOf(id: string): string { return (this.fwd()[id] ?? '').trim(); }
  protected setFwd(id: string, v: string): void { this.fwd.update((m) => ({ ...m, [id]: v.slice(0, 60) })); }
  protected close(): void { this.closeCamera(); this.closed.emit(); }

  /** Adds Pending Outscan AWBs onto the manifest right away. */
  addAwb(raw: string): void {
    const v = raw.trim().toUpperCase();
    if (!v) return;
    if (this.rows().some((s) => s.shipmentNumber?.toUpperCase() === v || s.trackingNumber?.toUpperCase() === v)) {
      this.awbError.set(`AWB ${v} is already on this manifest.`); return;
    }
    const hit = this.pending().find((s) => s.shipmentNumber?.toUpperCase() === v || s.trackingNumber?.toUpperCase() === v);
    if (!hit) { this.awbError.set(`AWB ${v} is not pending outscan at this branch.`); return; }
    this.awbError.set(null);
    this.busy.set(true);
    this.manifests.addShipments(this.manifest().id, [hit.id]).subscribe({
      next: () => { this.busy.set(false); this.load(); this.changed.emit(null); },
      error: (e: HttpErrorResponse) => { this.busy.set(false); this.awbError.set(e.error?.message ?? `Could not add ${v}.`); }
    });
  }
  protected addTyped(): void {
    this.awbText().split(/[\s,;]+/).filter(Boolean).forEach((p) => this.addAwb(p));
    this.awbText.set('');
  }

  /** Off the manifest: back to Pending Outscan. */
  protected remove(s: Shipment): void {
    this.busy.set(true);
    this.manifests.removeShipment(this.manifest().id, s.id).subscribe({
      next: () => { this.busy.set(false); this.load(); this.changed.emit(null); },
      error: (e: HttpErrorResponse) => { this.busy.set(false); this.error.set(e.error?.message ?? 'Could not remove it.'); }
    });
  }

  /** Qty / weight change freight, so it goes through Edit Shipment: off the draft, edited, then back onto it on save. */
  protected editLoad(s: Shipment): void {
    this.busy.set(true);
    this.save$().pipe(switchMap(() => this.manifests.removeShipment(this.manifest().id, s.id))).subscribe({
      next: () => { this.busy.set(false); this.router.navigate(['/shipments', s.id, 'edit'], { queryParams: { manifest: this.manifest().id } }); },
      error: (e: HttpErrorResponse) => { this.busy.set(false); this.error.set(e.error?.message ?? 'Could not open it for editing.'); }
    });
  }

  private save$() {
    const m = this.manifest();
    const numbers = Object.fromEntries(this.rows().map((s) => [s.id, this.withFwd() ? this.fwdOf(s.id) : '']));
    return this.manifests.updateDraft(m.id, { coLoaderId: this.coLoaderId() || null, vehicleId: this.vehicleId() || null,
      driverUserId: this.driverId() || null, bagsCount: this.bags() ? Number(this.bags()) : null }).pipe(
      switchMap(() => this.rows().length ? this.manifests.setForwarderNumbers(m.id, numbers) : of(undefined)), map(() => undefined));
  }
  protected save(): void {
    if (!!this.vehicleId() !== !!this.driverId()) { this.error.set('Give both the vehicle and the driver, or neither.'); return; }
    this.busy.set(true);
    this.error.set(null);
    this.save$().subscribe({
      next: () => { this.busy.set(false); this.changed.emit(`Manifest ${this.manifest().manifestNumber} saved.`); this.closed.emit(); },
      error: (e: HttpErrorResponse) => { this.busy.set(false); this.error.set(e.error?.message ?? 'Could not save.'); }
    });
  }

  protected askDispatch(): void {
    if (!this.rows().length) { this.error.set('Add at least one AWB before dispatching.'); return; }
    if (this.withFwd() && this.fwdDone() !== this.rows().length) { this.error.set('Enter the forwarder number for every AWB first.'); return; }
    if (!!this.vehicleId() !== !!this.driverId()) { this.error.set('Give both the vehicle and the driver, or neither.'); return; }
    this.error.set(null);
    this.confirming.set(true);
  }
  protected dispatch(): void {
    const m = this.manifest();
    this.busy.set(true);
    this.error.set(null);
    this.save$().pipe(switchMap(() => this.movement.dispatch({ manifestId: m.id, vehicleId: this.vehicleId() || null, driverUserId: this.driverId() || null,
      coLoaderId: this.coLoaderId() || null, forwardingNumber: m.forwardingNumber ?? null, bagsCount: this.bags() ? Number(this.bags()) : null,
      departureTime: null, fuelCost: null, driverAdvance: null, tollAmount: null, otherAmount: null }))).subscribe({
      next: (r) => { this.busy.set(false); this.changed.emit(`Manifest ${r.manifestNumber} dispatched to ${this.toLabel()} — ${this.rows().length} AWB(s) outscanned.`); this.closed.emit(); },
      error: (e: HttpErrorResponse) => { this.busy.set(false); this.error.set(e.error?.message ?? 'Could not dispatch.'); }
    });
  }

  // ---- camera: AWBs, or one row's forwarder number
  protected openCamera(forRow: string | null): void {
    this.camFor.set(forRow);
    this.camera.set(true);
    setTimeout(() => {
      const video = document.getElementById('me-video') as HTMLVideoElement | null;
      if (!video) return;
      this.stopCamera = startBarcodeCamera(video, (v) => {
        if (forRow) { this.setFwd(forRow, v); this.closeCamera(); } else { this.addAwb(v); this.cameraMsg.set(`Read ${v}`); }
      }, (t) => this.cameraMsg.set(t));
    });
  }
  protected closeCamera(): void { this.stopCamera?.(); this.stopCamera = null; this.camera.set(false); }
}
