import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { OutscanAssignDialog } from './outscan-assign-dialog';

describe('Assign Outscan Item (as on the earlier portal)', () => {
  const ship = (id: string) => ({ id, shipmentNumber: id.toUpperCase(), trackingNumber: 'T' + id, toCity: 'Pune' });
  const setup = () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const f = TestBed.createComponent(OutscanAssignDialog);
    f.componentRef.setInput('pending', [ship('a1'), ship('b2')]);
    f.componentRef.setInput('preselected', ['a1']);
    f.componentRef.setInput('myBranchId', 'me');
    f.componentRef.setInput('branches', [{ value: 'kot', label: 'Kothrud Branch' }]);
    f.detectChanges();
    return { f, c: f.componentInstance as unknown as Record<string, any>, http: TestBed.inject(HttpTestingController) };
  };

  it('AWBs: ticked rows start as chips; typed or scanned numbers are checked against Pending Outscan', () => {
    const { c } = setup();
    expect(c['picked']().map((s: any) => s.id)).toEqual(['a1']);
    expect(c['addAwb']('tb2')).toBe(true);
    expect(c['addAwb']('A1')).toBe(false);
    expect(c['awbError']()).toContain('already added');
    expect(c['addAwb']('ZZZ')).toBe(false);
    expect(c['awbError']()).toContain('not pending outscan');
  });

  it('Assign to Branch with a co-loader: loading sheet to the branch, then dispatch with co-loader, forwarding no. and bags, no vehicle', () => {
    const { c, http } = setup();
    c['assign']();
    expect(c['error']()).toContain('branch');
    c['branchId'].set('kot'); c['coLoaderId'].set('cl1'); c['forwardingNo'].set('FWD-1'); c['bags'].set('3');
    c['assign']();
    const create = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/manifests'));
    expect(create.request.body).toMatchObject({ bookingBranchId: 'me', deliveryBranchId: 'kot', shipmentIds: ['a1'] });
    create.flush({ data: { id: 'm1', manifestNumber: 'LS-1' } });
    const dispatch = http.expectOne((r) => r.url.endsWith('/dispatch'));
    expect(dispatch.request.body).toMatchObject({ manifestId: 'm1', vehicleId: null, driverUserId: null, coLoaderId: 'cl1', forwardingNumber: 'FWD-1', bagsCount: 3 });
  });

  it('Assign to Delivery by a co-loader creates the DRS; RTO needs the message', () => {
    const { c, http } = setup();
    c['setAction']('delivery');
    c['deliveryBy'].set('c:cl1');
    c['assign']();
    const ofd = http.expectOne((r) => r.url.endsWith('/out-for-delivery'));
    expect(ofd.request.body).toMatchObject({ shipmentIds: ['a1'], deliveryUserId: null, coLoaderId: 'cl1' });
    c['setAction']('rto');
    c['assign']();
    expect(c['error']()).toContain('message');
  });
});
