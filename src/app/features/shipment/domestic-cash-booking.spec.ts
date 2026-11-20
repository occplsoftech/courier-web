import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { DomesticCashBooking, actualKg, volumetricKg } from './domestic-cash-booking';

describe('DomesticCashBooking', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] }));

  const make = () => {
    const f = TestBed.createComponent(DomesticCashBooking);
    return f.componentInstance as unknown as Record<string, any>;
  };

  it('works out actual (per-piece grams × pieces) and volumetric (L×W×H/5000 × pieces) weight in kg', () => {
    const rows = [
      { length: 30, width: 20, height: 15, weightGrams: 800, pieces: 2 },
      { length: null, width: 10, height: 10, weightGrams: 500, pieces: 1 }
    ];
    expect(actualKg(rows)).toBeCloseTo(2.1);
    expect(volumetricKg(rows)).toBeCloseTo(3.6);
  });

  it('will not leave Package Details until the size rows add up to the number of pieces', () => {
    const c = make();
    c['itemType'].set('PARCEL');
    c['numPieces'].set(3);
    c['rows'].set([{ length: 10, width: 10, height: 10, weightGrams: 400, pieces: 2 }]);
    expect(c['stepError'](1)).toBe('Pieces of same size does not match with the total number of pieces.');
    c['rows'].update((rs: any[]) => [...rs, { length: null, width: null, height: null, weightGrams: 300, pieces: 1 }]);
    expect(c['stepError'](1)).toBeNull();
  });

  it('asks for the required shipment details and 10-digit contact numbers', () => {
    const c = make();
    expect(c['stepError'](3)).toBe('Package Description is required.');
    c['d'].set({ packageDescription: 'Books', packageValue: '500', pickupName: 'A', pickupAddress: 'X', pickupContact: '98220',
      pickupAltContact: '', pickupEmail: '', deliveryName: 'B', deliveryAddress: 'Y', deliveryContact: '9819098765', deliveryAltContact: '', deliveryEmail: '' });
    expect(c['stepError'](3)).toBe('Pickup Contact Number must be exactly 10 digits.');
  });

  it('books with the typed AWB, the chosen mode and one item per size (weight in kg)', () => {
    const c = make();
    c['itemType'].set('PARCEL');
    c['awbNumber'].set(' AWB123 ');
    c['fromPincode'].set('411001');
    c['toPincode'].set('400001');
    c['toInfo'].set({ state: 'ok', areaId: 'area-1' });
    c['numPieces'].set(3);
    c['rows'].set([{ length: 30, width: 20, height: 15, weightGrams: 800, pieces: 2 }, { length: null, width: null, height: null, weightGrams: 500, pieces: 1 }]);
    c['modeId'].set('svc-air');
    c['paymentModeId'].set('pm-paid');
    c['referenceId'].set('REF-9');
    c['d'].set({ packageDescription: 'Spares', packageValue: '4500', pickupName: 'Ravi', pickupAddress: 'FC Road', pickupContact: '9822012345',
      pickupAltContact: '', pickupEmail: '', deliveryName: 'Anita', deliveryAddress: 'Marine Drive', deliveryContact: '9819098765', deliveryAltContact: '', deliveryEmail: '' });
    const body = c['buildRequest']();
    expect(body).toMatchObject({ manualShipmentNumber: 'AWB123', pickupPincode: '411001', deliveryPincode: '400001', destinationAreaId: 'area-1',
      serviceTypeId: 'svc-air', paymentModeId: 'pm-paid', declaredValue: 4500, numberOfPackages: 3, remarks: 'Ref: REF-9' });
    expect(body.items.map((i: any) => [i.quantity, i.weight])).toEqual([[2, 1.6], [1, 0.5]]);
  });

  it('starts on Non-Document (Parcel)', () => {
    const c = make();
    expect(c['itemType']()).toBe('PARCEL');
    expect(c['itemTypes'][1].label).toBe('Non-Document (Parcel)');
  });

  it('opens a row for the remaining pieces only when the last row is committed', () => {
    const c = make();
    c['numPieces'].set(3);
    c['rows'].set([{ length: 10, width: 10, height: 10, weightGrams: 400, pieces: 2 }]);
    c['fillRemainder'](0);
    expect(c['rows']().map((r: any) => r.pieces)).toEqual([2, 1]);
    c['fillRemainder'](0); // not the last row any more
    expect(c['rows']().length).toBe(2);
  });

  it('lets the pieces box be cleared while typing instead of forcing 1 back in', () => {
    const c = make();
    c['setRow'](0, 'pieces', { target: { value: '' } } as unknown as Event);
    expect(c['rows']()[0].pieces).toBe(0);
    c['setRow'](0, 'pieces', { target: { value: '2' } } as unknown as Event);
    expect(c['rows']()[0].pieces).toBe(2);
  });

  it('gives Tab focus to the chosen option of a group, or the first when none is chosen', () => {
    const c = make();
    expect(c['roving']('b', 'b', 'a')).toBe(0);
    expect(c['roving']('b', 'a', 'a')).toBe(-1);
    expect(c['roving'](null, 'a', 'a')).toBe(0);
  });
});
