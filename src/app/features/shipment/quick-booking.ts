import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, effect, inject, signal } from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { CreateShipmentRequest } from '@core/models/shipment.model';
import { CustomerResponse } from '@core/models/customer.model';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { BusinessCustomerService } from '@features/business-customer/business-customer.service';
import { CustomerService } from '@features/customer/customer.service';
import { MASTER_DEFINITIONS } from '@features/masters/master.config';
import { MasterDataService } from '@features/masters/master-data.service';
import { FreightCalculationService } from './freight-calculation.service';
import { ShipmentService } from './shipment.service';

/** The fields of a Quick Booking, as typed (weight in grams, as the desk is used to). */
export interface QuickBookingFields {
  clientId: string; consignorName: string; fromPincode: string; parcelType: 'DOCUMENT' | 'PARCEL';
  pieces: string; weightGrams: string; awbNumber: string; declaredValue: string;
  consigneeName: string; toPincode: string; consigneeAddress: string; consigneePhone: string;
}
type Field = keyof QuickBookingFields;
type Locks = Partial<Record<Field, boolean>>;

/** One generated AWB, for the session table. */
export interface BookingRow { awb: string; id: string; consignee: string; to: string; pieces: number; kg: number; at: string; }

/** A pincode as looked up: its city, and for the destination its Area and whether it is served. */
interface PinInfo { state: 'idle' | 'loading' | 'ok' | 'error'; city?: string | null; areaId?: string | null; message?: string; }

const EMPTY: QuickBookingFields = {
  clientId: '', consignorName: '', fromPincode: '', parcelType: 'PARCEL', pieces: '', weightGrams: '', awbNumber: '',
  declaredValue: '', consigneeName: '', toPincode: '', consigneeAddress: '', consigneePhone: ''
};
/** The batch: locked from the start, since they rarely change within a run of parcels. */
const BATCH: Field[] = ['clientId', 'consignorName', 'fromPincode', 'parcelType'];
const DIGITS: Partial<Record<Field, number>> = { pieces: 5, weightGrams: 9, declaredValue: 9, fromPincode: 6, toPincode: 6, consigneePhone: 10 };
const PINCODE = /^\d{6}$/;

/** Locks, the values they keep, and this session's AWBs live in this browser tab only: kept across reloads, gone when it closes. */
const SESSION_KEY = 'cs.quickBooking.locked';
const DONE_KEY = 'cs.quickBooking.done';

export function readLocked(): { locks: Locks; values: Partial<QuickBookingFields> } {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw === null) return { locks: Object.fromEntries(BATCH.map((k) => [k, true])), values: {} };
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? { locks: parsed.locks ?? {}, values: parsed.values ?? {} } : { locks: {}, values: {} };
  } catch {
    return { locks: Object.fromEntries(BATCH.map((k) => [k, true])), values: {} };
  }
}

function writeLocked(locks: Locks, v: QuickBookingFields): void {
  const values: Partial<QuickBookingFields> = {};
  (Object.keys(locks) as Field[]).filter((k) => locks[k]).forEach((k) => { (values as Record<string, string>)[k] = v[k]; });
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ locks, values })); } catch { /* storage unavailable: locks last this visit only */ }
}

function readDone(): BookingRow[] {
  try { return JSON.parse(sessionStorage.getItem(DONE_KEY) ?? '[]') as BookingRow[]; } catch { return []; }
}

/**
 * Quick Booking — the earlier portal's one-screen credit-client booking ("Quick Inscan" there), laid out as a Batch (client, consignor, sender
 * pincode, parcel type: locked for every parcel) and This parcel (pieces, weight, AWB, value, consignee). Every field has a
 * lock; locked fields keep their value for the next parcel. Generate AWB books it To Be Billed for the client on the
 * cheapest service that has charges for the destination, then clears the unlocked fields.
 */
