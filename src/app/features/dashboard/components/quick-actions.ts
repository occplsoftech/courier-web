import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { QuickActionDef } from '../dashboard.roles';

/** Grid of primary operator actions. Emits the picked action; the page routes or toasts. */
@Component({
  selector: 'app-quick-actions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, UiCard],
  template: `
    <app-card title="Quick Actions" subtitle="Jump straight to a task">
      <div class="qa">
        @for (a of actions(); track a.id) {
          <button type="button" class="qa__btn" (click)="pick.emit(a)">
            <span class="qa__ic" [attr.data-tone]="a.tone"><mat-icon>{{ a.icon }}</mat-icon></span>
            <span class="qa__label">{{ a.label }}</span>
          </button>
        }
      </div>
    </app-card>
  `,
  styles: [`
    .qa { display:grid; grid-template-columns:repeat(3, 1fr); gap:14px; }
    .qa__btn { display:flex; flex-direction:column; align-items:center; gap:10px; padding:18px 8px;
      border:0; border-radius:20px; background:var(--surface); box-shadow:var(--shadow-clay-sm);
      cursor:pointer; transition:box-shadow .15s ease, transform .15s ease; color:var(--content-fg); }
    .qa__btn:hover { background:var(--brand-50); transform:translateY(-2px); box-shadow:var(--shadow-clay); }
    .qa__btn:active { transform:translateY(0); box-shadow:var(--shadow-clay-inset); }
    .qa__ic { display:grid; place-items:center; width:44px; height:44px; border-radius:16px;
      background:var(--brand-50); color:var(--brand-600); box-shadow:var(--shadow-clay-inset); }
    @media (prefers-reduced-motion: reduce) { .qa__btn { transition:box-shadow .15s ease; } .qa__btn:hover, .qa__btn:active { transform:none; } }
    .qa__ic[data-tone="success"] { background:var(--success-bg); color:var(--success); }
    .qa__ic[data-tone="warning"] { background:var(--warning-bg); color:var(--warning); }
    .qa__ic[data-tone="danger"]  { background:var(--danger-bg);  color:var(--danger); }
    .qa__ic[data-tone="info"]    { background:var(--info-bg);    color:var(--info); }
    .qa__btn:hover .qa__ic { filter:brightness(.96); }
    .qa__label { font:600 15px var(--font-sans); text-align:center; }
    @media (max-width:520px){ .qa { grid-template-columns:repeat(2,1fr); } }
  `]
})
export class QuickActions {
  readonly actions = input<QuickActionDef[]>([]);
  readonly pick = output<QuickActionDef>();
}
