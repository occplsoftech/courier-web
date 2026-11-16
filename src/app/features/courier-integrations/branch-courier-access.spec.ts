import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { environment } from '@env/environment';
import { AuthService } from '@core/auth/auth.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { BranchCourierAccessCard } from './branch-courier-access';

const base = `${environment.apiBaseUrl}/courier-integrations/customer-access/branch`;
const view = (enabled: string[], customised: boolean) => ({ success: true, data: {
  branchId: 'pun', branchName: 'Pune', customised, customers: 3,
  couriers: [{ code: 'OCCPL_NETWORK', name: 'OCCPL Network', connected: true, enabled: enabled.includes('OCCPL_NETWORK') },
    { code: 'DELHIVERY', name: 'Delhivery', connected: true, enabled: enabled.includes('DELHIVERY') }] } });

describe('BranchCourierAccessCard', () => {
  function create(admin: boolean) {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(),
      { provide: AuthService, useValue: { hasAnyRole: () => admin, user: () => ({ branchId: 'pun' }) } },
      { provide: MasterDataService, useValue: { branchDirectory: () => of([
        { id: 'pun', branchName: 'Pune', branchCode: 'PUN', branchType: 'BRANCH' },
        { id: 'pdp', branchName: 'Partner', branchCode: 'PDP', branchType: 'PICKUP_DELIVERY_PARTNER' }]) } }] });
    const http = TestBed.inject(HttpTestingController);
    const f = TestBed.createComponent(BranchCourierAccessCard);
    f.detectChanges();
    return { f, http, card: f.componentInstance as unknown as { choose(id: string): void; toggle(c: string): void; save(): void; dirty(): boolean } };
  }

  it('a branch manager sees their own branch at once, with how many customers use it', () => {
    const { f, http } = create(false);
    http.expectOne(`${base}/pun`).flush(view([], false));
    f.detectChanges();
    const text = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Your branch');
    expect(text).toContain('3 business customers have this home branch');
    expect(text).toContain('OCCPL Network only');
  });

  it('an admin picks a branch (not a pickup partner) and saves exactly the ticked couriers', () => {
    const { f, http, card } = create(true);
    expect(((f.nativeElement as HTMLElement).querySelectorAll('select option')).length).toBe(2); // "Select…" + Pune
    card.choose('pun');
    http.expectOne(`${base}/pun`).flush(view(['OCCPL_NETWORK'], false));
    card.toggle('DELHIVERY');
    expect(card.dirty()).toBe(true);
    card.save();
    const put = http.expectOne(`${base}/pun`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ providerCodes: ['OCCPL_NETWORK', 'DELHIVERY'] });
    put.flush(view(['OCCPL_NETWORK', 'DELHIVERY'], true));
    expect(card.dirty()).toBe(false);
  });
});
