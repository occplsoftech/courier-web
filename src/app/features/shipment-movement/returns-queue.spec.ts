import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { environment } from '@env/environment';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { ReturnsQueue } from './returns-queue';

const base = `${environment.apiBaseUrl}/shipment-movement`;
const row = (over: Record<string, unknown>) => ({
  id: 's1', shipmentNumber: 'PUN-000001', trackingNumber: '2611', senderName: 'Asha', senderContact: '9800000001',
  receiverName: 'Ravi', toCity: 'Mumbai', status: 'READY_FOR_MANIFEST', currentLocationId: 'mum', bookingBranchId: 'pun',
  backAtOrigin: false, rtoStartedAt: '2026-11-06T10:00:00Z', daysOnTheWay: 1, ...over
});

describe('ReturnsQueue', () => {
  function create(prompt = of<string | undefined>('Asha Shah')) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: DialogService, useValue: { prompt: () => prompt } },
        { provide: MasterDataService, useValue: { branchDirectory: () => of([
          { id: 'pun', branchName: 'Pune', branchCode: 'PUN' }, { id: 'mum', branchName: 'Mumbai', branchCode: 'MUM' }]) } }]
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ReturnsQueue);
    fixture.detectChanges();
    http.expectOne(`${base}/returns`).flush({ data: [
      row({}),
      row({ id: 's2', shipmentNumber: 'PUN-000002', status: 'IN_SCAN', currentLocationId: 'pun', backAtOrigin: true })
    ] });
    fixture.detectChanges();
    return { fixture, http };
  }

  it('shows where each return is and what to do next', () => {
    const { fixture } = create();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('put it on a Load Sheet to Pune (PUN)');
    expect(text).toContain('Back at Pune (PUN)');
    expect(fixture.componentInstance.backCount()).toBe(1);
    fixture.componentInstance.filter.set('BACK');
    expect(fixture.componentInstance.shown().map((c) => c.id)).toEqual(['s2']);
  });

  it('hands a return back with who received it, then reloads', () => {
    const { fixture, http } = create();
    fixture.componentInstance.handBack(fixture.componentInstance.cases()[1]);
    const req = http.expectOne(`${base}/s2/hand-back`);
    expect(req.request.body).toEqual({ receivedBy: 'Asha Shah', remarks: null });
    req.flush({ data: {} });
    http.expectOne(`${base}/returns`).flush({ data: [] });
  });

  it('does nothing when the dialog is closed', () => {
    const { fixture, http } = create(of(undefined));
    fixture.componentInstance.handBack(fixture.componentInstance.cases()[1]);
    http.expectNone(`${base}/s2/hand-back`);
  });
});
