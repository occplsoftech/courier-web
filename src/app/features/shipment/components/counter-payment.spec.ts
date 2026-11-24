import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { vi } from 'vitest';
import { CounterPayment, upiLink } from './counter-payment';
import { POLL_MS, RazorpayQrDialog } from './razorpay-qr-dialog';

describe('Paid booking: how the customer pays', () => {
  it('draws the company UPI QR for the exact amount', () => {
    expect(upiLink('occpl@okaxis', 'OCCPL SOFTECH', 780, 'Courier TEST_BR-1'))
      .toBe('upi://pay?pa=occpl%40okaxis&pn=OCCPL%20SOFTECH&am=780.00&cu=INR&tn=Courier%20TEST_BR-1');
    TestBed.configureTestingModule({});
    const f = TestBed.createComponent(CounterPayment);
    f.componentRef.setInput('amount', 780);
    f.componentRef.setInput('upiId', 'occpl@okaxis');
    f.componentInstance.method.set('UPI_QR');
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.cp__img svg')).not.toBeNull();
    expect(el.textContent).toContain('₹780.00');
    (el.querySelector('[data-method="RAZORPAY"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(f.componentInstance.method()).toBe('RAZORPAY');
    expect(el.textContent).toContain('branch wallet is not charged');
  });

  it('asks for a UPI ID when the company has none', () => {
    TestBed.configureTestingModule({});
    const f = TestBed.createComponent(CounterPayment);
    f.componentRef.setInput('amount', 100);
    f.componentInstance.method.set('UPI_QR');
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).toContain('No company UPI ID yet');
  });

  it('Razorpay QR: waits for the payment and closes by itself with PAID once Razorpay has it', () => {
    vi.useFakeTimers();
    const close = vi.fn();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(),
      { provide: MAT_DIALOG_DATA, useValue: { shipmentId: 's1', shipmentNumber: 'TEST_BR-000009' } },
      { provide: MatDialogRef, useValue: { close } }] });
    const f = TestBed.createComponent(RazorpayQrDialog);
    f.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    const base = { id: 'p1', shipmentId: 's1', shipmentNumber: 'TEST_BR-000009', bookingBranchId: 'b', method: 'RAZORPAY', amount: 780 };
    http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/shipments/s1/payment/qr'))
      .flush({ data: { ...base, status: 'PENDING', qrOpen: true, qrImageUrl: 'https://rzp.io/i/qr1', qrCloseBy: '2026-11-24T10:30:00Z' } });
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('img')?.getAttribute('src')).toBe('https://rzp.io/i/qr1');
    expect(el.textContent).toContain('Waiting for payment');

    vi.advanceTimersByTime(POLL_MS);
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/shipments/s1/payment'))
      .flush({ data: { ...base, status: 'PAID', qrOpen: false, reference: 'pay_123', paidAmount: 780 } });
    f.detectChanges();
    expect(el.textContent).toContain('Payment received');
    vi.advanceTimersByTime(1500);
    expect(close).toHaveBeenCalledWith('PAID');
    vi.useRealTimers();
  });
});
