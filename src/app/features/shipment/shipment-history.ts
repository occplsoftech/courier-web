import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { ShipmentStatusHistoryEntry } from '@core/models/shipment.model';
import { ShipmentStatusBadge } from './components/shipment-status-badge';
import { ShipmentService } from './shipment.service';

/** Shipment History — the append-only status timeline, oldest first. GET /shipments/{id}/history. */
@Component({
  selector: 'app-shipment-history',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, UiCard, UiLoader, ShipmentStatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Shipment History</h1>
          <p class="text-caption"><a [routerLink]="['/shipments', id]">← Back to shipment</a></p></div>
      </header>

      @if (loading()) {
        <app-loader [minHeight]="240" caption="Loading…" />
      } @else if (!entries().length) {
        <app-card><p class="empty">No status history on file for this shipment.</p></app-card>
      } @else {
        <app-card title="Status Timeline">
          <ol class="tl">
            @for (e of entries(); track e.id) {
              <li class="tl__row">
                <div class="tl__dot"></div>
                <div class="tl__body">
                  <div class="tl__head">
                    @if (e.previousStatus) { <app-shipment-status-badge [status]="e.previousStatus" /> <span class="tl__arrow">→</span> }
                    <app-shipment-status-badge [status]="e.status" />
                    <span class="tl__at">{{ e.changedAt | date: 'medium' }}</span>
                  </div>
                  @if (e.remarks) { <p class="tl__remarks">{{ e.remarks }}</p> }
                </div>
              </li>
            }
          </ol>
        </app-card>
      }
    </div>
  `,
  styles: [`
    .tl { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; }
    .tl__row { display:flex; gap:14px; padding:12px 0; border-left:2px solid var(--surface-border); margin-left:5px; padding-left:20px; position:relative; }
    .tl__row:last-child { border-color:transparent; }
    .tl__dot { position:absolute; left:-7px; top:14px; width:12px; height:12px; border-radius:50%; background:var(--brand-600); }
    .tl__body { flex:1; }
    .tl__head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .tl__arrow { color:var(--content-muted); font-size:16px; }
    .tl__at { font:400 15px var(--font-sans); color:var(--content-muted); margin-left:auto; }
    .tl__remarks { margin:6px 0 0; font:400 16px var(--font-sans); color:var(--content-fg); }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
  `]
})
export class ShipmentHistory implements OnInit {
  private readonly service = inject(ShipmentService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(true);
  readonly entries = signal<ShipmentStatusHistoryEntry[]>([]);
  id = '';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.breadcrumb.set([{ label: 'Shipments', route: '/shipments' }, { label: 'History' }]);
    this.service.history(this.id).subscribe({
      next: (h) => { this.entries.set(h); this.loading.set(false); },
      error: () => { this.entries.set([]); this.loading.set(false); }
    });
  }
}
