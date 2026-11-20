import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info';

/** KPI tile for the dashboard: icon, label, big number, optional delta. */
@Component({
  selector: 'app-statistic-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="app-card stat" [attr.data-tone]="tone()">
      <div class="stat__icon" [attr.data-tone]="tone()"><mat-icon>{{ icon() }}</mat-icon></div>
      <div class="stat__body">
        <p class="text-caption">{{ label() }}</p>
        @if (loading()) {
          <div class="stat__skeleton"></div>
        } @else {
          <p class="stat__value num-tabular">{{ prefix() }}{{ value() }}</p>
        }
        @if (delta() !== null) {
          <p class="stat__delta" [class.down]="(delta() ?? 0) < 0">
            <mat-icon>{{ (delta() ?? 0) < 0 ? 'trending_down' : 'trending_up' }}</mat-icon>
            {{ deltaLabel() }}
          </p>
        }
      </div>
    </div>
  `,
  styles: [`
    .stat { position:relative; display:flex; align-items:center; gap:16px; padding:20px 22px;
      overflow:hidden; transition:transform .15s ease, box-shadow .15s ease; }
    .stat::before { content:''; position:absolute; inset:0; opacity:.5; pointer-events:none; }
    .stat:hover { transform:translateY(-2px); box-shadow:var(--shadow-clay-hover) !important; }
    .stat[data-tone="brand"]::before   { background:linear-gradient(135deg, var(--brand-50), transparent 70%); }
    .stat[data-tone="success"]::before { background:linear-gradient(135deg, var(--success-bg), transparent 70%); }
    .stat[data-tone="warning"]::before { background:linear-gradient(135deg, var(--warning-bg), transparent 70%); }
    .stat[data-tone="danger"]::before  { background:linear-gradient(135deg, var(--danger-bg), transparent 70%); }
    .stat[data-tone="info"]::before    { background:linear-gradient(135deg, var(--info-bg), transparent 70%); }
    .stat[data-tone="brand"]   { border-top:3px solid var(--brand-500); }
    .stat[data-tone="success"] { border-top:3px solid var(--success); }
    .stat[data-tone="warning"] { border-top:3px solid var(--warning); }
    .stat[data-tone="danger"]  { border-top:3px solid var(--danger); }
    .stat[data-tone="info"]    { border-top:3px solid var(--info); }
    .stat__icon, .stat__body { position:relative; }
    .stat__icon { display:grid; place-items:center; width:52px; height:52px; border-radius:18px;
      box-shadow:var(--shadow-clay-sm); flex-shrink:0; }
    .stat__icon mat-icon { font-size:24px; color:#fff; }
    .stat__icon[data-tone="brand"]   { background:linear-gradient(155deg, var(--brand-400),   var(--brand-600)); }
    .stat__icon[data-tone="success"] { background:linear-gradient(155deg, #4ade80, var(--success)); }
    .stat__icon[data-tone="warning"] { background:linear-gradient(155deg, #fbbf24, var(--warning)); }
    .stat__icon[data-tone="danger"]  { background:linear-gradient(155deg, #f87171, var(--danger)); }
    .stat__icon[data-tone="info"]    { background:linear-gradient(155deg, #60a5fa, var(--info)); }
    .stat__value { font:700 27px/1.1 var(--font-sans); margin:2px 0 0; letter-spacing:-.02em; }
    .stat[data-tone="brand"]   .stat__value { color:var(--brand-600); }
    .stat[data-tone="success"] .stat__value { color:var(--success); }
    .stat[data-tone="warning"] .stat__value { color:var(--warning); }
    .stat[data-tone="danger"]  .stat__value { color:var(--danger); }
    .stat[data-tone="info"]    .stat__value { color:var(--info); }
    .stat__skeleton { width:70px; height:24px; margin-top:4px; border-radius:6px;
      background:linear-gradient(90deg,var(--surface-muted),var(--surface-border),var(--surface-muted));
      background-size:200% 100%; animation:sh 1.2s infinite; }
    .stat__delta { display:flex; align-items:center; gap:4px; margin:6px 0 0; font:600 15px var(--font-sans); color:var(--success); }
    .stat__delta.down { color:var(--danger); }
    .stat__delta mat-icon { font-size:16px; width:16px; height:16px; }
    @keyframes sh { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
  `]
})
export class StatisticCard {
  readonly label = input('');
  readonly value = input<string | number>('—');
  readonly prefix = input('');
  readonly icon = input('insights');
  readonly tone = input<Tone>('brand');
  readonly loading = input(false);
  readonly delta = input<number | null>(null);
  readonly deltaLabel = input('');
}
