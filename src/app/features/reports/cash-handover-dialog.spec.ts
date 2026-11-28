import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { describe, expect, it, vi } from 'vitest';
import { CashHandoverDialog, CashHandoverDialogData } from './cash-handover-dialog';

function create(data: Partial<CashHandoverDialogData> = {}) {
  const close = vi.fn();
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations(),
      { provide: MatDialogRef, useValue: { close } },
      { provide: MAT_DIALOG_DATA, useValue: {
        branchId: null, today: '2026-11-28', selfId: 'u-me',
        users: [{ userId: 'u-ravi', userName: 'Ravi', outstanding: 400 },
          { userId: 'u-me', userName: 'Me', outstanding: 10 }],
        ...data } }]
  });
  const fixture = TestBed.createComponent(CashHandoverDialog);
  fixture.detectChanges();
  return { fixture, close, http: TestBed.inject(HttpTestingController), el: fixture.nativeElement as HTMLElement };
}

describe('CashHandoverDialog', () => {
  it('prefills the chosen user\'s outstanding cash and records it', () => {
    const { fixture, close, http, el } = create({ userId: 'u-ravi' });
    const amount = el.querySelector<HTMLInputElement>('input[aria-label="Amount"]')!;
    expect(Number(amount.value)).toBe(400);
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne((r) => r.url.endsWith('/branch-wallet/cash-handovers'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ branchId: null, userId: 'u-ravi', amount: 400, mode: 'CASH',
      handoverDate: '2026-11-28', reference: null, remarks: null });
    req.flush({ success: true, data: { id: 'h1' } });
    fixture.detectChanges();
    expect(close).toHaveBeenCalledWith({ id: 'h1' });
  });

  it('never offers the signed-in user as the one handing over', () => {
    const { el } = create();
    const options = Array.from(el.querySelectorAll('select[aria-label="From user"] option')).map((o) => o.textContent!.trim());
    expect(options.some((o) => o.startsWith('Ravi'))).toBe(true);
    expect(options.some((o) => o.startsWith('Me'))).toBe(false);
  });

  it('warns when more than the outstanding amount is entered, and sends nothing without a user', () => {
    const { fixture, http, el } = create({ userId: 'u-ravi' });
    const amount = el.querySelector<HTMLInputElement>('input[aria-label="Amount"]')!;
    amount.value = '450';
    amount.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.textContent).toContain('More than the ₹400.00 outstanding');

    const select = el.querySelector<HTMLSelectElement>('select[aria-label="From user"]')!;
    select.value = '';
    select.dispatchEvent(new Event('change'));
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    http.expectNone((r) => r.url.endsWith('/cash-handovers'));
  });
});
