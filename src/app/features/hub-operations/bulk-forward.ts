import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { BulkForwardResultRow, ForwardOption, ForwardOptions } from '@core/models/shipment.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { ShipmentService } from '@features/shipment/shipment.service';

/** Shipments priced (and forwarded) this many per request, so the page can show progress. */
const CHUNK = 5;

interface Row {
  shipmentId: string;
  shipmentNumber: string;
  options: ForwardOption[];
  /** Why it cannot be forwarded (blocker or error); such a row is left out. */
  blocked: string | null;
  collectFrom: string | null;
  /** providerCode|serviceCode of the chosen service. */
  choice: string;
  result: BulkForwardResultRow | null;
}

/**
 * Forward several shipments at once (14.1). Each shipment's connected couriers are priced (a few at a time), its cheapest service is
 * pre-selected, staff may change any row or switch all rows to one courier, then confirm once. Shipments are forwarded one after the
 * other, each priced afresh by the server; a refusal or unconfirmed forward never stops the rest.
 */
@Component({
  selector: 'app-bulk-forward',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButton, RouterLink, DecimalPipe],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">Forward Shipments</h1>
          <p class="text-caption">Hand several shipments to courier partners at once. The courier collects from your hub; the customer's price does not change.</p>
        </div>
        <app-button variant="stroked" icon="arrow_back" (pressed)="back()">Shipments At Hub</app-button>
      </header>

      @if (pricing()) { <p class="note" role="status">Asking the couriers… {{ priced() }} of {{ ids.length }} shipments priced.</p> }

      @if (!pricing() && ready().length && !done()) {
        <div class="bar">
          <app-button variant="stroked" (pressed)="cheapestForAll()">Cheapest for all</app-button>
          <label class="pick">Use one courier for all
            <select (change)="oneCourier($any($event.target).value)" aria-label="One courier for all">
              <option value="">Choose…</option>
              @for (p of providers(); track p.code) { <option [value]="p.code">{{ p.name }}</option> }
            </select>
          </label>
        </div>
      }

      <table class="tbl">
        <thead><tr><th>Shipment</th><th>Courier service</th><th class="num">Our cost</th><th>Result</th></tr></thead>
        <tbody>
          @for (r of rows(); track r.shipmentId) {
            <tr [class.off]="r.blocked">
              <td><a class="cs" [routerLink]="['/shipments', r.shipmentId]">{{ r.shipmentNumber }}</a>
                @if (r.collectFrom) { <div class="text-caption">Collect from {{ r.collectFrom }}</div> }</td>
              <td>
                @if (r.blocked) { <span class="warn">{{ r.blocked }}</span> }
                @else if (!r.options.length) { <span class="text-caption">Pricing…</span> }
                @else {
                  <select [value]="r.choice" (change)="choose(r, $any($event.target).value)" [disabled]="busy() || !!r.result" [attr.aria-label]="'Courier for ' + r.shipmentNumber">
                    @for (o of r.options; track o.providerCode + o.serviceCode) {
                      <option [value]="key(o)">{{ o.providerName }} · {{ o.serviceName }} — ₹{{ o.cost | number: '1.0-2' }}{{ eta(o) }}</option>
                    }
                  </select>
                }
              </td>
              <td class="num">@if (chosen(r); as o) { ₹{{ o.cost | number: '1.2-2' }} }</td>
              <td>
                @if (r.result; as x) {
                  <span class="res" [class.ok]="x.outcome === 'FORWARDED'" [class.bad]="x.outcome === 'REFUSED' || x.outcome === 'ERROR'" [class.warn2]="x.outcome === 'UNCONFIRMED'">
                    {{ label(x.outcome) }}</span>
                  @if (x.awb) { <div class="mono">AWB {{ x.awb }}</div> }
                  @if (x.outcome !== 'FORWARDED') { <div class="text-caption">{{ x.message }}</div> }
                  @if (x.labelUrl) { <a [href]="x.labelUrl" target="_blank" rel="noopener">Label</a> }
                } @else if (busy() && !r.blocked) { <span class="text-caption">Waiting…</span> }
              </td>
            </tr>
          }
        </tbody>
      </table>

      @if (!pricing()) {
        <footer class="foot">
          @if (done()) {
            <p class="text-caption">{{ count('FORWARDED') }} forwarded · {{ count('UNCONFIRMED') }} to check with the courier · {{ count('REFUSED') + count('ERROR') }} not forwarded.</p>
            <app-button variant="stroked" icon="download" (pressed)="download()">Download list</app-button>
          } @else {
            <p class="text-caption">{{ ready().length }} ready · {{ rows().length - ready().length }} cannot be forwarded.</p>
            <app-button icon="local_shipping" [disabled]="!ready().length || busy()" (pressed)="forwardAll()">
              {{ busy() ? 'Forwarding ' + progress() + ' of ' + ready().length + '…' : 'Forward ' + ready().length + ' for ₹' + (total() | number: '1.2-2') }}</app-button>
          }
        </footer>
      }
    </div>
  `,
  styles: [`
    .page__head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; }
    .note { font:500 14px var(--font-sans); color:var(--content-muted); }
    .bar { display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap; margin:8px 0 12px; }
    .pick { display:flex; flex-direction:column; gap:4px; font:600 13px var(--font-sans); }
    select { height:38px; border:1px solid var(--surface-border); border-radius:8px; padding:0 10px; background:var(--surface-card, #fff);
      color:var(--content-fg); font:400 14px var(--font-sans); max-width:420px; width:100%; }
    .tbl { width:100%; border-collapse:collapse; font:400 14px var(--font-sans); background:var(--surface-card, #fff); border-radius:12px; overflow:hidden; }
    .tbl th { text-align:left; font:600 12px var(--font-sans); text-transform:uppercase; letter-spacing:.04em; color:var(--content-muted); padding:10px 12px; }
    .tbl td { padding:10px 12px; border-top:1px solid var(--surface-border); vertical-align:top; }
    .num { text-align:right; white-space:nowrap; }
    tr.off td { color:var(--content-muted); }
    .cs { font:600 14px var(--font-sans); }
    .warn { color:var(--warning, #b45309); }
    .res { font:600 13px var(--font-sans); }
    .res.ok { color:var(--success, #15803d); } .res.bad { color:var(--danger, #b91c1c); } .res.warn2 { color:var(--warning, #b45309); }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:13px; }
    .foot { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-top:14px; flex-wrap:wrap; }
  `]
})
export class BulkForward implements OnInit {
  private readonly svc = inject(ShipmentService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly dialogs = inject(DialogService);

  ids: string[] = [];
  readonly rows = signal<Row[]>([]);
  readonly pricing = signal(true);
  readonly priced = signal(0);
  readonly busy = signal(false);
  readonly progress = signal(0);
  readonly done = signal(false);

  readonly ready = computed(() => this.rows().filter((r) => !r.blocked && r.options.length && !r.result));
  readonly total = computed(() => this.ready().reduce((sum, r) => sum + (this.chosen(r)?.cost ?? 0), 0));
  readonly providers = computed(() => {
    const m = new Map<string, string>();
    this.rows().forEach((r) => r.options.forEach((o) => m.set(o.providerCode, o.providerName)));
    return [...m].map(([code, name]) => ({ code, name }));
  });

  async ngOnInit(): Promise<void> {
    this.breadcrumb.set([{ label: 'Hub Operations' }, { label: 'Shipments At Hub', route: '/hub-operations/shipments' }, { label: 'Forward Shipments' }]);
    this.ids = (this.route.snapshot.queryParamMap.get('ids') ?? '').split(',').map((x) => x.trim()).filter((x) => !!x).slice(0, 50);
    this.rows.set(this.ids.map((id) => ({ shipmentId: id, shipmentNumber: '…', options: [], blocked: null, collectFrom: null, choice: '', result: null })));
    for (let i = 0; i < this.ids.length; i += CHUNK) {
      const chunk = this.ids.slice(i, i + CHUNK);
      try {
        const answer = await firstValueFrom(this.svc.bulkForwardOptions(chunk));
        answer.forEach((a) => this.patch(a.shipmentId, this.fromOptions(a.options, a.error)));
      } catch {
        chunk.forEach((id) => this.patch(id, { blocked: 'Could not be priced. Try again.' }));
      }
      this.priced.set(Math.min(this.ids.length, i + CHUNK));
    }
    this.pricing.set(false);
  }

  private fromOptions(o: ForwardOptions | null, error: string | null): Partial<Row> {
    if (!o) return { blocked: error ?? 'Could not be priced.' };
    const blocked = o.blocker ?? (o.options.length ? null
      : 'No courier can take it' + (o.unavailable.length ? ': ' + o.unavailable.map((u) => `${u.providerName} (${u.reason ?? 'unavailable'})`).join('; ') : '.'));
    return { shipmentNumber: o.shipmentNumber, collectFrom: o.collectFrom, options: o.options, blocked,
      choice: o.options.length ? this.key(o.options[0]) : '' };
  }

  private patch(id: string, change: Partial<Row>): void {
    this.rows.update((list) => list.map((r) => (r.shipmentId === id ? { ...r, ...change } : r)));
  }

  key(o: ForwardOption): string { return `${o.providerCode}|${o.serviceCode}`; }
  chosen(r: Row): ForwardOption | undefined { return r.options.find((o) => this.key(o) === r.choice); }
  eta(o: ForwardOption): string {
    return o.etaMinDays == null ? '' : ` (${o.etaMinDays}${o.etaMaxDays != null && o.etaMaxDays !== o.etaMinDays ? '–' + o.etaMaxDays : ''} days)`;
  }

  choose(r: Row, choice: string): void { this.patch(r.shipmentId, { choice }); }

  /** Options come cheapest first from the server. */
  cheapestForAll(): void {
    this.rows.update((list) => list.map((r) => (r.options.length && !r.result ? { ...r, choice: this.key(r.options[0]) } : r)));
  }

  /** That courier's cheapest service on every row it serves; other rows keep their choice. */
  oneCourier(code: string): void {
    if (!code) return;
    this.rows.update((list) => list.map((r) => {
      const o = r.result ? undefined : r.options.find((x) => x.providerCode === code);
      return o ? { ...r, choice: this.key(o) } : r;
    }));
  }

  async forwardAll(): Promise<void> {
    const todo = this.ready();
    const ok = await firstValueFrom(this.dialogs.confirm({
      title: 'Forward shipments',
      message: `Forward ${todo.length} shipment(s) to the chosen couriers for ₹${this.total().toFixed(2)} in all? Each is priced again and booked one after the other.`,
      confirmLabel: 'Forward'
    }));
    if (!ok) return;
    this.busy.set(true);
    this.progress.set(0);
    for (let i = 0; i < todo.length; i += CHUNK) {
      const chunk = todo.slice(i, i + CHUNK);
      const items = chunk.map((r) => { const [providerCode, serviceCode] = r.choice.split('|'); return { shipmentId: r.shipmentId, providerCode, serviceCode }; });
      try {
        const res = await firstValueFrom(this.svc.bulkForward(items));
        res.forEach((x) => this.patch(x.shipmentId, { result: x }));
      } catch {
        chunk.forEach((r) => this.patch(r.shipmentId, { result: { shipmentId: r.shipmentId, outcome: 'ERROR',
          message: 'No answer from the server; open the shipment to check whether it was forwarded.', provider: null, serviceName: null,
          awb: null, labelUrl: null, cost: null } }));
      }
      this.progress.set(Math.min(todo.length, i + CHUNK));
    }
    this.busy.set(false);
    this.done.set(true);
  }

  count(outcome: string): number { return this.rows().filter((r) => r.result?.outcome === outcome).length; }

  label(outcome: string): string {
    return { FORWARDED: 'Forwarded', UNCONFIRMED: 'Not confirmed: check with the courier', REFUSED: 'Not forwarded', ERROR: 'Not forwarded' }[outcome] ?? outcome;
  }

  /** The result as a CSV file (opens in Excel). */
  download(): void {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Shipment', 'Result', 'Courier', 'Service', 'Courier AWB', 'Our cost', 'Message', 'Label'].map(esc).join(',')];
    for (const r of this.rows()) {
      const x = r.result;
      lines.push([r.shipmentNumber, x ? this.label(x.outcome) : (r.blocked ? 'Not forwarded' : ''), x?.provider ?? '', x?.serviceName ?? '',
        x?.awb ?? '', x?.cost ?? '', x?.message ?? r.blocked ?? '', x?.labelUrl ?? ''].map(esc).join(','));
    }
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `forwarded-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  back(): void { this.router.navigate(['/hub-operations/shipments']); }
}
