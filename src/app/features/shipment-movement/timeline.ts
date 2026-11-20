import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { ShipmentService } from '@features/shipment/shipment.service';
import { TimelineStep } from '@core/models/shipment.model';

const ICONS: Record<string, string> = {
  BOOKED: 'add_box', MANIFEST_CREATED: 'qr_code_scanner',
  DISPATCHED: 'outbound', IN_SCAN: 'move_to_inbox', OUT_FOR_DELIVERY: 'directions_run',
  DELIVERED: 'task_alt'
};

/** Timeline — Booked -> Loading Sheet Created -> Dispatched -> Received -> Out For Delivery ->
 *  Delivered. Loading Sheet folded into Manifest Created on request — one milestone, not two.
 *  GET /shipments/{id}/timeline. */
@Component({
  selector: 'app-shipment-timeline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, MatIconModule, UiCard, UiLoader],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Shipment Timeline</h1>
          <p class="text-caption"><a [routerLink]="['/shipments', id]">← Back to shipment</a></p></div>
      </header>

      @if (loading()) {
        <app-loader [minHeight]="200" caption="Loading…" />
      } @else {
        <app-card>
          <div class="tl">
            @for (step of steps(); track step.status; let i = $index) {
              <div class="tl__row" [class.tl__row--done]="step.completed" [class.tl__row--current]="isCurrent(i)">
                <div class="tl__icon"><mat-icon>{{ icon(step.status) }}</mat-icon></div>
                <div class="tl__body">
                  <strong>{{ step.label }}</strong>
                  @if (step.completed) {
                    <span class="text-caption">{{ step.changedAt | date: 'medium' }}</span>
                  } @else {
                    <span class="text-caption tl__pending">Pending</span>
                  }
                </div>
              </div>
            }
          </div>
        </app-card>
      }
    </div>
  `,
  styles: [`
    .tl { display:flex; flex-direction:column; }
    .tl__row { display:flex; gap:16px; align-items:flex-start; padding:14px 4px; position:relative; }
    .tl__row:not(:last-child)::before { content:''; position:absolute; left:21px; top:48px; bottom:-2px; width:3px;
      border-radius:3px; background:var(--surface-border); }
    .tl__row--done:not(:last-child)::before { background:linear-gradient(var(--brand-400), var(--brand-200)); }
    .tl__icon { width:42px; height:42px; border-radius:16px; background:var(--surface-muted); color:var(--content-muted);
      display:grid; place-items:center; flex:0 0 auto; z-index:1; box-shadow:var(--shadow-clay-inset); }
    .tl__row--done .tl__icon { background:linear-gradient(155deg, var(--brand-400), var(--brand-600)); color:#fff; box-shadow:var(--shadow-clay-sm); }
    .tl__row--current .tl__icon { box-shadow:var(--shadow-clay-sm), 0 0 0 4px var(--brand-100); }
    .tl__body { display:flex; flex-direction:column; gap:2px; padding-top:8px; }
    .tl__body strong { font:600 17px var(--font-sans); color:var(--content-fg); }
    .tl__row--current .tl__body strong { color:var(--brand-700); font-weight:700; }
    .tl__row:not(.tl__row--done) .tl__body strong { color:var(--content-muted); }
    .tl__pending { font-style:italic; }
  `]
})
export class ShipmentTimeline implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly shipmentService = inject(ShipmentService);

  id = '';
  readonly loading = signal(true);
  readonly steps = signal<TimelineStep[]>([]);

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.breadcrumb.set([{ label: 'Shipments', route: '/shipments' }, { label: 'Timeline' }]);
    this.shipmentService.timeline(this.id).subscribe({
      next: (s) => { this.steps.set(s); this.loading.set(false); },
      error: () => { this.steps.set([]); this.loading.set(false); }
    });
  }

  icon(status: string): string { return ICONS[status] ?? 'circle'; }

  /** The most recently completed step — the shipment's current position on the line. */
  isCurrent(index: number): boolean {
    const steps = this.steps();
    return steps[index]?.completed && !steps[index + 1]?.completed;
  }
}
