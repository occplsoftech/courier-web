import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { NotificationService } from '@core/services/notification.service';
import { Customer } from '@core/models/customer.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { BusinessCustomerService } from '@features/business-customer/business-customer.service';
import { CourierIntegrationService } from '@features/courier-integrations/courier-integration.service';
import { apiMessage } from '@features/communication/api-error';
import {
  CourierMarkupService, MARKUP_COMPONENTS, MarkupCheck, MarkupComponent, MarkupRule, RuleState, ruleState
} from './courier-markup.service';

const STATE_LABEL: Record<RuleState, string> = { IN_FORCE: 'In force', UPCOMING: 'Upcoming', ENDED: 'Ended', OFF: 'Switched off' };
const COMPONENT_LABEL: Record<MarkupComponent, string> = {
  FREIGHT: 'Freight', FUEL_SURCHARGE: 'Fuel surcharge', COD: 'COD charge', REMOTE_AREA: 'Remote area',
  HANDLING: 'Handling', INSURANCE: 'Insurance', OTHER: 'Other', TAX: 'Tax'
};
const OCCPL_NETWORK = 'OCCPL_NETWORK';

/**
 * Courier markup: what the company adds on top of an outside courier's price before a business customer sees it in the
 * shipping portal. A rule can be for one customer or all, one courier or all; the most specific rule in force wins, and
 * with none the company default applies. Rules are never edited: adding one for the same customer and courier closes the
 * old one, and "End now" stops one, so the history stays.
 */