@Component({
  selector: 'app-quick-booking',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, DecimalPipe, MatIconModule, UiButton],
  template: `
    <div class="qi" (keydown)="onKey($event)">
      <header class="page__head qi__head">
        <div>
          <h1 class="text-h1">Quick Booking</h1>
          <p class="text-caption">Set the batch once, then type each parcel and press Enter.</p>
        </div>
        <div class="stats">
          <div class="stat"><strong>{{ done().length }}</strong><span>parcels this session</span></div>
          <div class="stat"><strong>{{ totalKg() | number: '1.0-1' }} kg</strong><span>total weight</span></div>
        </div>
      </header>

      <div class="qi__body">
        <section class="card batch" aria-label="Batch">
          <div class="batch__head"><h2 class="sec"><mat-icon>lock</mat-icon>Batch</h2><span class="text-caption">kept for every parcel</span></div>
          <div class="f">
            <label class="f__l" for="qi-clientId">Credit Client <b class="req">*</b></label>
            <div class="row">
              <select class="f__i" id="qi-clientId" data-qi (change)="pickClient($any($event.target).value)">
                <option value="" [selected]="!v().clientId">Select the credit client</option>
                @for (c of clients(); track c.value) { <option [value]="c.value" [selected]="c.value === v().clientId">{{ c.label }}</option> }
              </select>
              <ng-container [ngTemplateOutlet]="lockBtn" [ngTemplateOutletContext]="{ k: 'clientId' }" />
            </div>
          </div>
          <ng-container [ngTemplateOutlet]="field" [ngTemplateOutletContext]="{ k: 'consignorName', label: 'Consignor Name', req: true }" />
          <ng-container [ngTemplateOutlet]="field" [ngTemplateOutletContext]="{ k: 'fromPincode', label: 'Sender Pincode', req: true, pin: from() }" />
          <div class="f">
            <span class="f__l">Parcel Type <b class="req">*</b></span>
            <div class="row">
              <div class="seg" role="radiogroup" aria-label="Parcel type">
                @for (t of types; track t.value) {
                  <button type="button" class="seg__opt" role="radio" data-qi [attr.aria-checked]="v().parcelType === t.value"
                          [class.seg__opt--on]="v().parcelType === t.value" (click)="set('parcelType', t.value)">
                    <mat-icon>{{ t.icon }}</mat-icon>{{ t.label }}</button>
                }
              </div>
              <ng-container [ngTemplateOutlet]="lockBtn" [ngTemplateOutletContext]="{ k: 'parcelType' }" />
            </div>
          </div>
          @if (lockedCount()) { <button type="button" class="unlock" (click)="unlockAll()"><mat-icon>lock_open</mat-icon>Unlock all</button> }
        </section>

        <section class="card" aria-label="This parcel">
          <h2 class="sec">This parcel</h2>
          <div class="grid3">
            <ng-container [ngTemplateOutlet]="field" [ngTemplateOutletContext]="{ k: 'pieces', label: 'Pieces', req: true, big: true }" />
            <ng-container [ngTemplateOutlet]="field" [ngTemplateOutletContext]="{ k: 'weightGrams', label: 'Weight (g)', req: true, big: true, suffix: kgLabel() }" />
            <ng-container [ngTemplateOutlet]="field" [ngTemplateOutletContext]="{ k: 'awbNumber', label: 'AWB Number', hint: 'Auto if empty', err: awbTaken() ? 'AWB number already exists. Please use a different AWB number.' : null }" />
          </div>
          <div class="grid2">
            <ng-container [ngTemplateOutlet]="field" [ngTemplateOutletContext]="{ k: 'consigneeName', label: 'Consignee Name', req: true }" />
            <ng-container [ngTemplateOutlet]="field" [ngTemplateOutletContext]="{ k: 'toPincode', label: 'Receiver Pincode', req: true, pin: to() }" />
            <ng-container [ngTemplateOutlet]="field" [ngTemplateOutletContext]="{ k: 'consigneeAddress', label: 'Address', req: true }" />
            <ng-container [ngTemplateOutlet]="field" [ngTemplateOutletContext]="{ k: 'consigneePhone', label: 'Phone', req: true }" />
            <ng-container [ngTemplateOutlet]="field" [ngTemplateOutletContext]="{ k: 'declaredValue', label: 'Declared Value (₹)', req: true }" />
          </div>
          @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
          <div class="actions">
            <span class="text-caption">Enter → next field · Ctrl+Enter → Generate</span>
            <app-button icon="bolt" [loading]="busy()" (pressed)="generate()">Generate AWB</app-button>
          </div>
        </section>
      </div>

      <section class="card">
        <h2 class="sec">Booked this session</h2>
        @if (!done().length) {
          <p class="muted">Each AWB you generate is listed here.</p>
        } @else {
          <div class="tw"><table class="t">
            <thead><tr><th>AWB</th><th>Consignee</th><th>To</th><th class="n">Pcs</th><th class="n">Weight</th><th>Time</th><th></th></tr></thead>
            <tbody>
              @for (d of done(); track d.id) {
                <tr><td><a class="mono" [href]="'/shipments/' + d.id">{{ d.awb }}</a></td><td>{{ d.consignee }}</td><td>{{ d.to }}</td>
                  <td class="n">{{ d.pieces }}</td><td class="n">{{ d.kg | number: '1.0-3' }} kg</td><td>{{ d.at }}</td><td><span class="tag">Booked</span></td></tr>
              }
            </tbody>
          </table></div>
        }
      </section>
    </div>

    @if (success(); as s) {
      <div class="ovl" (click)="closeSuccess()">
        <div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="qi-ok" (click)="$event.stopPropagation()">
          <mat-icon class="dlg__ic">check_circle</mat-icon>
          <h2 id="qi-ok" class="dlg__t">Booking Successful</h2>
          <p>Booking completed successfully. AWB Number: <strong class="mono">{{ s }}</strong></p>
          <app-button data-qi-close (pressed)="closeSuccess()">Next parcel</app-button>
        </div>
      </div>
    }

    <ng-template #field let-k="k" let-label="label" let-req="req" let-pin="pin" let-hint="hint" let-suffix="suffix" let-big="big" let-err="err">
      <div class="f">
        <label class="f__l" [attr.for]="'qi-' + k">{{ label }} @if (req) { <b class="req">*</b> }</label>
        <div class="row">
          <div class="f__wrap">
            <input class="f__i" [class.f__i--big]="big" [id]="'qi-' + k" data-qi [value]="val(k)" autocomplete="off"
                   [attr.inputmode]="isDigits(k) ? 'numeric' : null" [attr.placeholder]="hint ?? null" (input)="onInput(k, $event)" />
            @if (pin?.state === 'loading') { <span class="f__adorn f__adorn--muted">…</span> }
            @else if (pin?.city) { <span class="f__adorn">{{ pin.city }}</span> }
            @if (suffix) { <span class="f__adorn f__adorn--muted">{{ suffix }}</span> }
          </div>
          <ng-container [ngTemplateOutlet]="lockBtn" [ngTemplateOutletContext]="{ k: k }" />
        </div>
        @if (pin?.state === 'error') { <span class="f__err">{{ pin.message }}</span> }
        @if (err) { <span class="f__err">{{ err }}</span> }
      </div>
    </ng-template>

    <ng-template #lockBtn let-k="k">
      <button type="button" class="lock" [class.lock--on]="isLocked(k)" (click)="toggleLock(k)" tabindex="-1"
              [attr.aria-pressed]="isLocked(k)" [attr.title]="isLocked(k) ? 'Locked: kept for the next parcel. Click to unlock.' : 'Lock: keep for the next parcel'"
              [attr.aria-label]="(isLocked(k) ? 'Unlock ' : 'Lock ') + k">
        <mat-icon>{{ isLocked(k) ? 'lock' : 'lock_open' }}</mat-icon>
      </button>
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .qi { display: flex; flex-direction: column; gap: 18px; }
    .qi__head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
    .stats { display: flex; gap: 10px; }
    .stat { display: flex; flex-direction: column; align-items: flex-end; padding: 10px 18px; border-radius: 12px; background: var(--surface);
      border: 1px solid var(--surface-border); }
    .stat strong { font: 700 26px var(--font-display); color: var(--brand-700); line-height: 1.1; }
    .stat span { font: 400 14px var(--font-sans); color: var(--content-muted); }
    .qi__body { display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 18px; align-items: start; }
    .card { background: var(--surface); border: 1px solid var(--surface-border); border-radius: 14px; padding: 22px; display: flex; flex-direction: column; gap: 14px; }
    .batch { background: linear-gradient(180deg, var(--surface), var(--brand-50)); border-color: var(--brand-200, var(--surface-border)); }
    .batch__head { display: flex; justify-content: space-between; align-items: center; }
    .sec { display: flex; align-items: center; gap: 6px; margin: 0; font: 600 19px var(--font-sans); color: var(--content-fg); }
    .sec mat-icon { color: var(--brand-600); font-size: 20px; width: 20px; height: 20px; }
    .grid3 { display: grid; grid-template-columns: 1fr 1fr 1.4fr; gap: 14px 16px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 16px; }
    .f { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .f__l { font: 500 15px var(--font-sans); color: var(--content-muted); }
    .req { color: var(--danger); font-weight: 600; }
    .row { display: flex; align-items: center; gap: 8px; }
    .f__wrap { position: relative; display: flex; flex: 1; min-width: 0; }
    .f__i { width: 100%; box-sizing: border-box; border: 1px solid var(--surface-border); border-radius: var(--r-field, 8px); padding: 10px 12px;
      font: 400 17px var(--font-sans); color: var(--content-fg); background: var(--surface); outline: 0; flex: 1; min-width: 0; }
    .f__i--big { font-size: 22px; padding: 8px 12px; }
    .f__i:focus { border-color: var(--brand-600); box-shadow: 0 0 0 3px var(--brand-50); }
    .f__adorn { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font: 600 16px var(--font-sans); color: var(--brand-700);
      max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; pointer-events: none; }
    .f__adorn--muted { color: var(--content-muted); font-weight: 500; font-size: 15px; }
    .f__err { font: 500 14px var(--font-sans); color: var(--danger); }
    .seg { display: flex; gap: 8px; flex-wrap: wrap; flex: 1; }
    .seg__opt { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--surface-border); background: var(--surface); font: 500 16px var(--font-sans); color: var(--content-fg); }
    .seg__opt mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .seg__opt--on { border-color: var(--brand-600); background: var(--brand-50); color: var(--brand-700); }
    .lock { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 10px; cursor: pointer;
      border: 1px solid var(--surface-border); background: var(--surface); color: var(--content-muted); }
    .lock mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .lock:hover { border-color: var(--brand-600); color: var(--brand-700); }
    .lock--on, .lock--on:hover { border-color: var(--brand-600); background: var(--brand-600); color: #fff; }
    .unlock { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; border: 0; background: none; cursor: pointer; padding: 0;
      color: var(--brand-700); font: 600 15px var(--font-sans); }
    .unlock mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .actions { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 4px; }
    .err { margin: 0; color: var(--danger); font: 500 16px var(--font-sans); }
    .muted { color: var(--content-muted); font: 400 16px var(--font-sans); margin: 0; }
    .tw { overflow-x: auto; }
    .t { width: 100%; border-collapse: collapse; font: 400 16px var(--font-sans); }
    .t th { text-align: left; padding: 8px 10px; font: 600 13px var(--font-sans); color: var(--content-muted); text-transform: uppercase; letter-spacing: .04em;
      border-bottom: 1px solid var(--surface-border); white-space: nowrap; }
    .t td { padding: 10px; border-bottom: 1px solid var(--surface-border); }
    .t .n { text-align: right; }
    .mono { font-family: var(--font-mono, ui-monospace, monospace); font-weight: 600; color: var(--brand-700); text-decoration: none; }
    .tag { display: inline-block; padding: 3px 10px; border-radius: 999px; background: var(--success-surface, #e9f7ee); color: var(--success, #15803d);
      font: 600 13px var(--font-sans); }
    .ovl { position: fixed; inset: 0; background: rgba(15, 18, 34, .45); display: grid; place-items: center; z-index: 50; padding: 16px; }
    .dlg { background: var(--surface); border-radius: 16px; padding: 26px; max-width: 420px; width: 100%; text-align: center;
      display: flex; flex-direction: column; align-items: center; gap: 10px; font: 400 17px var(--font-sans); color: var(--content-fg); }
    .dlg p { margin: 0; }
    .dlg__ic { color: var(--success, #15803d); font-size: 44px; width: 44px; height: 44px; }
    .dlg__t { margin: 0; font: 600 21px var(--font-sans); }
    @media (max-width: 1100px) { .qi__body { grid-template-columns: 1fr; } }
    @media (max-width: 700px) { .grid3, .grid2 { grid-template-columns: 1fr; } .card { padding: 16px; } .stats { width: 100%; } .stat { flex: 1; } }
  `]
})
export class QuickBooking {
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly business = inject(BusinessCustomerService);
  private readonly customers = inject(CustomerService);
  private readonly masters = inject(MasterDataService);
  private readonly freight = inject(FreightCalculationService);
  private readonly shipments = inject(ShipmentService);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly branchId = inject(AuthService).user()?.branchId ?? null;

