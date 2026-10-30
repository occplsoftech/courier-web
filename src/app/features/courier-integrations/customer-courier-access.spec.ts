import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import { CustomerCourierAccessCard } from './customer-courier-access';

describe('CustomerCourierAccessCard', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  function open() {
    const fixture = TestBed.createComponent(CustomerCourierAccessCard);
    fixture.detectChanges();
    http.expectOne((r) => r.url.includes('/customers')).flush({ success: true, data: { content: [{ id: 'c-1', displayName: 'Acme', customerCode: 'C1' }], totalElements: 1 } });
    const card = fixture.componentInstance as unknown as {
      choose(id: string): void; toggle(code: string): void; save(): void; dirty(): boolean; picked(): ReadonlySet<string>;
    };
    card.choose('c-1');
    http.expectOne(`${environment.apiBaseUrl}/courier-integrations/customer-access/c-1`).flush({ success: true, data: {
      customerId: 'c-1', customised: false,
      couriers: [
        { code: 'OCCPL_NETWORK', name: 'OCCPL Network', connected: true, enabled: true },
        { code: 'DELHIVERY', name: 'Delhivery', connected: true, enabled: false }
      ] } });
    return card;
  }

  afterEach(() => http.verify());

  it('shows OCCPL Network ticked for a customer with nothing assigned, and is not changed until the person changes it', () => {
    const card = open();
    expect([...card.picked()]).toEqual(['OCCPL_NETWORK']);
    expect(card.dirty()).toBe(false);
  });

  it('saves exactly the ticked couriers', () => {
    const card = open();
    card.toggle('OCCPL_NETWORK');
    card.toggle('DELHIVERY');
    expect(card.dirty()).toBe(true);
    card.save();
    const put = http.expectOne(`${environment.apiBaseUrl}/courier-integrations/customer-access/c-1`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ providerCodes: ['DELHIVERY'] });
    put.flush({ success: true, data: { customerId: 'c-1', customised: true, couriers: [
      { code: 'OCCPL_NETWORK', name: 'OCCPL Network', connected: true, enabled: false },
      { code: 'DELHIVERY', name: 'Delhivery', connected: true, enabled: true }] } });
    expect(card.dirty()).toBe(false);
  });
});
