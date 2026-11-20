// Hub module not built yet — component disabled, not wired into dashboard.ts. Kept for when the
// hub backend lands so the card can be re-enabled instead of rewritten.
/*
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { HubSummaryRow } from '../models/dashboard.model';

/** Compact list of sorting hubs for company/platform dashboards. Data from the real /hubs list. * /
@Component({
  selector: 'app-hub-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, RouterLink, UiCard, UiLoader, StatusBadge],
  template: `
    <app-card title="Hub Summary" subtitle="Sorting & transit hubs">
      <a card-actions routerLink="/hubs" class="hs__link">Manage</a>
      @if (loading()) {
        <app-loader [minHeight]="180" />
      } @else if (rows().length === 0) {
        <div class="hs-empty">
          <mat-icon>hub</mat-icon>
          <p class="text-caption">No hubs yet</p>
        </div>
      } @else {
        <ul class="hs">
          @for (h of rows(); track h.id) {
            <li class="hs__item">
              <span class="hs__code">{{ h.hubCode }}</span>
              <div class="hs__body">
                <p class="hs__name">{{ h.hubName }}</p>
                @if (h.city) { <p class="text-caption">{{ h.city }}</p> }
              </div>
              <app-status-badge [value]="h.status" />
            </li>
          }
        </ul>
      }
    </app-card>
  `,
  styles: [`
    .hs__link { font:600 16px var(--font-sans); color:var(--brand-600); text-decoration:none; }
    .hs-empty { display:flex; flex-direction:column; align-items:center; gap:6px; padding:24px 0; color:var(--content-muted); }
    .hs-empty mat-icon { font-size:34px; width:34px; height:34px; opacity:.45; }
    .hs { list-style:none; margin:0; padding:0; }
    .hs__item { display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--surface-border); }
    .hs__item:last-child { border-bottom:0; }
    .hs__code { display:grid; place-items:center; min-width:52px; height:30px; padding:0 8px; border-radius:8px;
      background:var(--info-bg); color:var(--info); font:700 15px var(--font-sans); }
    .hs__body { flex:1; min-width:0; }
    .hs__name { font:600 17px var(--font-sans); margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  `]
})
export class HubSummary {
  readonly loading = input(false);
  readonly rows = input<HubSummaryRow[]>([]);
}
*/
