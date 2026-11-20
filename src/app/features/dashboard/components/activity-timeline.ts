import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { ActivityKind, DashboardActivity } from '../models/dashboard.model';

const ICONS: Record<ActivityKind, string> = {
  BOOKING: 'add_box', DELIVERY: 'task_alt', WALLET: 'account_balance_wallet', SYSTEM: 'settings'
};

/** Vertical timeline of latest bookings, deliveries, wallet moves and system events. */
@Component({
  selector: 'app-activity-timeline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, MatIconModule, UiCard, UiLoader],
  template: `
    <app-card title="Recent Activity" subtitle="Latest events across your network">
      @if (loading()) {
        <app-loader [minHeight]="240" />
      } @else if (rows().length === 0) {
        <div class="tl-empty">
          <mat-icon>history</mat-icon>
          <p class="text-h3">No activity yet</p>
          <p class="text-caption">Bookings, scans and wallet moves appear here as they happen.</p>
        </div>
      } @else {
        <ul class="tl">
          @for (a of rows(); track a.id) {
            <li class="tl__item" [attr.data-kind]="a.kind">
              <span class="tl__dot"><mat-icon>{{ iconFor(a.kind) }}</mat-icon></span>
              <div class="tl__body">
                <p class="tl__title">{{ a.title }}</p>
                @if (a.detail) { <p class="text-caption">{{ a.detail }}</p> }
              </div>
              <div class="tl__meta">
                @if (a.amount != null) { <span class="tl__amt">₹{{ a.amount | number:'1.0-2' }}</span> }
                <span class="text-caption">{{ a.at | date:'short' }}</span>
              </div>
            </li>
          }
        </ul>
      }
    </app-card>
  `,
  styles: [`
    .tl-empty { display:flex; flex-direction:column; align-items:center; gap:6px; padding:28px 0; color:var(--content-muted); text-align:center; }
    .tl-empty mat-icon { font-size:40px; width:40px; height:40px; opacity:.45; }
    .tl { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
    .tl__item { display:flex; align-items:flex-start; gap:12px; padding:10px 12px; border-radius:16px; }
    .tl__item:hover { background:var(--surface-muted); }
    .tl__dot { display:grid; place-items:center; width:36px; height:36px; border-radius:14px; flex:none;
      background:var(--brand-50); color:var(--brand-600); box-shadow:var(--shadow-clay-inset); }
    .tl__dot mat-icon { font-size:18px; width:18px; height:18px; }
    .tl__item[data-kind="DELIVERY"] .tl__dot { background:var(--success-bg); color:var(--success); }
    .tl__item[data-kind="WALLET"] .tl__dot { background:var(--info-bg); color:var(--info); }
    .tl__item[data-kind="SYSTEM"] .tl__dot { background:var(--warning-bg); color:var(--warning); }
    .tl__body { flex:1; min-width:0; }
    .tl__title { font:600 17px var(--font-sans); margin:0; }
    .tl__meta { display:flex; flex-direction:column; align-items:flex-end; gap:2px; flex:none; white-space:nowrap; }
    .tl__amt { font:700 16px var(--font-sans); }
  `]
})
export class ActivityTimeline {
  readonly loading = input(false);
  readonly rows = input<DashboardActivity[]>([]);

  iconFor(kind: ActivityKind): string { return ICONS[kind] ?? 'bolt'; }
}
