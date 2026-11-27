import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse, HttpContext } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { ApiService, SILENT_ERRORS } from '@core/services/api.service';
import { API } from '@core/config/api-endpoints';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { BUSINESS, PUBLIC_PAGE_LINKS } from './public-page.content';

interface PublicTrackEvent { status: string; changedAt: string | null; }
interface PublicTrackResult {
  trackingNumber: string;
  shipmentNumber: string;
  status: string;
  bookingDate: string | null;
  expectedDeliveryDate: string | null;
  fromCity: string | null;
  toCity: string | null;
  timeline: PublicTrackEvent[];
  /** The outside courier delivering it (booked through the customer portal); null for an OCCPL shipment. */
  carrier?: string | null;
  latestStatus?: string | null;
  latestLocation?: string | null;
}
/** Proof of delivery from `POST /track/{number}/verify`; links are short-lived. */
interface PublicTrackPod {
  photoUrl: string | null;
  signatureUrl: string | null;
  deliveredBy: string | null;
  deliveredAt: string | null;
  receivedBy?: string | null;
}

/** Public (no-login) Track Shipment — reached from the login screen so anyone with an
 *  AWB/tracking or shipment number can see its status without an account. Calls the
 *  redacted `GET /track/{number}` endpoint (see `PublicTrackController` on the backend) —
 *  no bearer token attached, none required. Accepts an optional `?q=` so a shared tracking
 *  link (`/track-shipment?q=AWB123`) runs the search immediately.
 *
 *  A delivered shipment offers "Show proof of delivery": the last 4 digits of the receiver's phone unlock
 *  the delivery photo, signature, time and receiver (`POST /track/{number}/verify`, rate-limited). */
