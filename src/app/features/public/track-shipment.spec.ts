import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { TrackShipment } from './track-shipment';

describe('TrackShipment', () => {
  function create() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    return TestBed.createComponent(TrackShipment);
  }

  const base = {
    trackingNumber: 'SR123', shipmentNumber: 'ORD-9', status: 'OUT_FOR_DELIVERY', bookingDate: '2026-11-05',
    expectedDeliveryDate: null, fromCity: 'Pune', toCity: 'Mumbai',
    timeline: [{ status: 'BOOKED', changedAt: '2026-11-05T05:00:00Z' }, { status: 'OUT_FOR_DELIVERY', changedAt: null }]
  };

  it('names the outside courier and shows its latest update for a portal booking', () => {
    const fixture = create();
    fixture.componentInstance.result.set({ ...base, carrier: 'Shiprocket', latestStatus: 'Out for delivery', latestLocation: 'Mumbai' });
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Delivered by');
    expect(text).toContain('Shiprocket');
    expect(text).toContain('Latest update');
    expect(text).toContain('Reference');
  });

  it('keeps the OCCPL layout when there is no outside courier', () => {
    const fixture = create();
    fixture.componentInstance.result.set({ ...base, shipmentNumber: 'TEST_BR-000006' });
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Shipment No.');
    expect(text).not.toContain('Delivered by');
    expect(text).not.toContain('Latest update');
  });
});

describe('TrackShipment proof of delivery', () => {
  function create() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    return TestBed.createComponent(TrackShipment);
  }
  const delivered = {
    trackingNumber: 'AWB1', shipmentNumber: 'SHP-1', status: 'DELIVERED', bookingDate: '2026-11-20',
    expectedDeliveryDate: null, fromCity: 'Pune', toCity: 'Mumbai', timeline: []
  };

  it('offers the phone check only for a delivered shipment', () => {
    const fixture = create();
    fixture.componentInstance.result.set({ ...delivered, status: 'OUT_FOR_DELIVERY' });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Show proof of delivery');
    fixture.componentInstance.result.set(delivered);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Show proof of delivery');
  });

  it('verifies with the last 4 digits and shows the photo and receiver', () => {
    const fixture = create();
    const http = TestBed.inject(HttpTestingController);
    const c = fixture.componentInstance;
    c.result.set(delivered);
    c.phoneControl.setValue('3210');
    c.showPod();
    const req = http.expectOne((r) => r.url.endsWith('/track/AWB1/verify'));
    expect(req.request.body).toEqual({ phoneLast4: '3210' });
    req.flush({ success: true, data: { pod: { photoUrl: 'https://s3/p.jpg?sig', signatureUrl: null, deliveredBy: null,
      deliveredAt: '2026-11-26T06:30:00Z', receivedBy: 'Ramesh (Security)' } } });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('img.pod__img')?.getAttribute('src')).toBe('https://s3/p.jpg?sig');
    expect(el.textContent).toContain('Ramesh (Security)');
  });

  it('refuses anything but 4 digits without calling the server, and shows a wrong-code message', () => {
    const fixture = create();
    const http = TestBed.inject(HttpTestingController);
    const c = fixture.componentInstance;
    c.result.set(delivered);
    c.phoneControl.setValue('12');
    c.showPod();
    http.expectNone((r) => r.url.includes('/verify'));
    expect(c.podError()).toBe('Enter exactly 4 digits.');
    c.phoneControl.setValue('0000');
    c.showPod();
    http.expectOne((r) => r.url.endsWith('/verify')).flush(
      { success: false, message: 'Verification failed. Check the phone number and try again.' }, { status: 400, statusText: 'Bad Request' });
    expect(c.podError()).toContain('Verification failed');
    expect(c.pod()).toBeNull();
  });
});
