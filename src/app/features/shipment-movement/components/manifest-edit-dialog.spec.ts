import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ManifestEditDialog } from './manifest-edit-dialog';

describe('Edit Manifest (draft)', () => {
  const ship = (id: string, fwd: string | null = null) =>
    ({ id, shipmentNumber: id.toUpperCase(), trackingNumber: 'T' + id, toCity: 'Pune', numberOfPackages: 1, actualWeight: 2, chargeableWeight: 2, forwarderNumber: fwd });
  const setup = (rows: unknown[], startDispatch = false) => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    const f = TestBed.createComponent(ManifestEditDialog);
    f.componentRef.setInput('manifest', { id: 'm1', manifestNumber: 'MFT-1', deliveryBranchId: 'pun', coLoaderId: 'cl1', vehicleId: null,
      driverUserId: null, bagsCount: 2, status: 'CREATED' });
    f.componentRef.setInput('pending', [ship('c3')]);
    f.componentRef.setInput('startDispatch', startDispatch);
    f.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((r) => r.url.endsWith('/manifests/m1/shipments')).flush({ data: rows });
    return { c: f.componentInstance as unknown as Record<string, any>, http };
  };

  it('opens With Forwarder No. when an AWB already has one; Dispatch waits for every number', () => {
    const { c } = setup([ship('a1', 'DT-1'), ship('b2')]);
    expect(c['withFwd']()).toBe(true);
    expect(c['canDispatch']()).toBe(false);
    c['setFwd']('b2', 'DT-2');
    expect(c['canDispatch']()).toBe(true);
    expect(c['bags']()).toBe('2');
  });

  it('scanning a Pending Outscan AWB adds it to the manifest; Remove sends one back', () => {
    const { c, http } = setup([ship('a1')]);
    c['addAwb']('tc3');
    const add = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/manifests/m1/shipments'));
    expect(add.request.body).toEqual({ shipmentIds: ['c3'] });
    c['addAwb']('A1');
    expect(c['awbError']()).toContain('already on this manifest');
    c['remove']({ id: 'a1' });
    http.expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/manifests/m1/shipments/a1'));
  });

  it('Dispatch saves the trip details and numbers, then dispatches with them', () => {
    const { c, http } = setup([ship('a1', 'DT-1')], true);
    expect(c['confirming']()).toBe(true);
    c['dispatch']();
    const patch = http.expectOne((r) => r.method === 'PATCH');
    expect(patch.request.body).toEqual({ coLoaderId: 'cl1', vehicleId: null, driverUserId: null, bagsCount: 2 });
    patch.flush({ data: {} });
    http.expectOne((r) => r.method === 'PUT').flush({ data: null });
    const d = http.expectOne((r) => r.url.endsWith('/dispatch'));
    expect(d.request.body).toMatchObject({ manifestId: 'm1', coLoaderId: 'cl1', bagsCount: 2 });
  });
});
