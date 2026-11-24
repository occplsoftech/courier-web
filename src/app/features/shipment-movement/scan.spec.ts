import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Scan, destinationOf } from './scan';

describe('Scan', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] }));
  const make = () => TestBed.createComponent(Scan).componentInstance as unknown as Record<string, any>;
  const s = (id: string, o: Record<string, unknown> = {}) => ({ id, shipmentNumber: id.toUpperCase(), trackingNumber: 'T' + id, nextLocationId: 'br2',
    deliveryBranchId: 'br2', status: 'BOOKED', receiverName: 'R ' + id, createdDate: '2026-11-24T10:00:00Z', ...o });

  it('leaves for the next stop, else the delivery branch', () => {
    expect(destinationOf({ nextLocationId: 'hub', deliveryBranchId: 'br2' })).toBe('hub');
    expect(destinationOf({ nextLocationId: null, deliveryBranchId: 'br2' })).toBe('br2');
    expect(destinationOf({ nextLocationId: null, deliveryBranchId: null })).toBeNull();
  });

  it('outscans only parcels going to one branch, and never ones without a route', () => {
    const c = make();
    c['lists'].set({ out: [s('a'), s('b'), s('c', { nextLocationId: 'br3', deliveryBranchId: 'br3' }), s('d', { nextLocationId: null, deliveryBranchId: null })], in: [], del: [] });
    c['selected'].set(new Set(['a', 'b']));
    expect(c['outDestination']()).toBe('br2');
    expect(c['outDestinationError']()).toBeNull();
    c['selected'].set(new Set(['a', 'c']));
    expect(c['outDestinationError']()).toContain('one branch');
    c['selected'].set(new Set(['a', 'd']));
    expect(c['outDestinationError']()).toContain('no route');
  });

  it('a scanned AWB or tracking number selects that row; others are explained', () => {
    const c = make();
    c['lists'].set({ out: [s('a')], in: [], del: [] });
    c['scanText'].set('ta'); c['scanOne']();
    expect(c['selected']().has('a')).toBe(true);
    c['scanText'].set('A'); c['scanOne']();
    expect(c['scanError']()).toContain('already selected');
    c['scanText'].set('ZZZ'); c['scanOne']();
    expect(c['scanError']()).toContain('not in Pending Outscan');
  });

  it('Pending Delivery splits the selection into DRS (inscanned) and Update Delivery (out for delivery)', () => {
    const c = make();
    c['lists'].set({ out: [], in: [], del: [s('i', { status: 'IN_SCAN' }), s('o', { status: 'OUT_FOR_DELIVERY' })] });
    c['tab'].set('del');
    c['selected'].set(new Set(['i', 'o']));
    expect(c['selectedInscanned']().map((x: any) => x.id)).toEqual(['i']);
    expect(c['selectedOut']().map((x: any) => x.id)).toEqual(['o']);
  });
});
