import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DrsEditDialog } from './drs-edit-dialog';

describe('Edit DRS', () => {
  const setup = () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const f = TestBed.createComponent(DrsEditDialog);
    f.componentRef.setInput('drs', { drsNumber: 'DRS000009', deliveryUserId: 'u1', deliveryBranchId: 'pun', runDate: '2026-11-27',
      shipmentCount: 2, deliveredCount: 1, pendingCount: 1 });
    f.componentRef.setInput('pending', [{ id: 'c3', shipmentNumber: 'C3', trackingNumber: 'T3', status: 'IN_SCAN' },
      { id: 'd4', shipmentNumber: 'D4', trackingNumber: 'T4', status: 'OUT_FOR_DELIVERY' }]);
    f.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    const det = http.expectOne((r) => r.url.includes('/drs/detail'));
    expect(det.request.params.get('drsNumber')).toBe('DRS000009');
    det.flush({ data: { drsNumber: 'DRS000009', shipments: [
      { shipmentId: 'a1', shipmentNumber: 'A1', trackingNumber: 'TA', status: 'OUT_FOR_DELIVERY' },
      { shipmentId: 'b2', shipmentNumber: 'B2', trackingNumber: 'TB', status: 'DELIVERED' }] } });
    return { c: f.componentInstance as unknown as Record<string, any>, http };
  };

  it('adds a Pending Delivery (inscanned) parcel to the same DRS; refuses one already on it or not pending here', () => {
    const { c, http } = setup();
    c['addAwb']('A1');
    expect(c['msg']()).toContain('already on this DRS');
    c['addAwb']('D4');
    expect(c['msg']()).toContain('not in Pending Delivery');
    c['addAwb']('t3');
    const add = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/drs/DRS000009/shipments'));
    expect(add.request.body).toEqual({ shipmentIds: ['c3'] });
  });

  it('takes an undelivered parcel off the run', () => {
    const { c, http } = setup();
    c['remove']({ shipmentId: 'a1' });
    http.expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/drs/DRS000009/shipments/a1'));
  });
});
