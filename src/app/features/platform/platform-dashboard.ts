import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { PlatformDashboard } from '@core/models/company.model';
import { StatisticCard } from '@shared/components/statistic-card/statistic-card';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { CompanyService } from '@features/company/company.service';

/**
 * The super admin's home screen: the platform, not any one company.
 *
 * <p>API-only. On a failed load the tiles read zero and the worklist is empty rather than
 * showing invented figures — the same degradation every other screen uses.
 *
 * <p>There is no shipment tile. The module that would produce the number does not exist,
 * and a tile reading 0 says "nobody has booked anything", which is a different and
 * untrue statement.
 */
@Component({
  selector: 'app-platform-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatIconModule, StatisticCard, StatusBadge, UiCard, UiLoader],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">Platform</h1>
          <p class="text-caption">Every company on the platform, and what needs attention.</p>
        </div>
      </header>

      @if (loading()) {
        <app-loader [minHeight]="280" caption="Loading platform figures…" />
      } @else {
        <section class="tiles">
          <app-statistic-card icon="domain" label="Companies" [value]="board().companyCount" tone="brand" />
          <app-statistic-card icon="check_circle" label="Active"
            [value]="byStatus('ACTIVE')" tone="success" />
          <app-statistic-card icon="schedule" label="On trial"
            [value]="byStatus('TRIAL')" tone="info" />
          <app-statistic-card icon="block" label="Suspended"
            [value]="byStatus('SUSPENDED')" tone="danger" />
          <app-statistic-card icon="event_busy" label="Lapsed"
            [value]="board().expiredCount" tone="danger" />
          <app-statistic-card icon="autorenew" label="Renewing in 30 days"
            [value]="board().expiringSoonCount" tone="warning" />
          <app-statistic-card icon="workspace_premium" label="Plans offered"
            [value]="board().activePlanCount" tone="brand" />
        </section>

        <app-card title="Renewals" subtitle="Soonest first. Lapsed companies are at the top.">
          @if (board().upcomingRenewals.length === 0) {
            <p class="empty">Nothing expires in the next thirty days.</p>
          } @else {
            <table class="renewals">
              <thead>
                <tr>
                  <th>#</th><th>Company</th><th>Code</th><th>Status</th><th>Ends</th><th class="num">Days</th>
                </tr>
              </thead>
              <tbody>
                @for (row of board().upcomingRenewals; track row.id; let i = $index) {
                  <tr (click)="open(row.id)" tabindex="0" (keydown.enter)="open(row.id)">
                    <td>{{ i + 1 }}</td>
                    <td>{{ row.companyName }}</td>
                    <td class="mono">{{ row.companyCode }}</td>
                    <td><app-status-badge [value]="row.status" /></td>
                    <td>{{ row.endDate ? (row.endDate | date: 'mediumDate') : '—' }}</td>
                    <td class="num" [class.overdue]="row.daysRemaining < 0">
                      {{ row.daysRemaining < 0 ? (-row.daysRemaining) + ' overdue' : row.daysRemaining }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </app-card>

        <p class="note">
          <mat-icon>info</mat-icon>
          Shipment volume is not shown: the shipments module has not been built, and a
          figure of zero would be indistinguishable from a company that has booked nothing.
        </p>
      }
    </div>
  `,
  styles: [`
    .tiles { display:grid; gap:16px; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); margin-bottom:20px; }
    .renewals { width:100%; border-collapse:collapse; font:17px var(--font-sans); }
    .renewals th { text-align:left; padding:8px 12px; color:var(--text-muted); font-weight:600; }
    .renewals th.num, .renewals td.num { text-align:right; }
    .renewals td { padding:10px 12px; border-top:1px solid var(--surface-border); }
    .renewals tbody tr { cursor:pointer; }
    .renewals tbody tr:hover { background:var(--surface-muted); }
    .mono { font-family:var(--font-mono,monospace); }
    .overdue { color:var(--danger); font-weight:600; }
    .empty { color:var(--text-muted); margin:0; }
    .note { display:flex; align-items:center; gap:8px; margin-top:16px; color:var(--text-muted); font-size:16px; }
    .note mat-icon { font-size:18px; width:18px; height:18px; }
  `]
})
export class PlatformDashboardPage implements OnInit {
  private readonly service = inject(CompanyService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly board = signal<PlatformDashboard>(EMPTY_BOARD);

  ngOnInit(): void {
    this.breadcrumbs.set([{ label: 'Platform' }, { label: 'Dashboard' }]);
    this.service.platformDashboard().subscribe({
      next: (board) => { this.board.set(board); this.loading.set(false); },
      // Degrade to zeros rather than an error page: the rest of the console still works,
      // and an operator can navigate on to the company they came for.
      error: () => this.loading.set(false)
    });
  }

  byStatus(status: string): number {
    return this.board().companiesByStatus?.[status as keyof PlatformDashboard['companiesByStatus']] ?? 0;
  }

  open(id: string): void {
    this.router.navigate(['/companies', id]);
  }
}

const EMPTY_BOARD: PlatformDashboard = {
  companyCount: 0,
  companiesByStatus: { TRIAL: 0, ACTIVE: 0, INACTIVE: 0, SUSPENDED: 0, EXPIRED: 0 },
  expiredCount: 0,
  expiringSoonCount: 0,
  planCount: 0,
  activePlanCount: 0,
  upcomingRenewals: []
};
