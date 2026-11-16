import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { environment } from '@env/environment';
import { MasterDataService } from '@features/masters/master-data.service';
import { HomeBranchCard } from './home-branch-card';

describe('HomeBranchCard', () => {
  it('shows where the couriers come from and saves a new home branch', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
      { provide: MasterDataService, useValue: { branchDirectory: () => of([
        { id: 'pun', branchName: 'Pune', branchCode: 'PUN', branchType: 'BRANCH' },
        { id: 'mum', branchName: 'Mumbai', branchCode: 'MUM', branchType: 'BRANCH' }]) } }] });
    const http = TestBed.inject(HttpTestingController);
    const f = TestBed.createComponent(HomeBranchCard);
    f.componentRef.setInput('customer', { id: 'c1', homeBranchId: 'pun' });
    f.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/courier-integrations/customer-access/c1`).flush({ success: true, data: {
      customerId: 'c1', customised: false, source: 'BRANCH', homeBranchName: 'Pune',
      couriers: [{ code: 'DELHIVERY', name: 'Delhivery', connected: true, enabled: true }] } });
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).toContain('Delhivery');
    expect((f.nativeElement as HTMLElement).textContent).toContain('from the home branch (Pune)');

    const card = f.componentInstance as unknown as { branchId: { set(v: string): void }; save(): void; dirty(): boolean };
    card.branchId.set('mum');
    expect(card.dirty()).toBe(true);
    card.save();
    const patch = http.expectOne(`${environment.apiBaseUrl}/customers/c1/home-branch`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ branchId: 'mum' });
    patch.flush({ success: true, data: { id: 'c1', homeBranchId: 'mum' } });
    http.expectOne(`${environment.apiBaseUrl}/courier-integrations/customer-access/c1`).flush({ success: true, data: {
      customerId: 'c1', customised: false, source: 'DEFAULT', couriers: [] } });
  });
});
