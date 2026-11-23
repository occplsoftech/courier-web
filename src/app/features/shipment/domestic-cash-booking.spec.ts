import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { DomesticCashBooking, ModeRate, actualKg, pricedModes, volumetricKg } from './domestic-cash-booking';

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

  it('divides L×W×H by each service type\'s own divisor, 5000 when it has none', () => {
    const rows = [{ length: 40, width: 40, height: 40, weightGrams: 2000, pieces: 1 }];
    expect(volumetricKg(rows, 4000)).toBeCloseTo(16);
    const c = make();
    c['itemType'].set('PARCEL');
    c['rows'].set(rows);
    c['divisors'].set(new Map([['svc-surface', 4000], ['svc-air', null]]));
    expect(c['weightsFor']('svc-surface').chargeable).toBeCloseTo(16);
    expect(c['weightsFor']('svc-air').chargeable).toBeCloseTo(12.8);
    expect(c['weights']().chargeable).toBeCloseTo(12.8); // no mode chosen yet
    c['modeId'].set('svc-surface');
    expect(c['weights']().volumetric).toBeCloseTo(16);
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

  it('charges GST at the company rate from Settings (0% here), not the branch\'s', () => {
    const f = TestBed.createComponent(DomesticCashBooking);
    f.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.match((r) => r.url.endsWith('/company-settings')).forEach((r) => r.flush({ success: true, data: { finance: { gstPercentage: 0 } } }));
    expect((f.componentInstance as unknown as Record<string, any>)['gstPercent']()).toBe(0);
  });

  const mode = (id: string, total: number | null, estimate: number, extra: Partial<ModeRate> = {}): ModeRate => ({
    serviceTypeId: id, label: id, total, freight: 0, oda: 0, extras: 0, gst: 0, estimate, days: null, chargeable: 5, ...extra });

  it('offers only the services with charges set up, cheapest first', () => {
    const shown = pricedModes([mode('air', 300, 300), mode('none', null, 0, { error: 'No rate' }), mode('zero', 0, 0), mode('surface', 120, 120)]);
    expect(shown.map((m) => m.serviceTypeId)).toEqual(['surface', 'air']);
  });

  it('notes on Cargo that up to 20 kg costs the same, only below 20 kg', () => {
    const c = make();
    expect(c['cargoNote'](mode('cargo', 500, 500, { cargo: true, chargeable: 7 }))).toBe(true);
    expect(c['cargoNote'](mode('cargo', 500, 500, { cargo: true, chargeable: 20 }))).toBe(false);
    expect(c['cargoNote'](mode('air', 500, 500, { chargeable: 7 }))).toBe(false);
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

  describe('Credit Shipment', () => {
    const makeCredit = () => {
      TestBed.overrideProvider(ActivatedRoute, { useValue: { snapshot: { data: { credit: true } } } });
      return TestBed.createComponent(DomesticCashBooking).componentInstance as unknown as Record<string, any>;
    };

    it('has no payment step and asks for the client first', () => {
      const c = makeCredit();
      expect(c['steps']).toEqual(['Serviceability Check', 'Package Details', 'Mode of Dispatch', 'Shipment Details']);
      expect(c['stepError'](0)).toBe('Select the credit client first.');
    });

    it('books for the client, To Be Billed', () => {
      const c = makeCredit();
      c['client'].set({ id: 'cust-9', displayName: 'Sai Pharma', addresses: [] });
      c['paymentModeId'].set('pm-tbb');
      c['modeId'].set('svc-srf');
      c['toInfo'].set({ state: 'ok', areaId: 'area-1' });
      c['numPieces'].set(1);
      c['rows'].set([{ length: null, width: null, height: null, weightGrams: 900, pieces: 1 }]);
      c['d'].set({ packageDescription: 'Medicines', packageValue: '18000', pickupName: 'Sai Pharma', pickupAddress: 'MIDC', pickupContact: '9890011122',
        pickupAltContact: '', pickupEmail: '', deliveryName: 'City Care', deliveryAddress: 'Bandra', deliveryContact: '9819012345', deliveryAltContact: '', deliveryEmail: '' });
      expect(c['buildRequest']()).toMatchObject({ businessCustomerId: 'cust-9', paymentModeId: 'pm-tbb', serviceTypeId: 'svc-srf' });
    });

    it('Continue Inscan keeps the client and sender but clears the shipment', () => {
      const c = makeCredit();
      c['client'].set({ id: 'cust-9', displayName: 'Sai Pharma', addresses: [] });
      c['toPincode'].set('400001');
      c['active'].set(3);
      c['booked'].set({ id: 's1', number: 'PNQ-1' });
      c['d'].update((d: any) => ({ ...d, pickupName: 'Sai Pharma', deliveryName: 'City Care' }));
      c['continueInscan']();
      expect(c['client']().id).toBe('cust-9');
      expect(c['d']().pickupName).toBe('Sai Pharma');
      expect(c['d']().deliveryName).toBe('');
      expect(c['toPincode']()).toBe('');
      expect(c['active']()).toBe(0);
      expect(c['booked']()).toBeNull();
    });
  });
});