  protected readonly types = [
    { value: 'DOCUMENT' as const, label: 'Document', icon: 'description' },
    { value: 'PARCEL' as const, label: 'Parcel', icon: 'inventory_2' }
  ];
  private readonly saved = readLocked();
  protected readonly v = signal<QuickBookingFields>({ ...EMPTY, ...this.saved.values });
  protected readonly locks = signal<Locks>(this.saved.locks);
  protected readonly clients = signal<SelectOption[]>([]);
  private readonly client = signal<CustomerResponse | null>(null);
  protected readonly from = signal<PinInfo>({ state: 'idle' });
  protected readonly to = signal<PinInfo>({ state: 'idle' });
  protected readonly awbTaken = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly success = signal<string | null>(null);
  protected readonly done = signal<BookingRow[]>(readDone());
  protected readonly lockedCount = computed(() => Object.values(this.locks()).filter(Boolean).length);
  protected readonly totalKg = computed(() => this.done().reduce((s, d) => s + d.kg, 0));
  protected readonly kgLabel = computed(() => {
    const g = Number(this.v().weightGrams);
    return g > 0 ? `${(g / 1000).toFixed(3)} kg` : null;
  });

  private services: SelectOption[] = [];
  private packageTypes: SelectOption[] = [];
  private tbbModeId: string | null = null;
  private awbTimer: ReturnType<typeof setTimeout> | undefined;
  private seq = { from: 0, to: 0 };

