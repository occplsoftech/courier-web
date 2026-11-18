import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { PermissionService } from '@core/auth/permission.service';
import { UnserviceableReportPage } from './unserviceable-report';

const row = (over: object = {}) => ({ id: 'r1', pincode: '411001', areaId: 'a1', areaName: 'Camp', cityName: 'Pune', reason: 'AREA_OFF',
  staffCount: 5, portalCount: 2, total: 7, firstRequestedAt: '2026-11-10T10:00:00Z', lastRequestedAt: '2026-11-17T10:00:00Z',
  lastBranchId: null, turnedOnAt: null, serviceableNow: false, canTurnOn: true, ...over });

describe('UnserviceableReportPage', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
    { provide: PermissionService, useValue: { hasRole: () => true } }] }));

  it('lists still-unavailable areas with their counts and switches one on', () => {
    const f = TestBed.createComponent(UnserviceableReportPage);
    f.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.match((r) => r.url.includes('branch')).forEach((r) => r.flush({ data: [] }));
    const list = http.expectOne((r) => r.url === '/api/v1/serviceability/unserviceable');
    expect(list.request.params.get('open')).toBe('true');
    list.flush({ data: { content: [row()], page: 0, size: 25, totalElements: 1, totalPages: 1, first: true, last: true, hasNext: false } });
    f.detectChanges();
    const text = (f.nativeElement as HTMLElement).textContent!;
    expect(text).toContain('411001');
    expect(text).toContain('Camp');
    expect(text).toContain('5 staff');
    expect(text).toContain('Still unavailable');

    f.componentInstance.turnOn(f.componentInstance.page().content[0]);
    http.expectOne('/api/v1/serviceability/unserviceable/r1/turn-on')
      .flush({ data: row({ serviceableNow: true, canTurnOn: false, turnedOnAt: '2026-11-18T08:00:00Z' }) });
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).toContain('Serviceable now');
  });
});
