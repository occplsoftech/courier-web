import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PickupService } from './pickup.service';

describe('PickupService (13.4 branch filter)', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }));

  it('narrows the list and the counts to a booking branch', () => {
    const svc = TestBed.inject(PickupService);
    const http = TestBed.inject(HttpTestingController);
    svc.list({ page: 0, size: 20, bookingBranchId: 'b1' }).subscribe();
    svc.stats('b1').subscribe();
    svc.stats().subscribe();
    const reqs = http.match(() => true);
    const list = reqs.find((r) => !r.request.url.endsWith('/stats'))!;
    expect(list.request.params.get('bookingBranchId')).toBe('b1');
    const stats = reqs.filter((r) => r.request.url.endsWith('/stats'));
    expect(stats[0].request.params.get('bookingBranchId')).toBe('b1');
    expect(stats[1].request.params.has('bookingBranchId')).toBe(false);
  });
});