  constructor() {
    this.breadcrumb.set([{ label: 'Shipments', route: '/shipments' }, { label: 'Quick Booking' }]);
    effect(() => writeLocked(this.locks(), this.v()));
    effect(() => { try { sessionStorage.setItem(DONE_KEY, JSON.stringify(this.done())); } catch { /* this visit only */ } });
    this.business.businessCustomers().subscribe({
      next: (p) => this.clients.set(p.content.map((c) => ({ value: c.id, label: `${c.displayName} (${c.customerCode})` }))),
      error: () => this.error.set('Could not load the credit clients.')
    });
    this.masters.options('service-types').subscribe((o) => (this.services = o));
    this.masters.options('package-types').subscribe((o) => (this.packageTypes = o));
    this.masters.options('payment-modes').subscribe((o) => {
      const tbb = o.find((x) => /\(TBB\)$/i.test(x.label)) ?? o.find((x) => /credit|to be billed/i.test(x.label));
      this.tbbModeId = tbb ? String(tbb.value) : null;
    });
    const s = this.v();
    if (s.clientId) this.loadClient(s.clientId, false);
    if (s.fromPincode) this.lookup('from', s.fromPincode);
    if (s.toPincode) this.lookup('to', s.toPincode);
    setTimeout(() => this.focusFirstOpen());
  }

