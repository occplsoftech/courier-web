import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { BranchSummaryRow } from '../models/dashboard.model';

/** Compact list of branches for company/platform dashboards. Data from the real /branches list. */
@Component({
  selector: 'app-branch-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, RouterLink, UiCard, UiLoader, StatusBadge],
  template: `
    <app-card title="Branch Summary" subtitle="Booking & delivery offices">
      <a card-actions routerLink="/branches" class="bs__link">Manage</a>
      @if (!loading() && (pendingDelivery() != null || totalBranches() != null)) {
        <div class="bs__stats">
          @if (pendingDelivery() != null) {
            <span class="bs__stat" data-tone="warning">
              <mat-icon>local_shipping</mat-icon>
              {{ pendingDelivery() }} pending delivery
            </span>
          }
          @if (totalBranches() != null) {
            <span class="bs__stat" data-tone="success">
              <mat-icon>store</mat-icon>
              {{ activeBranches() }} of {{ totalBranches() }} branches active
            </span>
          }
        </div>
      }
      @if (loading()) {
        <app-loader [minHeight]="180" />
      } @else if (rows().length === 0) {
        <div class="bs-empty">
          <mat-icon>store</mat-icon>
          <p class="text-caption">No branches yet</p>
        </div>
      } @else {
        <ul class="bs">
          @for (b of rows(); track b.id) {
            <li class="bs__item">
              <span class="bs__code">{{ b.branchCode }}</span>
              <div class="bs__body">
                <p class="bs__name">{{ b.branchName }}</p>
                @if (b.city) { <p class="text-caption">{{ b.city }}</p> }
              </div>
              <app-status-badge [value]="b.status" />
            </li>
          }
        </ul>
      }
    </app-card>
  `,
  styles: [`
    .bs__link { font:600 16px var(--font-sans); color:var(--brand-600); text-decoration:none; }
    .bs__stats { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
    .bs__stat { display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border-radius:var(--r-pill);
      font:600 15px var(--font-sans); }
    .bs__stat mat-icon { font-size:16px; width:16px; height:16px; }
    .bs__stat[data-tone="warning"] { background:var(--warning-bg); color:var(--warning); }
    .bs__stat[data-tone="success"] { background:var(--success-bg); color:var(--success); }
    .bs-empty { display:flex; flex-direction:column; align-items:center; gap:6px; padding:24px 0; color:var(--content-muted); }
    .bs-empty mat-icon { font-size:34px; width:34px; height:34px; opacity:.45; }
    .bs { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
    .bs__item { display:flex; align-items:center; gap:12px; padding:8px 10px; border-radius:16px; }
    .bs__item:hover { background:var(--surface-muted); }
    .bs__code { display:grid; place-items:center; min-width:54px; height:32px; padding:0 8px; border-radius:12px;
      background:var(--brand-50); color:var(--brand-600); font:700 15px var(--font-sans); box-shadow:var(--shadow-clay-inset); }
    .bs__body { flex:1; min-width:0; }
    .bs__name { font:600 17px var(--font-sans); margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  `]
})
export class BranchSummary {
  readonly loading = input(false);
  readonly rows = input<BranchSummaryRow[]>([]);
  readonly pendingDelivery = input<number | null>(null);
  readonly activeBranches = input<number | null>(null);
  readonly totalBranches = input<number | null>(null);
}
