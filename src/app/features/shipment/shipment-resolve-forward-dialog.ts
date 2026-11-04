import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { ResolveForwardResult } from '@core/models/shipment.model';
import { ShipmentService } from './shipment.service';

/**
 * Settle a forward the courier never confirmed. Either the courier did not take it (the order is cancelled at the courier and the
 * shipment can be forwarded again), or it did (enter the AWB the courier gave and the shipment becomes Forwarded).
 */
@Component({
  selector: 'app-shipment-resolve-forward-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, FormsModule, UiButton],
  template: `
    <h2 mat-dialog-title>Resolve the forward</h2>
    <mat-dialog-content>
      <p class="sub">{{ data.shipmentNumber }} · we could not confirm whether {{ data.courier }} accepted it. Check the {{ data.courier }} panel if unsure.</p>
      <div class="opts" role="radiogroup" aria-label="What happened">
        <label class="opt" [class.on]="mode() === 'cancel'">
          <input type="radio" name="r" [checked]="mode() === 'cancel'" (change)="mode.set('cancel')" />
          <span><strong>{{ data.courier }} did not take it</strong>
            <small>We cancel the order at {{ data.courier }}, then you can forward the shipment again.</small></span>
        </label>
        <label class="opt" [class.on]="mode() === 'hand'">
          <input type="radio" name="r" [checked]="mode() === 'hand'" (change)="mode.set('hand')" />
          <span><strong>I already cancelled it at {{ data.courier }}</strong>
            <small>Use this if the cancel above is refused. Cancel the order in the {{ data.courier }} panel first; then you can forward again.</small></span>
        </label>
        <label class="opt" [class.on]="mode() === 'took'">
          <input type="radio" name="r" [checked]="mode() === 'took'" (change)="mode.set('took')" />
          <span><strong>{{ data.courier }} did take it</strong>
            <small>Enter the tracking number (AWB) it gave. The shipment becomes Forwarded.</small></span>
        </label>
      </div>
      @if (mode() === 'took') {
        <label class="fld">Courier AWB
          <input type="text" maxlength="80" [ngModel]="awb()" (ngModelChange)="awb.set($event)" placeholder="e.g. 14327700012345" />
        </label>
      }
      @if (error()) { <p class="err">{{ error() }}</p> }
      @if (result(); as r) { <p class="ok">{{ r.message }}</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <app-button variant="stroked" (pressed)="ref.close(result())">{{ result() ? 'Close' : 'Cancel' }}</app-button>
      @if (!result()) {
        <app-button [loading]="busy()" [disabled]="mode() === 'took' && !awb().trim()" (pressed)="confirm()">
          {{ mode() === 'took' ? 'Record AWB' : mode() === 'hand' ? 'Clear it' : 'Cancel at ' + data.courier }}</app-button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content { min-width:min(520px, 86vw); }
    .sub { font:400 13px var(--font-sans); color:var(--content-muted); margin:0 0 12px; }
    .opts { display:flex; flex-direction:column; gap:8px; }
    .opt { display:flex; align-items:flex-start; gap:12px; padding:12px 14px; border:1px solid var(--surface-border); border-radius:12px; cursor:pointer; background:var(--surface); font:500 14px var(--font-sans); }
    .opt.on { border-color:var(--brand-600); box-shadow:0 0 0 2px color-mix(in srgb, var(--brand-600) 25%, transparent); }
    .opt small { display:block; font:400 12px var(--font-sans); color:var(--content-muted); margin-top:2px; }
    .fld { display:flex; flex-direction:column; gap:4px; margin-top:12px; font:500 13px var(--font-sans); }
    .fld input { padding:10px 12px; border:1px solid var(--surface-border); border-radius:10px; font:400 14px var(--font-sans); background:var(--surface); color:inherit; }
    .err { margin:8px 0 0; padding:10px 12px; border-radius:10px; background:var(--danger-bg, #fdecee); color:var(--danger, #b3123a); font:500 13px var(--font-sans); }
    .ok { margin:12px 0 0; padding:10px 12px; border-radius:10px; background:var(--success-bg, #e3f5ee); color:var(--success, #0b7a55); font:600 13px var(--font-sans); }
  `]
})
export class ShipmentResolveForwardDialog {
  protected readonly data = inject<{ shipmentId: string; shipmentNumber: string; courier: string }>(MAT_DIALOG_DATA);
  protected readonly ref = inject<MatDialogRef<ShipmentResolveForwardDialog, ResolveForwardResult | null>>(MatDialogRef);
  private readonly service = inject(ShipmentService);

  protected readonly mode = signal<'cancel' | 'hand' | 'took'>('cancel');
  protected readonly awb = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly result = signal<ResolveForwardResult | null>(null);

  protected confirm(): void {
    this.busy.set(true);
    this.error.set('');
    this.service.resolveForward(this.data.shipmentId, this.mode() === 'took', this.mode() === 'took' ? this.awb().trim() : undefined, this.mode() === 'hand').subscribe({
      next: (r) => { this.busy.set(false); this.result.set(r); },
      error: (e: HttpErrorResponse) => { this.busy.set(false); this.error.set(e.error?.message ?? 'It could not be resolved.'); }
    });
  }
}