  protected val(k: string): string { return String(this.v()[k as Field] ?? ''); }
  protected isLocked(k: string): boolean { return !!this.locks()[k as Field]; }
  protected isDigits(k: string): boolean { return k in DIGITS; }

  protected set(k: Field, value: string): void {
    this.v.update((s) => ({ ...s, [k]: value }));
  }

  protected onInput(k: Field, e: Event): void {
    const el = e.target as HTMLInputElement;
    const max = DIGITS[k];
    if (max) el.value = el.value.replace(/\D/g, '').slice(0, max);
    this.set(k, el.value);
    if (k === 'fromPincode' || k === 'toPincode') this.lookup(k === 'fromPincode' ? 'from' : 'to', el.value);
    if (k === 'awbNumber') this.checkAwb(el.value.trim());
  }

  /** A client fills the consignor name and sender pincode from its record, as on the earlier portal. */
  protected pickClient(id: string): void {
    this.set('clientId', id);
    this.client.set(null);
    if (id) this.loadClient(id, true);
  }

  private loadClient(id: string, fill: boolean): void {
    this.customers.get(id).subscribe({
      next: (c) => {
        if (this.v().clientId !== id) return;
        this.client.set(c);
        if (!fill) return;
        const pin = c.billingPincode ?? '';
        this.v.update((s) => ({ ...s, consignorName: c.contactPerson || c.displayName || s.consignorName, fromPincode: pin || s.fromPincode }));
        if (pin) this.lookup('from', pin);
      },
      error: () => this.error.set('Could not load this client.')
    });
  }

