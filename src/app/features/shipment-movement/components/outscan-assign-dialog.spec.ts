import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { OutscanAssignDialog } from './outscan-assign-dialog';

describe('Assign Outscan Item', () => {
  const ship = (id: string, qty: number, wt: number) =>
    ({ id, shipmentNumber: id.toUpperCase(), trackingNumber: 'T' + id, toCity: 'Pune', numberOfPackages: qty, actualWeight: wt, chargeableWeight: wt + 1 });
  const setup = () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const f = TestBed.createComponent(OutscanAssignDialog);
    f.componentRef.setInput('pending', [ship('a1', 2, 3.5), ship('b2', 1, 1)]);
    f.componentRef.setInput('preselected', ['a1']);
    f.componentRef.setInput('myBranchId', 'me');
    f.componentRef.setInput('branches', [{ value: 'kot', label: 'Kothrud Branch' }]);
    f.detectChanges();
    return { f, c: f.componentInstance as unknown as Record<string, any>, http: TestBed.inject(HttpTestingController) };
  };

  it('opens on Create = Manifest, Without Forwarder No.; AWBs are checked against Pending Outscan and totalled', () => {
    const { c } = setup();
    expect(c['create']()).toBe('manifest');
    expect(c['withFwd']()).toBe(false);
    expect(c['addAwb']('tb2')).toBe(true);
    expect(c['addAwb']('A1')).toBe(false);
    expect(c['awbError']()).toContain('already added');
    expect(c['addAwb']('ZZZ')).toBe(false);
    expect(c['awbError']()).toContain('not pending outscan');
    expect(c['totalQty']()).toBe(3);
    expect(c['totalWt']()).toBe(4.5);
  });

  it('Manifest without forwarder no.: saves a draft (Created) with co-loader and bags; nothing is dispatched', () => {
    const { c, http } = setup();
    c['assign']();
    expect(c['error']()).toContain('branch');
    c['branchId'].set('kot'); c['coLoaderId'].set('cl1'); c['bags'].set('3');
    c['assign']();
    const create = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/manifests'));
    expect(create.request.body).toMatchObject({ bookingBranchId: 'me', deliveryBranchId: 'kot', shipmentIds: ['a1'] });
    create.flush({ data: { id: 'm1', manifestNumber: 'LS-1' } });
    const draft = http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/manifests/m1'));
    expect(draft.request.body).toEqual({ coLoaderId: 'cl1', vehicleId: null, driverUserId: null, bagsCount: 3 });
    draft.flush({ data: { id: 'm1', manifestNumber: 'LS-1' } });
    http.expectNone((r) => r.url.endsWith('/dispatch'));
    http.expectNone((r) => r.url.endsWith('/forwarder-numbers'));
  });

  it('With Forwarder No.: ASSIGN waits until every AWB has its number, which goes per shipment', () => {
    const { c, http } = setup();
    c['addAwb']('B2');
    c['branchId'].set('kot');
    c['withFwd'].set(true);
    expect(c['canAssign']()).toBe(false);
    c['setFwd']('a1', ' DT-1 ');
    expect(c['canAssign']()).toBe(false);
    c['setFwd']('b2', 'DT-2');
    expect(c['canAssign']()).toBe(true);
    c['assign']();
    http.expectOne((r) => r.url.endsWith('/manifests')).flush({ data: { id: 'm1', manifestNumber: 'LS-1' } });
    http.expectOne((r) => r.method === 'PATCH').flush({ data: { id: 'm1', manifestNumber: 'LS-1' } });
    const fwd = http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/manifests/m1/forwarder-numbers'));
    expect(fwd.request.body).toEqual({ forwarderNumbers: { a1: 'DT-1', b2: 'DT-2' } });
  });

  it('DRS by a co-loader with a vehicle creates the delivery run', () => {
    const { c, http } = setup();
    c['setCreate']('drs');
    expect(c['showFwd']()).toBe(false);
    c['assign']();
    expect(c['error']()).toContain('delivery boy');
    c['deliveryBy'].set('c:cl1'); c['vehicleId'].set('v1');
    c['assign']();
    const ofd = http.expectOne((r) => r.url.endsWith('/out-for-delivery'));
    expect(ofd.request.body).toMatchObject({ shipmentIds: ['a1'], deliveryUserId: null, coLoaderId: 'cl1', vehicleId: 'v1' });
  });
});
