import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { environment } from '@env/environment';
import { CustomerWalletDialog, CustomerWalletDialogData } from './customer-wallet-dialog';

const base = `${environment.apiBaseUrl}/customers/c1/wallet`;
const data = (mode: 'credit' | 'debit'): CustomerWalletDialogData =>
  ({ mode, customerId: 'c1', customerName: 'Acme Traders', currency: 'INR', availableBalance: 1000 });

describe('CustomerWalletDialog', () => {
  let http: HttpTestingController;
  const close = vi.fn();

  function create(mode: 'credit' | 'debit') {
    close.mockReset();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: data(mode) }, { provide: MatDialogRef, useValue: { close } }]
    });
    http = TestBed.inject(HttpTestingController);
    const f = TestBed.createComponent(CustomerWalletDialog);
    f.detectChanges();
    return f.componentInstance;
  }

  afterEach(() => http.verify());

  it('credits with the typed amount, defaulting the reason to MCR, and closes with the entry', () => {
    const c = create('credit');
    c.form.patchValue({ amount: 250, referenceId: ' UTR1 ', remarks: ' Bank transfer ' });

    c.save();

    const req = http.expectOne(`${base}/credit`);
    expect(req.request.body).toEqual({ amount: 250, subTransactionType: 'MCR', referenceId: 'UTR1', remarks: 'Bank transfer' });
    req.flush({ success: true, data: { id: 'e1' } });
    expect(close).toHaveBeenCalledWith({ id: 'e1' });
  });

  it('debits through /debit with MDB as the default reason', () => {
    const c = create('debit');
    c.form.patchValue({ amount: 100 });

    c.save();

    const req = http.expectOne(`${base}/debit`);
    expect(req.request.body).toEqual({ amount: 100, subTransactionType: 'MDB', referenceId: null, remarks: null });
    req.flush({ success: true, data: { id: 'e2' } });
    expect(close).toHaveBeenCalledWith({ id: 'e2' });
  });

  it('shows the server\'s refusal (no overdraft) and stays open', () => {
    const c = create('debit');
    c.form.patchValue({ amount: 5000 });

    c.save();
    http.expectOne(`${base}/debit`).flush({ message: 'Insufficient wallet balance. Available INR 1,000.00, required INR 5,000.00.' },
      { status: 422, statusText: 'Unprocessable' });

    expect(c.error()).toContain('Insufficient wallet balance');
    expect(close).not.toHaveBeenCalled();
    expect(c.busy()).toBe(false);
  });

  it('sends nothing for a missing or zero amount', () => {
    const c = create('credit');
    c.save();
    c.form.patchValue({ amount: 0 });
    c.save();
    http.expectNone(`${base}/credit`);
  });

  it('offers only reasons that fit the direction', () => {
    const credit = create('credit') as unknown as { reasons: { value: string }[] };
    expect(credit.reasons.map((r) => r.value)).toContain('MCR');
    expect(credit.reasons.map((r) => r.value)).not.toContain('MDB');
    TestBed.resetTestingModule();
    const debit = create('debit') as unknown as { reasons: { value: string }[] };
    expect(debit.reasons.map((r) => r.value)).toContain('MDB');
    expect(debit.reasons.map((r) => r.value)).not.toContain('MCR');
  });
});
