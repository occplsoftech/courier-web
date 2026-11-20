import { ChangeDetectionStrategy, Component, Injectable, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Observable } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiSearch } from '@shared/components/ui-search/ui-search';

export type CarriedBy = 'OCCPL' | 'FORWARDED' | 'BOOKED_WITH';

export interface PlatformBooking {
  id: string; kind: 'SHIPMENT' | 'PORTAL_BOOKING'; companyId: string; companyName: string | null; bookedAt: string;
  number: string | null; awb: string | null; channel: string; customer: string | null;
  fromPincode: string | null; fromCity: string | null; toPincode: string | null; toCity: string | null;
  carriedBy: CarriedBy; carrier: string; providerCode: string | null; service: string | null; partnerAwb: string | null;
  status: string; amount: number | null; cost: number | null;
}
export interface CarrierTotal { carrier: string; carriedBy: CarriedBy; providerCode: string | null; courier: string | null; count: number; }
export interface PlatformBookingsPage {
  content: PlatformBooking[]; page: number; size: number; totalElements: number; totalPages: number; hasNext: boolean;
  totals: CarrierTotal[]; companies: Array<{ id: string; name: string }>;
}
export interface PlatformBookingsQuery {
  companyId?: string; carriedBy?: CarriedBy; providerCode?: string; courier?: string; from?: string; to?: string; search?: string;
  page?: number; size?: number;
}

@Injectable({ providedIn: 'root' })
export class PlatformBookingsService {
  private readonly api = inject(ApiService);
  list(q: PlatformBookingsQuery): Observable<PlatformBookingsPage> {
    return this.api.get<PlatformBookingsPage>('/platform/bookings', q as Record<string, unknown>);
  }
  export(q: PlatformBookingsQuery): Observable<Blob> { return this.api.getBlob('/platform/bookings/export', q as Record<string, unknown>); }
}

const CARRIED_LABEL: Record<CarriedBy, string> = { OCCPL: 'OCCPL Network', FORWARDED: 'Forwarded to', BOOKED_WITH: 'Booked with' };
const CHANNEL_LABEL: Record<string, string> = { COUNTER: 'Counter', PORTAL: 'Portal', API: 'Portal · API', SHOPIFY: 'Portal · Shopify', WOOCOMMERCE: 'Portal · WooCommerce' };

/**
 * Platform console → All Bookings (super admin): every company's bookings, newest first, with who carries each one — OCCPL Network, the
 * courier a hub forwarded it to, or the courier the customer booked directly (aggregators as "Delhivery via Shipyaari"). Counts per
 * carrier double as filters; the list downloads as Excel.
 */
