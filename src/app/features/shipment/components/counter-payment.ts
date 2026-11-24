import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import qrcode from 'qrcode-generator';
import { CounterPaymentMethod } from '@core/models/shipment.model';

/** A UPI payment link for an exact amount: what any UPI app reads from a QR. */
export function upiLink(upiId: string, payee: string | null, amount: number, note: string): string {
  const q = [`pa=${encodeURIComponent(upiId)}`, payee ? `pn=${encodeURIComponent(payee)}` : null,
    `am=${amount.toFixed(2)}`, 'cu=INR', note ? `tn=${encodeURIComponent(note.slice(0, 50))}` : null].filter(Boolean);
  return `upi://pay?${q.join('&')}`;
}

/**
 * Paid booking: how the customer pays at the counter. Razorpay (a QR from Razorpay shown once booked; the branch
 * wallet is not charged), Cash, or QR (the company's UPI ID drawn as a QR for the exact amount, confirmed by staff).
 */
@Component({
  selector: 'app-counter-payment',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <div class="cp">
      <span class="cp__l">Customer pays by</span>
      <div class="cp__seg" role="radiogroup" aria-label="Customer pays by">
        @for (o of options; track o.value) {
          <button type="button" role="radio" class="cp__opt" [class.cp__opt--on]="method() === o.value"
                  [attr.aria-checked]="method() === o.value" [attr.data-method]="o.value" (click)="method.set(o.value)">{{ o.label }}</button>
        }
      </div>
      @switch (method()) {
        @case ('RAZORPAY') {
          <p class="cp__hint">Book the shipment, then the customer scans the Razorpay QR for <strong>₹{{ amount() | number: '1.2-2' }}</strong>.
            It turns Paid by itself once Razorpay confirms. The branch wallet is not charged.</p>
        }
        @case ('UPI_QR') {
          @if (upiId()) {
            <div class="cp__qr">
              <div class="cp__img" [innerHTML]="qrSvg()"></div>
              <div class="cp__qri">
                <span class="cp__to">Pay to {{ payeeName() || upiId() }}</span>
                <span class="cp__upi">{{ upiId() }}</span>
                <strong class="cp__amt">₹{{ amount() | number: '1.2-2' }}</strong>
                <span class="cp__hint">Check the money has arrived before booking.</span>
              </div>
            </div>
            <label class="cp__f"><span>UPI reference (UTR) — optional</span>
              <input class="cp__i" inputmode="numeric" maxlength="30" [value]="reference()" (input)="reference.set($any($event.target).value)" placeholder="12-digit reference" /></label>
          } @else {
            <p class="cp__warn">No company UPI ID yet. A company admin adds it in Settings → Finance → UPI ID.</p>
          }
        }
        @default {
          <p class="cp__hint">Collect ₹{{ amount() | number: '1.2-2' }} in cash.</p>
        }
      }
    </div>
  `,
  styles: [`
    .cp { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
    .cp__l { font: 500 15px var(--font-sans); color: var(--content-muted); }
    .cp__seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
    .cp__opt { border: 1px solid var(--surface-border); background: var(--surface); color: var(--content-fg); border-radius: 10px;
      padding: 9px 6px; font: 600 15px var(--font-sans); cursor: pointer; }
    .cp__opt:hover { border-color: var(--brand-300); }
    .cp__opt--on { background: var(--brand-600); border-color: var(--brand-600); color: #fff; }
    .cp__hint { margin: 0; font: 400 14px var(--font-sans); color: var(--content-muted); }
    .cp__warn { margin: 0; font: 500 14px var(--font-sans); color: var(--danger); }
    .cp__qr { display: flex; gap: 12px; align-items: center; padding: 10px; border: 1px solid var(--surface-border); border-radius: 12px; background: #fff; }
    .cp__img { width: 132px; height: 132px; flex: none; }
    .cp__img ::ng-deep svg { width: 100%; height: 100%; }
    .cp__qri { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .cp__to { font: 600 14px var(--font-sans); color: #1d2433; }
    .cp__upi { font: 400 13px var(--font-sans); color: #5b6478; word-break: break-all; }
    .cp__amt { font: 800 24px var(--font-sans); color: #1d2433; }
    .cp__f { display: flex; flex-direction: column; gap: 4px; font: 500 14px var(--font-sans); color: var(--content-muted); }
    .cp__i { height: 40px; padding: 0 12px; border: 1px solid var(--surface-border); border-radius: var(--r-field, 10px);
      background: var(--surface); color: var(--content-fg); font: 400 16px var(--font-sans); }
  `]
})
export class CounterPayment {
  private readonly sanitizer = inject(DomSanitizer);

  readonly amount = input(0);
  readonly upiId = input<string | null>(null);
  readonly payeeName = input<string | null>(null);
  /** Shown in the customer's UPI app as the payment note. */
  readonly note = input('Courier booking');
  readonly method = model<CounterPaymentMethod>('CASH');
  readonly reference = model('');

  protected readonly options: { value: CounterPaymentMethod; label: string }[] = [
    { value: 'RAZORPAY', label: 'Razorpay' }, { value: 'CASH', label: 'Cash' }, { value: 'UPI_QR', label: 'QR' }
  ];

  protected readonly qrSvg = computed(() => {
    const id = this.upiId();
    if (!id || !(this.amount() > 0)) return '';
    const qr = qrcode(0, 'M');
    qr.addData(upiLink(id, this.payeeName(), this.amount(), this.note()));
    qr.make();
    return this.sanitizer.bypassSecurityTrustHtml(qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }));
  });
}
