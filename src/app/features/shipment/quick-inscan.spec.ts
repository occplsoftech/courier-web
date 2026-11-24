import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { QuickInscan, readLocked } from './quick-inscan';

describe('QuickInscan locks', () => {
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

  it('keeps only locked fields in this tab\'s session storage, and brings them back on the next visit', () => {
    const { f, c } = make();
    c['set']('consignorName', 'Sai Pharma');
    c['set']('fromPincode', '411026');
    c['set']('consigneeName', 'City Care');
    c['toggleLock']('consignorName');
    c['toggleLock']('fromPincode');
    f.detectChanges();
    expect(readLocked()).toEqual({ locks: { consignorName: true, fromPincode: true }, values: { consignorName: 'Sai Pharma', fromPincode: '411026' } });

    const again = make().c;
    expect(again['v']().consignorName).toBe('Sai Pharma');
    expect(again['v']().fromPincode).toBe('411026');
    expect(again['v']().consigneeName).toBe('');
    expect(again['isLocked']('fromPincode')).toBe(true);
  });

  it('clears unlocked fields for the next parcel and forgets everything on Unlock all', () => {
    const { f, c } = make();
    c['set']('consignorName', 'Sai Pharma');
    c['set']('consigneeName', 'City Care');
    c['toggleLock']('consignorName');
    c['clearForNext']();
    expect(c['v']().consignorName).toBe('Sai Pharma');
    expect(c['v']().consigneeName).toBe('');
    c['unlockAll']();
    f.detectChanges();
    expect(c['lockedCount']()).toBe(0);
    expect(sessionStorage.getItem('cs.quickInscan.locked')).toBeNull();
  });
});
