import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import { CourierIntegrationService } from './courier-integration.service';

describe('CourierIntegrationService', () => {
  const base = `${environment.apiBaseUrl}/courier-integrations`;
  let service: CourierIntegrationService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [CourierIntegrationService, provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(CourierIntegrationService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('lists with GET', () => {
    service.list().subscribe();
    const r = http.expectOne(base);
    expect(r.request.method).toBe('GET');
    r.flush({ success: true, data: [] });
  });

  it('saves with PUT to the courier code, sending only the typed values', () => {
    service.save('SHIPROCKET', { enabled: true, values: { email: 'a@b.test' } }).subscribe();
    const r = http.expectOne(`${base}/SHIPROCKET`);
    expect(r.request.method).toBe('PUT');
    expect(r.request.body).toEqual({ enabled: true, values: { email: 'a@b.test' } });
    r.flush({ success: true, data: {} });
  });

  it('reads a customer\'s courier access with GET and replaces it with PUT', () => {
    service.customerAccess('c-1').subscribe();
    const g = http.expectOne(`${base}/customer-access/c-1`);
    expect(g.request.method).toBe('GET');
    g.flush({ success: true, data: { customerId: 'c-1', customised: false, couriers: [] } });
    service.saveCustomerAccess('c-1', ['DELHIVERY']).subscribe();
    const p = http.expectOne(`${base}/customer-access/c-1`);
    expect(p.request.method).toBe('PUT');
    expect(p.request.body).toEqual({ providerCodes: ['DELHIVERY'] });
    p.flush({ success: true, data: { customerId: 'c-1', customised: true, couriers: [] } });
  });

  it('tests with POST and disconnects with DELETE', () => {
    service.test('DELHIVERY').subscribe();
    const t = http.expectOne(`${base}/DELHIVERY/test`);
    expect(t.request.method).toBe('POST');
    t.flush({ success: true, data: {} });
    service.disconnect('DELHIVERY').subscribe();
    const d = http.expectOne(`${base}/DELHIVERY`);
    expect(d.request.method).toBe('DELETE');
    d.flush({ success: true, data: {} });
  });

  it('uploads a logo as multipart PUT and removes it with DELETE', () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' });
    service.uploadLogo('DELHIVERY', file).subscribe();
    const u = http.expectOne(`${base}/DELHIVERY/logo`);
    expect(u.request.method).toBe('PUT');
    expect(u.request.body instanceof FormData).toBe(true);
    expect((u.request.body as FormData).get('file')).toBeTruthy();
    u.flush({ success: true, data: null });
    service.removeLogo('DELHIVERY').subscribe();
    const d = http.expectOne(`${base}/DELHIVERY/logo`);
    expect(d.request.method).toBe('DELETE');
    d.flush({ success: true, data: null });
  });
});
