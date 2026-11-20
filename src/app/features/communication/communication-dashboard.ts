import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '@core/auth/auth.service';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { CommunicationService } from './communication.service';
import { apiMessage } from './api-error';
import {
  CommunicationDashboard as Dashboard, COMMUNICATION_CHANNELS, CommunicationFailureRow, DashboardPeriod, FetchedRates
} from '@core/models/communication.model';
import { StatisticCard } from '@shared/components/statistic-card/statistic-card';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { ChartCard } from '@features/dashboard/components/chart-card';
import {
  PERIODS, costView, dailySummaryView, formatRate, hasTrend, money, periodLabel, receiptState, timeAgo, trendSeries
} from './dashboard-view';

function words(value: string): string {
  return value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Communication at a glance for a chosen period (Today / Yesterday / 7 / 30 days, cut at midnight
 * India time): sent, delivered, read, failed and pending, a per-day trend, per-channel breakdown,
 * the messages that need attention (with Retry), the 9:00 AM summary's last run, and how healthy
 * the WhatsApp templates are. Delivered and Read are only real once Meta's webhook reaches this
 * deployment — the page says so plainly instead of showing a quiet zero.
 */
@Component({
  selector: 'app-communication-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, MatIconModule, StatisticCard, UiCard, UiButton, ChartCard],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">Communication Dashboard</h1>
          <p class="text-caption">WhatsApp, SMS and Email — {{ label().toLowerCase() }}, in India time.</p>
        </div>
        <div class="page__actions">
          <div class="seg" role="group" aria-label="Period">
            @for (p of periods; track p.value) {
              <button type="button" [class.on]="period() === p.value" (click)="select(p.value)">{{ p.label }}</button>
            }
          </div>
          <app-button variant="stroked" icon="refresh" [loading]="loading()" (pressed)="load()">Refresh</app-button>
        </div>
      </header>

      @switch (receipts()) {
        @case ('live') {
          <div class="note note--ok"><mat-icon>check_circle</mat-icon>
            <span>Delivery receipts are live — the last one arrived <strong [title]="dashboard()?.lastReceiptAt | date: 'medium'">{{ ago(dashboard()?.lastReceiptAt) }}</strong>.</span>
          </div>
        }
        @case ('waiting') {
          <div class="note note--warn">
            <mat-icon>info</mat-icon>
            <div class="note__body">
              <strong>Delivered and Read will stay at 0 until Meta’s webhook is connected.</strong>
              <span>Messages are being sent, but Meta has never reported back that they arrived. Connect the webhook once:</span>
              <ol>
                <li>In your Meta app: <em>WhatsApp → Configuration → Webhook → Edit</em>.</li>
                <li>Callback URL: <code>{{ webhookUrl }}</code> <button type="button" class="link" (click)="copyUrl()">Copy</button></li>
                <li>Verify token: the value of <code>COMMUNICATION_WHATSAPP_WEBHOOK_VERIFY_TOKEN</code> on the server. The server also needs <code>COMMUNICATION_WHATSAPP_APP_SECRET</code> (your Meta app’s secret).</li>
                <li>Click <em>Verify and save</em>, then subscribe to the <code>messages</code> field.</li>
              </ol>
              <span class="text-caption">Meta only accepts a public <strong>https</strong> address, so this works on a deployed server, not on localhost.</span>
            </div>
          </div>
        }
      }

      <section class="grid">
        <div class="stat">
          <app-statistic-card label="Sent" icon="send" tone="brand" [loading]="loading()" [value]="dashboard()?.totalSent ?? '—'" />
        </div>
        <div class="stat">
          <app-statistic-card label="Delivered" icon="mark_email_read" tone="success" [loading]="loading()" [value]="dashboard()?.totalDelivered ?? '—'" />
          <span class="stat__rate">{{ rate(dashboard()?.deliveryRatePercent) }} of sent</span>
        </div>
        <div class="stat">
          <app-statistic-card label="Read" icon="visibility" tone="info" [loading]="loading()" [value]="dashboard()?.totalRead ?? '—'" />
          <span class="stat__rate">{{ rate(dashboard()?.readRatePercent) }} of sent</span>
        </div>
        <div class="stat">
          <app-statistic-card label="Failed" icon="error" tone="danger" [loading]="loading()" [value]="dashboard()?.totalFailed ?? '—'" />
        </div>
        <div class="stat">
          <app-statistic-card label="Pending" icon="hourglass_top" tone="warning" [loading]="loading()" [value]="dashboard()?.totalPending ?? '—'" />
        </div>
      </section>

      @if (showTrend()) {
        <app-chart-card title="Messages per day" [subtitle]="label()" type="area" [data]="series()"
          [colorKeys]="['brand', 'success', 'danger']" [loading]="loading()" [height]="260" />
      }

      <section class="channels">
        @for (channel of channels; track channel) {
          <app-card [title]="channelLabel(channel)" [subtitle]="label()">
            <div class="channel">
              <div class="cstat"><span class="cstat__v">{{ dashboard()?.channels?.[channel]?.sent ?? 0 }}</span><span class="cstat__l">Sent</span></div>
              <div class="cstat"><span class="cstat__v success">{{ dashboard()?.channels?.[channel]?.delivered ?? 0 }}</span><span class="cstat__l">Delivered</span></div>
              <div class="cstat"><span class="cstat__v danger">{{ dashboard()?.channels?.[channel]?.failed ?? 0 }}</span><span class="cstat__l">Failed</span></div>
              <div class="cstat"><span class="cstat__v warning">{{ dashboard()?.channels?.[channel]?.pending ?? 0 }}</span><span class="cstat__l">Pending</span></div>
            </div>
          </app-card>
        }
      </section>

      <section class="two">
        <app-card title="Needs attention" [subtitle]="'Failed messages · ' + label()">
          <a card-actions class="link" routerLink="/communication/logs">Open logs</a>
          @if (!failures().length) {
            <p class="empty"><mat-icon>check_circle</mat-icon>Nothing failed in this period.</p>
          } @else {
            <ul class="fails">
              @for (f of failures(); track f.id) {
                <li>
                  <div class="fails__main">
                    <strong>{{ eventLabel(f.eventType) }} · {{ f.channel }}</strong>
                    <span class="text-caption">{{ f.recipient || 'no recipient' }} · {{ ago(f.at) }} · {{ f.attemptCount }} attempt{{ f.attemptCount === 1 ? '' : 's' }}</span>
                    <span class="fails__why">{{ f.errorMessage || 'No reason recorded.' }}</span>
                  </div>
                  <app-button variant="stroked" icon="replay" [loading]="isRetrying(f.id)" (pressed)="retry(f)">Retry</app-button>
                </li>
              }
            </ul>
          }
        </app-card>

        <div class="stack">
          <app-card title="Daily 9:00 AM summary" subtitle="Yesterday's business figures, on WhatsApp">
            <div class="sum sum--{{ summary().tone }}">
              <strong>{{ summary().headline }}</strong>
              @if (summary().detail) { <span class="text-caption">{{ summary().detail }}</span> }
            </div>
            <a class="link" routerLink="/communication/settings">Channel settings</a>
          </app-card>

          <app-card title="WhatsApp cost estimate" [subtitle]="label()">
            @if (cost().rows.length) {
              <table class="cost">
                <thead><tr><th>Category</th><th class="num">Messages</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
                <tbody>
                  @for (r of cost().rows; track r.category) {
                    <tr><td>{{ r.category }}</td><td class="num">{{ r.messages }}</td><td class="num">{{ r.rate }}</td><td class="num">{{ r.amount }}</td></tr>
                  }
                </tbody>
                <tfoot><tr><td colspan="3"><strong>Estimated total</strong></td><td class="num"><strong>{{ cost().total }}</strong></td></tr></tfoot>
              </table>
              <p class="text-caption cost__basis">{{ cost().basis }}</p>
            }
            <p class="text-caption cost__hint">{{ cost().hint }}</p>
            <div class="cost__actions">
              @if (isAdmin()) {
                <app-button variant="stroked" icon="cloud_download" [loading]="fetching()" (pressed)="fetchRates()">Fetch from Meta</app-button>
              }
              <a class="link" routerLink="/communication/settings">Set rates by hand</a>
            </div>
            @if (fetched(); as f) {
              <div class="fetched" [class.fetched--ok]="f.saved.length">
                <strong>{{ f.saved.length ? 'Rates fetched from Meta' : 'Nothing to fetch yet' }}</strong>
                <span class="text-caption">{{ f.note }}</span>
                @if (f.rates.length) {
                  <ul>
                    @for (r of f.rates; track r.category) {
                      <li>{{ categoryLabel(r.category) }}: {{ moneyOf(r.rate, f.currency) }} per message
                        <span class="text-caption">({{ r.volume }} delivered, {{ moneyOf(r.cost, f.currency) }} billed)</span></li>
                    }
                  </ul>
                }
              </div>
            }
          </app-card>

          <app-card title="WhatsApp templates" subtitle="Where Meta stands on each one">
            @if (dashboard()?.templates; as t) {
              <div class="health">
                <div><span class="health__v success">{{ t.approved }}</span><span class="health__l">Approved</span></div>
                <div><span class="health__v warning">{{ t.pending }}</span><span class="health__l">Pending</span></div>
                <div><span class="health__v danger">{{ t.rejected }}</span><span class="health__l">Rejected</span></div>
                <div><span class="health__v">{{ t.notSubmitted }}</span><span class="health__l">Not submitted</span></div>
              </div>
              @if (t.switchedOff) { <p class="text-caption health__off">{{ t.switchedOff }} template{{ t.switchedOff === 1 ? ' is' : 's are' }} switched off and sending nothing.</p> }
            }
            <a class="link" routerLink="/communication/templates">Manage templates</a>
          </app-card>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .seg { display:inline-flex; border:1px solid var(--surface-border); border-radius:999px; overflow:hidden; background:var(--surface); }
    .seg button { border:0; background:transparent; padding:7px 14px; font:500 16px var(--font-sans); color:var(--content-muted); cursor:pointer; }
    .seg button.on { background:var(--brand-500); color:#fff; }
    .note { display:flex; gap:12px; align-items:flex-start; padding:12px 16px; border-radius:var(--r-field); font:400 16px var(--font-sans); }
    .note mat-icon { flex-shrink:0; font-size:20px; width:20px; height:20px; }
    .note--ok { background:var(--success-bg); color:var(--success); }
    .note--ok span { color:var(--content-fg); }
    .note--warn { background:var(--warning-bg); }
    .note--warn mat-icon { color:var(--warning); }
    .note__body { display:flex; flex-direction:column; gap:6px; color:var(--content-fg); }
    .note__body ol { margin:2px 0 2px 18px; padding:0; display:flex; flex-direction:column; gap:3px; }
    code { font-family:var(--font-mono, ui-monospace); font-size:15px; background:var(--surface-muted); padding:1px 6px; border-radius:6px; word-break:break-all; }
    .link { color:var(--brand-600, var(--brand-500)); font:500 16px var(--font-sans); cursor:pointer; background:none; border:0; padding:0; text-decoration:none; }
    .link:hover { text-decoration:underline; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:16px; }
    .stat { display:flex; flex-direction:column; gap:6px; }
    .stat__rate { font:500 15px var(--font-sans); color:var(--content-muted); text-align:center; }
    .channels { display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:20px; }
    .channel { display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; text-align:center; }
    .cstat { display:flex; flex-direction:column; gap:4px; }
    .cstat__v { font:700 25px var(--font-sans); color:var(--content-fg); }
    .cstat__v.success, .health__v.success { color:var(--success); }
    .cstat__v.danger, .health__v.danger { color:var(--danger); }
    .cstat__v.warning, .health__v.warning { color:var(--warning); }
    .cstat__l, .health__l { font:500 15px var(--font-sans); color:var(--content-muted); }
    .two { display:grid; grid-template-columns:minmax(0, 3fr) minmax(0, 2fr); gap:20px; align-items:start; }
    .stack { display:flex; flex-direction:column; gap:20px; }
    .empty { display:flex; align-items:center; gap:8px; margin:0; color:var(--content-muted); font:400 16px var(--font-sans); }
    .empty mat-icon { color:var(--success); }
    .fails { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; }
    .fails li { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--surface-border); }
    .fails li:last-child { border-bottom:0; }
    .fails__main { display:flex; flex-direction:column; gap:2px; min-width:0; }
    .fails__why { font:400 15px var(--font-sans); color:var(--danger); overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
    .sum { display:flex; flex-direction:column; gap:4px; padding:10px 14px; border-radius:var(--r-field); margin-bottom:10px; background:var(--surface-muted); }
    .sum--success { background:var(--success-bg); }
    .sum--warning { background:var(--warning-bg); }
    .sum--danger { background:var(--danger-bg); }
    .cost { width:100%; border-collapse:collapse; font:400 16px var(--font-sans); margin-bottom:6px; }
    .cost th { text-align:left; font:600 14px var(--font-sans); color:var(--content-muted); text-transform:uppercase; letter-spacing:.04em; padding:4px 0; }
    .cost td { padding:6px 0; border-top:1px solid var(--surface-border); }
    .cost .num { text-align:right; font-variant-numeric:tabular-nums; }
    .cost__basis, .cost__hint { margin:4px 0 8px; }
    .cost__actions { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
    .fetched { display:flex; flex-direction:column; gap:4px; margin-top:12px; padding:10px 14px; border-radius:var(--r-field);
      background:var(--surface-muted); font:400 16px var(--font-sans); }
    .fetched--ok { background:var(--success-bg); }
    .fetched ul { margin:2px 0 0 18px; padding:0; }
    .health { display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; text-align:center; margin-bottom:8px; }
    .health > div { display:flex; flex-direction:column; gap:2px; }
    .health__v { font:700 25px var(--font-sans); color:var(--content-fg); }
    .health__off { margin:0 0 8px; }
    @media (max-width: 900px) { .two { grid-template-columns:minmax(0, 1fr); } }
  `]
})
export class CommunicationDashboardPage implements OnInit {
  private readonly service = inject(CommunicationService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);

  protected readonly periods = PERIODS;
  protected readonly channels = COMMUNICATION_CHANNELS;
  protected readonly webhookUrl = `${window.location.origin}/api/v1/webhooks/whatsapp`;

  readonly loading = signal(true);
  readonly dashboard = signal<Dashboard | null>(null);
  protected readonly period = signal<DashboardPeriod>('TODAY');
  private readonly retrying = signal<Set<string>>(new Set());
  protected readonly fetching = signal(false);
  protected readonly fetched = signal<FetchedRates | null>(null);
  /** Reading Meta's billing and saving rates changes settings, so it is for company admins only. */
  protected readonly isAdmin = computed(() => this.auth.roles().includes('COMPANY_ADMIN'));

  protected readonly label = computed(() => periodLabel(this.period()));
  protected readonly receipts = computed(() => receiptState(this.dashboard()));
  protected readonly showTrend = computed(() => hasTrend(this.dashboard()));
  protected readonly series = computed(() => trendSeries(this.dashboard()?.daily ?? []));
  protected readonly failures = computed(() => this.dashboard()?.recentFailures ?? []);
  protected readonly summary = computed(() => dailySummaryView(this.dashboard()));
  protected readonly cost = computed(() => costView(this.dashboard()));

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Communication' }, { label: 'Dashboard' }]);
    this.load();
  }

  protected select(period: DashboardPeriod): void {
    if (period === this.period()) return;
    this.period.set(period);
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.service.dashboard(this.period()).subscribe({
      next: (d) => { this.dashboard.set(d); this.loading.set(false); },
      error: () => { this.dashboard.set(null); this.loading.set(false); }
    });
  }

  protected isRetrying(id: string): boolean { return this.retrying().has(id); }

  protected retry(row: CommunicationFailureRow): void {
    this.retrying.update((s) => new Set(s).add(row.id));
    this.service.retry(row.id).subscribe({
      next: () => {
        this.release(row.id);
        this.notify.success('Queued to send again.');
        this.load();
      },
      error: (e) => { this.release(row.id); this.notify.error(apiMessage(e, 'Could not queue the message again.')); }
    });
  }

  /** Meta's own billing -> per-message rates, saved to Channel Settings; then the estimate reloads with them. */
  protected fetchRates(): void {
    this.fetching.set(true);
    this.service.fetchRates().subscribe({
      next: (r) => {
        this.fetched.set(r);
        this.fetching.set(false);
        if (r.saved.length) {
          this.notify.success('Rates fetched from Meta and saved.');
          this.load();
        }
      },
      error: (e) => { this.fetching.set(false); this.notify.error(apiMessage(e, 'Could not fetch the rates from Meta.')); }
    });
  }

  protected copyUrl(): void {
    void navigator.clipboard?.writeText(this.webhookUrl).then(
      () => this.notify.success('Webhook URL copied.'), () => undefined);
  }

  protected rate(value: number | null | undefined): string { return formatRate(value); }
  protected moneyOf(value: number, currency?: string | null): string { return money(value, currency ?? 'INR'); }
  protected categoryLabel(c: string): string { return c.charAt(0) + c.slice(1).toLowerCase(); }
  protected ago(iso: string | null | undefined): string { return timeAgo(iso); }
  protected eventLabel(e: string): string { return words(e); }
  protected channelLabel(channel: string): string { return channel.charAt(0) + channel.slice(1).toLowerCase(); }

  private release(id: string): void {
    this.retrying.update((s) => { const n = new Set(s); n.delete(id); return n; });
  }
}
