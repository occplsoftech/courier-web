import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { UndeliveredCase } from '@core/models/shipment.model';
import { ShipmentMovementService } from './shipment-movement.service';

/**
 * Undelivered shipments — every open failed-delivery case (Phase 10.2): why it failed, how many attempts, how long it has waited,
 * and what the customer chose. Staff send it out again (Generate DRS, with the new address if one was given) or return it to the
 * sender. A case is flagged for return after 3 attempts, when the customer asks, or after 7 days without an answer.
 */
@Component({
  selector: 'app-undelivered-queue',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, UiCard, UiButton, UiLoader],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">Undelivered Shipments</h1>
          <p class="text-caption">Failed delivery attempts waiting for action. Send them out again from Generate DRS, or return them to the sender.</p>
        </div>
        <div class="page__actions">
          <app-button variant="stroked" icon="directions_run" (pressed)="goDrs()">Generate DRS</app-button>
          <app-button variant="stroked" icon="refresh" (pressed)="load()">Refresh</app-button>
        </div>
      </header>

      <div class="chips">
        <button type="button" class="chip" [class.chip--on]="filter() === 'ALL'" (click)="filter.set('ALL')">All <b>{{ cases().length }}</b></button>
        <button type="button" class="chip" [class.chip--on]="filter() === 'FLAGGED'" (click)="filter.set('FLAGGED')">Return due <b>{{ flaggedCount() }}</b></button>
        <button type="button" class="chip" [class.chip--on]="filter() === 'ANSWERED'" (click)="filter.set('ANSWERED')">Customer answered <b>{{ answeredCount() }}</b></button>
        <button type="button" class="chip" [class.chip--on]="filter() === 'WAITING'" (click)="filter.set('WAITING')">No answer yet <b>{{ cases().length - answeredCount() }}</b></button>
      </div>

      <app-card>
        @if (loading()) {
          <app-loader [minHeight]="120" caption="Loading…" />
        } @else if (!shown().length) {
          <p class="empty">{{ cases().length ? 'Nothing matches this filter.' : 'No undelivered shipments. Every failed attempt has been acted on.' }}</p>
        } @else {
          <div class="tbl__wrap">
            <table class="tbl">
              <thead><tr><th>Shipment</th><th>Receiver</th><th>Last attempt</th><th>Attempts</th><th>Waiting</th><th>Customer's choice</th><th></th></tr></thead>
              <tbody>
                @for (c of shown(); track c.shipmentId) {
                  <tr [class.row--due]="c.returnFlagged">
                    <td><strong>{{ c.shipmentNumber }}</strong><br><span class="muted">{{ c.trackingNumber || '' }}</span></td>
                    <td>{{ c.receiverName }}<br><span class="muted">{{ c.receiverContact }}{{ c.toCity ? ' · ' + c.toCity : '' }}</span></td>
                    <td>{{ c.reasonLabel || '—' }}@if (c.note) { <br><span class="muted">{{ c.note }}</span> }
                      @if (c.failedAt) { <br><span class="muted">{{ c.failedAt | date: 'd MMM, h:mm a' }}</span> }</td>
                    <td>{{ c.attempts }}</td>
                    <td>{{ c.daysWaiting }} {{ c.daysWaiting === 1 ? 'day' : 'days' }}</td>
                    <td>
                      @if (c.choice) {
                        <span class="choice" [class.choice--return]="c.choice === 'RETURN'">{{ c.choiceLabel }}</span>
                        @if (c.choiceDate) { <br><span class="muted">on {{ c.choiceDate | date: 'EEE d MMM' }}</span> }
                        @if (c.choice === 'CHANGE_ADDRESS') { <br><span class="muted addr">{{ c.receiverAddress }}</span> }
                      } @else { <span class="muted">No answer yet</span> }
                      @if (c.returnFlagged) { <br><span class="due">Return due</span> }
                    </td>
                    <td class="tbl--right">
                      <app-button variant="danger" icon="undo" [loading]="returning() === c.shipmentId" (pressed)="returnIt(c)">Return</app-button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </app-card>
    </div>
  `,
  styles: [`
    .page__actions { display:flex; gap:10px; flex-wrap:wrap; }
    .chips { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 12px; }
    .chip { border:1px solid var(--surface-border); background:var(--surface); color:var(--content-fg); border-radius:999px; padding:6px 12px; font:500 13px var(--font-sans); cursor:pointer; }
    .chip b { margin-left:4px; }
    .chip--on { border-color:var(--brand-600); background:color-mix(in srgb, var(--brand-600) 10%, var(--surface)); }
    .empty { font:400 14px var(--font-sans); color:var(--content-muted); text-align:center; padding:20px; }
    .tbl__wrap { overflow-x:auto; }
    .tbl { width:100%; border-collapse:collapse; font:400 14px var(--font-sans); }
    .tbl th { text-align:left; font:500 12px var(--font-sans); color:var(--content-muted); text-transform:uppercase; letter-spacing:.04em; padding:0 12px 8px; }
    .tbl td { padding:10px 12px; border-top:1px solid var(--surface-border); color:var(--content-fg); vertical-align:top; }
    .tbl--right { text-align:right; }
    .muted { font-size:12px; color:var(--content-muted); }
    .addr { display:inline-block; max-width:240px; }
    .row--due { background:color-mix(in srgb, var(--danger, #b3123a) 5%, transparent); }
    .due { font:700 11px var(--font-sans); color:var(--danger, #b3123a); text-transform:uppercase; letter-spacing:.04em; }
    .choice { font-weight:600; }
    .choice--return { color:var(--danger, #b3123a); }
  `]
})
export class UndeliveredQueue implements OnInit {
  private readonly movement = inject(ShipmentMovementService);
  private readonly notify = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly cases = signal<UndeliveredCase[]>([]);
  readonly filter = signal<'ALL' | 'FLAGGED' | 'ANSWERED' | 'WAITING'>('ALL');
  readonly returning = signal<string | null>(null);

  readonly flaggedCount = computed(() => this.cases().filter((c) => c.returnFlagged).length);
  readonly answeredCount = computed(() => this.cases().filter((c) => !!c.choice).length);
  readonly shown = computed(() => {
    const all = this.cases();
    switch (this.filter()) {
      case 'FLAGGED': return all.filter((c) => c.returnFlagged);
      case 'ANSWERED': return all.filter((c) => !!c.choice);
      case 'WAITING': return all.filter((c) => !c.choice);
      default: return all;
    }
  });

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Operations' }, { label: 'Undelivered Shipments' }]);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.movement.undelivered().subscribe({
      next: (c) => { this.cases.set(c); this.loading.set(false); },
      error: (e) => { this.loading.set(false); this.notify.error(e.error?.message ?? 'The undelivered shipments could not be loaded.'); }
    });
  }

  goDrs(): void { this.router.navigate(['/movement/out-for-delivery']); }

  returnIt(c: UndeliveredCase): void {
    this.dialog.prompt({
      title: `Return ${c.shipmentNumber} to the sender`,
      message: 'The shipment ends as Returned. Arrange the trip back with your branch. The customer is told when that message is switched on.',
      label: 'Reason', placeholder: c.returnFlagged ? 'e.g. 3 failed attempts' : 'Why is it being returned?',
      confirmLabel: 'Return to sender', danger: true
    }).subscribe((reason) => {
      if (!reason) return;
      this.returning.set(c.shipmentId);
      this.movement.returnToSender(c.shipmentId, reason).subscribe({
        next: () => { this.returning.set(null); this.notify.success(`${c.shipmentNumber} returned to the sender.`); this.load(); },
        error: (e) => { this.returning.set(null); this.notify.error(e.error?.message ?? 'The shipment could not be returned.'); }
      });
    });
  }
}
