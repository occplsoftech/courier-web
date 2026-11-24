import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { BusinessCustomerService } from '@features/business-customer/business-customer.service';
import { CustomerService } from '@features/customer/customer.service';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { UiButton } from '@shared/components/ui-button/ui-button';

/** The fields of a Quick Inscan, as typed (weight in grams, as the desk is used to). */
export interface QuickInscanFields {
  clientId: string; consignorName: string; parcelType: 'DOCUMENT' | 'PARCEL'; pieces: string; weightGrams: string;
  awbNumber: string; consigneeName: string; fromPincode: string; toPincode: string; consigneeAddress: string; consigneePhone: string;
}
type Field = keyof QuickInscanFields;

/** Locks and the values they keep live in this browser tab only (sessionStorage): kept across reloads, gone when the tab closes. */
const SESSION_KEY = 'cs.quickInscan.locked';

/** The locks saved for this tab, with the value each locked field keeps. */
export function readLocked(): { locks: Partial<Record<Field, boolean>>; values: Partial<QuickInscanFields> } {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? { locks: parsed.locks ?? {}, values: parsed.values ?? {} } : { locks: {}, values: {} };
  } catch {
    return { locks: {}, values: {} };
  }
}

function writeLocked(locks: Partial<Record<Field, boolean>>, v: QuickInscanFields): void {
  const values: Partial<QuickInscanFields> = {};
  (Object.keys(locks) as Field[]).filter((k) => locks[k]).forEach((k) => { (values as Record<string, string>)[k] = v[k]; });
  try {
    if (Object.keys(values).length) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ locks, values }));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* storage unavailable: locks last this visit only */ }
}

const EMPTY: QuickInscanFields = {
  clientId: '', consignorName: '', parcelType: 'PARCEL', pieces: '', weightGrams: '', awbNumber: '',
  consigneeName: '', fromPincode: '', toPincode: '', consigneeAddress: '', consigneePhone: ''
};

/**
 * Quick Inscan — the earlier portal's one-screen credit-client inscan: client, consignor, type, pieces, weight, AWB,
 * consignee and both pincodes, then Generate AWB. Every field has a lock: a locked field keeps its value for the next
 * parcel, so a batch from one client to one city is typed once.
 */
