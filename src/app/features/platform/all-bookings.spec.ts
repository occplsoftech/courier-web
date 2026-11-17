import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AllBookingsPage } from './all-bookings';

const page = (totals: unknown[]) => ({ data: {
  content: [{ id: '1', kind: 'SHIPMENT', companyId: 'c', companyName: 'Acme', bookedAt: '2026-11-13T10:00:00Z', number: 'ACM-2', awb: '261100',
    channel: 'COUNTER', customer: 'Test Shop', fromPincode: '411001', fromCity: 'Pune', toPincode: '560001', toCity: 'Bengaluru',
    carriedBy: 'FORWARDED', carrier: 'Delhivery via Shipyaari', providerCode: 'SHIPYAARI', service: 'DELHIVERY Economy', partnerAwb: '1490',
    status: 'IN_SCAN', amount: null, cost: 154.58 }],
  page: 0, size: 25, totalElements: 1, totalPages: 1, hasNext: false, totals, companies: [{ id: 'c', name: 'Acme' }] } });

describe('AllBookingsPage', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] }));

  it('shows who carries each booking and filters by a carrier chip, keeping the other chips', () => {
    const f = TestBed.createComponent(AllBookingsPage);
    f.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    const chips = [{ carrier: 'Delhivery via Shipyaari', carriedBy: 'FORWARDED', providerCode: 'SHIPYAARI', courier: 'Delhivery', count: 1 },
      { carrier: 'OCCPL Network', carriedBy: 'OCCPL', providerCode: null, courier: null, count: 4 }];
    http.expectOne((r) => r.url === '/api/v1/platform/bookings').flush(page(chips));
    f.detectChanges();
    const text = (f.nativeElement as HTMLElement).textContent!;
    expect(text).toContain('Forwarded to');
    expect(text).toContain('Delhivery via Shipyaari');
    expect(text).toContain('AWB 1490');

    f.componentInstance.pickChip(f.componentInstance.chips()[0]);
    const req = http.expectOne((r) => r.url === '/api/v1/platform/bookings');
    expect(req.request.params.get('carriedBy')).toBe('FORWARDED');
    expect(req.request.params.get('providerCode')).toBe('SHIPYAARI');
    expect(req.request.params.get('courier')).toBe('Delhivery');
    req.flush(page([chips[0]]));
    expect(f.componentInstance.chips().length).toBe(2);
  });
});
