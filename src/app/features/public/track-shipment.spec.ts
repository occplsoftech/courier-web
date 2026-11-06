import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
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