@Component({
  selector: 'app-quick-inscan',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, MatIconModule, UiButton],
  template: `
    <div class="qi">
      <header class="qi__head">
        <div>
          <h1 class="text-h1">Quick Inscan</h1>
          <p class="text-caption">Credit-client parcels in one screen. Lock (<mat-icon class="inl">lock</mat-icon>) a field to keep it for the next parcel; locks stay until you unlock them or close this tab.</p>
        </div>
        <div class="qi__count"><strong>{{ done().length }}</strong><span>inscanned this session</span></div>
      </header>

      <div class="qi__body">
        <form class="card" (submit)="$event.preventDefault(); generate()">
          <h2 class="sec">Consignor</h2>
          <div class="grid2">
            <ng-container [ngTemplateOutlet]="field" [ngTemplateOutletContext]="{ k: 'clientId', label: 'Credit Client', kind: 'client' }" />
            <ng-container [ngTemplateOutlet]="field" [ngTemplateOutletContext]="{ k: 'consignorName', label: 'Consignor Name', req: true }" />
            <ng-container [ngTemplateOutlet]="field" [ngTemplateOutletContext]="{ k: 'fromPincode', label: 'Consignor (Sender) Pincode', req: true, kind: 'pin', city: fromCity() }" />
          </div>

          <h2 class="sec">Parcel</h2>
          <div class="grid2">
            <div class="f f--wide">
              <span class="f__l">Parcel Type <b class="req">*</b></span>
              <div class="row">
                <div class="seg" role="radiogroup" aria-label="Parcel type">
                  @for (t of types; track t.value) {
                    <button type="button" class="seg__opt" role="radio" [attr.aria-checked]="v().parcelType === t.value"
                            [class.seg__opt--on]="v().parcelType === t.value" (click)="set('parcelType', t.value)">
                      <mat-icon>{{ t.icon }}</mat-icon>{{ t.label }}</button>
                  }
                </div>
                <ng-container [ngTemplateOutlet]="lockBtn" [ngTemplateOutletContext]="{ k: 'parcelType' }" />
              </div>
            </div>
            <ng-container [ngTemplateOutlet]="field" [ngTemplateOutletContext]="{ k: 'pieces', label: 'No of Pieces', req: true, num: true }" />
            <ng-container [ngTemplateOutlet]="field" [ngTemplateOutletContext]="{ k: 'weightGrams', label: 'Actual Weight (grams)', req: true, num: true, suffix: kg() }" />
            <ng-container [ngTemplateOutlet]="field" [ngTemplateOutletContext]="{ k: 'awbNumber', label: 'AWB Number', hint: 'Leave empty to generate one', wide: true }" />
          </div>

          <h2 class="sec">Consignee</h2>
          <div class="grid2">
            <ng-container [ngTemplateOutlet]="field" [ngTemplateOutletContext]="{ k: 'consigneeName', label: 'Consignee Name', req: true }" />
            <ng-container [ngTemplateOutlet]="field" [ngTemplateOutletContext]="{ k: 'toPincode', label: 'Consignee (Receiver) Pincode', req: true, kind: 'pin', city: toCity() }" />
            <ng-container [ngTemplateOutlet]="field" [ngTemplateOutletContext]="{ k: 'consigneeAddress', label: 'Consignee Address', wide: true }" />
            <ng-container [ngTemplateOutlet]="field" [ngTemplateOutletContext]="{ k: 'consigneePhone', label: 'Consignee Phone Number', num: true }" />
          </div>

          @if (error()) { <p class="err">{{ error() }}</p> }
          <div class="actions">
            <span class="text-caption lk">{{ lockedCount() }} field(s) locked for the next parcel
              @if (lockedCount()) { <button type="button" class="lk__all" (click)="unlockAll()"><mat-icon>lock_open</mat-icon>Unlock all</button> }</span>
            <app-button icon="qr_code_2" (pressed)="generate()">Generate AWB</app-button>
          </div>
        </form>

        <aside class="card side">
          <h2 class="sec">This session</h2>
          @if (!done().length) {
            <p class="muted">AWBs you generate here are listed for quick reference.</p>
          } @else {
            <ul class="done">
              @for (d of done(); track d.awb) {
                <li><strong class="mono">{{ d.awb }}</strong><span>{{ d.consignee }} · {{ d.to }}</span><small>{{ d.pieces }} pc · {{ d.kg }} kg</small></li>
              }
            </ul>
          }
        </aside>
      </div>
    </div>

    <ng-template #field let-k="k" let-label="label" let-req="req" let-kind="kind" let-city="city" let-num="num" let-hint="hint" let-suffix="suffix" let-wide="wide">
      <div class="f" [class.f--wide]="wide">
        <label class="f__l" [attr.for]="'qi-' + k">{{ label }} @if (req) { <b class="req">*</b> }</label>
        <div class="row">
          @if (kind === 'client') {
            <select class="f__i" [id]="'qi-' + k" [value]="v().clientId" (change)="pickClient($any($event.target).value)">
              <option value="" [selected]="!v().clientId">Select the credit client</option>
              @for (c of clients(); track c.id) { <option [value]="c.id" [selected]="c.id === v().clientId">{{ c.name }}</option> }
            </select>
          } @else {
            <div class="f__wrap">
              <input class="f__i" [id]="'qi-' + k" [value]="val(k)" [attr.inputmode]="num || kind === 'pin' ? 'numeric' : null"
                     [attr.maxlength]="kind === 'pin' ? 6 : k === 'consigneePhone' ? 10 : null" [attr.placeholder]="hint ?? null"
                     (input)="set(k, $any($event.target).value)" />
              @if (city) { <span class="f__adorn">{{ city }}</span> }
              @if (suffix) { <span class="f__adorn f__adorn--muted">{{ suffix }}</span> }
            </div>
          }
          <ng-container [ngTemplateOutlet]="lockBtn" [ngTemplateOutletContext]="{ k: k }" />
        </div>
      </div>
    </ng-template>

    <ng-template #lockBtn let-k="k">
      <button type="button" class="lock" [class.lock--on]="isLocked(k)" (click)="toggleLock(k)"
              [attr.aria-pressed]="!!isLocked(k)" [attr.title]="isLocked(k) ? 'Locked: kept for the next parcel' : 'Lock: keep for the next parcel'"
              [attr.aria-label]="'Keep for the next parcel'">
        <mat-icon>{{ isLocked(k) ? 'lock' : 'lock_open' }}</mat-icon>
      </button>
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .qi { display: flex; flex-direction: column; gap: 18px; }
    .qi__head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
    .qi__count { display: flex; flex-direction: column; align-items: flex-end; padding: 10px 16px; border-radius: 12px;
      background: var(--brand-50); color: var(--brand-700); }
    .qi__count strong { font: 700 26px var(--font-display); line-height: 1; }
    .qi__count span { font: 500 14px var(--font-sans); }
    .inl { font-size: 17px; width: 17px; height: 17px; vertical-align: -3px; }
    .qi__body { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 18px; align-items: start; }
    .card { background: var(--surface); border: 1px solid var(--surface-border); border-radius: 12px; padding: 24px; display: flex; flex-direction: column; gap: 14px; }
    .side { position: sticky; top: 16px; }
    .sec { margin: 6px 0 0; font: 600 18px var(--font-sans); color: var(--content-fg); }
    .sec:first-child { margin-top: 0; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 20px; }
    .f { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .f--wide { grid-column: 1 / -1; }
    .f__l { font: 500 15px var(--font-sans); color: var(--content-muted); }
    .req { color: var(--danger); font-weight: 600; }
    .row { display: flex; align-items: center; gap: 8px; }
    .f__wrap { position: relative; display: flex; flex: 1; min-width: 0; }
    .f__i { width: 100%; box-sizing: border-box; border: 1px solid var(--surface-border); border-radius: var(--r-field, 8px); padding: 10px 12px;
      font: 400 17px var(--font-sans); color: var(--content-fg); background: var(--surface); outline: 0; flex: 1; min-width: 0; }
    .f__i:focus { border-color: var(--brand-600); box-shadow: 0 0 0 3px var(--brand-50); }
    .f__adorn { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font: 600 16px var(--font-sans); color: var(--brand-700);
      max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; pointer-events: none; }
    .f__adorn--muted { color: var(--content-muted); font-weight: 500; }
    .seg { display: flex; gap: 8px; flex-wrap: wrap; flex: 1; }
    .seg__opt { display: inline-flex; align-items: center; gap: 8px; padding: 9px 16px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--surface-border); background: var(--surface); font: 500 16px var(--font-sans); color: var(--content-fg); }
    .seg__opt mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .seg__opt--on { border-color: var(--brand-600); background: var(--brand-50); color: var(--brand-700); }
    .lock { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 10px; cursor: pointer;
      border: 1px solid var(--surface-border); background: var(--surface); color: var(--content-muted); }
    .lock mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .lock:hover { border-color: var(--brand-600); color: var(--brand-700); }
    .lock--on { border-color: var(--brand-600); background: var(--brand-600); color: #fff; }
    .lock--on:hover { color: #fff; }
    .actions { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 6px;
      padding-top: 16px; border-top: 1px solid var(--surface-border); }
    .lk { display: inline-flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .lk__all { display: inline-flex; align-items: center; gap: 4px; border: 0; background: none; cursor: pointer; padding: 0;
      color: var(--brand-700); font: 600 15px var(--font-sans); }
    .lk__all mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .err { margin: 0; color: var(--danger); font: 500 16px var(--font-sans); }
    .muted { color: var(--content-muted); font: 400 16px var(--font-sans); margin: 0; }
    .done { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .done li { display: flex; flex-direction: column; gap: 2px; padding: 10px 0; border-bottom: 1px solid var(--surface-border); }
    .done li:last-child { border-bottom: 0; }
    .done strong { color: var(--brand-700); font-size: 17px; }
    .done span { font: 400 16px var(--font-sans); color: var(--content-fg); }
    .done small { font: 400 14px var(--font-sans); color: var(--content-muted); }
    @media (max-width: 1100px) { .qi__body { grid-template-columns: 1fr; } .side { position: static; } }
    @media (max-width: 640px) { .grid2 { grid-template-columns: 1fr; } .card { padding: 18px; } }
  `]
})
export class QuickInscan {
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly business = inject(BusinessCustomerService);
  private readonly customers = inject(CustomerService);

