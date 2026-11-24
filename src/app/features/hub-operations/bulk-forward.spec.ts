import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { BulkForward } from './bulk-forward';

const opt = (p: string, s: string, cost: number) => ({ providerCode: p, providerName: p === 'D' ? 'Delhivery' : 'Shiprocket', serviceCode: s,
  serviceName: s, transportMode: null, etaMinDays: 2, etaMaxDays: 4, chargeableWeightKg: 1, cost, breakdown: [] });
const options = (id: string, n: string, list: unknown[], blocker: string | null = null) =>
  ({ shipmentId: id, options: { shipmentId: id, shipmentNumber: n, blocker, collectFrom: 'Hub, 411001', options: list, unavailable: [] }, error: null });

describe('BulkForward', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
    { provide: DialogService, useValue: { confirm: () => of(true) } },
    { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ ids: 'a,b,c' }) } } }] }));

  it('prices, pre-selects the cheapest, switches to one courier and forwards the ready ones', async () => {
    const f = TestBed.createComponent(BulkForward);
    const c = f.componentInstance;
    const http = TestBed.inject(HttpTestingController);
    const init = c.ngOnInit();
    const req = http.expectOne('/api/v1/forwarding/bulk/options');
    expect(req.request.body).toEqual({ shipmentIds: ['a', 'b', 'c'] });
    req.flush({ data: [
      options('a', 'SH-A', [opt('D', 'Surface', 80), opt('S', 'Air', 95)]),
      options('b', 'SH-B', [opt('S', 'Air', 60), opt('D', 'Surface', 70)]),
      options('c', 'SH-C', [], 'A To Pay shipment cannot be forwarded.')] });
    await init;
    expect(c.rows().map((r) => r.choice)).toEqual(['D|Surface', 'S|Air', '']);
    expect(c.ready().length).toBe(2);
    c.oneCourier('D');
    expect(c.rows().map((r) => r.choice)).toEqual(['D|Surface', 'D|Surface', '']);
    c.cheapestForAll();
    expect(c.rows()[1].choice).toBe('S|Air');

    const run = c.forwardAll();
    await Promise.resolve();
    const fw = http.expectOne('/api/v1/forwarding/bulk');
    expect(fw.request.body.items).toEqual([{ shipmentId: 'a', providerCode: 'D', serviceCode: 'Surface' },
      { shipmentId: 'b', providerCode: 'S', serviceCode: 'Air' }]);
    fw.flush({ data: [
      { shipmentId: 'a', outcome: 'FORWARDED', message: 'ok', provider: 'D', serviceName: 'Surface', awb: 'AWB1', labelUrl: null, cost: 80 },
      { shipmentId: 'b', outcome: 'REFUSED', message: 'Shiprocket did not accept it', provider: 'S', serviceName: null, awb: null, labelUrl: null, cost: null }] });
    await run;
    expect(c.done()).toBe(true);
    expect(c.count('FORWARDED')).toBe(1);
    expect(c.count('REFUSED')).toBe(1);
  });
});
