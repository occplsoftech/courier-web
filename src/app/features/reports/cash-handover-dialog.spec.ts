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
      { provide: MAT_DIALOG_DATA, useValue: { branchId: null, today: '2026-11-28', outstanding: 400, ...data } }]
  });
  const fixture = TestBed.createComponent(CashHandoverDialog);
  fixture.detectChanges();
  return { fixture, close, http: TestBed.inject(HttpTestingController), el: fixture.nativeElement as HTMLElement };
}

function choose(el: HTMLElement, file: File) {
  const input = el.querySelector<HTMLInputElement>('input[aria-label="Proof image"]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

describe('CashHandoverDialog', () => {
  it('prefills what you hold, uploads the proof, then sends the handover for approval', () => {
    const { fixture, close, http, el } = create();
    expect(Number(el.querySelector<HTMLInputElement>('input[aria-label="Amount"]')!.value)).toBe(400);
    choose(el, new File([new Uint8Array([1, 2, 3])], 'slip.jpg', { type: 'image/jpeg' }));
    fixture.detectChanges();
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));

    const upload = http.expectOne((r) => r.url.endsWith('/cash-handovers/upload-proof'));
    expect(upload.request.body instanceof FormData).toBe(true);
    upload.flush({ success: true, data: { url: 'https://files.example/slip.jpg' } });
    const submit = http.expectOne((r) => r.url.endsWith('/branch-wallet/cash-handovers'));
    expect(submit.request.body).toEqual({ branchId: null, amount: 400, mode: 'CASH', handoverDate: '2026-11-28',
      reference: null, remarks: null, proofImageUrl: 'https://files.example/slip.jpg' });
    submit.flush({ success: true, data: { id: 'h1', status: 'PENDING' } });
    expect(close).toHaveBeenCalledWith({ id: 'h1', status: 'PENDING' });
  });

  it('sends nothing without a proof image', () => {
    const { fixture, http, el } = create();
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(el.textContent).toContain('Attach a proof image');
    http.expectNone(() => true);
  });

  it('refuses a file that is not an image', () => {
    const { fixture, el } = create();
    choose(el, new File(['x'], 'notes.pdf', { type: 'application/pdf' }));
    fixture.detectChanges();
    expect(el.textContent).toContain('Choose a JPEG, PNG, WEBP or HEIC image');
  });

  it('warns when more than you hold is entered', () => {
    const { fixture, el } = create();
    const amount = el.querySelector<HTMLInputElement>('input[aria-label="Amount"]')!;
    amount.value = '450';
    amount.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.textContent).toContain('More than the ₹400.00 you hold');
  });
});
