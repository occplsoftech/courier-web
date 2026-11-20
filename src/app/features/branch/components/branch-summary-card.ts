import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { BranchStatusBadge } from './branch-status-badge';
import { BranchResponse } from '@core/models/branch.model';

/**
 * Identity banner for the branch detail view — avatar, name, code, type/status, the
 * resolved manager and a strip of enabled-capability chips. Presentational only.
 */
@Component({
  selector: 'app-branch-summary-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, BranchStatusBadge],
  template: `
    <div class="bs__id">
      <span class="bs__av"><mat-icon>store</mat-icon></span>
      <div class="bs__body">
        <div class="bs__name"><h1 class="text-h1">{{ branch().branchName }}</h1>
          <app-branch-status-badge [status]="branch().status" /></div>
        <p class="text-caption mono">{{ branch().branchCode }}</p>
        <div class="bs__tags">
          <span class="tag tag--brand">{{ pretty(branch().branchType) }}</span>
          <span class="tag"><mat-icon>person</mat-icon>{{ managerName() }}</span>
          @if (location()) { <span class="tag"><mat-icon>place</mat-icon>{{ location() }}</span> }
        </div>
        <div class="bs__caps">
          @for (cap of capabilities(); track cap) { <span class="chip">{{ cap }}</span> }
          @if (!capabilities().length) { <span class="text-caption">No capabilities enabled.</span> }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .bs__id { display:flex; gap:16px; align-items:flex-start; }
    .bs__av { width:56px; height:56px; border-radius:14px; background:var(--brand-100); color:var(--brand-700); display:grid; place-items:center; flex:0 0 auto; }
    .bs__av mat-icon { font-size:28px; width:28px; height:28px; }
    .bs__name { display:flex; align-items:center; gap:12px; }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .bs__tags { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
    .tag { display:inline-flex; align-items:center; gap:3px; background:var(--surface-muted); border:1px solid var(--surface-border);
      color:var(--content-muted); font:600 14px var(--font-sans); padding:2px 8px; border-radius:6px; }
    .tag mat-icon { font-size:13px; width:13px; height:13px; }
    .tag--brand { background:var(--brand-50); color:var(--brand-700); border-color:var(--brand-100); }
    .bs__caps { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
    .chip { background:var(--success-bg); color:var(--success); font:600 14px var(--font-sans); padding:3px 9px; border-radius:999px; }
  `]
})
export class BranchSummaryCard {
  readonly branch = input.required<BranchResponse>();
  readonly managerName = input('Unassigned');

  pretty(v: string): string { return (v || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }

  readonly location = computed(() => {
    const b = this.branch();
    return [b.city, b.state].filter(Boolean).join(', ');
  });

  readonly capabilities = computed(() => {
    const b = this.branch();
    return [
      b.allowBooking && 'Booking', b.allowDelivery && 'Delivery', b.allowPickup && 'Pickup',
      b.allowManifest && 'Manifest', b.allowCashCollection && 'Cash Collection', b.allowWallet && 'Wallet',
      b.instantCommission && 'Instant Commission'
    ].filter(Boolean) as string[];
  });
}
