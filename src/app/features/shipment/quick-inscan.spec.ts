import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { QuickInscan, readLocked } from './quick-inscan';

describe('QuickInscan', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
  });
  afterEach(() => sessionStorage.clear());

  const make = () => {
    const f = TestBed.createComponent(QuickInscan);
    f.detectChanges();
    return { f, c: f.componentInstance as unknown as Record<string, any> };
  };

  it('starts with the batch (client, consignor, sender pincode, parcel type) locked', () => {
    const { c } = make();
    expect(['clientId', 'consignorName', 'fromPincode', 'parcelType'].every((k) => c['isLocked'](k))).toBe(true);
    expect(c['isLocked']('pieces')).toBe(false);
  });

  it('keeps only locked fields in this tab\'s session storage, and brings them back on the next visit', () => {
    const { f, c } = make();
    c['set']('consignorName', 'Sai Pharma');
    c['set']('consigneeName', 'City Care');
    c['toggleLock']('clientId');
    f.detectChanges();
    expect(readLocked().values).toEqual({ consignorName: 'Sai Pharma', fromPincode: '', parcelType: 'PARCEL' });
    expect(readLocked().locks['clientId']).toBe(false);

    const again = make().c;
    expect(again['v']().consignorName).toBe('Sai Pharma');
    expect(again['v']().consigneeName).toBe('');
    expect(again['isLocked']('clientId')).toBe(false);
  });

  it('clears unlocked fields for the next parcel; Unlock all forgets every lock', () => {
    const { f, c } = make();
    c['set']('consignorName', 'Sai Pharma');
    c['set']('pieces', '2');
    c['clearForNext']();
    expect(c['v']().consignorName).toBe('Sai Pharma');
    expect(c['v']().pieces).toBe('');
    c['unlockAll']();
    f.detectChanges();
    expect(c['lockedCount']()).toBe(0);
  });

  it('asks for what is missing, in form order, before booking', () => {
    const { c } = make();
    expect(c['missing']()).toBe('Select the credit client.');
    c['set']('clientId', 'cust-1');
    c['set']('consignorName', 'Sai Pharma');
    c['from'].set({ state: 'ok', city: 'Pune' });
    expect(c['missing']()).toBe('No of Pieces is required.');
  });

  it('books To Be Billed for the client: one item, weight in kg, typed AWB', () => {
    const { c } = make();
    c['tbbModeId'] = 'pm-tbb';
    c['branchId'] = 'br-1';
    c['client'].set({ id: 'cust-1', displayName: 'Sai Pharma', mobile: '+91 98900 11122', billingAddressLine1: 'MIDC Bhosari', billingCity: 'Pune' });
    c['to'].set({ state: 'ok', city: 'Mumbai', areaId: 'area-9' });
    c['v'].set({ clientId: 'cust-1', consignorName: 'Sai Pharma', fromPincode: '411026', parcelType: 'PARCEL', pieces: '2', weightGrams: '1500',
      awbNumber: ' AWB77 ', declaredValue: '4000', consigneeName: 'City Care', toPincode: '400050', consigneeAddress: '12 Hill Rd', consigneePhone: '9819012345' });
    const body = c['buildRequest']('svc-1');
    expect(body).toMatchObject({ manualShipmentNumber: 'AWB77', businessCustomerId: 'cust-1', paymentModeId: 'pm-tbb', serviceTypeId: 'svc-1',
      senderContact: '9890011122', senderAddress: 'MIDC Bhosari, Pune', destinationAreaId: 'area-9', declaredValue: 4000, numberOfPackages: 2 });
    expect(body.items).toEqual([{ itemName: 'Parcel', quantity: 2, weight: 1.5, declaredValue: 4000 }]);
  });
});