  protected toggleLock(k: Field): void { this.locks.update((l) => ({ ...l, [k]: !l[k] })); }
  protected unlockAll(): void { this.locks.set({}); }

  /** The next parcel: unlocked fields are cleared, locked ones keep their value. */
  protected clearForNext(): void {
    const l = this.locks();
    this.v.update((s) => {
      const next = { ...EMPTY };
      (Object.keys(l) as Field[]).filter((k) => l[k]).forEach((k) => { (next as Record<string, string>)[k] = s[k]; });
      return next;
    });
    if (!l.fromPincode) this.from.set({ state: 'idle' });
    if (!l.toPincode) this.to.set({ state: 'idle' });
    this.awbTaken.set(false);
  }

  /** As on the earlier portal: a typed AWB is checked a moment after typing stops. */
  private checkAwb(awb: string): void {
    clearTimeout(this.awbTimer);
    this.awbTaken.set(false);
    if (!awb) return;
    this.awbTimer = setTimeout(() => {
      this.shipments.list({ page: 0, size: 5, search: awb }).subscribe({
        next: (p) => { if (this.v().awbNumber.trim() === awb) this.awbTaken.set(p.content.some((s) => s.shipmentNumber?.toUpperCase() === awb.toUpperCase())); },
        error: () => undefined
      });
    }, 1200);
  }

  /** Six digits → the city (shown in the field) and, for the receiver, its Area and whether we deliver there. */
  private lookup(side: 'from' | 'to', code: string): void {
    const info = side === 'from' ? this.from : this.to;
    const seq = ++this.seq[side];
    if (!PINCODE.test(code)) { info.set({ state: 'idle' }); return; }
    info.set({ state: 'loading' });
    this.masters.list(MASTER_DEFINITIONS['pincodes'], { page: 0, size: 5, search: code }).pipe(
      switchMap((page): Observable<PinInfo> => {
        const match = page.content.find((r) => r['code'] === code);
        if (!match) return of({ state: 'error', message: 'This pincode is not on file.' });
        return this.masters.pincodeAreas(String(match['id'])).pipe(switchMap((areas): Observable<PinInfo> => {
          const area = areas.find((a) => a.primary) ?? areas[0];
          if (!area) return of({ state: 'error', message: 'No area is set up for this pincode.' });
          if (side === 'from') {
            return of({ state: 'ok', city: area.cityName, areaId: area.areaId });
          }
          return this.shipments.checkServiceability(code, area.areaId, this.branchId).pipe(
            catchError(() => of(null)),
            map((svc): PinInfo => svc && !svc.serviceable
              ? { state: 'error', city: svc.cityName, message: svc.message ?? 'Currently Delivery service is not available in this pincode.' }
              : { state: 'ok', city: svc?.cityName ?? area.cityName, areaId: area.areaId }));
        }));
      }),
      catchError(() => of<PinInfo>({ state: 'error', message: 'Could not check this pincode.' }))
    ).subscribe((r) => { if (seq === this.seq[side]) info.set(r); });
  }

