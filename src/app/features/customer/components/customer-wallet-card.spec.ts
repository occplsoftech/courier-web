import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { environment } from '@env/environment';
import { CustomerWalletCard } from './customer-wallet-card';
import { CustomerWalletDialog } from './customer-wallet-dialog';

const base = `${environment.apiBaseUrl}/customers/c1/wallet`;
const wallet = {
  id: 'w1', customerId: 'c1', walletNumber: 'WLT2610ABC', status: 'ACTIVE', availableBalance: 1250.5, holdBalance: 0,
  totalBalance: 1250.5, currency: 'INR', createdAt: '2026-10-26T10:00:00Z'
};
const entry = (over: object = {}) => ({
  id: 'e1', companyId: 'co', walletId: 'w1', transactionNo: 'TXN-1', transactionType: 'CR', transactionTypeLabel: 'Credit',
  subTransactionType: 'WRC', subTransactionTypeLabel: 'Wallet Recharge', amount: 500, balanceBefore: 750.5, balanceAfter: 1250.5,
  createdAt: '2026-10-26T10:05:00Z', ...over
});
const page = (content: object[], over: object = {}) =>
  ({ content, page: 0, size: 10, totalElements: content.length, totalPages: 1, ...over });

describe('CustomerWalletCard', () => {
  let http: HttpTestingController;

  function create(canAdjust: boolean, entries: object[] = [entry()], pageOver: object = {}) {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()] });
    http = TestBed.inject(HttpTestingController);
    const f = TestBed.createComponent(CustomerWalletCard);
    f.componentRef.setInput('customerId', 'c1');
    f.componentRef.setInput('customerName', 'Acme Traders');
    f.componentRef.setInput('canAdjust', canAdjust);
    f.detectChanges();
    http.expectOne(base).flush({ success: true, data: wallet });
    http.expectOne((r) => r.url === `${base}/transactions`).flush({ success: true, data: page(entries, pageOver) });
    f.detectChanges();
    return f;
  }

  afterEach(() => http.verify());

  it('shows the balance, the wallet number and the statement with credits and debits told apart', () => {
    const f = create(false, [entry(), entry({ id: 'e2', transactionNo: 'TXN-2', transactionType: 'DR', subTransactionTypeLabel: 'Shipment Booking',
      amount: 111.8, balanceAfter: 638.7, remarks: 'Courier booking SHIPROCKET' })]);
    const text = f.nativeElement.textContent as string;
    expect(text).toContain('₹1,250.50');
    expect(text).toContain('WLT2610ABC');
    expect(text).toContain('Wallet Recharge');
    expect(text).toContain('+₹500.00');
    expect(text).toContain('Shipment Booking');
    expect(text).toContain('−₹111.80');
    expect(text).toContain('Courier booking SHIPROCKET');
  });

  it('offers credit and debit to a company admin only', () => {
    expect(create(true).nativeElement.textContent).toContain('Credit');
    TestBed.resetTestingModule();
    const viewer = create(false).nativeElement.textContent as string;
    expect(viewer).not.toContain('Credit');
    expect(viewer).not.toContain('Debit');
  });

  it('says so when the wallet has no transactions', () => {
    expect(create(false, []).nativeElement.textContent).toContain('No transactions yet');
  });

  it('opens the dialog with the wallet\'s balance and reloads after an entry is posted', () => {
    const f = create(true);
    const open = vi.spyOn(TestBed.inject(MatDialog), 'open')
      .mockReturnValue({ afterClosed: () => of(entry()) } as never);

    f.componentInstance.adjust('debit');

    expect(open).toHaveBeenCalledWith(CustomerWalletDialog, expect.objectContaining({
      data: { mode: 'debit', customerId: 'c1', customerName: 'Acme Traders', currency: 'INR', availableBalance: 1250.5 }
    }));
    http.expectOne(base).flush({ success: true, data: { ...wallet, availableBalance: 1000 } });
    http.expectOne((r) => r.url === `${base}/transactions`).flush({ success: true, data: page([entry()]) });
    expect(f.componentInstance.wallet()!.availableBalance).toBe(1000);
  });

  it('does not reload when the dialog is cancelled', () => {
    const f = create(true);
    vi.spyOn(TestBed.inject(MatDialog), 'open').mockReturnValue({ afterClosed: () => of(null) } as never);

    f.componentInstance.adjust('credit');

    http.expectNone(base);
  });

  it('pages through the statement', () => {
    const f = create(false, [entry()], { totalPages: 3 });
    f.componentInstance.load(1);
    const r = http.expectOne((x) => x.url === `${base}/transactions`);
    expect(r.request.params.get('page')).toBe('1');
    expect(r.request.params.get('size')).toBe('10');
    r.flush({ success: true, data: page([entry({ id: 'e9' })], { page: 1, totalPages: 3 }) });
    expect(f.componentInstance.entries()!.page).toBe(1);
  });

  it('shows the server\'s message when the wallet cannot be loaded', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()] });
    http = TestBed.inject(HttpTestingController);
    const f = TestBed.createComponent(CustomerWalletCard);
    f.componentRef.setInput('customerId', 'c1');
    f.detectChanges();
    http.expectOne(base).flush({ message: 'Customer not found' }, { status: 404, statusText: 'Not Found' });
    http.expectOne((r) => r.url === `${base}/transactions`).flush({ message: 'Customer not found (statement)' }, { status: 404, statusText: 'Not Found' });
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Customer not found');
    expect(f.nativeElement.textContent).not.toContain('(statement)');
  });
});