  protected readonly types = [
    { value: 'DOCUMENT' as const, label: 'Document', icon: 'description' },
    { value: 'PARCEL' as const, label: 'Non-Document (Parcel)', icon: 'inventory_2' }
  ];
  private readonly saved = readLocked();
  protected readonly v = signal<QuickInscanFields>({ ...EMPTY, ...this.saved.values });
  protected readonly locks = signal<Partial<Record<Field, boolean>>>(this.saved.locks);
  protected readonly clients = signal<{ id: string; name: string; contact: string; pincode: string }[]>([]);
  protected readonly fromCity = signal<string | null>(null);
  protected readonly toCity = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly done = signal<{ awb: string; consignee: string; to: string; pieces: string; kg: string }[]>([]);
  protected readonly lockedCount = computed(() => Object.values(this.locks()).filter(Boolean).length);
  protected readonly kg = computed(() => {
    const g = Number(this.v().weightGrams);
    return g > 0 ? `${(g / 1000).toFixed(3)} kg` : null;
  });

  constructor() {
    this.breadcrumb.set([{ label: 'Shipments', route: '/shipments' }, { label: 'Quick Inscan' }]);
    // Keep the locked fields (and only those) in this tab's session storage as they change.
    effect(() => writeLocked(this.locks(), this.v()));
    this.business.businessCustomers().subscribe({
      next: (p) => this.clients.set(p.content.map((c) => ({
        id: c.id, name: `${c.displayName} (${c.customerCode})`, contact: c.contactPerson || c.displayName, pincode: ''
      }))),
      error: () => this.error.set('Could not load the credit clients.')
    });
  }

