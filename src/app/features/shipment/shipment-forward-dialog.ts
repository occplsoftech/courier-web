import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { ForwardOption, ForwardOptions, ForwardResult } from '@core/models/shipment.model';
import { ShipmentService } from './shipment.service';

/**
 * Hand a shipment held at this hub or branch to a connected courier. Shows each courier's own price for the shipment (the courier
 * collects from this hub), the cheapest first; the choice is booked once, priced afresh on the server. Our cost is saved on the
 * shipment; the customer's price is unchanged.
 */
@Component({
  selector: 'app-shipment-forward-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, CurrencyPipe, UiButton, UiLoader],
  template: `
    <h2 mat-dialog-title>Forward to a courier partner</h2>
    <mat-dialog-content>
      <p class="sub">{{ data.shipmentNumber }}@if (opts()?.collectFrom; as from) { · the courier collects from <strong>{{ from }}</strong> }</p>

      @if (loading()) {
        <app-loader [minHeight]="140" caption="Asking the couriers…" />
      } @else if (loadError()) {
        <p class="err">{{ loadError() }}</p>
      } @else if (opts(); as o) {
        @if (o.blocker) {
          <p class="err">{{ o.blocker }}</p>
        } @else {
          @if (!o.options.length) { <p class="err">No connected courier can take this shipment.</p> }
          <div class="opts" role="radiogroup" aria-label="Courier services">
            @for (x of o.options; track x.providerCode + x.serviceCode) {
              <label class="opt" [class.on]="isPicked(x)">
                <input type="radio" name="svc" [checked]="isPicked(x)" (change)="picked.set(x)" />
                <span class="opt__main">
                  <strong>{{ x.serviceName }}</strong>
                  <small>{{ x.providerName }}@if (x.transportMode) { · {{ x.transportMode }} }@if (x.etaMinDays) { · {{ x.etaMinDays }}@if (x.etaMaxDays && x.etaMaxDays !== x.etaMinDays) {–{{ x.etaMaxDays }}} days }
                    @if (x.chargeableWeightKg) { · charged for {{ x.chargeableWeightKg }} kg }</small>
                </span>
                <span class="opt__cost">{{ x.cost | currency: 'INR' : 'symbol' : '1.2-2' }}</span>
              </label>
            }
          </div>
          @if (o.unavailable.length) {
            <details class="un"><summary>Couriers that cannot take it ({{ o.unavailable.length }})</summary>
              <ul>@for (u of o.unavailable; track u.providerCode) { <li><strong>{{ u.providerName }}</strong>: {{ u.reason }}</li> }</ul>
            </details>
          }
          <p class="hint">These are the couriers' own prices (our cost). The customer's price and OCCPL tracking number stay as they are.</p>
        }
      }
      @if (error()) { <p class="err">{{ error() }}</p> }
      @if (result(); as r) { <p class="ok">{{ r.message }}</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <app-button variant="stroked" (pressed)="ref.close(result())">{{ result() ? 'Close' : 'Cancel' }}</app-button>
      @if (!result()) {
        <app-button icon="local_shipping" [loading]="busy()" [disabled]="!picked() || !!opts()?.blocker" (pressed)="confirm()">
          Forward{{ picked() ? ' · ' + (picked()!.cost | currency: 'INR' : 'symbol' : '1.2-2') : '' }}</app-button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content { min-width:min(560px, 86vw); max-height:70vh; }
    .sub { font:400 13px var(--font-sans); color:var(--content-muted); margin:0 0 12px; }
    .opts { display:flex; flex-direction:column; gap:8px; }
    .opt { display:flex; align-items:center; gap:12px; padding:12px 14px; border:1px solid var(--surface-border); border-radius:12px; cursor:pointer; background:var(--surface); }
    .opt.on { border-color:var(--brand-600); box-shadow:0 0 0 2px color-mix(in srgb, var(--brand-600) 25%, transparent); }
    .opt__main { flex:1; min-width:0; font:500 14px var(--font-sans); display:flex; flex-direction:column; gap:2px; }
    .opt__main small { font:400 12px var(--font-sans); color:var(--content-muted); }
    .opt__cost { font:700 15px var(--font-sans); white-space:nowrap; }
    .un { margin:12px 0 0; font:400 12px var(--font-sans); color:var(--content-muted); } .un ul { margin:6px 0 0; padding-left:18px; }
    .hint { font:400 12px var(--font-sans); color:var(--content-muted); margin:12px 0 0; }
    .err { margin:8px 0 0; padding:10px 12px; border-radius:10px; background:var(--danger-bg, #fdecee); color:var(--danger, #b3123a); font:500 13px var(--font-sans); }
    .ok { margin:12px 0 0; padding:10px 12px; border-radius:10px; background:var(--success-bg, #e3f5ee); color:var(--success, #0b7a55); font:600 13px var(--font-sans); }
  `]
})
export class ShipmentForwardDialog implements OnInit {
  protected readonly data = inject<{ shipmentId: string; shipmentNumber: string }>(MAT_DIALOG_DATA);
  protected readonly ref = inject<MatDialogRef<ShipmentForwardDialog, ForwardResult | null>>(MatDialogRef);
  private readonly service = inject(ShipmentService);

  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  protected readonly opts = signal<ForwardOptions | null>(null);
  protected readonly picked = signal<ForwardOption | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly result = signal<ForwardResult | null>(null);
  protected readonly cheapest = computed(() => this.opts()?.options[0] ?? null);

  ngOnInit(): void {
    this.service.forwardOptions(this.data.shipmentId).subscribe({
      next: (o) => { this.opts.set(o); this.picked.set(o.options[0] ?? null); this.loading.set(false); },
      error: (e: HttpErrorResponse) => { this.loadError.set(e.error?.message ?? 'The couriers could not be asked.'); this.loading.set(false); }
    });
  }

  protected isPicked(x: ForwardOption): boolean {
    const p = this.picked();
    return !!p && p.providerCode === x.providerCode && p.serviceCode === x.serviceCode;
  }

  protected confirm(): void {
    const p = this.picked();
    if (!p) return;
    this.busy.set(true);
    this.error.set('');
    this.service.forward(this.data.shipmentId, p.providerCode, p.serviceCode).subscribe({
      next: (r) => { this.busy.set(false); this.result.set(r); },
      error: (e: HttpErrorResponse) => { this.busy.set(false); this.error.set(e.error?.message ?? 'The shipment could not be forwarded.'); }
    });
  }
}
