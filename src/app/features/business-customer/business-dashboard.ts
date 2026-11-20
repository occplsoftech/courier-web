import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { BusinessDashboard } from '@core/models/pricing-zone.model';
import { BILLING_FREQUENCY_LABELS, BillingFrequency, CustomerPaymentMode, PAYMENT_MODE_LABELS } from '@core/models/customer.model';
import { StatisticCard } from '@shared/components/statistic-card/statistic-card';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { BusinessCustomerService } from './business-customer.service';

interface Bar { label: string; count: number; pct: number; }

/**
 * Business Customer dashboard: the company-wide picture of business accounts — how many, how
 * they pay and are billed, and per-customer booking activity. Every number comes from `GET /business-customers/dashboard`;
 * nothing is computed beyond bar widths. Bookings are matched on the consignor's mobile number.
 */
@Component({
  selector: 'app-business-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, RouterLink, StatisticCard, UiCard, UiLoader, UiButton],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Business Customer Dashboard</h1>
          <p class="text-caption">Business accounts, payment terms and booking activity at a glance.</p></div>
        <div class="page__actions">
          <app-button variant="stroked" icon="refresh" [loading]="loading()" (pressed)="load()">Refresh</app-button>
          <app-button icon="add" (pressed)="go('/customers/new', { type: 'BUSINESS' })">New Customer</app-button>
        </div>
      </header>

      @if (loading() && !data()) {
        <app-loader [minHeight]="300" caption="Loading overview…" />
      } @else if (data(); as d) {
        <div class="tiles">
          <app-statistic-card label="Business Customers" icon="business_center" tone="brand" [value]="d.totals.customers" />
          <app-statistic-card label="Active Customers" icon="check_circle" tone="success" [value]="d.totals.activeCustomers" />
          <app-statistic-card label="Inactive Customers" icon="pause_circle" tone="warning" [value]="d.totals.inactiveCustomers" />
          <app-statistic-card label="Bookings This Month" icon="local_shipping" tone="brand" [value]="d.totals.bookingsThisMonth" />
          <app-statistic-card label="Total Bookings" icon="inventory_2" tone="info" [value]="d.totals.bookingsTotal" />
          <app-statistic-card label="Total Qty (Packages)" icon="widgets" tone="brand" [value]="d.totals.totalQuantity" />
          <app-statistic-card label="Total Weight (kg)" icon="scale" tone="info" [value]="kg(d.totals.totalWeight)" />
          <app-statistic-card label="Total Business" icon="payments" tone="success" prefix="₹" [value]="inr(d.totals.totalBusiness)" />
          <app-statistic-card label="Payment Pending" icon="hourglass_top" [tone]="d.totals.paymentPending > 0 ? 'danger' : 'success'" prefix="₹" [value]="inr(d.totals.paymentPending)" />
        </div>

        <div class="grid2">
          <app-card title="Payment Mode" subtitle="Default payment mode per business customer">
            @for (b of modeBars(); track b.label) {
              <div class="bar"><span class="bar__l">{{ b.label }}</span>
                <span class="bar__t"><span class="bar__f" [style.width.%]="b.pct"></span></span><span class="bar__n">{{ b.count }}</span></div>
            }
          </app-card>
          <app-card title="Billing Frequency" subtitle="How often customers are invoiced">
            @for (b of freqBars(); track b.label) {
              <div class="bar"><span class="bar__l">{{ b.label }}</span>
                <span class="bar__t"><span class="bar__f bar__f--alt" [style.width.%]="b.pct"></span></span><span class="bar__n">{{ b.count }}</span></div>
            }
          </app-card>
        </div>

        <app-card title="Customers" [subtitle]="'Matched on the consignor mobile number. Pending = unpaid invoice balances + un-invoiced To Be Billed / To Pay / COD bookings.'">
          @if (!d.customers.length) {
            <p class="empty">No business customers yet.</p>
          } @else {
            <div class="tw"><table class="t">
              <thead><tr><th>Customer</th><th>Payment</th><th>Billing</th><th class="n">This month</th><th class="n">Bookings</th><th class="n">Qty</th><th class="n">Weight (kg)</th><th class="n">Business</th><th class="n">Pending</th><th>Last booking</th><th></th></tr></thead>
              <tbody>
                @for (c of d.customers; track c.customerId) {
                  <tr>
                    <td><a [routerLink]="['/customers', c.customerId]"><strong>{{ c.displayName }}</strong></a>
                      <div class="sub">{{ c.customerCode }} · {{ c.mobile }}@if (c.status !== 'ACTIVE') { · Inactive }</div></td>
                    <td>{{ mode(c.paymentMode) }}</td><td>{{ freq(c.billingFrequency) }}</td>
                    <td class="n">{{ c.bookingsThisMonth }}</td><td class="n">{{ c.bookingsTotal }}</td>
                    <td class="n">{{ c.quantity }}</td><td class="n">{{ c.weight | number: '1.0-3' }}</td>
                    <td class="n">₹{{ c.businessAmount | number: '1.2-2' }}</td>
                    <td class="n" [class.due]="c.pendingAmount > 0">₹{{ c.pendingAmount | number: '1.2-2' }}</td>
                    <td>{{ c.lastBookingAt ? (c.lastBookingAt | date: 'mediumDate') : '—' }}</td>
                    <td class="n"><a routerLink="/business-customer/booking">Book</a></td>
                  </tr>
                }
              </tbody>
            </table></div>
          }
        </app-card>
      } @else {
        <app-card><p class="empty">Could not load the overview.</p></app-card>
      }
    </div>
  `,
  styles: [`
    .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:16px; margin-bottom:16px; }
    .grid2 { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; margin-bottom:16px; }
    app-card { display:block; margin-bottom:16px; } .grid2 app-card { margin-bottom:0; }
    .bar { display:grid; grid-template-columns:110px 1fr 36px; align-items:center; gap:12px; padding:6px 0; font:500 17px var(--font-sans); }
    .bar__t { height:10px; background:var(--surface-muted); border-radius:999px; overflow:hidden; }
    .bar__f { display:block; height:100%; background:var(--brand-600); border-radius:999px; min-width:2px; }
    .bar__f--alt { background:var(--info, var(--brand-400)); }
    .bar__n { text-align:right; font-weight:700; }
    .t a { color:var(--brand-700); font-weight:600; text-decoration:none; } .t a:hover { text-decoration:underline; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:12px; margin:0; }
    .tw { overflow-x:auto; } .t { width:100%; border-collapse:collapse; font:400 17px var(--font-sans); }
    .t th { text-align:left; font:600 15px var(--font-sans); color:var(--content-muted); text-transform:uppercase; letter-spacing:.04em; padding:8px 10px; border-bottom:1px solid var(--surface-border); }
    .t td { padding:10px; border-bottom:1px solid var(--surface-border); vertical-align:top; } .t .n { text-align:right; }
    .due { color:var(--danger); font-weight:700; }
    .sub { font:400 15px var(--font-sans); color:var(--content-muted); }
    @media (max-width:860px){ .grid2 { grid-template-columns:1fr; } }
  `]
})
export class BusinessDashboardPage implements OnInit {
  private readonly service = inject(BusinessCustomerService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly data = signal<BusinessDashboard | null>(null);

  protected readonly modeBars = computed(() => this.bars(this.data()?.byPaymentMode, (k) => this.mode(k)));
  protected readonly freqBars = computed(() => this.bars(this.data()?.byBillingFrequency, (k) => this.freq(k)));

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Business Customer' }, { label: 'Dashboard' }]);
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.service.dashboard().subscribe({
      next: (d) => { this.data.set(d); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  protected go(path: string, queryParams?: Record<string, string>): void { this.router.navigate([path], { queryParams }); }

  protected kg(n: number): string { return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(n ?? 0); }
  protected inr(n: number): string { return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n ?? 0); }

  protected mode(k: string): string { return PAYMENT_MODE_LABELS[k as CustomerPaymentMode] ?? k; }
  protected freq(k: string): string { return BILLING_FREQUENCY_LABELS[k as BillingFrequency] ?? k; }

  private bars(map: Record<string, number> | undefined, label: (k: string) => string): Bar[] {
    const entries = Object.entries(map ?? {});
    const max = Math.max(1, ...entries.map(([, n]) => n));
    return entries.map(([k, n]) => ({ label: label(k), count: n, pct: (n / max) * 100 }));
  }
}
