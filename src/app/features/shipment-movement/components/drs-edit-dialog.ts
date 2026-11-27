import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { DrsDetail, DrsShipmentRow, DrsSummary, Shipment } from '@core/models/shipment.model';
import { startBarcodeCamera } from '@shared/utils/barcode-camera.util';
import { ShipmentMovementService } from '../shipment-movement.service';

/**
 * Edit a DRS from Scan → DRS: scan Pending Delivery parcels onto the same run (same DRS number, delivery boy, vehicle
 * and day), or take an undelivered parcel off it (back to Pending Delivery). Delivered parcels are locked.
 */
@Component({
  selector: 'app-drs-edit-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="ovl" (keydown.escape)="close()">
      <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="de-title">
        <h2 id="de-title" class="dlg__t">Edit {{ drs().drsNumber }} <small>{{ deliveryBy() }}</small></h2>
        <div class="scan">
          <div class="scan__box"><mat-icon>qr_code_scanner</mat-icon>
            <input id="de-awb" [value]="awbText()" (input)="awbText.set($any($event.target).value)" (keydown.enter)="addTyped(); $event.preventDefault()"
                   placeholder="Scan or type AWB from Pending Delivery to add to this run" autocomplete="off" /></div>
          <button type="button" class="scanbtn" (click)="openCamera()"><mat-icon>photo_camera</mat-icon>SCAN</button>
        </div>
        @if (msg()) { <p class="err" role="alert">{{ msg() }}</p> }
        <div class="tw"><table class="t">
          <thead><tr><th>#</th><th>AWB</th><th>Receiver</th><th>Address</th><th>Status</th><th></th></tr></thead>
          <tbody>
            @for (s of rows(); track s.shipmentId; let i = $index) {
              <tr><td class="muted">{{ i + 1 }}</td><td class="mono">{{ s.shipmentNumber }}</td><td>{{ s.receiverName }}</td><td class="addr">{{ s.receiverAddress }}</td>
                <td><span class="st" [class.st--ok]="s.status === 'DELIVERED'">{{ s.status === 'DELIVERED' ? 'Delivered' : 'Out for delivery' }}</span></td>
                <td class="r">@if (s.status === 'DELIVERED') { <span class="muted">locked</span> }
                  @else { <button type="button" class="pill pill--rm" [disabled]="busy()" (click)="remove(s)" [attr.aria-label]="'Remove ' + s.shipmentNumber"><mat-icon>close</mat-icon>Remove</button> }</td></tr>
            } @empty { <tr><td colspan="6" class="empty">No parcels on this run.</td></tr> }
          </tbody>
        </table></div>
        <div class="acts"><button type="button" class="done" (click)="close()">DONE</button></div>
      </div>
      @if (camera()) {
        <div class="cam" role="dialog" aria-modal="true" aria-label="Scan AWB">
          <div class="cam__box"><div class="cam__top"><b>Scan AWB</b><button type="button" class="x" (click)="closeCamera()" aria-label="Close">✕</button></div>
            <div class="cam__view"><video id="de-video" playsinline muted></video></div><p class="cam__msg">{{ cameraMsg() }}</p></div>
        </div>
      }
    </div>
  `,
  styles: [`
    .ovl { position: fixed; inset: 0; z-index: 1000; background: rgb(15 16 32 / 55%); display: grid; place-items: center; padding: 16px; }
    .dlg { width: min(900px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; overflow-x: hidden; background: var(--surface); border-radius: 18px;
      padding: 22px 24px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 30px 60px rgb(0 0 0 / 30%); }
    .dlg__t { margin: 0; font: 600 22px var(--font-sans); } .dlg__t small { font: 500 15px var(--font-sans); color: var(--content-muted); margin-left: 8px; }
    .scan { display: flex; gap: 10px; min-width: 0; }
    .scan__box { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 46px; border: 2px solid var(--brand-600); border-radius: var(--r-field); }
    .scan__box mat-icon { color: var(--brand-600); } .scan__box input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: 400 16px var(--font-sans); color: var(--content-fg); }
    .scanbtn { flex: none; display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 10px; padding: 0 16px; background: var(--content-fg); color: #fff; font: 600 14px var(--font-sans); cursor: pointer; }
    .tw { overflow-x: auto; border: 1px solid var(--surface-border); border-radius: 12px; }
    .t { width: 100%; border-collapse: collapse; font: 400 14px var(--font-sans); }
    .t th { text-align: left; padding: 9px 10px; background: var(--surface-muted); color: var(--content-muted); font-weight: 600; }
    .t td { padding: 8px 10px; border-top: 1px solid var(--surface-border); } .r { text-align: right; white-space: nowrap; } .addr { max-width: 260px; }
    .mono { font-family: var(--font-mono, monospace); font-weight: 600; white-space: nowrap; } .muted { color: var(--content-muted); } .empty { text-align: center; color: var(--content-muted); padding: 18px; }
    .st { padding: 3px 10px; border-radius: 999px; background: #fff1e6; color: #c2410c; font: 600 12px var(--font-sans); white-space: nowrap; } .st--ok { background: #ecfdf3; color: #067647; }
    .pill { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--surface-border); background: var(--surface); border-radius: 999px; padding: 5px 11px; font: 600 13px var(--font-sans); cursor: pointer; }
    .pill mat-icon { font-size: 16px; width: 16px; height: 16px; } .pill--rm { color: var(--danger); }
    .err { margin: 0; color: var(--danger); font: 500 14px var(--font-sans); }
    .acts { display: flex; justify-content: flex-end; } .done { border: 0; border-radius: 10px; padding: 10px 22px; background: var(--occpl-gradient-button, #c8102e); color: #fff; font: 700 15px var(--font-sans); cursor: pointer; }
    .cam { position: fixed; inset: 0; z-index: 1010; background: rgb(15 16 32 / 92%); display: grid; place-items: center; padding: 16px; }
    .cam__box { width: min(420px, 100%); background: #0f1020; border-radius: 20px; overflow: hidden; color: #fff; }
    .cam__top { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: var(--occpl-gradient-brand, #b3123a); }
    .x { border: 0; background: none; color: #fff; font-size: 22px; cursor: pointer; }
    .cam__view { aspect-ratio: 3 / 4; background: #000; } .cam__view video { width: 100%; height: 100%; object-fit: cover; } .cam__msg { margin: 0; padding: 12px 16px; text-align: center; color: #d5d7ea; }
  `]
})
export class DrsEditDialog implements OnInit {
  readonly drs = input.required<DrsSummary>();
  readonly deliveryBy = input('');
  /** Pending Delivery at this branch (inscanned, not on a run): what can be added. */
  readonly pending = input<Shipment[]>([]);
  /** Something changed on the server: the lists should reload. */
  readonly changed = output<void>();
  readonly closed = output<void>();

  private readonly movement = inject(ShipmentMovementService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly rows = signal<DrsShipmentRow[]>([]);
  protected readonly awbText = signal('');
  protected readonly msg = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly camera = signal(false);
  protected readonly cameraMsg = signal('');
  private stopCamera: (() => void) | null = null;

  ngOnInit(): void { this.load(); this.destroyRef.onDestroy(() => this.closeCamera()); }

  private load(): void {
    const d = this.drs();
    this.movement.drsDetail(d.deliveryUserId, d.deliveryBranchId, d.runDate, d.coLoaderId ?? null, d.drsNumber).subscribe({
      next: (det: DrsDetail) => this.rows.set(det.shipments),
      error: (e: HttpErrorResponse) => this.msg.set(e.error?.message ?? 'Could not load this DRS.')
    });
  }

  addAwb(raw: string): void {
    const v = raw.trim().toUpperCase();
    if (!v) return;
    if (this.rows().some((s) => s.shipmentNumber?.toUpperCase() === v || s.trackingNumber?.toUpperCase() === v)) { this.msg.set(`AWB ${v} is already on this DRS.`); return; }
    const hit = this.pending().find((s) => s.status === 'IN_SCAN' && (s.shipmentNumber?.toUpperCase() === v || s.trackingNumber?.toUpperCase() === v));
    if (!hit) { this.msg.set(`AWB ${v} is not in Pending Delivery at this branch.`); return; }
    this.busy.set(true);
    this.msg.set(null);
    this.movement.addToDrs(this.drs().drsNumber!, [hit.id]).subscribe({
      next: (r) => {
        this.busy.set(false);
        const bad = r.results.find((x) => !x.success);
        if (bad) this.msg.set(`${bad.reference}: ${bad.message ?? 'not added'}`);
        this.load(); this.changed.emit();
      },
      error: (e: HttpErrorResponse) => { this.busy.set(false); this.msg.set(e.error?.message ?? `Could not add ${v}.`); }
    });
  }
  protected addTyped(): void { this.awbText().split(/[\s,;]+/).filter(Boolean).forEach((p) => this.addAwb(p)); this.awbText.set(''); }

  protected remove(s: DrsShipmentRow): void {
    this.busy.set(true);
    this.movement.removeFromDrs(this.drs().drsNumber!, s.shipmentId).subscribe({
      next: () => { this.busy.set(false); this.load(); this.changed.emit(); },
      error: (e: HttpErrorResponse) => { this.busy.set(false); this.msg.set(e.error?.message ?? 'Could not take it off.'); }
    });
  }

  protected close(): void { this.closeCamera(); this.closed.emit(); }
  protected openCamera(): void {
    this.camera.set(true);
    setTimeout(() => {
      const video = document.getElementById('de-video') as HTMLVideoElement | null;
      if (video) this.stopCamera = startBarcodeCamera(video, (v) => { this.addAwb(v); this.cameraMsg.set(`Read ${v}`); }, (t) => this.cameraMsg.set(t));
    });
  }
  protected closeCamera(): void { this.stopCamera?.(); this.stopCamera = null; this.camera.set(false); }
}