@Component({
  selector: 'app-courier-markup',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiButton, DatePipe],
  template: `
    <div class="cm">
      <header class="cm__head">
        <h1>Courier markup</h1>
        <p class="hint">What is added to an outside courier's price before a business customer sees it in the shipping portal.
          The most specific rule in force wins: customer + courier, then customer, then courier, then all. With none, the default applies.</p>
      </header>

      <app-card title="Which markup applies?" subtitle="Pick a customer and a courier to see the markup they get right now.">
        <div class="cm__row">
          <label class="f">Customer
            <select [value]="checkCustomer()" (change)="checkCustomer.set($any($event.target).value); check()" aria-label="Check customer">
              <option value="">Any customer</option>
              @for (c of customers(); track c.id) { <option [value]="c.id">{{ c.displayName }} ({{ c.customerCode }})</option> }
            </select>
          </label>
          <label class="f">Courier
            <select [value]="checkCourier()" (change)="checkCourier.set($any($event.target).value); check()" aria-label="Check courier">
              <option value="">Any courier</option>
              @for (p of couriers(); track p.code) { <option [value]="p.code">{{ p.name }}</option> }
            </select>
          </label>
        </div>
        @if (result(); as r) {
          <div class="cm__result" role="status">
            @if (!r.enabled) { <strong>No markup</strong> <span>(the rule that wins is switched off)</span> }
            @else { <strong>{{ r.percent }}%</strong> <span>on {{ components(r.appliesTo) }}, then GST {{ r.gstPercent }}%</span> }
            <span class="cm__src">{{ r.isDefault ? 'Company default — no rule matches' : 'From rule: ' + describe(r.ruleId) }}</span>
          </div>
        }
      </app-card>

      <app-card title="Rules" subtitle="Newest first. Adding a rule for the same customer and courier ends the old one.">
        <div class="cm__bar">
          <label class="f f--inline">Show
            <select [value]="filter()" (change)="filter.set($any($event.target).value)" aria-label="Show rules">
              <option value="ALL">All</option>
              <option value="IN_FORCE">In force</option>
              <option value="UPCOMING">Upcoming</option>
              <option value="OFF">Switched off</option>
              <option value="ENDED">Ended</option>
            </select>
          </label>
          <app-button icon="add" (pressed)="openForm()">Add rule</app-button>
        </div>

        @if (adding()) {
          <form class="cm__form" (submit)="$event.preventDefault(); save()">
            <div class="cm__row">
              <label class="f">Customer
                <select [value]="fCustomer()" (change)="fCustomer.set($any($event.target).value)" aria-label="Rule customer">
                  <option value="">All customers</option>
                  @for (c of customers(); track c.id) { <option [value]="c.id">{{ c.displayName }} ({{ c.customerCode }})</option> }
                </select>
              </label>
              <label class="f">Courier
                <select [value]="fCourier()" (change)="fCourier.set($any($event.target).value)" aria-label="Rule courier">
                  <option value="">All couriers</option>
                  @for (p of couriers(); track p.code) { <option [value]="p.code">{{ p.name }}</option> }
                </select>
              </label>
              <label class="f f--sm">Markup %
                <input type="number" min="0" max="100" step="0.01" [value]="fPercent()" (input)="fPercent.set($any($event.target).value)" aria-label="Markup percent" />
              </label>
              <label class="f f--check"><input type="checkbox" [checked]="fEnabled()" (change)="fEnabled.set(!fEnabled())" /> Markup on</label>
            </div>
            <fieldset class="cm__lines">
              <legend>Apply to</legend>
              @for (c of allComponents; track c) {
                <label><input type="checkbox" [checked]="fLines().has(c)" (change)="toggleLine(c)" /> {{ label(c) }}</label>
              }
            </fieldset>
            <div class="cm__row">
              <label class="f">From <span class="hint">(blank = now)</span>
                <input type="datetime-local" [value]="fFrom()" (input)="fFrom.set($any($event.target).value)" aria-label="From" />
              </label>
              <label class="f">To <span class="hint">(blank = no end)</span>
                <input type="datetime-local" [value]="fTo()" (input)="fTo.set($any($event.target).value)" aria-label="To" />
              </label>
              <label class="f f--grow">Notes
                <input type="text" maxlength="500" [value]="fNotes()" (input)="fNotes.set($any($event.target).value)" aria-label="Notes" />
              </label>
            </div>
            @if (formError()) { <p class="alert" role="alert">{{ formError() }}</p> }
            <div class="cm__bar">
              <app-button variant="text" (pressed)="adding.set(false)">Cancel</app-button>
              <app-button icon="save" type="submit" [loading]="saving()">Save rule</app-button>
            </div>
          </form>
        }

        @if (loading()) { <p class="hint" role="status">Loading…</p> }
        @if (error()) { <p class="alert" role="alert">{{ error() }}</p> }
        @if (!loading() && shown().length === 0) { <p class="hint">No rules here. Until one is added, the default markup applies.</p> }
        @if (shown().length) {
          <div class="cm__table">
            <table>
              <thead><tr><th>Customer</th><th>Courier</th><th>Markup</th><th>Applies to</th><th>From</th><th>To</th><th>State</th><th></th></tr></thead>
              <tbody>
                @for (r of shown(); track r.id) {
                  <tr>
                    <td>{{ customerName(r.customerId) }}</td>
                    <td>{{ courierName(r.providerCode) }}</td>
                    <td>{{ r.enabled ? r.percent + '%' : 'Off' }}</td>
                    <td>{{ components(r.appliesTo) }}</td>
                    <td>{{ r.effectiveFrom | date: 'dd MMM yyyy, HH:mm' }}</td>
                    <td>{{ r.effectiveTo ? (r.effectiveTo | date: 'dd MMM yyyy, HH:mm') : '—' }}</td>
                    <td><span class="st" [class]="'st st--' + state(r)">{{ stateLabel(r) }}</span></td>
                    <td>
                      @if (state(r) !== 'ENDED') {
                        <app-button variant="stroked" [loading]="ending() === r.id" (pressed)="end(r)">End now</app-button>
                      }
                    </td>
                  </tr>
                  @if (r.notes) { <tr class="cm__note"><td colspan="8">{{ r.notes }}</td></tr> }
                }
              </tbody>
            </table>
          </div>
        }
      </app-card>
    </div>
  `,
  styles: [`
    .cm { display:flex; flex-direction:column; gap:16px; }
    .cm__head h1 { margin:0 0 4px; font:700 22px var(--font-sans); color:var(--content-fg); }
    .cm__row { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; }
    .f { display:flex; flex-direction:column; gap:4px; font:600 13px var(--font-sans); min-width:200px; flex:1 1 200px; }
    .f--sm { flex:0 1 120px; min-width:100px; }
    .f--grow { flex:2 1 260px; }
    .f--inline { flex-direction:row; align-items:center; gap:8px; flex:0 0 auto; min-width:0; }
    .f--check { flex-direction:row; align-items:center; gap:8px; flex:0 0 auto; min-width:0; height:40px; }
    .f select, .f input[type=number], .f input[type=text], .f input[type=datetime-local] {
      height:40px; border:1px solid var(--surface-border); border-radius:8px; padding:0 10px;
      background:var(--surface-card, #fff); color:var(--content-fg); font:400 14px var(--font-sans); }
    .cm__bar { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
    .cm__form { border:1px solid var(--surface-border); border-radius:12px; padding:14px; margin-bottom:14px; display:flex; flex-direction:column; gap:12px; }
    .cm__lines { border:0; padding:0; margin:0; display:flex; flex-wrap:wrap; gap:8px 16px; font:400 13px var(--font-sans); }
    .cm__lines legend { font:600 13px var(--font-sans); margin-bottom:6px; }
    .cm__lines label { display:flex; align-items:center; gap:6px; }
    .cm__result { margin-top:12px; padding:12px 14px; border-radius:10px; background:var(--surface-muted, #f4f6fa); display:flex; flex-wrap:wrap; gap:6px 10px; align-items:baseline; font:400 14px var(--font-sans); }
    .cm__result strong { font:700 20px var(--font-sans); }
    .cm__src { flex-basis:100%; font:400 12px var(--font-sans); color:var(--content-muted); }
    .cm__table { overflow-x:auto; }
    table { width:100%; border-collapse:collapse; font:400 13px var(--font-sans); }
    th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--surface-border); white-space:nowrap; }
    th { font-weight:600; color:var(--content-muted); }
    .cm__note td { color:var(--content-muted); font-size:12px; padding-top:0; white-space:normal; }
    .st { display:inline-block; padding:2px 8px; border-radius:999px; font:600 11px var(--font-sans); }
    .st--IN_FORCE { background:#e6f6ec; color:#17733a; }
    .st--UPCOMING { background:#e8f0fe; color:#1a56c4; }
    .st--OFF { background:#fff4e0; color:#9a5b00; }
    .st--ENDED { background:#eef0f3; color:#5b6472; }
    .hint { font:400 12px var(--font-sans); color:var(--content-muted); margin:0; }
    .alert { color:#b42318; font:500 13px var(--font-sans); margin:0; }
  `]
})
export class CourierMarkupPage implements OnInit {
  private readonly svc = inject(CourierMarkupService);
  private readonly integrations = inject(CourierIntegrationService);
  private readonly business = inject(BusinessCustomerService);
  private readonly notify = inject(NotificationService);

