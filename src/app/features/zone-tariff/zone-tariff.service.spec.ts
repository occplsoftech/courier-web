import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import { ZoneTariffService } from './zone-tariff.service';

/** Zone tariff zones, rate card lanes and charges, and quotes. */
describe('ZoneTariffService', () => {
  const base = environment.apiBaseUrl;
  let service: ZoneTariffService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ZoneTariffService, provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ZoneTariffService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('creates a zone with its locations in one POST', () => {
    service.createZone({ code: 'KERALA', name: 'Kerala', usage: 'TO', description: null, displayOrder: 0,
      locations: [{ scope: 'STATE', stateId: 's-1' }] }).subscribe();

    const req = http.expectOne(`${base}/tariff-zones`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.locations[0]).toEqual({ scope: 'STATE', stateId: 's-1' });
    req.flush({ success: true, data: { id: 'z-1' } });
  });

  it('adds several locations as one list', () => {
    service.addLocations('z-1', [{ scope: 'PINCODE', pincode: '411030' }, { scope: 'PINCODE', pincode: '411031' }]).subscribe();

    const req = http.expectOne(`${base}/tariff-zones/z-1/locations`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.locations).toHaveLength(2);
    req.flush({ success: true, data: {} });
  });

  it('resolves a pincode with its direction', () => {
    service.resolve('400001', 'TO').subscribe();

    const req = http.expectOne((r) => r.url === `${base}/tariff-zones/resolve`);
    expect(req.request.params.get('pincode')).toBe('400001');
    expect(req.request.params.get('direction')).toBe('TO');
    req.flush({ success: true, data: { pincode: '400001', direction: 'TO', zone: null } });
  });

  it('saves a lane with PUT and removes it by its three ids', () => {
    service.saveLane('c-1', { toZoneId: 'z', serviceTypeId: 's', packageTypeId: 'p',
      slabs: [{ weightFromKg: 0.001, weightToKg: 1, rateType: 'FIXED', rate: 200, stepKg: null }] }).subscribe();
    const save = http.expectOne(`${base}/tariff-rate-cards/c-1/lanes`);
    expect(save.request.method).toBe('PUT');
    expect(save.request.body.slabs[0].rate).toBe(200);
    save.flush({ success: true, data: {} });

    service.deleteLane('c-1', { toZoneId: 'z', serviceTypeId: 's', packageTypeId: 'p' }).subscribe();
    const del = http.expectOne(`${base}/tariff-rate-cards/c-1/lanes?toZoneId=z&serviceTypeId=s&packageTypeId=p`);
    expect(del.request.method).toBe('DELETE');
    del.flush({ success: true, data: {} });
  });

  it('adds, edits and removes a charge under its card', () => {
    const body = { code: 'FUEL', name: 'Fuel', toZoneId: null, serviceTypeId: null, packageTypeId: null, appliesWhen: 'ALWAYS' as const,
      calcMethod: 'PERCENT_OF_FREIGHT' as const, value: 10, minAmount: null, maxAmount: null, taxable: true, displayOrder: 0, status: 'ACTIVE' as const };
    service.addCharge('c-1', body).subscribe();
    http.expectOne(`${base}/tariff-rate-cards/c-1/charges`).flush({ success: true, data: {} });
    service.updateCharge('c-1', 'ch-1', body).subscribe();
    expect(http.expectOne(`${base}/tariff-rate-cards/c-1/charges/ch-1`).request.method).toBe('PUT');
    service.deleteCharge('c-1', 'ch-1').subscribe();
    expect(http.expectOne((r) => r.method === 'DELETE' && r.url === `${base}/tariff-rate-cards/c-1/charges/ch-1`)).toBeTruthy();
  });

  it('quotes with POST and activates a card with PATCH', () => {
    service.quote({ originPincode: '411030', destinationPincode: '462001', serviceTypeId: 's', packageTypeId: 'p', actualWeightKg: 2.3,
      lengthCm: null, widthCm: null, heightCm: null, pieces: 1, declaredValue: null, cod: false, bookingDate: null }).subscribe();
    const q = http.expectOne(`${base}/tariff-rate-cards/quote`);
    expect(q.request.method).toBe('POST');
    q.flush({ success: true, data: { total: 779 } });

    service.activateCard('c-1').subscribe();
    expect(http.expectOne(`${base}/tariff-rate-cards/c-1/activate`).request.method).toBe('PATCH');
  });
  it('prices every option with POST to quote/options', () => {
    service.quoteOptions({ originPincode: '411030', destinationPincode: '462001', actualWeightKg: 2.3, lengthCm: null, widthCm: null,
      heightCm: null, pieces: 1, declaredValue: null, cod: false, bookingDate: null }).subscribe();
    const req = http.expectOne(`${base}/tariff-rate-cards/quote/options`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.serviceTypeId).toBeUndefined();
    req.flush({ success: true, data: { options: [], unavailable: [] } });
  });
});
