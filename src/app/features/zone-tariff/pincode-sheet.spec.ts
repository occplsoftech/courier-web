import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { AuthService } from '@core/auth/auth.service';
import { AppRole } from '@core/models/role.model';
import { PincodeSheet } from './pincode-sheet';

const row = {
  rowNo: 1, pincode: '413102', city: 'Baramati', state: 'MAHARASHTRA', region: 'X - PUNE', zone: 'WEST',
  docIsOda: 'N', docServ: 'Y', docTat: '48', surfaceServ: 'Y', surfaceTat: '72', airService: 'N', airTat: null,
  premiumService: 'No', premiumTat: null, livePremium: false, liveAirCargo: true, liveSurfaceCargo: null
};

function create(roles: AppRole[]) {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
      { provide: AuthService, useValue: { roles: () => roles } }]
  });
  const fixture = TestBed.createComponent(PincodeSheet);
  fixture.detectChanges();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne((r) => r.url.endsWith('/pincode-sheet')).flush({
    success: true, data: { content: [row], totalElements: 1, totalPages: 1, number: 0, size: 50 }
  });
  fixture.detectChanges();
  return { fixture, http, el: fixture.nativeElement as HTMLElement };
}

describe('PincodeSheet live switches', () => {
  it('shows Premium, Air Cargo and Surface Cargo switches with their live state for a company admin', () => {
    const { el } = create([AppRole.COMPANY_ADMIN]);
    const premium = el.querySelector<HTMLInputElement>('input[aria-label="Premium at 413102"]')!;
    const air = el.querySelector<HTMLInputElement>('input[aria-label="Air Cargo at 413102"]')!;
    expect(premium.checked).toBe(false);
    expect(air.checked).toBe(true);
    expect(el.querySelector('input[aria-label="Surface Cargo at 413102"]')).not.toBeNull();
  });

  it('switching Premium on saves it at once and shows the server state', () => {
    const { fixture, http, el } = create([AppRole.COMPANY_ADMIN]);
    const premium = el.querySelector<HTMLInputElement>('input[aria-label="Premium at 413102"]')!;
    premium.checked = true;
    premium.dispatchEvent(new Event('change'));
    const req = http.expectOne((r) => r.url.endsWith('/pincode-sheet/413102/coverage'));
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ network: 'PREMIUM', serviceable: true });
    req.flush({ success: true, data: { premium: true, airCargo: true, surfaceCargo: null } });
    fixture.detectChanges();
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Premium at 413102"]')!.checked).toBe(true);
  });

  it('a refused switch puts the row back as it was', () => {
    const { fixture, http, el } = create([AppRole.COMPANY_ADMIN]);
    const premium = el.querySelector<HTMLInputElement>('input[aria-label="Premium at 413102"]')!;
    premium.checked = true;
    premium.dispatchEvent(new Event('change'));
    http.expectOne((r) => r.url.endsWith('/coverage')).flush({ success: false, message: 'denied' }, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Premium at 413102"]')!.checked).toBe(false);
  });

  it('other users see On / Off, not switches', () => {
    const { el } = create([AppRole.BRANCH_MANAGER]);
    expect(el.querySelector('input[aria-label="Premium at 413102"]')).toBeNull();
    expect(el.textContent).toContain('On');
    expect(el.textContent).toContain('Off');
  });
});
