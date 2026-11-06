import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import { CourierMarkupPage } from './courier-markup';
import { MarkupRule, ruleState } from './courier-markup.service';

const base = `${environment.apiBaseUrl}/pricing-markup-rules`;
const H = 3600_000;

function rule(p: Partial<MarkupRule>): MarkupRule {
  return { id: 'r', providerCode: null, customerId: null, enabled: true, percent: 10, appliesTo: ['FREIGHT'],
    effectiveFrom: new Date(Date.now() - H).toISOString(), effectiveTo: null, notes: null, createdAt: new Date().toISOString(), ...p };
}

describe('ruleState', () => {
  it('reads in force, upcoming, ended and switched off from the dates and the switch', () => {
    expect(ruleState(rule({}))).toBe('IN_FORCE');
    expect(ruleState(rule({ effectiveFrom: new Date(Date.now() + H).toISOString() }))).toBe('UPCOMING');
    expect(ruleState(rule({ effectiveTo: new Date(Date.now() - 1000).toISOString() }))).toBe('ENDED');
    expect(ruleState(rule({ enabled: false }))).toBe('OFF');
  });
});

describe('CourierMarkupPage', () => {
  let http: HttpTestingController;
  type Page = {
    openForm(): void; save(): void; end(r: MarkupRule): void; check(): void; toggleLine(c: string): void;
    fCustomer: { set(v: string): void }; fCourier: { set(v: string): void }; fPercent: { set(v: string): void };
    checkCourier: { set(v: string): void }; checkCustomer: { set(v: string): void };
    formError(): string | null; shown(): MarkupRule[]; result(): unknown;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  function open(rules: MarkupRule[] = []): Page {
    const fixture = TestBed.createComponent(CourierMarkupPage);
    fixture.detectChanges();
    http.expectOne((r) => r.url.includes('/customers')).flush({ success: true, data: { content: [{ id: 'c-1', displayName: 'Acme', customerCode: 'C1' }], totalElements: 1 } });
    http.expectOne(`${environment.apiBaseUrl}/courier-integrations`).flush({ success: true, data: [
      { code: 'OCCPL_NETWORK', name: 'OCCPL Network', available: true }, { code: 'SHIPROCKET', name: 'Shiprocket', available: true }] });
    http.expectOne(base).flush({ success: true, data: rules });
    http.expectOne(`${base}/check`).flush({ success: true, data: { ruleId: null, isDefault: true, enabled: true, percent: 10, appliesTo: ['FREIGHT'], gstPercent: 18 } });
    return fixture.componentInstance as unknown as Page;
  }

  it('checks a customer and courier with their ids', () => {
    const page = open();
    page.checkCustomer.set('c-1');
    page.checkCourier.set('SHIPROCKET');
    page.check();
    const req = http.expectOne((r) => r.url === `${base}/check`);
    expect(req.request.params.get('customerId')).toBe('c-1');
    expect(req.request.params.get('providerCode')).toBe('SHIPROCKET');
    req.flush({ success: true, data: { ruleId: 'r', isDefault: false, enabled: true, percent: 12, appliesTo: ['FREIGHT'], gstPercent: 18 } });
    expect(page.result()).toEqual(expect.objectContaining({ percent: 12 }));
  });

  it('adds a rule for one customer and courier, on freight by default, starting now', () => {
    const page = open();
    page.openForm();
    page.fCustomer.set('c-1');
    page.fCourier.set('SHIPROCKET');
    page.fPercent.set('15');
    page.save();
    const post = http.expectOne(base);
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ providerCode: 'SHIPROCKET', customerId: 'c-1', enabled: true, percent: 15,
      appliesTo: ['FREIGHT'], effectiveFrom: null, effectiveTo: null, notes: null });
    post.flush({ success: true, data: rule({ id: 'n' }) });
    http.expectOne(base).flush({ success: true, data: [] });
    http.expectOne(`${base}/check`).flush({ success: true, data: { ruleId: null, isDefault: true, enabled: true, percent: 10, appliesTo: ['FREIGHT'], gstPercent: 18 } });
  });

  it('refuses a rule with no charge line or a bad percent without calling the server', () => {
    const page = open();
    page.openForm();
    page.fPercent.set('150');
    page.save();
    expect(page.formError()).toContain('between 0 and 100');
    page.fPercent.set('5');
    page.toggleLine('FREIGHT');
    page.save();
    expect(page.formError()).toContain('charge line');
  });

  it('ends a rule now after confirming', () => {
    const r = rule({ id: 'r-9', customerId: 'c-1' });
    const page = open([r]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    page.end(r);
    const post = http.expectOne(`${base}/r-9/end`);
    expect(post.request.method).toBe('POST');
    post.flush({ success: true, data: { ...r, effectiveTo: new Date().toISOString() } });
    http.expectOne(base).flush({ success: true, data: [] });
    http.expectOne(`${base}/check`).flush({ success: true, data: { ruleId: null, isDefault: true, enabled: true, percent: 10, appliesTo: ['FREIGHT'], gstPercent: 18 } });
  });
});
