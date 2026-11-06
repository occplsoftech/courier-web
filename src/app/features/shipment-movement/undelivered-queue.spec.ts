import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { environment } from '@env/environment';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { UndeliveredQueue } from './undelivered-queue';

const base = `${environment.apiBaseUrl}/shipment-movement`;
const row = (over: Record<string, unknown>) => ({
  shipmentId: 's1', shipmentNumber: 'PUN-000001', trackingNumber: '2611', receiverName: 'Ravi', receiverContact: '9800000002',
  receiverAddress: '5 Park St', toCity: 'Mumbai', currentLocationId: 'b1', deliveryBranchId: 'b1', attempts: 1,
  reason: 'RECEIVER_NOT_AVAILABLE', reasonLabel: 'Receiver not available', note: null, failedAt: '2026-11-06T10:00:00Z', daysWaiting: 0,
  choice: null, choiceLabel: null, choiceDate: null, choiceAt: null, returnFlagged: false, ...over
});

describe('UndeliveredQueue', () => {
  function create(prompt = of<string | undefined>('3 attempts')) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: DialogService, useValue: { prompt: () => prompt } }]
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(UndeliveredQueue);
    fixture.detectChanges();
    http.expectOne(`${base}/undelivered`).flush({ data: [
      row({}),
      row({ shipmentId: 's2', shipmentNumber: 'PUN-000002', attempts: 3, returnFlagged: true }),
      row({ shipmentId: 's3', shipmentNumber: 'PUN-000003', choice: 'REATTEMPT', choiceLabel: 'Deliver again', choiceDate: '2026-11-08' })
    ] });
    fixture.detectChanges();
    return { fixture, http };
  }

  it('lists the open cases with the customer\'s choice and counts each filter', () => {
    const { fixture } = create();
    const c = fixture.componentInstance;
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('PUN-000001');
    expect(text).toContain('Deliver again');
    expect(text).toContain('Return due');
    expect(c.flaggedCount()).toBe(1);
    expect(c.answeredCount()).toBe(1);
    c.filter.set('FLAGGED');
    expect(c.shown().map((x) => x.shipmentNumber)).toEqual(['PUN-000002']);
    c.filter.set('WAITING');
    expect(c.shown().length).toBe(2);
  });

  it('returns a shipment with the reason given, then reloads', () => {
    const { fixture, http } = create();
    fixture.componentInstance.returnIt(fixture.componentInstance.cases()[1]);
    const req = http.expectOne(`${base}/s2/return`);
    expect(req.request.body).toEqual({ reason: '3 attempts' });
    req.flush({ data: {} });
    http.expectOne(`${base}/undelivered`).flush({ data: [] });
  });

  it('does nothing when the return is cancelled', () => {
    const { fixture, http } = create(of(undefined));
    fixture.componentInstance.returnIt(fixture.componentInstance.cases()[0]);
    http.expectNone(`${base}/s1/return`);
  });
});
