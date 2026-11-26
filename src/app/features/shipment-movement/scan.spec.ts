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

  it('Pending Outscan opens the Assign dialog; DRS and Manifest tabs count their runs and sheets', () => {
    const c = make();
    c['openAssign']();
    expect(c['actionError']()).toContain('No parcels');
    c['lists'].set({ out: [s('a')], in: [], del: [], drs: [], man: [] });
    c['openAssign']();
    expect(c['assignOpen']()).toBe(true);
    c['drsRuns'].set([{ deliveryUserId: 'u1', coLoaderId: null, deliveryBranchId: 'b', runDate: '2026-11-26', drsNumber: 'D1', shipmentCount: 2, deliveredCount: 1, pendingCount: 1 },
      { deliveryUserId: null, coLoaderId: 'c1', deliveryBranchId: 'b', runDate: '2026-11-26', drsNumber: 'D2', shipmentCount: 1, deliveredCount: 0, pendingCount: 1 }]);
    expect(c['countOf']('drs')).toBe(2);
    c['drsWho'].set('c:c1');
    expect(c['drsRows']().map((d: any) => d.drsNumber)).toEqual(['D2']);
    c['sheets'].set([{ id: 'm1', coLoaderId: 'c1' }, { id: 'm2', coLoaderId: null }]);
    c['manCoLoader'].set('c1');
    expect(c['manRows']().map((m: any) => m.id)).toEqual(['m1']);
  });

  it('a scanned AWB or tracking number selects that row; others are explained', () => {
    const c = make();
    c['lists'].set({ out: [s('a')], in: [], del: [], drs: [], man: [] });
    c['scanText'].set('ta'); c['scanOne']();
    expect(c['selected']().has('a')).toBe(true);
    c['scanText'].set('A'); c['scanOne']();
    expect(c['scanError']()).toContain('already selected');
    c['scanText'].set('ZZZ'); c['scanOne']();
    expect(c['scanError']()).toContain('not in Pending Outscan');
  });

  it('Pending Delivery splits the selection into DRS (inscanned) and Update Delivery (out for delivery)', () => {
    const c = make();
    c['lists'].set({ out: [], in: [], del: [s('i', { status: 'IN_SCAN' }), s('o', { status: 'OUT_FOR_DELIVERY' })], drs: [], man: [] });
    c['tab'].set('del');
    c['selected'].set(new Set(['i', 'o']));
    expect(c['selectedInscanned']().map((x: any) => x.id)).toEqual(['i']);
    expect(c['selectedOut']().map((x: any) => x.id)).toEqual(['o']);
  });
});
