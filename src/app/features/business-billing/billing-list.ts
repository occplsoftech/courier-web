import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import {
  APPROVAL_LABELS, ApprovalStatus, INVOICE_STATUS_LABELS, InvoiceStatus, InvoiceSummary, UnbilledSummary
} from '@core/models/customer-invoice.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiAutocomplete } from '@shared/components/ui-autocomplete/ui-autocomplete';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { BusinessCustomerService } from '@features/business-customer/business-customer.service';
import { BusinessBillingService } from './business-billing.service';

const APPROVAL_OPTS: SelectOption[] = (Object.keys(APPROVAL_LABELS) as ApprovalStatus[]).map((s) => ({ value: s, label: APPROVAL_LABELS[s] }));
const STATUS_OPTS: SelectOption[] = (Object.keys(INVOICE_STATUS_LABELS) as InvoiceStatus[])
  .map((s) => ({ value: s, label: INVOICE_STATUS_LABELS[s] }));

/**
 * Business customer invoices. Invoices are issued automatically when a customer's weekly /
 * 15-day / monthly cycle closes; this screen lists them, and lets an admin bill a customer
 * right now (everything unbilled up to a date) or run the cycle for the company.
 */
@Component({
  selector: 'app-billing-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DecimalPipe, DatePipe, UiButton, UiCard, UiInput, UiSearch, UiSelect, UiAutocomplete, StatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Business Customer Billing</h1>
          <p class="text-caption">Invoices per billing cycle, payments received and what is still owed — {{ rows().length }} shown.</p></div>
        <div class="page__actions">
          <app-search placeholder="Search invoice number…" (changed)="onSearch($event)" />
          @if (canCreate()) {
            <app-button variant="stroked" icon="autorenew" [loading]="running()" (pressed)="runCycle()">Run billing cycle</app-button>
            <app-button icon="add" (pressed)="genOpen.set(!genOpen())">Generate invoice</app-button>
          }
        </div>
      </header>

      <div class="sums">
        <div class="sum"><span>Invoiced</span><strong>₹{{ totalInvoiced() | number: '1.2-2' }}</strong></div>
        <div class="sum"><span>Received</span><strong>₹{{ totalReceived() | number: '1.2-2' }}</strong></div>
        <div class="sum sum--due"><span>Outstanding</span><strong>₹{{ totalOutstanding() | number: '1.2-2' }}</strong></div>
      </div>

      @if (genOpen()) {
        <app-card title="Generate invoice now" subtitle="Bills every booking of the customer, up to the date, that is not on an invoice yet.">
          <div class="gen">
            <app-autocomplete [control]="genCustomer" label="Business Customer" [options]="customerOpts()" placeholder="Search business customer…" />
            <app-input [control]="genDate" label="Bill up to (date)" type="date" />
            <app-button icon="receipt_long" [disabled]="!genCustomerId()" [loading]="generating()" (pressed)="generate()">Generate</app-button>
          </div>
          @if (unbilled(); as u) {
            <p class="hint">{{ u.shipments }} unbilled booking(s) · {{ u.quantity }} package(s) · {{ u.weight | number: '1.0-3' }} kg · ₹{{ u.amount | number: '1.2-2' }}
              @if (u.prepaid > 0) { (₹{{ u.prepaid | number: '1.2-2' }} already paid at booking) }</p>
          }
        </app-card>
      }

      <div class="filters">
        <app-select [control]="customerFilter" label="Customer" [options]="customerOpts()" [allowEmpty]="true" emptyLabel="All customers" placeholder="All customers" />
        <app-select [control]="approvalFilter" label="Approval" [options]="approvalOpts" [allowEmpty]="true" emptyLabel="All" placeholder="All" />
        <app-select [control]="statusFilter" label="Payment status" [options]="statusOpts" [allowEmpty]="true" emptyLabel="All" placeholder="All" />
        <app-input [control]="fromFilter" label="From" type="date" />
        <app-input [control]="toFilter" label="To" type="date" />
      </div>

      <app-card>
        @if (loading()) { <p class="empty">Loading…</p> }
        @else if (!rows().length) { <p class="empty">No invoices yet. They are issued automatically when a billing cycle closes, or use Generate invoice.</p> }
        @else {
          <div class="tw"><table class="t">
            <thead><tr><th>Invoice</th><th>Customer</th><th>Period</th><th class="n">Bookings</th><th class="n">Total</th>
              <th class="n">Received</th><th class="n">Balance</th><th>Approval</th><th>Payment</th></tr></thead>
            <tbody>
              @for (r of rows(); track r.id) {
                <tr (click)="open(r)">
                  <td><strong>{{ r.invoiceNumber }}</strong><div class="sub">{{ r.invoiceDate | date: 'mediumDate' }} · {{ r.source === 'AUTO' ? 'Auto' : 'Manual' }}</div></td>
                  <td>{{ r.customerName || '—' }}</td>
                  <td>{{ r.periodFrom | date: 'dd MMM' }} – {{ r.periodTo | date: 'dd MMM yyyy' }}</td>
                  <td class="n">{{ r.shipmentsCount }}</td>
                  <td class="n">₹{{ r.totalAmount | number: '1.2-2' }}</td>
                  <td class="n">₹{{ r.prepaidAmount + r.amountPaid | number: '1.2-2' }}</td>
                  <td class="n" [class.due]="r.balance > 0 && r.status !== 'CANCELLED'">₹{{ r.balance | number: '1.2-2' }}</td>
                  <td>@if (r.status !== 'CANCELLED') { <app-status-badge [value]="r.approvalStatus === 'APPROVED' ? 'ACTIVE' : 'PENDING'" [label]="approvalLabel(r.approvalStatus)" /> }</td>
                  <td><app-status-badge [value]="r.status" [label]="label(r.status)" /></td>
                </tr>
              }
            </tbody>
          </table></div>
        }
      </app-card>
    </div>
  `,
  styles: [`
    .sums { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; margin-bottom:16px; }
    .sum { background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); padding:14px 16px; display:flex; flex-direction:column; gap:4px; }
    .sum span { font:500 16px var(--font-sans); color:var(--content-muted); } .sum strong { font:700 25px var(--font-sans); }
    .sum--due strong { color:var(--danger); }
    app-card { display:block; margin-bottom:16px; }
    .gen { display:grid; grid-template-columns:minmax(0,2fr) minmax(0,1fr) auto; gap:16px; align-items:end; }
    .hint { font:400 16px var(--font-sans); color:var(--content-muted); margin:12px 0 0; }
    .filters { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:16px; margin:0 0 16px; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:20px; margin:0; }
    .tw { overflow-x:auto; } .t { width:100%; border-collapse:collapse; font:400 17px var(--font-sans); }
    .t th { text-align:left; font:600 15px var(--font-sans); color:var(--content-muted); text-transform:uppercase; letter-spacing:.04em; padding:8px 10px; border-bottom:1px solid var(--surface-border); }
    .t td { padding:10px; border-bottom:1px solid var(--surface-border); vertical-align:top; } .t .n { text-align:right; }
    .t tbody tr { cursor:pointer; } .t tbody tr:hover { background:var(--surface-muted); }
    .sub { font:400 15px var(--font-sans); color:var(--content-muted); } .due { color:var(--danger); font-weight:700; }
    @media (max-width:860px){ .sums, .filters, .gen { grid-template-columns:1fr; } }
  `]
})
export class BillingList implements OnInit {
  private readonly billing = inject(BusinessBillingService);
  private readonly customers = inject(BusinessCustomerService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly router = inject(Router);

  protected readonly rows = signal<InvoiceSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly running = signal(false);
  protected readonly generating = signal(false);
  protected readonly genOpen = signal(false);
  protected readonly unbilled = signal<UnbilledSummary | null>(null);
  protected readonly customerOpts = signal<SelectOption[]>([]);
  protected readonly statusOpts = STATUS_OPTS;
  protected readonly approvalOpts = APPROVAL_OPTS;
  protected readonly approvalFilter = new FormControl<string>('', { nonNullable: true });
  private search = '';

  protected readonly customerFilter = new FormControl<string>('', { nonNullable: true });
  protected readonly statusFilter = new FormControl<string>('', { nonNullable: true });
  protected readonly fromFilter = new FormControl<string>('', { nonNullable: true });
  protected readonly toFilter = new FormControl<string>('', { nonNullable: true });
  protected readonly genCustomer = new FormControl<string>('', { nonNullable: true });
  protected readonly genDate = new FormControl<string>(new Date().toISOString().slice(0, 10), { nonNullable: true });
  /** The autocomplete holds typed text until an option is chosen: only a real customer id counts. */
  protected readonly genCustomerId = signal('');

  protected readonly canCreate = computed(() => this.perms.canAccess({ roles: [AppRole.COMPANY_ADMIN], permissions: ['CUSTOMER_BILLING_CREATE'] }));
  protected readonly live = computed(() => this.rows().filter((r) => r.status !== 'CANCELLED'));
  protected readonly totalInvoiced = computed(() => this.live().reduce((a, r) => a + r.totalAmount, 0));
  protected readonly totalReceived = computed(() => this.live().reduce((a, r) => a + r.prepaidAmount + r.amountPaid, 0));
  protected readonly totalOutstanding = computed(() => this.live().reduce((a, r) => a + r.balance, 0));

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Business Customer' }, { label: 'Billing' }]);
    this.customers.businessCustomers().subscribe((p) =>
      this.customerOpts.set(p.content.map((c) => ({ value: c.id, label: `${c.displayName} (${c.customerCode})` }))));
    [this.customerFilter, this.statusFilter, this.approvalFilter, this.fromFilter, this.toFilter].forEach((c) => c.valueChanges.subscribe(() => this.load()));
    this.genCustomer.valueChanges.subscribe((raw) => {
      const id = this.customerOpts().some((o) => o.value === raw) ? raw : '';
      this.genCustomerId.set(id);
      this.refreshUnbilled();
    });
    this.genDate.valueChanges.subscribe(() => this.refreshUnbilled());
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.billing.invoices({
      customerId: this.customerFilter.value || undefined, status: (this.statusFilter.value || undefined) as InvoiceStatus | undefined,
      approval: (this.approvalFilter.value || undefined) as ApprovalStatus | undefined,
      from: this.fromFilter.value || undefined, to: this.toFilter.value || undefined, search: this.search || undefined
    }).subscribe({ next: (r) => { this.rows.set(r ?? []); this.loading.set(false); }, error: () => this.loading.set(false) });
  }

  private refreshUnbilled(): void {
    const id = this.genCustomerId();
    if (!id) { this.unbilled.set(null); return; }
    this.billing.unbilled(id, this.genDate.value || undefined).subscribe({ next: (u) => this.unbilled.set(u), error: () => this.unbilled.set(null) });
  }

  protected onSearch(t: string): void { this.search = t; this.load(); }
  protected approvalLabel(s: ApprovalStatus): string { return APPROVAL_LABELS[s]; }
  protected label(s: InvoiceStatus): string { return INVOICE_STATUS_LABELS[s]; }
  protected open(r: InvoiceSummary): void { this.router.navigate(['/business-customer/billing', r.id]); }

  protected generate(): void {
    this.generating.set(true);
    this.billing.generate(this.genCustomerId(), this.genDate.value).subscribe({
      next: (inv) => { this.generating.set(false); this.notify.success(`Invoice ${inv.invoiceNumber} generated.`); this.router.navigate(['/business-customer/billing', inv.id]); },
      error: (e) => { this.generating.set(false); this.notify.error(e?.error?.message ?? 'Could not generate the invoice.'); }
    });
  }

  protected runCycle(): void {
    this.running.set(true);
    this.billing.runCycle().subscribe({
      next: (r) => { this.running.set(false); this.notify.success(r.invoicesIssued ? `${r.invoicesIssued} invoice(s) issued.` : 'Nothing to bill — every closed cycle is already invoiced.'); this.load(); },
      error: (e) => { this.running.set(false); this.notify.error(e?.error?.message ?? 'Could not run the billing cycle.'); }
    });
  }
}