  /** What is still missing, in the order the form is filled; null when the parcel can be booked. */
  missing(): string | null {
    const s = this.v();
    if (!s.clientId) return 'Select the credit client.';
    if (!s.consignorName.trim()) return 'Consignor Name is required.';
    if (this.from().state !== 'ok') return this.from().message ?? 'Enter a valid Sender Pincode.';
    if (!(Number(s.pieces) > 0)) return 'No of Pieces is required.';
    if (!(Number(s.weightGrams) > 0)) return 'Actual Weight is required.';
    if (this.awbTaken()) return 'AWB number already exists. Please use a different AWB number.';
    if (!s.consigneeName.trim()) return 'Consignee Name is required.';
    if (this.to().state !== 'ok') return this.to().message ?? 'Enter a valid Receiver Pincode.';
    if (!s.consigneeAddress.trim()) return 'Consignee Address is required.';
    if (!/^\d{10}$/.test(s.consigneePhone)) return 'Consignee Phone Number must be 10 digits.';
    if (!(Number(s.declaredValue) > 0)) return 'Declared Value is required.';
    return null;
  }

  private packageTypeId(): string | null {
    const doc = this.v().parcelType === 'DOCUMENT';
    const opt = this.packageTypes.find((o) => doc ? /^\s*doc/i.test(o.label) && !/non/i.test(o.label) : /non[\s-]?doc/i.test(o.label));
    return opt ? String(opt.value) : null;
  }

  /** The POST /shipments body, To Be Billed to the client, on {@code serviceTypeId}. */
  buildRequest(serviceTypeId: string): CreateShipmentRequest {
    const s = this.v();
    const c = this.client();
    const kg = Math.round(Number(s.weightGrams)) / 1000;
    const value = Number(s.declaredValue);
    const senderAddress = [c?.billingAddressLine1, c?.billingAddressLine2, c?.billingCity].filter((x) => !!x?.trim()).join(', ')
      || `${this.from().city ?? ''} ${s.fromPincode}`.trim();
    return {
      bookingBranchId: this.branchId!, manualShipmentNumber: s.awbNumber.trim() || null,
      pickupPincode: s.fromPincode, deliveryPincode: s.toPincode, destinationAreaId: this.to().areaId ?? null,
      senderName: s.consignorName.trim(), senderAddress, senderContact: (c?.mobile ?? '').replace(/\D/g, '').slice(-10),
      receiverName: s.consigneeName.trim(), receiverAddress: s.consigneeAddress.trim(), receiverContact: s.consigneePhone,
      serviceTypeId, packageTypeId: this.packageTypeId(), paymentModeId: this.tbbModeId!,
      declaredValue: value, numberOfPackages: Number(s.pieces),
      items: [{ itemName: s.parcelType === 'DOCUMENT' ? 'Document' : 'Parcel', quantity: Number(s.pieces), weight: kg, declaredValue: value }],
      remarks: 'Quick Booking', deliveryType: 'DOOR', businessCustomerId: s.clientId
    } as CreateShipmentRequest;
  }