@Component({
  selector: 'app-all-bookings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButton, UiSearch, DatePipe, DecimalPipe],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">All Bookings</h1>
          <p class="text-caption">Every company's bookings and who carries them: OCCPL's own network, or the courier partner they were forwarded to or booked with.</p></div>
        <app-button variant="stroked" icon="download" [disabled]="exporting()" (pressed)="download()">{{ exporting() ? 'Preparing…' : 'Download Excel' }}</app-button>
      </header>

      <div class="filters">
        <label>Company
          <select [value]="q().companyId ?? ''" (change)="set({ companyId: $any($event.target).value || undefined })" aria-label="Company">
            <option value="">All companies</option>
            @for (c of companies(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
          </select>
        </label>
        <label>Carried by
          <select [value]="q().carriedBy ?? ''" (change)="setCarried($any($event.target).value)" aria-label="Carried by">
            <option value="">Anyone</option>
            <option value="OCCPL">OCCPL Network</option>
            <option value="FORWARDED">Forwarded to a courier</option>
            <option value="BOOKED_WITH">Booked with a courier</option>
          </select>
        </label>
        <label>From <input type="date" [value]="q().from ?? ''" (change)="set({ from: $any($event.target).value || undefined })" /></label>
        <label>To <input type="date" [value]="q().to ?? ''" (change)="set({ to: $any($event.target).value || undefined })" /></label>
        <app-search placeholder="Number, AWB, courier AWB, customer…" (changed)="set({ search: $event || undefined })" />
      </div>

      @if (chips().length) {
        <div class="chips">
          <button type="button" class="chip" [class.on]="!q().carriedBy && !q().providerCode" (click)="pickChip(null)">All <b>{{ chipTotal() }}</b></button>
          @for (t of chips(); track t.carriedBy + t.carrier) {
            <button type="button" class="chip" [class.on]="isChip(t)" (click)="pickChip(t)">
              @if (t.carriedBy !== 'OCCPL') { <span class="how">{{ carriedLabel(t.carriedBy) }}</span> } {{ t.carrier }} <b>{{ t.count }}</b></button>
          }
        </div>
      }

      <div class="wrap">
        <table class="tbl">
          <thead><tr><th>Booked</th><th>Company</th><th>Number / AWB</th><th>Customer</th><th>From → To</th><th>Carried by</th><th>Status</th><th class="num">Amount</th></tr></thead>
          <tbody>
            @if (loading()) { <tr><td colspan="8" class="muted">Loading…</td></tr> }
            @else if (!page().content.length) { <tr><td colspan="8" class="muted">No bookings match these filters.</td></tr> }
            @for (b of page().content; track b.id) {
              <tr>
                <td>{{ b.bookedAt | date: 'd MMM y, h:mm a' }}</td>
                <td>{{ b.companyName || '—' }}</td>
                <td><span class="cs">{{ b.number || '—' }}</span>@if (b.awb && b.awb !== b.number) { <div class="mono">{{ b.awb }}</div> }
                  <div class="text-caption">{{ channel(b.channel) }}</div></td>
                <td>{{ b.customer || '—' }}</td>
                <td>{{ place(b.fromCity, b.fromPincode) }} → {{ place(b.toCity, b.toPincode) }}</td>
                <td>
                  <span class="carrier" [class.occpl]="b.carriedBy === 'OCCPL'" [class.fwd]="b.carriedBy === 'FORWARDED'" [class.ext]="b.carriedBy === 'BOOKED_WITH'">
                    @if (b.carriedBy !== 'OCCPL') { <small>{{ carriedLabel(b.carriedBy) }}</small> }{{ b.carrier }}</span>
                  @if (b.service && b.carriedBy !== 'OCCPL') { <div class="text-caption">{{ b.service }}</div> }
                  @if (b.partnerAwb) { <div class="mono">AWB {{ b.partnerAwb }}</div> }
                </td>
                <td>{{ status(b.status) }}</td>
                <td class="num">@if (b.amount != null) { ₹{{ b.amount | number: '1.2-2' }} } @else { — }
                  @if (b.cost != null) { <div class="text-caption">courier ₹{{ b.cost | number: '1.2-2' }}</div> }</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <footer class="pager">
        <span class="text-caption">{{ page().totalElements }} booking(s)</span>
        <div>
          <app-button variant="stroked" [disabled]="page().page === 0 || loading()" (pressed)="go(page().page - 1)">Previous</app-button>
          <span class="text-caption">Page {{ page().page + 1 }} of {{ page().totalPages || 1 }}</span>
          <app-button variant="stroked" [disabled]="!page().hasNext || loading()" (pressed)="go(page().page + 1)">Next</app-button>
        </div>
      </footer>
    </div>
  `,
  styles: [`
    .page__head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; }
    .filters { display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap; margin:6px 0 12px; }
    .filters label { display:flex; flex-direction:column; gap:4px; font:600 16px var(--font-sans); }
    .filters select, .filters input { height:38px; border:1px solid var(--surface-border); border-radius:8px; padding:0 10px;
      background:var(--surface-card, #fff); color:var(--content-fg); font:400 17px var(--font-sans); }
    .filters select { min-width:180px; }
    .chips { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
    .chip { border:1px solid var(--surface-border); background:transparent; border-radius:999px; padding:6px 12px; font:500 16px var(--font-sans);
      cursor:pointer; color:var(--content-fg); }
    .chip b { margin-left:4px; } .chip .how { color:var(--content-muted); margin-right:2px; }
    .chip.on { background:var(--primary, #1a56db); color:#fff; border-color:transparent; } .chip.on .how { color:rgb(255 255 255 / 80%); }
    .wrap { overflow-x:auto; border-radius:12px; }
    .tbl { width:100%; border-collapse:collapse; font:400 17px var(--font-sans); background:var(--surface-card, #fff); min-width:1000px; }
    .tbl th { text-align:left; font:600 15px var(--font-sans); text-transform:uppercase; letter-spacing:.04em; color:var(--content-muted); padding:10px 12px; }
    .tbl td { padding:10px 12px; border-top:1px solid var(--surface-border); vertical-align:top; }
    .num { text-align:right; white-space:nowrap; }
    .muted { color:var(--content-muted); text-align:center; padding:24px; }
    .cs { font:600 17px var(--font-sans); }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:15.5px; }
    .carrier { display:inline-flex; flex-direction:column; padding:3px 8px; border-radius:8px; font:600 16px var(--font-sans); }
    .carrier small { font:500 14px var(--font-sans); opacity:.8; }
    .carrier.occpl { background:var(--brand-50, #fdecef); color:var(--brand-700, #9f1239); }
    .carrier.fwd { background:var(--info-bg, #e0f2fe); color:var(--info, #0369a1); }
    .carrier.ext { background:var(--warning-bg, #fef3c7); color:var(--warning, #b45309); }
    .pager { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-top:12px; flex-wrap:wrap; }
    .pager div { display:flex; gap:10px; align-items:center; }
  `]
})
export class AllBookingsPage implements OnInit {
  private readonly svc = inject(PlatformBookingsService);
  private readonly breadcrumb = inject(BreadcrumbService);

  readonly q = signal<PlatformBookingsQuery>({ page: 0, size: 25 });
  readonly page = signal<PlatformBookingsPage>({ content: [], page: 0, size: 25, totalElements: 0, totalPages: 0, hasNext: false, totals: [], companies: [] });
  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly companies = signal<Array<{ id: string; name: string }>>([]);
  /** Carrier counts from the last load without a carrier filter, so picking one keeps the others to switch to. */
  readonly chips = signal<CarrierTotal[]>([]);
  readonly chipTotal = signal(0);

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Platform' }, { label: 'All Bookings' }]);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    const q = this.q();
    this.svc.list(q).subscribe({
      next: (p) => {
        this.page.set(p);
        this.loading.set(false);
        if (p.companies.length) this.companies.set(p.companies);
        if (!q.carriedBy && !q.providerCode) {
          this.chips.set(p.totals);
          this.chipTotal.set(p.totals.reduce((s, t) => s + t.count, 0));
        }
      },
      error: () => this.loading.set(false)
    });
  }

  set(change: Partial<PlatformBookingsQuery>): void {
    this.q.update((q) => ({ ...q, ...change, page: 0 }));
    this.load();
  }

  setCarried(v: string): void { this.set({ carriedBy: (v || undefined) as CarriedBy | undefined, providerCode: undefined, courier: undefined }); }

  pickChip(t: CarrierTotal | null): void {
    this.set(t ? { carriedBy: t.carriedBy, providerCode: t.providerCode ?? undefined, courier: t.courier ?? undefined }
      : { carriedBy: undefined, providerCode: undefined, courier: undefined });
  }

  isChip(t: CarrierTotal): boolean {
    const q = this.q();
    return q.carriedBy === t.carriedBy && (q.providerCode ?? null) === t.providerCode && (q.courier ?? null) === t.courier;
  }

  go(page: number): void { this.q.update((q) => ({ ...q, page })); this.load(); }

  download(): void {
    this.exporting.set(true);
    const { page: _p, size: _s, ...filter } = this.q();
    this.svc.export(filter).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `all-bookings-${new Date().toISOString().slice(0, 10)}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.exporting.set(false);
      },
      error: () => this.exporting.set(false)
    });
  }

  carriedLabel(c: CarriedBy): string { return CARRIED_LABEL[c]; }
  channel(c: string): string { return CHANNEL_LABEL[c] ?? c; }
  place(city: string | null, pin: string | null): string { return [city, pin].filter((x) => !!x).join(' ') || '—'; }
  status(s: string): string { return s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()); }
}
