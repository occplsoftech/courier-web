import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { ReturnCase } from '@core/models/shipment.model';
import { ShipmentMovementService } from './shipment-movement.service';

/**
 * Returns (RTO) — shipments on their way back to the sender (Phase 12.1). Return to sender at the delivery branch sends the parcel
 * back to its booking branch on a normal Load Sheet; once it is in-scanned there, the booking branch hands it to the sender here.
 */
@Component({
  selector: 'app-returns-queue',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, UiCard, UiButton, UiLoader],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">Returns (RTO)</h1>
          <p class="text-caption">Parcels going back to their sender. Put them on a Load Sheet to their booking branch; once they are in-scanned there, hand them back.</p>
        </div>
        <div class="page__actions">
          <app-button variant="stroked" icon="local_shipping" (pressed)="goLoadingSheet()">Loading Sheet</app-button>
          <app-button variant="stroked" icon="refresh" (pressed)="load()">Refresh</app-button>
        </div>
      </header>

      <div class="chips">
        <button type="button" class="chip" [class.chip--on]="filter() === 'ALL'" (click)="filter.set('ALL')">All <b>{{ cases().length }}</b></button>
        <button type="button" class="chip" [class.chip--on]="filter() === 'BACK'" (click)="filter.set('BACK')">Ready to hand back <b>{{ backCount() }}</b></button>
        <button type="button" class="chip" [class.chip--on]="filter() === 'WAY'" (click)="filter.set('WAY')">On the way back <b>{{ cases().length - backCount() }}</b></button>
      </div>

      <app-card>
        @if (loading()) {
          <app-loader [minHeight]="120" caption="Loading…" />
        } @else if (!shown().length) {
          <p class="empty">{{ cases().length ? 'Nothing matches this filter.' : 'No returns open. Every returned parcel has been handed back.' }}</p>
        } @else {
          <div class="tbl__wrap">
            <table class="tbl">
              <thead><tr><th>Shipment</th><th>Back to (sender)</th><th>Was going to</th><th>Where it is</th><th>Started</th><th></th></tr></thead>
              <tbody>
                @for (c of shown(); track c.id) {
                  <tr [class.row--back]="c.backAtOrigin">
                    <td><strong>{{ c.shipmentNumber }}</strong><br><span class="muted">{{ c.trackingNumber || '' }}</span></td>
                    <td>{{ c.senderName }}<br><span class="muted">{{ c.senderContact }}</span></td>
                    <td>{{ c.receiverName }}<br><span class="muted">{{ c.toCity || '' }}</span></td>
                    <td>
                      @if (c.backAtOrigin) { <span class="back">Back at {{ branch(c.bookingBranchId) }}</span> }
                      @else {
                        {{ stepLabel(c.status) }}<br>
                        <span class="muted">{{ c.status === 'READY_FOR_MANIFEST' ? 'At ' + branch(c.currentLocationId) + ' — put it on a Load Sheet to ' + branch(c.bookingBranchId) : 'Going to ' + branch(c.bookingBranchId) }}</span>
                      }
                    </td>
                    <td>@if (c.rtoStartedAt) { {{ c.rtoStartedAt | date: 'd MMM' }} }<br><span class="muted">{{ c.daysOnTheWay }} {{ c.daysOnTheWay === 1 ? 'day' : 'days' }}</span></td>
                    <td class="tbl--right">
                      @if (c.backAtOrigin) {
                        <app-button icon="assignment_return" [loading]="handing() === c.id" (pressed)="handBack(c)">Hand back</app-button>
                      }
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
    .row--back { background:color-mix(in srgb, #1a9d5a 6%, transparent); }
    .back { font-weight:600; color:#17733a; }
  `]
})
export class ReturnsQueue implements OnInit {
  private readonly movement = inject(ShipmentMovementService);
  private readonly notify = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly router = inject(Router);
  private readonly masterData = inject(MasterDataService);

  readonly loading = signal(true);
  readonly cases = signal<ReturnCase[]>([]);
  readonly filter = signal<'ALL' | 'BACK' | 'WAY'>('ALL');
  readonly handing = signal<string | null>(null);
  private readonly branchNames = signal<Map<string, string>>(new Map());

  readonly backCount = computed(() => this.cases().filter((c) => c.backAtOrigin).length);
  readonly shown = computed(() => {
    const all = this.cases();
    switch (this.filter()) {
      case 'BACK': return all.filter((c) => c.backAtOrigin);
      case 'WAY': return all.filter((c) => !c.backAtOrigin);
      default: return all;
    }
  });

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Operations' }, { label: 'Returns (RTO)' }]);
    this.masterData.branchDirectory().subscribe((list) =>
      this.branchNames.set(new Map(list.map((b) => [b.id, `${b.branchName} (${b.branchCode})`]))));
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.movement.returns().subscribe({
      next: (c) => { this.cases.set(c); this.loading.set(false); },
      error: (e) => { this.loading.set(false); this.notify.error(e.error?.message ?? 'The returns could not be loaded.'); }
    });
  }

  branch(id: string | null): string { return id ? this.branchNames().get(id) ?? 'the branch' : 'the branch'; }

  stepLabel(status: string): string {
    switch (status) {
      case 'READY_FOR_MANIFEST': return 'Waiting for a Load Sheet';
      case 'MANIFEST_CREATED': return 'On a Load Sheet';
      case 'DISPATCHED': return 'In transit back';
      case 'IN_SCAN': return 'Received';
      default: return status;
    }
  }

  goLoadingSheet(): void { this.router.navigate(['/movement/loading-sheet']); }

  handBack(c: ReturnCase): void {
    this.dialog.prompt({
      title: `Hand ${c.shipmentNumber} back to the sender`,
      message: `The shipment ends as Returned. Enter who received it (usually ${c.senderName}).`,
      label: 'Received by', placeholder: c.senderName, confirmLabel: 'Hand back'
    }).subscribe((receivedBy) => {
      if (!receivedBy) return;
      this.handing.set(c.id);
      this.movement.handBack(c.id, receivedBy, null).subscribe({
        next: () => { this.handing.set(null); this.notify.success(`${c.shipmentNumber} handed back to the sender.`); this.load(); },
        error: (e) => { this.handing.set(null); this.notify.error(e.error?.message ?? 'The shipment could not be handed back.'); }
      });
    });
  }
}
