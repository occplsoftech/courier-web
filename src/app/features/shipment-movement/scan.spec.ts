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

  it('Assign to Branch: any branch can be chosen; a parcel with a route pre-fills it, a different choice is only a warning', () => {
    const c = make();
    c['lists'].set({ out: [s('a'), s('b'), s('c', { nextLocationId: 'br3', deliveryBranchId: 'br3' }), s('d', { nextLocationId: null, deliveryBranchId: null })], in: [], del: [] });
    c['selected'].set(new Set(['d']));
    expect(c['outDestinationError']()).toBeNull();          // no route yet: just pick the Branch
    c['selected'].set(new Set(['a', 'b']));
    expect(c['outDestination']()).toBe('br2');
    c['toBranchId'].set('br9');
    expect(c['outDestinationError']()).toContain('instead');
    c['selected'].set(new Set(['a', 'c']));
    expect(c['outDestinationError']()).toContain('different next branches');
  });

  it('Assign checks the Branch, vehicle and driver, the delivery boy, and the RTO message before calling the server', () => {
    const c = make();
    c['lists'].set({ out: [s('d', { nextLocationId: null, deliveryBranchId: null })], in: [], del: [] });
    c['selected'].set(new Set(['d']));
    c['outscan']();
    expect(c['actionError']()).toContain('branch');
    c['toBranchId'].set('br2'); c['outscan']();
    expect(c['actionError']()).toContain('vehicle');
    c['setOutAction']('delivery'); c['assignLocalDelivery']();
    expect(c['actionError']()).toContain('delivery boy');
    c['setOutAction']('rto'); c['assignRto']();
    expect(c['actionError']()).toContain('message');
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
