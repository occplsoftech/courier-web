import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';

/** Header breadcrumb, fed by BreadcrumbService (pages set it on init). */
@Component({
  selector: 'app-breadcrumb',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatIconModule],
  template: `
    <nav class="bc">
      @for (c of crumbs(); track $index; let last = $last) {
        @if (c.route && !last) {
          <a class="bc__link" [routerLink]="c.route">{{ c.label }}</a>
        } @else {
          <span class="bc__cur">{{ c.label }}</span>
        }
        @if (!last) { <mat-icon class="bc__sep">chevron_right</mat-icon> }
      }
    </nav>
  `,
  styles: [`
    .bc { display:flex; align-items:center; gap:4px; min-width:0; white-space:nowrap; }
    .bc__link, .bc__cur { overflow:hidden; text-overflow:ellipsis; min-width:0; }
    .bc__link { color:var(--content-muted); text-decoration:none; font:500 17px var(--font-sans); }
    .bc__link:hover { color:var(--brand-600); }
    .bc__cur { color:var(--content-fg); font:600 17px var(--font-sans); }
    .bc__sep { font-size:16px; width:16px; height:16px; color:var(--content-muted); }
  `]
})
export class Breadcrumb {
  private readonly service = inject(BreadcrumbService);
  readonly crumbs = this.service.crumbs;
}
