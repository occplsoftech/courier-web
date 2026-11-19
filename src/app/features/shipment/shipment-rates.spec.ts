import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ShipmentCreate } from './shipment-create';

/** Booking prices every service for the destination (zone tariff) and starts Package Type on Non Document. */
describe('ShipmentCreate rates for this destination', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] }));

  it('defaults to Non Document and lists each service with its rate or "No rate"', async () => {
    const f = TestBed.createComponent(ShipmentCreate);
    const c = f.componentInstance as unknown as Record<string, any>;
    f.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    const opts = (url: string, rows: unknown[]) => http.match((r) => r.url.includes(url)).forEach((r) => r.flush({ data: { content: rows, page: 0, size: 100, totalElements: rows.length, totalPages: 1, first: true, last: true, hasNext: false } }));
    opts('package-types', [{ id: 'doc', code: 'DOCUMENT', name: 'Document', status: 'ACTIVE' }, { id: 'nd', code: 'NON-DOC', name: 'Non Document', status: 'ACTIVE' }]);
    expect(c['form'].get('packageTypeId').value).toBe('nd');

    c['serviceTypeOptions'].set([{ value: 'air', label: 'AIR (AIR)' }, { value: 'srf', label: 'SURFACE (SRF)' }]);
    c['readyForFreight'] = () => true;
    let rates: any = null;
    c['serviceRates$']().subscribe((r: unknown) => (rates = r));
    const calls = http.match((r) => r.url.endsWith('/district-level-freight/calculate'));
    expect(calls.map((r) => r.request.body.serviceTypeId)).toEqual(['air', 'srf']);
    expect(calls[0].request.body.packageTypeId).toBe('nd');
    calls[0].flush({ message: 'Rate card PUNE_CASH_2025 has no AIR NON-DOC rate to zone PUNE.' }, { status: 422, statusText: 'x' });
    calls[1].flush({ data: { totalFreight: 610, baseFreight: 610, odaCharge: 0, weightSlabLabel: '50 up to 1 kg + 14 × 40 per extra kg' } });
    expect(rates[0]).toMatchObject({ serviceTypeId: 'air', label: 'AIR', total: null, error: 'Rate card PUNE_CASH_2025 has no AIR NON-DOC rate to zone PUNE.' });
    // freight 610 + GST 18% 109.80 = 719.80 → 720 (rounded like the booking summary)
    expect(rates[1]).toMatchObject({ serviceTypeId: 'srf', label: 'SURFACE', total: 610, freight: 610, gst: 109.8, estimate: 720, roundOff: 0.2 });
    c['form'].get('serviceTypeId').setValue('air');
    c['serviceRates'].set(rates);
    expect(c['hasOtherRates']()).toBe(true);
    c['pickService']('srf');
    expect(c['form'].get('serviceTypeId').value).toBe('srf');
  });
});