  protected set(k: Field, value: string): void {
    const clean = ['pieces', 'weightGrams', 'fromPincode', 'toPincode', 'consigneePhone'].includes(k)
      ? value.replace(/\D/g, '').slice(0, k === 'consigneePhone' ? 10 : k.endsWith('Pincode') ? 6 : 9) : value;
    this.v.update((s) => ({ ...s, [k]: clean }));
  }

  /** A client fills the consignor name and pincode from its record, as on the earlier portal. */
  protected pickClient(id: string): void {
    const c = this.clients().find((x) => x.id === id);
    this.v.update((s) => ({ ...s, clientId: id, consignorName: c?.contact ?? s.consignorName }));
    if (!id) return;
    this.customers.get(id).subscribe({
      next: (full) => this.v.update((s) => s.clientId !== id ? s : ({
        ...s, consignorName: full.contactPerson || full.displayName || s.consignorName,
        fromPincode: full.billingPincode || s.fromPincode
      })),
      error: () => undefined
    });
  }

  protected val(k: string): string { return String(this.v()[k as Field] ?? ''); }
  protected isLocked(k: string): boolean { return !!this.locks()[k as Field]; }

  protected toggleLock(k: Field): void {
    this.locks.update((l) => ({ ...l, [k]: !l[k] }));
  }

  /** Unlock every field (and forget what they kept). */
  protected unlockAll(): void {
    this.locks.set({});
  }

  /** The next parcel: unlocked fields are cleared, locked ones keep their value. */
  protected clearForNext(): void {
    const l = this.locks();
    this.v.update((s) => {
      const next = { ...EMPTY };
      (Object.keys(l) as Field[]).filter((k) => l[k]).forEach((k) => { (next as Record<string, string>)[k] = s[k]; });
      return next;
    });
  }

  /** Design preview: booking is wired once the design is approved. */
  protected generate(): void {
    this.error.set(null);
  }
}
