import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RateStatusBadge } from './rate-status-badge';
import { Rate } from '@core/models/rate.model';

interface SlabRow {
  rate: Rate;
  /** True when this active slab shares weight with another active slab in the list — the
   *  same rule RateServiceImpl.requireNoOverlap enforces server-side. Shown so an admin
   *  building a rate card sees a conflict before saving, not after a 422. */
  overlapsAnother: boolean;
}

/**
 * One Route -> many Weight Slabs. Lists every rate that shares a Route + Service Type +
 * Package Type + Payment Mode combination, sorted by minimum weight, so an admin can see
 * the whole tariff for that lane at a glance and spot a gap or an overlap before saving.
 * Read-only — editing happens through the Rate Form.
 */
@Component({
  selector: 'app-weight-slab-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, RateStatusBadge],
  template: `
    @if (rows().length === 0) {
      <p class="empty">No other slabs are configured for this route, service type, package type and payment mode yet.</p>
    } @else {
      <table class="grid">
        <thead>
          <tr><th>#</th><th>Rate Code</th><th>Weight Slab</th><th>Base Rate</th><th>Status</th></tr>
        </thead>
        <tbody>
          @for (row of slabRows(); track row.rate.id; let i = $index) {
            <tr [class.current]="row.rate.id === currentId()" [class.conflict]="row.overlapsAnother">
              <td>{{ i + 1 }}</td>
              <td class="mono">{{ row.rate.rateCode }}@if (row.rate.id === currentId()) { <em>(this rate)</em> }</td>
              <td class="mono">[{{ row.rate.minimumWeight }}, {{ row.rate.maximumWeight }}) {{ row.rate.weightUnit }}</td>
              <td class="mono">{{ row.rate.baseRate | number: '1.2-2' }}</td>
              <td><app-rate-status-badge [status]="row.rate.status" />
                @if (row.overlapsAnother) { <span class="warn">overlaps</span> }
              </td>
            </tr>
          }
        </tbody>
      </table>
    }
  `,
  styles: [`
    .grid { width:100%; border-collapse:collapse; }
    .grid th { text-align:left; font:600 15px var(--font-sans); color:var(--content-muted); padding:8px 10px; border-bottom:1px solid var(--surface-border); }
    .grid td { padding:8px 10px; font:400 16px var(--font-sans); border-bottom:1px solid var(--surface-border); }
    .mono { font-family:var(--font-mono, ui-monospace); }
    tr.current td { background:var(--brand-50, rgba(59,130,246,.06)); }
    tr.conflict td { background:var(--danger-50, rgba(239,68,68,.06)); }
    .warn { margin-left:8px; font:600 14px var(--font-sans); color:var(--danger); }
    em { margin-left:6px; font:400 15px var(--font-sans); color:var(--content-muted); font-style:normal; }
    .empty { font:400 16px var(--font-sans); color:var(--content-muted); padding:12px 0; }
  `]
})
export class WeightSlabGrid {
  /** Every rate sharing the combination, in any status. */
  readonly rows = input<Rate[]>([]);
  /** The rate being created/edited, if any — highlighted and excluded from its own
   *  overlap check. */
  readonly currentId = input<string | null>(null);

  protected readonly slabRows = computed<SlabRow[]>(() => {
    const active = this.rows().filter((r) => r.status === 'ACTIVE');
    return this.rows()
      .slice()
      .sort((a, b) => a.minimumWeight - b.minimumWeight)
      .map((rate) => ({
        rate,
        overlapsAnother: rate.status === 'ACTIVE' && active.some((other) =>
          other.id !== rate.id
          && rate.minimumWeight < other.maximumWeight
          && other.minimumWeight < rate.maximumWeight)
      }));
  });
}
