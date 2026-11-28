import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '@core/auth/auth.service';
import { AppRole } from '@core/models/role.model';
import { MasterDataService } from '@features/masters/master-data.service';
import { UserPerformanceReport, todayIst } from './user-performance-report';
import { CashHandover, UserPerformanceRow, UserPerformanceResult } from './user-performance.service';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';

const ME = 'u-manager';

function row(over: Partial<UserPerformanceRow>): UserPerformanceRow {
  return {
    userId: 'u-ravi', userName: 'Ravi', system: false, booked: 4, cancelled: 1, bookingValue: 1200, bookedWeight: 4,
    paidCount: 2, toPayCount: 1, codCount: 0, creditCount: 0, counterCash: 500, counterOnline: 300, counterPending: 0,
    delivered: 0, deliveryPending: 0, failedAttempts: 0, deliveryCash: 0, successRate: null,
    walletDebit: 800, walletRefund: 200, walletNet: 600, commission: 0,
    cashCollected: 500, openingOutstanding: 400, handedOver: 500, closingOutstanding: 400, awaitingApproval: 0, ...over
  };
}

function report(over: Partial<UserPerformanceResult> = {}): UserPerformanceResult {
  const suresh = row({ userId: 'u-suresh', userName: 'Suresh', booked: 0, cancelled: 0, bookingValue: 0, paidCount: 0,
    toPayCount: 0, counterCash: 0, counterOnline: 0, delivered: 1, deliveryPending: 1, successRate: 50, deliveryCash: 900,
    walletDebit: 900, walletRefund: 0, walletNet: 900, cashCollected: 900, openingOutstanding: 250, handedOver: 0,
    closingOutstanding: 1150, awaitingApproval: 700 });
  return {
    branchId: 'b1', from: '2026-11-28', to: '2026-11-28', attribution: 'WORK', trackingFrom: '2026-11-20',
    teamView: true, canApproveHandover: true, rows: [row({}), suresh],
    total: row({ userId: null, userName: 'Branch total', cashCollected: 1400, closingOutstanding: 1550, walletDebit: 1700 }),
    reconciliation: { walletDebits: 1750, walletCredits: 5200, attributedDebits: 1700, unattributedDebits: 50 },
    ...over
  };
}

function handover(over: Partial<CashHandover> = {}): CashHandover {
  return {
    id: 'h1', branchId: 'b1', userId: 'u-suresh', userName: 'Suresh', amount: 700, mode: 'BANK_DEPOSIT', reference: 'SLIP-9',
    remarks: null, handoverDate: '2026-11-28', proofImageUrl: 'https://files.example/p.jpg', submittedAt: '2026-11-28T12:00:00Z',
    status: 'PENDING', decidedBy: null, decidedByName: null, decidedAt: null, decisionRemarks: null,
    voidedBy: null, voidedByName: null, voidedAt: null, voidReason: null, ...over
  };
}

const dialogs = { confirm: vi.fn(() => of(true)), prompt: vi.fn(() => of('Slip unreadable')), previewImage: vi.fn() };

function create(roles: AppRole[], branchId: string | null = 'b1') {
  dialogs.confirm.mockClear(); dialogs.prompt.mockClear(); dialogs.previewImage.mockClear();
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), provideNoopAnimations(),
      { provide: AuthService, useValue: {
        roles: () => roles, hasAnyRole: (r: string[]) => r.some((x) => roles.includes(x as AppRole)),
        user: () => ({ userId: ME, branchId, roles }) } },
      { provide: DialogService, useValue: dialogs },
      { provide: MasterDataService, useValue: { options: () => of([{ value: 'b1', label: 'Pune' }, { value: 'b2', label: 'Mumbai' }]) } }]
  });
  const fixture = TestBed.createComponent(UserPerformanceReport);
  fixture.detectChanges();
  return { fixture, http: TestBed.inject(HttpTestingController), el: fixture.nativeElement as HTMLElement };
}