@Component({
  selector: 'app-track-shipment',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, DatePipe, UiInput, UiButton, StatusBadge],
  template: `
    <div class="pub">
      <header class="pub__bar">
        <a class="pub__brand" routerLink="/home">Amazing Logistics</a>
        <a class="pub__signin" routerLink="/login">Sign in</a>
      </header>

      <main class="pub__main app-card">
        <h1 class="text-display">Track Shipment</h1>
        <p class="pub__intro text-body">Enter your AWB (Tracking No.) or Shipment No. to see its current status.</p>

        <div class="track__row">
          <app-input [control]="searchControl" label="AWB / Shipment No." placeholder="AWB… / SHP-…"
                     (keydown.enter)="track()" />
          <app-button icon="search" [loading]="searching()" (pressed)="track()">Track</app-button>
        </div>

        @if (notFound()) {
          <p class="track__empty">No shipment matches "{{ lastQuery() }}". Check the number and try again.</p>
        }

        @if (result(); as r) {
          <section class="track__result">
            <div class="track__result-head">
              <div>
                <p class="text-caption">AWB / Tracking No.</p>
                <p class="track__number">{{ r.trackingNumber }}</p>
              </div>
              <app-status-badge [value]="r.status" />
            </div>
            <div class="track__grid">
              <div><p class="text-caption">{{ r.carrier ? 'Reference' : 'Shipment No.' }}</p><p>{{ r.shipmentNumber || '—' }}</p></div>
              @if (r.carrier) {
                <div><p class="text-caption">Delivered by</p><p>{{ r.carrier }}</p></div>
              }
              <div><p class="text-caption">From</p><p>{{ r.fromCity || '—' }}</p></div>
              <div><p class="text-caption">To</p><p>{{ r.toCity || '—' }}</p></div>
              <div><p class="text-caption">Booking Date</p><p>{{ r.bookingDate || '—' }}</p></div>
              @if (r.expectedDeliveryDate) {
                <div><p class="text-caption">Expected Delivery</p><p>{{ r.expectedDeliveryDate }}</p></div>
              }
            </div>

            @if (r.latestStatus || r.latestLocation) {
              <p class="track__latest"><span class="text-caption">Latest update</span>
                {{ r.latestStatus || '' }}@if (r.latestStatus && r.latestLocation) { · }{{ r.latestLocation || '' }}</p>
            }
            @if (r.timeline.length) {
              <div class="track__timeline">
                <p class="text-caption">Timeline</p>
                <ul>
                  @for (event of r.timeline; track $index) {
                    <li><span class="track__timeline-status">{{ event.status }}</span>
                        <span class="track__timeline-date">{{ event.changedAt ? (event.changedAt | date: 'medium') : '' }}</span></li>
                  }
                </ul>
              </div>
            }

            @if (r.status === 'DELIVERED' && !r.carrier) {
              <div class="pod">
                <p class="text-caption">Proof of delivery</p>
                @if (pod(); as p) {
                  <div class="pod__facts">
                    @if (p.deliveredAt) { <p><span class="text-caption">Delivered on</span> {{ p.deliveredAt | date: 'medium' }}</p> }
                    @if (p.receivedBy) { <p><span class="text-caption">Received by</span> {{ p.receivedBy }}</p> }
                    @if (p.deliveredBy) { <p><span class="text-caption">Delivered by</span> {{ p.deliveredBy }}</p> }
                  </div>
                  @if (p.photoUrl) { <img class="pod__img" [src]="p.photoUrl" alt="Proof of delivery photo" /> }
                  @if (p.signatureUrl) { <img class="pod__img pod__img--sig" [src]="p.signatureUrl" alt="Receiver's signature" /> }
                  @if (!p.photoUrl && !p.signatureUrl) { <p class="pod__note">No delivery photo was uploaded for this shipment.</p> }
                } @else if (podMissing()) {
                  <p class="pod__note">Proof of delivery is not available for this shipment yet.</p>
                } @else {
                  <p class="pod__note">Enter the last 4 digits of the receiver's phone number to see the delivery photo.</p>
                  <div class="track__row">
                    <app-input [control]="phoneControl" label="Receiver's phone, last 4 digits" placeholder="1234"
                               type="tel" [maxLength]="4" (keydown.enter)="showPod()" />
                    <app-button icon="lock_open" [loading]="verifying()" (pressed)="showPod()">Show proof of delivery</app-button>
                  </div>
                  @if (podError(); as e) { <p class="pod__error" role="alert">{{ e }}</p> }
                }
              </div>
            }
          </section>
        }
      </main>

      <footer class="pub__footer">
        <nav class="pub__links">
          @for (link of links; track link.key) {
            <a [routerLink]="'/' + link.key">{{ link.label }}</a>
          }
        </nav>
        <p class="text-caption">© {{ year }} {{ business.legalName }}. All rights reserved.</p>
      </footer>
    </div>
  `,
  styles: [`
    .pub { min-height:100vh; display:flex; flex-direction:column; background:var(--surface-muted); }
    .pub__bar { display:flex; align-items:center; justify-content:space-between; padding:20px 24px; }
    .pub__brand { font:700 21px var(--font-display); color:var(--content-fg); text-decoration:none; letter-spacing:-.01em; }
    .pub__signin { font:600 16px var(--font-sans); color:var(--brand-600); text-decoration:none; }
    .pub__main { flex:1; width:100%; max-width:640px; margin:0 auto; padding:40px 44px 56px; }
    .pub__intro { color:var(--content-muted); margin-top:8px; margin-bottom:24px; }
    .pub__footer { padding:28px 24px 40px; display:flex; flex-direction:column; align-items:center; gap:14px; text-align:center; }
    .pub__links { display:flex; flex-wrap:wrap; justify-content:center; gap:8px 18px; max-width:720px; }
    .pub__links a { font:500 16px var(--font-sans); color:var(--content-muted); text-decoration:none; }
    .pub__links a:hover { color:var(--brand-600); text-decoration:underline; }
    .track__row { display:flex; gap:12px; align-items:flex-end; }
    .track__row app-input { flex:1; }
    .track__empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:16px 0 0; }
    .track__result { margin-top:28px; padding-top:24px; border-top:1px solid var(--surface-border); }
    .track__result-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
    .track__number { font:700 21px var(--font-display); color:var(--content-fg); margin:2px 0 0; }
    .track__grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .track__grid p:last-child { font:600 17px var(--font-sans); color:var(--content-fg); margin:2px 0 0; }
    .track__latest { margin:16px 0 0; font:600 17px var(--font-sans); color:var(--content-fg); display:flex; flex-direction:column; gap:2px; }
    .track__timeline { margin-top:24px; }
    .track__timeline ul { list-style:none; margin:8px 0 0; padding:0; display:flex; flex-direction:column; gap:10px; }
    .track__timeline li { display:flex; align-items:center; justify-content:space-between; padding:10px 14px;
      background:var(--surface-muted); border-radius:10px; }
    .track__timeline-status { font:700 16px var(--font-sans); color:var(--content-fg); text-transform:capitalize; }
    .track__timeline-date { font:500 15px var(--font-sans); color:var(--content-muted); }
    .pod { margin-top:24px; padding-top:20px; border-top:1px solid var(--surface-border); display:flex; flex-direction:column; gap:12px; }
    .pod__note { font:400 16px var(--font-sans); color:var(--content-muted); margin:0; }
    .pod__error { font:500 15px var(--font-sans); color:var(--danger-600, #c62828); margin:0; }
    .pod__facts { display:flex; flex-direction:column; gap:6px; }
    .pod__facts p { margin:0; font:600 16px var(--font-sans); color:var(--content-fg); display:flex; flex-direction:column; }
    .pod__img { max-width:100%; border-radius:10px; border:1px solid var(--surface-border); }
    .pod__img--sig { max-height:160px; object-fit:contain; background:#fff; }
    @media (max-width:600px) { .track__row { flex-direction:column; align-items:stretch; } }
    @media (max-width:600px) { .pub__main { padding:28px 20px 40px; } .track__grid { grid-template-columns:1fr; } }
  `]
})
export class TrackShipment {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  protected readonly business = BUSINESS;
  protected readonly links = PUBLIC_PAGE_LINKS;
  protected readonly year = new Date().getFullYear();

