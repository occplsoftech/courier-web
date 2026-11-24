import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { Subscription, interval, switchMap } from 'rxjs';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { ShipmentPayment } from '@core/models/shipment.model';
import { ShipmentService } from '../shipment.service';

export interface RazorpayQrDialogData { shipmentId: string; shipmentNumber: string; }
/** PAID when the customer paid while the QR was open; PENDING when closed to collect later. */
export type RazorpayQrResult = 'PAID' | 'PENDING';

/** How often the screen asks whether the payment has arrived. */
export const POLL_MS = 3000;

/**
 * The Razorpay QR for a booked shipment's final amount. Asks every few seconds whether Razorpay has the payment;
 * the moment it has, shows "Payment received" and closes by itself with PAID, so the booking carries on.
 */
@Component({
  selector: 'app-razorpay-qr-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, UiButton, DecimalPipe, DatePipe],
  template: `
    <div class="rq">
      <p class="rq__no"><strong>{{ data.shipmentNumber }}</strong> booked</p>
      <p class="rq__sub">Customer scans with any UPI app to pay</p>
      @if (payment(); as p) {
        <strong class="rq__amt">₹{{ p.amount | number: '1.2-2' }}</strong>
        @if (p.status === 'PAID') {
          <div class="rq__ok" role="status">✓ Payment received @if (p.reference) {<span>· {{ p.reference }}</span>}</div>
        } @else if (p.qrOpen && p.qrImageUrl) {
          <img class="rq__img" [src]="p.qrImageUrl" alt="Razorpay UPI QR code" />
          <div class="rq__wait" role="status">Waiting for payment… · valid till {{ p.qrCloseBy | date: 'h:mm a' }}</div>
        } @else {
          <div class="rq__wait">This QR has expired.</div>
          <app-button icon="refresh" [loading]="loading()" (pressed)="open()">New QR</app-button>
        }
      } @else if (error()) {
        <p class="rq__err">{{ error() }}</p>
        <app-button icon="refresh" [loading]="loading()" (pressed)="open()">Try again</app-button>
      } @else {
        <div class="rq__wait">Opening the Razorpay QR…</div>
      }
      <div class="rq__actions">
        @if (paid()) {
          <app-button icon="check" (pressed)="ref.close('PAID')">Continue</app-button>
        } @else {
          <app-button variant="stroked" (pressed)="ref.close('PENDING')">Close — collect later</app-button>
        }
      </div>
    </div>
  `,
  styles: [`
    .rq { padding: 24px; width: 380px; max-width: 92vw; display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; }
    .rq__no { margin: 0; font: 500 18px var(--font-sans); color: var(--content-fg); }
    .rq__sub { margin: 0; font: 400 15px var(--font-sans); color: var(--content-muted); }
    .rq__amt { font: 800 32px var(--font-sans); color: var(--content-fg); }
    .rq__img { width: 260px; max-width: 100%; border-radius: 12px; border: 1px solid var(--surface-border); background: #fff; }
    .rq__wait { width: 100%; padding: 9px; border-radius: 10px; background: #fff6e0; color: #8a5a00; font: 500 15px var(--font-sans); }
    .rq__ok { width: 100%; padding: 12px; border-radius: 10px; background: #e6f6ec; color: #16794a; font: 700 17px var(--font-sans); }
    .rq__err { margin: 0; color: var(--danger); font: 500 15px var(--font-sans); }
    .rq__actions { display: flex; justify-content: center; width: 100%; margin-top: 6px; }
  `]
})
export class RazorpayQrDialog implements OnInit {
  protected readonly data = inject<RazorpayQrDialogData>(MAT_DIALOG_DATA);
  protected readonly ref = inject<MatDialogRef<RazorpayQrDialog, RazorpayQrResult>>(MatDialogRef);
  private readonly shipments = inject(ShipmentService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly payment = signal<ShipmentPayment | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly paid = computed(() => this.payment()?.status === 'PAID');
  private poll?: Subscription;
  private closeTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.open();
    this.destroyRef.onDestroy(() => { this.poll?.unsubscribe(); clearTimeout(this.closeTimer); });
  }

  /** Shows the open QR, or a new one once it expired. */
  protected open(): void {
    this.loading.set(true);
    this.error.set(null);
    this.shipments.openPaymentQr(this.data.shipmentId).subscribe({
      next: (p) => { this.loading.set(false); this.show(p); this.startPolling(); },
      error: (e: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set((e.status >= 400 && e.status < 500 ? e.error?.message : null) ?? 'Could not open the Razorpay QR.');
      }
    });
  }

  private startPolling(): void {
    if (this.poll || this.paid()) return;
    this.poll = interval(POLL_MS).pipe(switchMap(() => this.shipments.payment(this.data.shipmentId)))
      .subscribe({ next: (p) => { if (p) this.show(p); }, error: () => { this.poll = undefined; } });
  }

  private show(p: ShipmentPayment): void {
    this.payment.set(p);
    if (p.status === 'PAID') {
      this.poll?.unsubscribe();
      // Paid: carry on by itself after a moment, so staff see the confirmation.
      this.closeTimer = setTimeout(() => this.ref.close('PAID'), 1500);
    }
  }
}