  protected readonly allComponents = MARKUP_COMPONENTS;
  protected readonly customers = signal<Customer[]>([]);
  protected readonly couriers = signal<{ code: string; name: string }[]>([]);
  protected readonly rules = signal<MarkupRule[]>([]);
  protected readonly filter = signal<'ALL' | RuleState>('ALL');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly ending = signal<string | null>(null);

  protected readonly checkCustomer = signal('');
  protected readonly checkCourier = signal('');
  protected readonly result = signal<MarkupCheck | null>(null);

  protected readonly adding = signal(false);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly fCustomer = signal('');
  protected readonly fCourier = signal('');
  protected readonly fPercent = signal('10');
  protected readonly fEnabled = signal(true);
  protected readonly fLines = signal<ReadonlySet<MarkupComponent>>(new Set(['FREIGHT']));
  protected readonly fFrom = signal('');
  protected readonly fTo = signal('');
  protected readonly fNotes = signal('');

  protected readonly shown = computed(() => {
    const f = this.filter();
    const sorted = [...this.rules()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return f === 'ALL' ? sorted : sorted.filter((r) => ruleState(r) === f);
  });

  ngOnInit(): void {
    this.business.businessCustomers().subscribe({ next: (p) => this.customers.set(p.content), error: () => this.error.set('Customers could not be loaded.') });
    this.integrations.list().subscribe({
      next: (list) => this.couriers.set(list.filter((c) => c.code !== OCCPL_NETWORK && c.available).map((c) => ({ code: c.code, name: c.name }))),
      error: () => this.error.set('Couriers could not be loaded.')
    });
    this.load();
    this.check();
  }

  private load(): void {
    this.loading.set(true);
    this.svc.list().subscribe({
      next: (r) => { this.loading.set(false); this.rules.set(r); },
      error: (e: HttpErrorResponse) => { this.loading.set(false); this.error.set(apiMessage(e, 'The markup rules could not be loaded.')); }
    });
  }

  protected check(): void {
    this.svc.check(this.checkCourier() || null, this.checkCustomer() || null).subscribe({
      next: (r) => this.result.set(r),
      error: (e: HttpErrorResponse) => this.notify.error(apiMessage(e, 'The markup could not be checked.'))
    });
  }

  protected openForm(): void {
    this.fCustomer.set(''); this.fCourier.set(''); this.fPercent.set('10'); this.fEnabled.set(true);
    this.fLines.set(new Set(['FREIGHT'])); this.fFrom.set(''); this.fTo.set(''); this.fNotes.set('');
    this.formError.set(null);
    this.adding.set(true);
  }

  protected toggleLine(c: MarkupComponent): void {
    const next = new Set(this.fLines());
    if (!next.delete(c)) next.add(c);
    this.fLines.set(next);
  }

  protected save(): void {
    const percent = Number(this.fPercent());
    if (this.fPercent() === '' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
      this.formError.set('Enter a markup between 0 and 100%.'); return;
    }
    if (this.fLines().size === 0) { this.formError.set('Tick at least one charge line.'); return; }
    const from = this.fFrom() ? new Date(this.fFrom()).toISOString() : null;
    const to = this.fTo() ? new Date(this.fTo()).toISOString() : null;
    if (to && Date.parse(to) <= (from ? Date.parse(from) : Date.now())) { this.formError.set('The end must be after the start.'); return; }
    this.formError.set(null);
    this.saving.set(true);
    this.svc.create({
      providerCode: this.fCourier() || null, customerId: this.fCustomer() || null, enabled: this.fEnabled(), percent,
      appliesTo: MARKUP_COMPONENTS.filter((c) => this.fLines().has(c)), effectiveFrom: from, effectiveTo: to,
      notes: this.fNotes().trim() || null
    }).subscribe({
      next: () => { this.saving.set(false); this.adding.set(false); this.notify.success('Markup rule added.'); this.load(); this.check(); },
      error: (e: HttpErrorResponse) => { this.saving.set(false); this.formError.set(apiMessage(e, 'The rule could not be saved.')); }
    });
  }

  protected end(r: MarkupRule): void {
    if (!confirm(`End this rule now? ${this.customerName(r.customerId)} · ${this.courierName(r.providerCode)} will fall back to the next rule or the default.`)) return;
    this.ending.set(r.id);
    this.svc.end(r.id).subscribe({
      next: () => { this.ending.set(null); this.notify.success('Rule ended.'); this.load(); this.check(); },
      error: (e: HttpErrorResponse) => { this.ending.set(null); this.notify.error(apiMessage(e, 'The rule could not be ended.')); }
    });
  }

  protected state(r: MarkupRule): RuleState { return ruleState(r); }
  protected stateLabel(r: MarkupRule): string { return STATE_LABEL[ruleState(r)]; }
  protected label(c: MarkupComponent): string { return COMPONENT_LABEL[c] ?? c; }
  protected components(list: MarkupComponent[]): string { return list.map((c) => COMPONENT_LABEL[c] ?? c).join(', '); }

  protected customerName(id: string | null): string {
    if (!id) return 'All customers';
    const c = this.customers().find((x) => x.id === id);
    return c ? c.displayName : 'Customer (inactive)';
  }

  protected courierName(code: string | null): string {
    if (!code) return 'All couriers';
    return this.couriers().find((x) => x.code === code)?.name ?? code;
  }

  protected describe(ruleId: string | null): string {
    const r = this.rules().find((x) => x.id === ruleId);
    return r ? `${this.customerName(r.customerId)} · ${this.courierName(r.providerCode)}` : 'a rule';
  }
}
