import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { environment } from '@env/environment';
import { CustomerTariffUploadPage } from './customer-tariff-upload';

const API = environment.apiBaseUrl;

const sheet = (errors: { row: number | null; message: string }[]) => ({
  rateCardCode: 'CUST-CUS-00042-PUNE', fromZoneCode: 'PUNE', rowsRead: 4, duplicateRows: 0, skippedRows: 0, imported: false,
  lanes: [
    { toZoneId: 'z1', toZoneCode: 'CENTRAL', serviceTypeId: 's1', serviceTypeCode: 'SURFACE', packageTypeId: 'p1', packageTypeCode: 'DOC',
      slabCount: 2, summary: '≤0.5 kg 60 · +100/500 g to 99 kg', replaces: false },
    { toZoneId: 'z1', toZoneCode: 'EAST', serviceTypeId: 's1', serviceTypeCode: 'SURFACE', packageTypeId: 'p2', packageTypeCode: 'LAPTOP',
      slabCount: 1, summary: '≤5 kg 650/box', replaces: false }],
  errors, warnings: [] as { row: number | null; message: string }[]
});

function setUp() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
    { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'c1' }) } } }] });
  const http = TestBed.inject(HttpTestingController);
  const f = TestBed.createComponent(CustomerTariffUploadPage);
  f.detectChanges();
  http.expectOne(`${API}/customers/c1`).flush({ success: true, data: { id: 'c1', displayName: 'A&A Global Resources' } });
  http.expectOne(`${API}/customer-tariff/c1/cards`).flush({ success: true, data: [] });
  http.expectOne((r) => r.url === `${API}/tariff-zones`).flush({ success: true, data: [
    { id: 'pune', code: 'PUNE', name: 'Pune city', usage: 'BOTH', status: 'ACTIVE' },
    { id: 'east', code: 'EAST', name: 'East', usage: 'TO', status: 'ACTIVE' }] });
  f.detectChanges();
  const page = f.componentInstance as unknown as { choose(files: FileList | null): void; upload(): void };
  const file = new File(['x'], 'A_A_Global.xlsx');
  return { http, f, page, files: { 0: file, length: 1, item: () => file } as unknown as FileList };
}

describe('CustomerTariffUploadPage', () => {
  it('checks the sheet per 500 g by default and lists lanes; problem rows keep Upload disabled', () => {
    const { http, f, page, files } = setUp();
    const text = () => (f.nativeElement as HTMLElement).textContent ?? '';
    expect(text()).toContain('Upload Rates — A&A Global Resources');
    expect(text()).toContain('None yet');

    page.choose(files);
    const check = http.expectOne((r) => r.url.startsWith(`${API}/customer-tariff/c1/upload/preview`));
    expect(check.request.url).toContain('additionStepKg=0.5');
    check.flush({ success: true, data: { customerId: 'c1', customerName: 'A&A', rateCardId: null, newCard: true, fromZoneId: 'pune',
      additionStepKg: 0.5, chargesFrom: 'PUNE_CASH',
      sheet: sheet([{ row: 49, message: 'EAST · AIR · NONDOC: the first weight band (0.001–0.5 kg) is Per Kg' }]) } });
    f.detectChanges();

    expect(text()).toContain('Row');
    expect(text()).toContain('the first weight band');
    expect(text()).toContain('≤5 kg 650/box');
    expect(text()).toContain('charges (fuel, docket…) of company card PUNE_CASH');
    const upload = Array.from((f.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Upload 2 lane(s)'))!;
    expect(upload.disabled).toBe(true);
  });

  it('uploads a clean sheet and shows the card', () => {
    const { http, f, page, files } = setUp();
    page.choose(files);
    http.expectOne((r) => r.url.startsWith(`${API}/customer-tariff/c1/upload/preview`)).flush({ success: true, data: {
      customerId: 'c1', customerName: 'A&A', rateCardId: null, newCard: true, fromZoneId: 'pune', additionStepKg: 0.5,
      chargesFrom: null, sheet: sheet([]) } });
    f.detectChanges();

    page.upload();
    const up = http.expectOne((r) => r.url.startsWith(`${API}/customer-tariff/c1/upload?`));
    expect(up.request.method).toBe('POST');
    up.flush({ success: true, data: { customerId: 'c1', customerName: 'A&A Global Resources', rateCardId: 'card1', newCard: true,
      fromZoneId: 'pune', additionStepKg: 0.5, chargesFrom: null, sheet: { ...sheet([]), imported: true } } });
    http.expectOne(`${API}/customer-tariff/c1/cards`).flush({ success: true, data: [{ id: 'card1', code: 'CUST-CUS-00042-PUNE',
      name: 'A&A rates', fromZoneId: 'pune', fromZoneCode: 'PUNE', effectiveFrom: '2025-04-01', effectiveTo: null, status: 'ACTIVE', laneCount: 2 }] });
    f.detectChanges();

    const text = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('2 lane(s) saved on CUST-CUS-00042-PUNE');
    expect(text).toContain('A&A Global Resources now uses their business rates');
    expect(text).toContain('CUST-CUS-00042-PUNE · from PUNE · 2 lane(s)');
    http.verify();
  });
});
