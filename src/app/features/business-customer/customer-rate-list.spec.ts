import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { environment } from '@env/environment';
import { CustomerRateList } from './customer-rate-list';

const API = environment.apiBaseUrl;
const card = (id: string, customerId: string | null, customerName: string | null) => ({
  id, code: id.toUpperCase(), name: id, fromZoneCode: 'PUNE', effectiveFrom: '2026-11-27', status: 'ACTIVE',
  laneCount: 24, chargeCount: 0, customerId, customerName });

function setUp() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
  const http = TestBed.inject(HttpTestingController);
  const f = TestBed.createComponent(CustomerRateList);
  f.detectChanges();
  http.expectOne((r) => r.url === `${API}/customers`).flush({ success: true, data: { content: [
    { id: 'aex', displayName: 'Aexonic', customerCode: 'CUSTQ5KD86QK' }, { id: 'bb', displayName: 'BB Ltd', customerCode: 'CUSTB' }] } });
  const list = http.expectOne((r) => r.url === `${API}/tariff-rate-cards`);
  return { http, f, list, c: f.componentInstance as unknown as Record<string, any> };
}

describe('Customer Rates (business customers\' own rate cards)', () => {
  it('lists customer cards only, filtered by the chosen customer', () => {
    const { list, c } = setUp();
    expect(list.request.params.get('owner')).toBe('CUSTOMER');
    list.flush({ success: true, data: [card('cust-aex-pune', 'aex', 'Aexonic'), card('cust-bb-pune', 'bb', 'BB Ltd'), card('pune_cash', null, null)] });
    expect(c['rows']().map((r: { id: string }) => r.id)).toEqual(['cust-aex-pune', 'cust-bb-pune']);
    c['customerCtl'].setValue('aex');
    expect(c['rows']().map((r: { id: string }) => r.id)).toEqual(['cust-aex-pune']);
  });

  it('opens a card in the rate card page and uploads a new sheet for its customer', () => {
    const { list, c } = setUp();
    list.flush({ success: true, data: [] });
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    c['open'](card('x1', 'aex', 'Aexonic'));
    expect(nav).toHaveBeenCalledWith(['/zone-tariff/rate-cards', 'x1']);
    c['upload']('aex');
    expect(nav).toHaveBeenCalledWith(['/business-customer/customers', 'aex', 'upload-rates']);
  });
});
