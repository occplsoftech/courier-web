import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, catchError, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { OptionsResponse, QuoteResponse } from '@core/models/zone-tariff.model';
import { ZoneTariffService } from './zone-tariff.service';

type Lookup = { state: 'idle' } | { state: 'ok'; text: string } | { state: 'bad'; text: string };

/**
 * Tariff calculator, laid out like the e-commerce portal's rate calculator: two pincodes and the package give every
 * option the zone tariff has — each service type and package type to the delivery zone — at a glance, cheapest first,
 * with the breakup one click away. The zone under each pincode shows as soon as six digits are typed. "Book" opens
 * Shipment Booking with the delivery pincode, service, package and weight filled in. Nothing is saved here.
 */
@Component({
  selector: 'app-tariff-quote',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, CurrencyPipe, DecimalPipe, MatIconModule],
  template: `
    <section class="calc">
      <header class="calc__title">
        <span class="calc__badge"><mat-icon>calculate</mat-icon></span>
        <div>
          <h1>Tariff calculator</h1>
          <p>Every option on your zone tariff · freight, charges and GST</p>
        </div>
      </header>

      <form class="bar" [formGroup]="form" (ngSubmit)="check()" novalidate>
        <div class="bar__row">
          <div class="f f--wide">
            <label for="tc-from">From pincode</label>
            <input id="tc-from" [class.ok]="from().state === 'ok'" formControlName="originPincode" inputmode="numeric" maxlength="6" placeholder="Pickup" autocomplete="off" />
            <p class="look" [class.ok]="from().state === 'ok'" [class.bad]="from().state === 'bad'" aria-live="polite">
              @if (from().state !== 'idle') { @if (from().state === 'ok') { <mat-icon>check_circle</mat-icon> } {{ text(from()) }} }
            </p>
          </div>
          <div class="f f--wide">
            <label for="tc-to">To pincode</label>
            <input id="tc-to" [class.ok]="to().state === 'ok'" formControlName="destinationPincode" inputmode="numeric" maxlength="6" placeholder="Delivery" autocomplete="off" />
            <p class="look" [class.ok]="to().state === 'ok'" [class.bad]="to().state === 'bad'" aria-live="polite">
              @if (to().state !== 'idle') { @if (to().state === 'ok') { <mat-icon>check_circle</mat-icon> } {{ text(to()) }} }
            </p>
          </div>
          <div class="f">
            <label for="tc-boxes">Boxes</label>
            <input id="tc-boxes" type="number" min="1" max="999" step="1" formControlName="pieces" inputmode="numeric" />
          </div>
          <div class="f">
            <label for="tc-kg">Weight (kg)</label>
            <input id="tc-kg" type="number" min="0" step="0.001" formControlName="actualWeightKg" inputmode="decimal" placeholder="Total" />
          </div>
          <div class="f">
            <label for="tc-val">Value (₹)</label>
            <input id="tc-val" type="number" min="0" step="0.01" formControlName="declaredValue" inputmode="decimal" placeholder="Optional" />
          </div>
          <button class="go" type="submit" [disabled]="loading()">{{ loading() ? 'Checking…' : 'Check rates' }}</button>
        </div>

        <div class="bar__opts">
          <button class="opt" type="button" (click)="dims.set(!dims())" [attr.aria-expanded]="dims()"><mat-icon>{{ dims() ? 'close' : 'add' }}</mat-icon> Dimensions</button>
          <button class="opt opt--warm" type="button" (click)="cod.set(!cod())" [attr.aria-pressed]="cod()"><mat-icon>{{ cod() ? 'check_circle' : 'add' }}</mat-icon> {{ cod() ? 'Cash on delivery' : 'Cash on delivery?' }}</button>
          <label class="opt opt--date">Date <input type="date" formControlName="bookingDate" aria-label="Booking date" /></label>
          @if (dims()) {
            <span class="dims" formGroupName="dimensions">
              <input type="number" min="0" step="0.1" formControlName="length" placeholder="L" aria-label="Length (cm)" />
              <input type="number" min="0" step="0.1" formControlName="width" placeholder="B" aria-label="Breadth (cm)" />
              <input type="number" min="0" step="0.1" formControlName="height" placeholder="H" aria-label="Height (cm)" />
              <small>cm per box; documents and cards without a divisor use the weight</small>
            </span>
          }
        </div>
        @if (error()) { <p class="alert" role="alert">{{ error() }}</p> }
      </form>

      <div class="toolbar" aria-live="polite">
        @if (result(); as r) {
          <div class="filters" role="group" aria-label="Filter by package type">
            <button type="button" class="pill" [class.pill--on]="pkg() === ''" (click)="pkg.set('')">All ({{ r.options.length }})</button>
            @for (p of packages(); track p.code) {
              <button type="button" class="pill" [class.pill--on]="pkg() === p.code" (click)="pkg.set(p.code)">{{ p.code }} ({{ p.count }})</button>
            }
          </div>
          @if (r.rateCardCode) {
            <span class="route">{{ r.rateCardCode }} · {{ r.fromZone?.code }} → {{ r.toZone?.code }}@if (r.oda) { · ODA pincode }</span>
          }
          <label class="sort">Sort
            <select [value]="sort()" (change)="sort.set($any($event.target).value)" aria-label="Sort rates">
              <option value="price">Lowest price</option>
              <option value="fastest">Fastest delivery</option>
              <option value="name">Service name</option>
            </select>
          </label>
        }
      </div>

      @if (loading()) {
        <p class="hint">Pricing every option…</p>
      } @else if (!result()) {
        <div class="empty">
          <mat-icon>local_shipping</mat-icon>
          <p>Enter the route and package above and press <strong>Check rates</strong> — every option on your zone tariff appears here.</p>
        </div>
      } @else {
        @if (result()!.options.length === 0) {
          <p class="hint">The rate card has no rate to this zone that can carry this shipment.</p>
        }
        <div class="grid">
          @for (o of shown(); track o.serviceTypeId + o.packageTypeId) {
            <article class="rate">
              @if (o === cheapest()) { <span class="lowest">↓ Lowest</span> }
              <span class="rate__icon"><mat-icon>{{ icon(o) }}</mat-icon></span>
              <h2>{{ o.serviceTypeName || o.serviceTypeCode }}</h2>
              <p class="rate__svc">{{ o.packageTypeCode }}@if (o.deliveryDays != null) { · {{ o.deliveryDays === 0 ? 'same day' : o.deliveryDays + (o.deliveryDays === 1 ? ' day' : ' days') }} }</p>
              <strong class="rate__price">{{ o.total | currency: 'INR' : 'symbol' : '1.2-2' }}</strong>
              <small>{{ o.total / o.chargeableWeightKg | currency: 'INR' : 'symbol' : '1.2-2' }} / kg · {{ o.chargeableWeightKg | number: '1.0-3' }} kg chargeable</small>
              <details class="rate__breakup">
                <summary>View breakup →</summary>
                <table>
                  <tbody>
                    <tr><td>Freight <span class="why">{{ o.freightBasis }}</span></td><td class="amt">{{ o.freight | currency: 'INR' : 'symbol' : '1.2-2' }}</td></tr>
                    @for (c of o.charges; track c.code) {
                      <tr><td>{{ c.name }} <span class="why">{{ c.basis }}{{ c.taxable ? '' : ' · no GST' }}</span></td><td class="amt">{{ c.amount | currency: 'INR' : 'symbol' : '1.2-2' }}</td></tr>
                    }
                    @for (t of o.taxes; track t.code) {
                      <tr><td>{{ t.code }} {{ t.percent | number: '1.0-2' }}%</td><td class="amt">{{ t.amount | currency: 'INR' : 'symbol' : '1.2-2' }}</td></tr>
                    }
                    @if (o.roundOff !== 0) { <tr><td>Round off</td><td class="amt">{{ o.roundOff | currency: 'INR' : 'symbol' : '1.2-2' }}</td></tr> }
                    <tr class="sum"><td>Total</td><td class="amt">{{ o.total | currency: 'INR' : 'symbol' : '1.2-2' }}</td></tr>
                  </tbody>
                </table>
              </details>
              <button class="book" type="button" (click)="book(o)">Book</button>
            </article>
          }
        </div>
        @if (result()!.unavailable.length) {
          <p class="hint">Not available:
            @for (u of result()!.unavailable; track u.serviceTypeCode + u.packageTypeCode; let last = $last) {
              <strong>{{ u.serviceTypeName || u.serviceTypeCode }} {{ u.packageTypeCode }}</strong> ({{ u.reason }}){{ last ? '' : ', ' }}
            }
          </p>
        }
      }
    </section>
  `,
  styles: [`
    :host { display:block; }
    .calc { max-width:80rem; margin:0 auto; display:flex; flex-direction:column; gap:16px; }
    .calc__title { display:flex; align-items:center; gap:14px; }
    .calc__title h1 { margin:0; font:800 1.5rem var(--font-display); letter-spacing:.04em; text-transform:uppercase; }
    .calc__title p { margin:2px 0 0; color:var(--content-muted); }
    .calc__badge { display:grid; place-items:center; width:3rem; height:3rem; border-radius:16px; background:var(--occpl-gradient-brand); color:#fff; }
    .bar { background:var(--occpl-color-surface); border:1px solid var(--surface-border); border-top:5px solid var(--occpl-color-primary); border-radius:24px; padding:18px 20px; box-shadow:var(--occpl-shadow-md); display:flex; flex-direction:column; gap:12px; }
    .bar__row { display:grid; grid-template-columns:1.3fr 1.3fr .6fr .8fr .9fr auto; gap:12px; align-items:start; }
    .f { display:flex; flex-direction:column; gap:6px; min-width:0; }
    .f label { font:700 .75rem var(--font-sans); letter-spacing:.1em; text-transform:uppercase; color:var(--content-muted); }
    .f input { width:100%; min-height:3.25rem; padding:0 16px; border:2px solid var(--surface-border); border-radius:14px; font:800 1.15rem var(--font-sans); background:var(--occpl-color-surface); color:var(--content-fg); box-sizing:border-box; }
    .f input.ok { border-color:var(--occpl-color-teal); }
    .f input:focus-visible { outline:none; border-color:var(--occpl-color-accent); box-shadow:0 0 0 4px var(--occpl-color-info-surface); }
    .look { display:flex; align-items:center; gap:6px; min-height:1.25rem; margin:0; font:700 .85rem var(--font-sans); }
    .look mat-icon { font-size:18px; width:18px; height:18px; }
    .look.ok { color:var(--occpl-color-teal); } .look.bad { color:var(--danger); }
    .go { align-self:start; margin-top:1.45rem; min-height:3.25rem; padding:0 26px; border:0; border-radius:14px; background:var(--occpl-gradient-button); color:#fff; font:800 .95rem var(--font-sans); letter-spacing:.08em; text-transform:uppercase; cursor:pointer; }
    .go:disabled { opacity:.6; cursor:wait; }
    .bar__opts { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .opt { display:inline-flex; align-items:center; gap:6px; min-height:2.25rem; padding:0 14px; border:2px solid var(--surface-border); border-radius:12px; background:transparent; font:700 .8rem var(--font-sans); letter-spacing:.06em; text-transform:uppercase; color:var(--content-fg); cursor:pointer; }
    .opt mat-icon { font-size:18px; width:18px; height:18px; }
    .opt--warm { border-color:#f9c9b0; color:#ea580c; }
    .opt--date input { border:0; background:transparent; font:600 .85rem var(--font-sans); color:var(--content-fg); }
    .dims { display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .dims input { width:4.5rem; min-height:2.25rem; padding:0 10px; border:2px solid var(--surface-border); border-radius:10px; font:600 .95rem var(--font-sans); background:var(--occpl-color-surface); color:var(--content-fg); }
    .dims small { color:var(--content-muted); }
    .alert { margin:0; padding:10px 14px; border-radius:12px; background:var(--occpl-color-danger-surface); color:var(--danger); font:600 .9rem var(--font-sans); }
    .toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; min-height:2.25rem; }
    .filters { display:flex; gap:8px; flex-wrap:wrap; }
    .pill { padding:8px 18px; border:0; border-radius:14px; background:var(--occpl-color-neutral-surface); color:var(--content-muted); font:800 .8rem var(--font-sans); letter-spacing:.08em; text-transform:uppercase; cursor:pointer; }
    .pill--on { background:var(--occpl-color-text); color:var(--occpl-color-surface); }
    .route { font:700 .85rem var(--font-sans); color:var(--content-muted); letter-spacing:.04em; }
    .sort { display:inline-flex; align-items:center; gap:8px; font:600 .9rem var(--font-sans); color:var(--content-muted); }
    .sort select { min-height:2.25rem; padding:0 12px; border:1px solid var(--surface-border); border-radius:10px; background:var(--occpl-color-surface); color:var(--content-fg); font:inherit; }
    .grid { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:16px; }
    .rate { position:relative; display:flex; flex-direction:column; gap:4px; padding:20px; background:var(--occpl-color-surface); border:1px solid var(--surface-border); border-radius:22px; box-shadow:var(--occpl-shadow-sm); }
    .rate__icon { display:grid; place-items:center; width:2.75rem; height:2.75rem; border-radius:14px; background:var(--occpl-color-info-surface); color:var(--occpl-color-primary); }
    .rate h2 { margin:10px 0 0; font:800 1.15rem var(--font-display); text-transform:uppercase; }
    .rate__svc { margin:0; color:var(--content-muted); }
    .rate__price { margin-top:14px; font:800 1.7rem var(--font-display); }
    .rate small { color:var(--content-muted); }
    .lowest { position:absolute; top:16px; right:16px; padding:2px 10px; border-radius:8px; background:var(--occpl-color-success-surface); color:var(--occpl-color-success); border:1px solid var(--occpl-color-success); font:800 .7rem var(--font-sans); letter-spacing:.08em; text-transform:uppercase; }
    .rate__breakup { margin-top:8px; }
    .rate__breakup summary { cursor:pointer; color:var(--occpl-color-primary); font:800 .8rem var(--font-sans); letter-spacing:.06em; text-transform:uppercase; }
    .rate__breakup table { margin-top:8px; width:100%; border-collapse:collapse; font-size:.9rem; }
    .rate__breakup td { padding:4px 0; border-bottom:1px solid var(--surface-border); vertical-align:top; }
    .rate__breakup .why { display:block; font-size:.75rem; color:var(--content-muted); }
    .rate__breakup .amt { text-align:right; white-space:nowrap; padding-left:8px; }
    .rate__breakup .sum td { font-weight:700; border-bottom:0; }
    .book { min-height:3rem; border:0; border-radius:14px; background:var(--occpl-gradient-button); color:#fff; font:800 .95rem var(--font-sans); letter-spacing:.1em; text-transform:uppercase; cursor:pointer; margin-top:auto; }
    .rate__breakup + .book { margin-top:14px; }
    .hint { margin:0; color:var(--content-muted); text-align:center; }
    .empty { display:flex; flex-direction:column; align-items:center; gap:10px; padding:56px 24px; text-align:center; color:var(--content-muted); border:2px dashed var(--surface-border); border-radius:24px; }
    .empty mat-icon { font-size:36px; width:36px; height:36px; }
    .empty p { margin:0; font-size:1rem; max-width:26rem; }
    @media (max-width: 70rem) { .bar__row { grid-template-columns:repeat(3, minmax(0, 1fr)); } .go { margin-top:0; grid-column:1 / -1; } .grid { grid-template-columns:repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 40rem) { .bar__row { grid-template-columns:repeat(2, minmax(0, 1fr)); } .f--wide { grid-column:1 / -1; } .grid { grid-template-columns:minmax(0, 1fr); } }
  `]
})
export class TariffQuote implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(ZoneTariffService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly router = inject(Router);

  readonly dims = signal(false);
  readonly cod = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<OptionsResponse | null>(null);
  readonly pkg = signal('');
  readonly sort = signal<'price' | 'fastest' | 'name'>('price');

  readonly form = this.fb.nonNullable.group({
    originPincode: ['', [Validators.required, Validators.pattern(/^[1-9][0-9]{5}$/)]],
    destinationPincode: ['', [Validators.required, Validators.pattern(/^[1-9][0-9]{5}$/)]],
    pieces: [1, [Validators.required, Validators.min(1)]],
    actualWeightKg: this.fb.control<number | null>(null, [Validators.required, Validators.min(0.001)]),
    declaredValue: this.fb.control<number | null>(null, [Validators.min(0)]),
    bookingDate: [''],
    dimensions: this.fb.group({
      length: this.fb.control<number | null>(null, [Validators.min(0)]),
      width: this.fb.control<number | null>(null, [Validators.min(0)]),
      height: this.fb.control<number | null>(null, [Validators.min(0)])
    })
  });

  readonly from = this.lookup('originPincode', 'FROM');
  readonly to = this.lookup('destinationPincode', 'TO');

  readonly cheapest = computed<QuoteResponse | null>(() => {
    const opts = this.result()?.options ?? [];
    return opts.length ? opts.reduce((a, b) => (b.total < a.total ? b : a)) : null;
  });
  readonly packages = computed(() => {
    const counts = new Map<string, number>();
    for (const o of this.result()?.options ?? []) counts.set(o.packageTypeCode, (counts.get(o.packageTypeCode) ?? 0) + 1);
    return [...counts].map(([code, count]) => ({ code, count }));
  });
  readonly shown = computed(() => {
    const list = (this.result()?.options ?? []).filter((o) => !this.pkg() || o.packageTypeCode === this.pkg());
    const by = this.sort();
    return [...list].sort((a, b) => by === 'name' ? (a.serviceTypeName || a.serviceTypeCode).localeCompare(b.serviceTypeName || b.serviceTypeCode)
      : by === 'fastest' ? (a.deliveryDays ?? 99) - (b.deliveryDays ?? 99) || a.total - b.total
      : a.total - b.total);
  });

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Zone Tariff' }, { label: 'Calculator' }]);
  }

  protected text(l: Lookup): string { return l.state === 'idle' ? '' : l.text; }

  protected icon(o: QuoteResponse): string {
    const s = `${o.serviceTypeCode} ${o.serviceTypeName ?? ''}`.toUpperCase();
    if (s.includes('AIR')) return 'flight';
    if (s.includes('PREMIUM') || s.includes('EXPRESS')) return 'bolt';
    if (s.includes('CARGO')) return 'inventory_2';
    return 'local_shipping';
  }

  /** The place and tariff zone of a pincode as soon as six digits are typed. */
  private lookup(control: 'originPincode' | 'destinationPincode', direction: 'FROM' | 'TO') {
    return toSignal(
      this.form.controls[control].valueChanges.pipe(
        map((v) => String(v ?? '').trim()),
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((v): Observable<Lookup> => {
          if (!/^[1-9][0-9]{5}$/.test(v)) return of<Lookup>({ state: 'idle' });
          return this.service.resolve(v, direction).pipe(
            map((r): Lookup => r.zone
              ? { state: 'ok', text: `${r.place?.label ?? v} · zone ${r.zone.code}` }
              : { state: 'bad', text: `${r.place?.label ?? v} · in no ${direction === 'FROM' ? 'from' : 'to'} zone` }),
            catchError((e: HttpErrorResponse) => of<Lookup>({ state: 'bad', text: e.error?.message ?? 'Pincode not found' }))
          );
        })
      ),
      { initialValue: { state: 'idle' } as Lookup }
    );
  }

  check(): void {
    this.error.set(null);
    if (this.form.invalid) { this.form.markAllAsTouched(); this.error.set('Enter both 6-digit pincodes, the number of boxes and the weight.'); return; }
    const v = this.form.getRawValue();
    const d = v.dimensions;
    const haveDims = !!(d.length && d.width && d.height);
    this.loading.set(true);
    this.service.quoteOptions({
      originPincode: v.originPincode.trim(), destinationPincode: v.destinationPincode.trim(), actualWeightKg: Number(v.actualWeightKg),
      lengthCm: haveDims ? d.length : null, widthCm: haveDims ? d.width : null, heightCm: haveDims ? d.height : null,
      pieces: v.pieces || 1, declaredValue: v.declaredValue || null, cod: this.cod(), bookingDate: v.bookingDate || null
    }).subscribe({
      next: (r) => { this.loading.set(false); this.pkg.set(''); this.result.set(r); },
      error: (e: HttpErrorResponse) => { this.loading.set(false); this.result.set(null); this.error.set(e.error?.message ?? 'Rates could not be checked right now. Please try again.'); }
    });
  }

  /** Opens Shipment Booking with this option's delivery pincode, service, package and weight filled in. */
  book(o: QuoteResponse): void {
    const v = this.form.getRawValue();
    this.router.navigate(['/shipments/new'], { queryParams: {
      fromTariff: 1, deliveryPincode: v.destinationPincode.trim(), serviceTypeId: o.serviceTypeId, packageTypeId: o.packageTypeId,
      weight: v.actualWeightKg, parcels: v.pieces || 1, declaredValue: v.declaredValue || null, cod: this.cod() ? 1 : null
    } });
  }
}
