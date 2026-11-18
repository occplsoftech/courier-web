import { ChangeDetectionStrategy, Component, Injectable, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { Page } from '@core/models/page.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { MasterDataService } from '@features/masters/master-data.service';

export interface UnserviceableRow {
  id: string; pincode: string; areaId: string | null; areaName: string | null; cityName: string | null;
  reason: 'PINCODE_OFF' | 'AREA_OFF' | 'NOT_ON_FILE'; staffCount: number; portalCount: number; total: number;
  firstRequestedAt: string; lastRequestedAt: string; lastBranchId: string | null; turnedOnAt: string | null;
  serviceableNow: boolean; canTurnOn: boolean;
}
export interface UnserviceableQuery { open?: boolean; search?: string; since?: string; page?: number; size?: number; }

@Injectable({ providedIn: 'root' })
export class UnserviceableService {
  private readonly api = inject(ApiService);
  list(q: UnserviceableQuery): Observable<Page<UnserviceableRow>> {
    return this.api.get<Page<UnserviceableRow>>('/serviceability/unserviceable', q as Record<string, unknown>);
  }
  export(q: UnserviceableQuery): Observable<Blob> { return this.api.getBlob('/serviceability/unserviceable/export', q as Record<string, unknown>); }
  turnOn(id: string): Observable<UnserviceableRow> { return this.api.post<UnserviceableRow>(`/serviceability/unserviceable/${id}/turn-on`, {}); }
}

const REASON: Record<UnserviceableRow['reason'], string> = {
  PINCODE_OFF: 'Pincode switched off', AREA_OFF: 'Area switched off', NOT_ON_FILE: 'Not in Masters'
};

/**
 * Reports → Unserviceable Requests: every destination pincode and area a booking asked for that OCCPL does not serve, most asked
 * first, counted from staff booking and from the customer portal. A company admin switches an area (and its pincode) on from here.
 */
@Component({
  selector: 'app-unserviceable-report',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButton, UiSearch, DatePipe],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Unserviceable Requests</h1>
          <p class="text-caption">Destinations a booking asked for that OCCPL does not serve yet, most asked first. Switch an area on when you start serving it.</p></div>
        <app-button variant="stroked" icon="download" [disabled]="exporting()" (pressed)="download()">{{ exporting() ? 'Preparing…' : 'Download Excel' }}</app-button>
      </header>

      <div class="filters">
        <div class="seg" role="tablist" aria-label="Status">
          <button type="button" role="tab" [class.on]="q().open === true" (click)="set({ open: true })">Still unavailable</button>
          <button type="button" role="tab" [class.on]="q().open === false" (click)="set({ open: false })">Switched on</button>
          <button type="button" role="tab" [class.on]="q().open === undefined" (click)="set({ open: undefined })">All</button>
        </div>
        <label>Asked since <input type="date" [value]="q().since ?? ''" (change)="set({ since: $any($event.target).value || undefined })" /></label>
        <app-search placeholder="Pincode, area or city…" (changed)="set({ search: $event || undefined })" />
      </div>

      <div class="wrap">
        <table class="tbl">
          <thead><tr><th>Pincode</th><th>Area</th><th class="num">Times asked</th><th>First / last asked</th><th>Last branch</th><th>Why</th><th>Status</th><th></th></tr></thead>
          <tbody>
            @if (loading()) { <tr><td colspan="8" class="muted">Loading…</td></tr> }
            @else if (!page().content.length) { <tr><td colspan="8" class="muted">No unserviceable requests here.</td></tr> }
            @for (r of page().content; track r.id) {
              <tr>
                <td class="cs">{{ r.pincode }}</td>
                <td>{{ r.areaName || 'Whole pincode' }}@if (r.cityName) { <div class="text-caption">{{ r.cityName }}</div> }</td>
                <td class="num"><b>{{ r.total }}</b>
                  <div class="text-caption">@if (r.staffCount) { {{ r.staffCount }} staff }@if (r.staffCount && r.portalCount) { · }@if (r.portalCount) { {{ r.portalCount }} portal }</div></td>
                <td>{{ r.firstRequestedAt | date: 'd MMM y' }}<div class="text-caption">last {{ r.lastRequestedAt | date: 'd MMM, h:mm a' }}</div></td>
                <td>{{ branch(r.lastBranchId) }}</td>
                <td>{{ reason(r.reason) }}</td>
                <td>@if (r.serviceableNow) { <span class="pill ok">Serviceable now</span> } @else { <span class="pill off">Still unavailable</span> }
                  @if (r.turnedOnAt) { <div class="text-caption">switched on {{ r.turnedOnAt | date: 'd MMM' }}</div> }</td>
                <td class="act">
                  @if (r.canTurnOn) {
                    <app-button variant="stroked" icon="toggle_on" [disabled]="busy() === r.id" (pressed)="turnOn(r)">{{ busy() === r.id ? 'Switching on…' : 'Turn on' }}</app-button>
                  } @else if (!r.serviceableNow && r.reason === 'NOT_ON_FILE' && isAdmin()) {
                    <span class="text-caption">Add it in Masters → Pincode</span>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <footer class="pager">
        <span class="text-caption">{{ page().totalElements }} pincode / area(s) · {{ totalAsked() }} request(s) on this page</span>
        <div>
          <app-button variant="stroked" [disabled]="page().page === 0 || loading()" (pressed)="go(page().page - 1)">Previous</app-button>
          <span class="text-caption">Page {{ page().page + 1 }} of {{ page().totalPages || 1 }}</span>
          <app-button variant="stroked" [disabled]="!page().hasNext || loading()" (pressed)="go(page().page + 1)">Next</app-button>
        </div>
      </footer>
    </div>
  `,
  styles: [`
    .page__head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; }
    .filters { display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap; margin:6px 0 12px; }
    .filters label { display:flex; flex-direction:column; gap:4px; font:600 13px var(--font-sans); }
    .filters input[type=date] { height:38px; border:1px solid var(--surface-border); border-radius:8px; padding:0 10px;
      background:var(--surface-card, #fff); color:var(--content-fg); font:400 14px var(--font-sans); }
    .seg { display:inline-flex; border:1px solid var(--surface-border); border-radius:999px; overflow:hidden; }
    .seg button { border:0; background:transparent; padding:8px 14px; font:500 13px var(--font-sans); color:var(--content-fg); cursor:pointer; }
    .seg button.on { background:var(--primary, #1a56db); color:#fff; }
    .wrap { overflow-x:auto; border-radius:12px; }
    .tbl { width:100%; border-collapse:collapse; font:400 14px var(--font-sans); background:var(--surface-card, #fff); min-width:900px; }
    .tbl th { text-align:left; font:600 12px var(--font-sans); text-transform:uppercase; letter-spacing:.04em; color:var(--content-muted); padding:10px 12px; }
    .tbl td { padding:10px 12px; border-top:1px solid var(--surface-border); vertical-align:top; }
    .num { text-align:right; white-space:nowrap; }
    .muted { color:var(--content-muted); text-align:center; padding:24px; }
    .cs { font:600 14px var(--font-sans); font-variant-numeric:tabular-nums; }
    .pill { display:inline-block; padding:2px 8px; border-radius:999px; font:600 12px var(--font-sans); }
    .pill.ok { background:var(--success-bg, #dcfce7); color:var(--success, #15803d); }
    .pill.off { background:var(--danger-bg, #fee2e2); color:var(--danger, #b91c1c); }
    .act { text-align:right; white-space:nowrap; }
    .pager { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-top:12px; flex-wrap:wrap; }
    .pager div { display:flex; gap:10px; align-items:center; }
  `]
})
export class UnserviceableReportPage implements OnInit {
  private readonly svc = inject(UnserviceableService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly masters = inject(MasterDataService);

  readonly q = signal<UnserviceableQuery>({ open: true, page: 0, size: 25 });
  readonly page = signal<Page<UnserviceableRow>>({ content: [], page: 0, size: 25, totalElements: 0, totalPages: 0 } as unknown as Page<UnserviceableRow>);
  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly busy = signal<string | null>(null);
  readonly branches = signal<Map<string, string>>(new Map());
  readonly isAdmin = computed(() => this.perms.hasRole(AppRole.COMPANY_ADMIN) || this.perms.hasRole(AppRole.SUPER_ADMIN));
  readonly totalAsked = computed(() => this.page().content.reduce((s, r) => s + r.total, 0));

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Reports' }, { label: 'Unserviceable Requests' }]);
    this.masters.branchDirectory().subscribe({
      next: (list) => this.branches.set(new Map((list ?? []).map((b) => [b.id, `${b.branchName} (${b.branchCode})`]))),
      error: () => undefined
    });
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.svc.list(this.q()).subscribe({
      next: (p) => { this.page.set(p); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  set(change: Partial<UnserviceableQuery>): void { this.q.update((q) => ({ ...q, ...change, page: 0 })); this.load(); }
  go(page: number): void { this.q.update((q) => ({ ...q, page })); this.load(); }

  turnOn(r: UnserviceableRow): void {
    this.busy.set(r.id);
    this.svc.turnOn(r.id).subscribe({
      next: (u) => {
        this.busy.set(null);
        this.page.update((p) => ({ ...p, content: p.content.map((x) => (x.id === u.id ? u : x)) }));
        this.notify.success(`${u.areaName ? u.areaName + ', ' : ''}${u.pincode} is serviceable now.`);
      },
      error: (e: HttpErrorResponse) => { this.busy.set(null); this.notify.error(e.error?.message ?? 'Could not switch it on.'); }
    });
  }

  download(): void {
    this.exporting.set(true);
    const { page: _p, size: _s, ...filter } = this.q();
    this.svc.export(filter).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `unserviceable-requests-${new Date().toISOString().slice(0, 10)}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.exporting.set(false);
      },
      error: () => this.exporting.set(false)
    });
  }

  reason(r: UnserviceableRow['reason']): string { return REASON[r]; }
  branch(id: string | null): string { return id ? (this.branches().get(id) ?? '—') : '—'; }
}