  readonly searchControl = new FormControl('', Validators.required);
  readonly searching = signal(false);
  readonly notFound = signal(false);
  readonly lastQuery = signal('');
  readonly result = signal<PublicTrackResult | null>(null);

  readonly phoneControl = new FormControl('', [Validators.required, Validators.pattern(/^\d{4}$/)]);
  readonly verifying = signal(false);
  readonly pod = signal<PublicTrackPod | null>(null);
  /** Verified, but there is no proof of delivery to show (awaiting POD review, or none recorded). */
  readonly podMissing = signal(false);
  readonly podError = signal<string | null>(null);

  private readonly initialQuery = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('q'))),
    { initialValue: null }
  );

  constructor() {
    const q = this.initialQuery();
    if (q) { this.searchControl.setValue(q); this.track(); }
  }

  track(): void {
    const raw = this.searchControl.value?.trim();
    if (!raw) return;
    this.searching.set(true);
    this.notFound.set(false);
    this.result.set(null);
    this.lastQuery.set(raw);
    this.resetPod();

    this.api.get<PublicTrackResult>(API.publicTrack(encodeURIComponent(raw)), undefined,
        new HttpContext().set(SILENT_ERRORS, true)).subscribe({
      next: (r) => { this.searching.set(false); this.result.set(r); },
      error: (e: HttpErrorResponse) => {
        this.searching.set(false);
        this.notFound.set(true);
        if (e.status !== 404) console.error('Track shipment failed', e);
      }
    });
  }

  showPod(): void {
    const r = this.result();
    const code = this.phoneControl.value?.trim() ?? '';
    if (!r || this.verifying()) return;
    if (!/^\d{4}$/.test(code)) { this.podError.set('Enter exactly 4 digits.'); return; }
    this.verifying.set(true);
    this.podError.set(null);
    this.api.post<{ pod: PublicTrackPod | null }>(`${API.publicTrack(encodeURIComponent(r.trackingNumber))}/verify`,
        { phoneLast4: code }, new HttpContext().set(SILENT_ERRORS, true)).subscribe({
      next: (d) => {
        this.verifying.set(false);
        if (d?.pod) { this.pod.set(d.pod); } else { this.podMissing.set(true); }
      },
      error: (e: HttpErrorResponse) => {
        this.verifying.set(false);
        this.podError.set(e.status === 429 ? 'Too many attempts. Please try again later.'
          : (e.error?.message as string | undefined) ?? 'Verification failed. Check the phone number and try again.');
      }
    });
  }

  private resetPod(): void {
    this.pod.set(null);
    this.podMissing.set(false);
    this.podError.set(null);
    this.phoneControl.reset('');
  }
}