  /** Books the parcel on the cheapest service with charges for this destination, To Be Billed to the client. */
  protected generate(): void {
    if (this.busy()) return;
    const miss = this.missing();
    if (miss) { this.error.set(miss); return; }
    if (!this.branchId) { this.error.set('Your user has no booking branch.'); return; }
    if (!this.tbbModeId) { this.error.set('The payment-mode list has no To Be Billed (TBB) mode — add it under Masters.'); return; }
    if (!this.client()?.mobile) { this.error.set('This client has no mobile number on file — add it to the client first.'); return; }
    this.error.set(null);
    this.busy.set(true);
    const s = this.v();
    const kg = Math.round(Number(s.weightGrams)) / 1000;
    const quotes = this.services.map((svc) => this.freight.calculate({
      bookingBranchId: this.branchId!, destinationPincode: s.toPincode, destinationAreaId: this.to().areaId ?? null,
      chargeableWeight: kg, businessCustomerId: s.clientId, declaredValue: Number(s.declaredValue),
      serviceTypeId: String(svc.value), packageTypeId: this.packageTypeId(), numberOfPackages: Number(s.pieces), bookingDate: null
    }, { silent: true }).pipe(map((r) => ({ id: String(svc.value), total: Number(r.totalFreight ?? 0) })), catchError(() => of(null))));
    (quotes.length ? forkJoin(quotes) : of([])).pipe(
      switchMap((rates) => {
        const best = rates.filter((r): r is { id: string; total: number } => !!r && r.total > 0).sort((a, b) => a.total - b.total)[0];
        if (!best) throw new Error('No service has charges set up for this destination and weight.');
        return this.shipments.create(this.buildRequest(best.id));
      })
    ).subscribe({
      next: (created) => {
        this.busy.set(false);
        const awb = created.shipmentNumber;
        this.done.update((d) => [{ awb, id: created.id, consignee: s.consigneeName.trim(), to: `${this.to().city ?? ''} ${s.toPincode}`.trim(),
          pieces: Number(s.pieces), kg, at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }, ...d]);
        this.success.set(awb);
        setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('[data-qi-close] button')?.focus());
      },
      error: (e: HttpErrorResponse | Error) => {
        this.busy.set(false);
        this.error.set(e instanceof HttpErrorResponse ? (e.error?.message ?? 'There was an error performing the quick booking.') : e.message);
      }
    });
  }

  /** Enter or Escape on the success message goes straight to the next parcel. */
  @HostListener('document:keydown', ['$event'])
  protected onDocKey(e: KeyboardEvent): void {
    if (!this.success() || (e.key !== 'Enter' && e.key !== 'Escape')) return;
    e.preventDefault();
    this.closeSuccess();
  }

  protected closeSuccess(): void {
    this.success.set(null);
    this.clearForNext();
    setTimeout(() => this.focusFirstOpen());
  }

  /** Keyboard only: Enter moves to the next field, Ctrl+Enter generates. */
  protected onKey(e: KeyboardEvent): void {
    if (e.key !== 'Enter' || this.success()) return;
    const t = e.target as HTMLElement;
    if (t.tagName === 'BUTTON' && !t.hasAttribute('data-qi')) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) { this.generate(); return; }
    const stops = this.stops();
    const i = stops.indexOf(t);
    const next = stops[i + 1];
    if (next) next.focus(); else this.generate();
  }

  private stops(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[data-qi]')).filter((el) => !(el as HTMLInputElement).disabled);
  }

  /** The cursor starts on the first field that is not locked (or empty). */
  private focusFirstOpen(): void {
    const order: Field[] = ['clientId', 'consignorName', 'fromPincode', 'parcelType', 'pieces', 'weightGrams', 'awbNumber',
      'consigneeName', 'toPincode', 'consigneeAddress', 'consigneePhone', 'declaredValue'];
    const k = order.find((f) => !this.locks()[f] || !this.v()[f]) ?? 'pieces';
    const el = this.host.nativeElement.querySelector<HTMLElement>(k === 'parcelType' ? '.seg__opt--on' : `#qi-${k}`);
    el?.focus();
  }
}
