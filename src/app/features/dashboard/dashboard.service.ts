import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiService } from '@core/services/api.service';
import { API } from '@core/config/api-endpoints';
import { Page } from '@core/models/page.model';
import { Branch } from '@core/models/branch.model';
import { DashboardProfile } from './dashboard.roles';
import {
  BranchSummaryRow, DashboardStatistics, DashboardSummary,
  emptyCharts, emptyStatistics
} from './models/dashboard.model';

/** What the backend summary endpoint is expected to return, all parts optional. */
type RawSummary = Partial<Omit<DashboardSummary, 'statistics' | 'charts'>> & {
  statistics?: Partial<DashboardStatistics>;
  charts?: Partial<DashboardSummary['charts']>;
};

/**
 * Dashboard data — API only, never mocked. The rich figures (shipments, revenue, charts,
 * activity) come from a single summary endpoint the operational modules will expose. Until
 * that endpoint lands it 404s and we degrade every one of those fields to zero / empty —
 * not to a fabricated number. Branch/hub/company counts and the summary lists are derived
 * from the real, already-shipped list endpoints so those tiles are live today.
 */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly api = inject(ApiService);

  /** {@code branchId}: a company admin viewing one branch's dashboard (13.4). */
  load(profile: DashboardProfile, branchId?: string): Observable<DashboardSummary> {
    const summary$ = this.api
      .get<RawSummary>(API.dashboard, branchId ? { branchId } : undefined)
      .pipe(catchError(() => of({} as RawSummary)));

    const branches$ = this.api
      .page<Branch>(API.branches, { page: 0, size: 6, sort: 'branchCode,asc' })
      .pipe(catchError(() => of(emptyPage<Branch>())));

    // separate, size:1 count-only calls — branches$ above is capped to 6 rows for the
    // summary list, too few to also double as an accurate active-branch total
    const activeBranches$ = this.api
      .page<Branch>(API.branches, { page: 0, size: 1, status: 'ACTIVE' })
      .pipe(map((p) => p.totalElements), catchError(() => of(0)));

    // hub module not built yet — /api/v1/hubs doesn't exist; hub tiles/section stay empty
    const companies$ =
      profile === 'PLATFORM'
        ? this.api.page<unknown>(API.companies, { page: 0, size: 1 })
            .pipe(map((p) => p.totalElements), catchError(() => of(0)))
        : of(0);

    return forkJoin({ summary: summary$, branches: branches$, activeBranches: activeBranches$, companies: companies$ }).pipe(
      map(({ summary, branches, activeBranches, companies }) =>
        this.assemble(summary, branches, activeBranches, companies))
    );
  }

  private assemble(
    raw: RawSummary,
    branches: Page<Branch>,
    activeBranchCount: number,
    companyCount: number
  ): DashboardSummary {
    const s = raw.statistics ?? {};

    const statistics: DashboardStatistics = {
      ...emptyStatistics(),
      ...s,
      // derive from live list endpoints when the summary endpoint omits the figure
      activeBranches: s.activeBranches ?? activeBranchCount,
      totalBranches: s.totalBranches ?? branches.totalElements,
      totalCompanies: s.totalCompanies ?? companyCount,
      activeCompanies: s.activeCompanies ?? companyCount,
      // walletBalance is the caller's own branch wallet (null for company/platform admins,
      // whose layout doesn't show the tile anyway) — stays null if the backend omits it,
      // never invented client-side
      walletBalance: s.walletBalance ?? null
    };

    return {
      statistics,
      charts: { ...emptyCharts(), ...(raw.charts ?? {}) },
      recentActivity: raw.recentActivity ?? [],
      recentShipments: raw.recentShipments ?? [],
      branchSummary: raw.branchSummary ?? branches.content.map(toBranchRow),
      hubSummary: raw.hubSummary ?? [], // hub module not built yet
      companyOverview: raw.companyOverview ?? null,
      branchOverview: raw.branchOverview ?? null
    };
  }
}

function toBranchRow(b: Branch): BranchSummaryRow {
  return {
    id: b.id, branchCode: b.branchCode, branchName: b.branchName,
    city: b.city ?? undefined, status: b.status
  };
}

const emptyPage = <T>(): Page<T> => ({
  content: [], page: 0, size: 0, totalElements: 0, totalPages: 0,
  first: true, last: true, hasNext: false
});