function flushReport(http: HttpTestingController, data: UserPerformanceResult, pending: CashHandover[] = []) {
  const req = http.expectOne((r) => r.url.endsWith('/branch-wallet/user-performance'));
  req.flush({ success: true, data });
  http.expectOne((r) => r.url.endsWith('/cash-handovers/pending')).flush({ success: true, data: pending });
  return req;
}

describe('UserPerformanceReport', () => {
  it('a branch manager sees every user, cash in hand, and the wallet reconciliation', () => {
    const { fixture, http, el } = create([AppRole.BRANCH_MANAGER]);
    const req = flushReport(http, report());
    expect(req.request.params.get('from')).toBe(todayIst());
    expect(req.request.params.get('attribution')).toBe('WORK');
    expect(req.request.params.has('branchId')).toBe(false);
    fixture.detectChanges();

    expect(el.querySelector('h1')!.textContent).toContain('User Performance');
    const names = Array.from(el.querySelectorAll('tbody td.name')).map((td) => td.textContent!.trim());
    expect(names).toEqual(['Ravi', 'Suresh']);
    expect(el.textContent).toContain('₹1,150.00');
    expect(el.textContent).toContain('₹700.00');
    expect(el.querySelector('[aria-label="Branch wallet reconciliation"]')!.textContent).toContain('Every debit is accounted for');
    expect(el.textContent).toContain('Outstanding cash counted from 20 Nov 2026');
  });

  it('an operator sees "My Performance": their own row, no reconciliation, and can hand over but not approve', () => {
    const { fixture, http, el } = create([AppRole.BOOKING_OPERATOR]);
    flushReport(http, report({ teamView: false, canApproveHandover: false, rows: [row({ userId: ME })], reconciliation: null }),
      [handover({ userId: ME, userName: 'Me' })]);
    fixture.detectChanges();
    expect(el.querySelector('h1')!.textContent).toContain('My Performance');
    expect(el.querySelector('[aria-label="Branch wallet reconciliation"]')).toBeNull();
    expect(el.querySelector('[aria-label="Debits by"]')).toBeNull();
    expect(el.textContent).toContain('Hand over cash');
    Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]'))[1].click();
    http.expectOne((r) => r.url.endsWith('/cash-handovers') && r.method === 'GET').flush({ success: true, data: [] });
    fixture.detectChanges();
    expect(el.querySelector('[aria-label="Handover from Me"]')).not.toBeNull();
    expect(el.querySelector('[aria-label^="Approve handover"]')).toBeNull();
  });

  it('a company admin without a branch is asked to choose one, then the report loads for it', () => {
    const { fixture, http, el } = create([AppRole.COMPANY_ADMIN], null);
    http.expectNone((r) => r.url.endsWith('/user-performance'));
    expect(el.textContent).toContain('Choose a branch');
    const select = el.querySelector<HTMLSelectElement>('select[aria-label="Branch"]')!;
    select.value = 'b2';
    select.dispatchEvent(new Event('change'));
    const req = flushReport(http, report({ branchId: 'b2' }));
    expect(req.request.params.get('branchId')).toBe('b2');
    fixture.detectChanges();
    expect(el.textContent).toContain('Ravi');
  });

  it('switching to "entered by" reloads with that attribution', () => {
    const { fixture, http, el } = create([AppRole.BRANCH_MANAGER]);
    flushReport(http, report());
    fixture.detectChanges();
    const select = el.querySelector<HTMLSelectElement>('select[aria-label="Debits by"]')!;
    select.value = 'ENTERED_BY';
    select.dispatchEvent(new Event('change'));
    expect(flushReport(http, report()).request.params.get('attribution')).toBe('ENTERED_BY');
  });

  it('clicking a figure opens the drill-down for that user and metric', () => {
    const { fixture, http, el } = create([AppRole.BRANCH_MANAGER]);
    flushReport(http, report());
    fixture.detectChanges();
    const counterCash = Array.from(el.querySelectorAll<HTMLButtonElement>('button.lnk')).find((b) => b.textContent!.includes('₹500.00'))!;
    counterCash.click();
    const req = http.expectOne((r) => r.url.endsWith('/user-performance/details'));
    expect(req.request.params.get('userId')).toBe('u-ravi');
    expect(req.request.params.get('metric')).toBe('COUNTER');
    req.flush({ success: true, data: [{ day: '2026-11-28', at: '2026-11-28T05:00:00Z', reference: 'SHP-1', type: 'CASH',
      detail: 'Paid', status: 'PAID', amount: 500 }] });
    fixture.detectChanges();
    expect(el.querySelector('table[aria-label="Details"]')!.textContent).toContain('SHP-1');
  });

  it('an approver sees pending handovers with their proof and approves one after confirming', () => {
    const { fixture, http, el } = create([AppRole.BRANCH_MANAGER]);
    flushReport(http, report(), [handover()]);
    fixture.detectChanges();
    expect(el.querySelector('[aria-label="pending handovers"]')!.textContent).toContain('1');
    Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]'))[1].click();
    http.expectOne((r) => r.url.endsWith('/cash-handovers') && r.method === 'GET').flush({ success: true, data: [
      handover({ id: 'h0', userId: 'u-ravi', userName: 'Ravi', amount: 500, status: 'APPROVED', decidedBy: ME,
        decidedByName: 'Meera', decidedAt: '2026-11-28T13:00:00Z' })] });
    fixture.detectChanges();

    const card = el.querySelector('[aria-label="Handover from Suresh"]')!;
    expect(card.querySelector('img')!.getAttribute('src')).toBe('https://files.example/p.jpg');
    card.querySelector<HTMLButtonElement>('[aria-label="View proof from Suresh"]')!.click();
    expect(dialogs.previewImage).toHaveBeenCalledWith('https://files.example/p.jpg', expect.stringContaining('Suresh'));

    card.querySelector<HTMLButtonElement>('[aria-label="Approve handover from Suresh"]')!.click();
    expect(dialogs.confirm).toHaveBeenCalled();
    const req = http.expectOne((r) => r.url.endsWith('/cash-handovers/h1/approve'));
    expect(req.request.method).toBe('POST');
    req.flush({ success: true, data: handover({ status: 'APPROVED' }) });
    flushReport(http, report());
    http.expectOne((r) => r.url.endsWith('/cash-handovers') && r.method === 'GET').flush({ success: true, data: [] });

    expect(el.querySelector('table[aria-label="Cash handovers"]')).not.toBeNull();
  });

  it('rejecting asks for a reason and sends it', () => {
    const { fixture, http, el } = create([AppRole.ACCOUNTS]);
    flushReport(http, report(), [handover()]);
    fixture.detectChanges();
    Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]'))[1].click();
    http.expectOne((r) => r.url.endsWith('/cash-handovers') && r.method === 'GET').flush({ success: true, data: [] });
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('[aria-label="Reject handover from Suresh"]')!.click();
    const req = http.expectOne((r) => r.url.endsWith('/cash-handovers/h1/reject'));
    expect(req.request.body).toEqual({ reason: 'Slip unreadable' });
  });

  it('nobody gets approve buttons on their own handover', () => {
    const { fixture, http, el } = create([AppRole.BRANCH_MANAGER]);
    flushReport(http, report(), [handover({ userId: ME, userName: 'Meera' })]);
    fixture.detectChanges();
    Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]'))[1].click();
    http.expectOne((r) => r.url.endsWith('/cash-handovers') && r.method === 'GET').flush({ success: true, data: [] });
    fixture.detectChanges();
    expect(el.querySelector('[aria-label="Handover from Meera"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="Approve handover from Meera"]')).toBeNull();
  });
});
