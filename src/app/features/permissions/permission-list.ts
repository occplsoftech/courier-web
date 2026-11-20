import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService as AccessService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { Permission, PermissionSearchRequest, prettyToken } from '@core/models/permission.model';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { UiTable, TableColumn, SortState } from '@shared/components/ui-table/ui-table';
import { downloadCsv } from '@shared/utils/csv-export.util';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiDrawer } from '@shared/components/ui-drawer/ui-drawer';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { PermissionFilter } from './components/permission-filter';
import { PermissionService } from './permission.service';

const ADMINS = [AppRole.SUPER_ADMIN, AppRole.PLATFORM_ADMIN, AppRole.COMPANY_ADMIN];
const ASSIGNERS = [AppRole.COMPANY_ADMIN];

/**
 * Permission catalogue — the platform's authorisation vocabulary. Server pagination,
 * sort, debounced search and an advanced filter drawer (module/action/status/kind/plan
 * gating/resource). Read-only to a company; a `COMPANY_ADMIN` jumps to the assignment
 * screen from here. No mock data.
 */
@Component({
  selector: 'app-permission-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiTable, UiPagination, UiSearch, UiButton, UiDrawer, StatusBadge, PermissionFilter],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Permissions</h1><p class="text-caption">The platform's authorization vocabulary — {{ page().totalElements }} rights across every module.</p></div>
        <div class="page__actions">
          <app-search placeholder="Search code, name, description…" (changed)="onSearch($event)" />
          <app-button variant="stroked" icon="filter_list" (pressed)="filterOpen.set(true)">
            Filters@if (activeFilters()) { <span class="fbadge">{{ activeFilters() }}</span> }
          </app-button>
          <app-button variant="stroked" icon="download" [loading]="exporting()" (pressed)="exportCsv()">Export</app-button>
          @if (canAssign()) { <app-button icon="rule" (pressed)="assign()">Assign to Role</app-button> }
        </div>
      </header>

      <app-table [columns]="columns" [rows]="page().content" [loading]="loading()" [sort]="sort()"
                 [startIndex]="page().page * page().size"
                 emptyTitle="No permissions" emptyHint="Adjust your filters or search."
                 (sortChange)="onSort($event)" (rowClick)="view($event)" idKey="id">
        <ng-template #row let-p>
          <td>{{ pretty(p.module) }}</td>
          <td><code class="code">{{ p.permissionCode }}</code></td>
          <td>{{ p.permissionName }}</td>
          <td class="desc">{{ p.description || '—' }}</td>
          <td>
            @if (p.isSystemPermission) { <span class="tag">System</span> }
            @if (p.requiredFeatureFlag) { <span class="tag tag--gate">Plan</span> }
            <app-status-badge [value]="p.status" />
          </td>
        </ng-template>
      </app-table>

      <app-pagination [page]="page()" (pageChange)="onPage($event)" />

      <app-drawer [open]="filterOpen()" title="Advanced filters" subtitle="Narrow the catalogue." (closed)="filterOpen.set(false)">
        <app-permission-filter (changed)="onFilter($event)" />
      </app-drawer>
    </div>
  `,
  styles: [`
    .code { font:600 15px var(--font-mono, ui-monospace); background:var(--surface-muted); border:1px solid var(--surface-border);
      padding:2px 8px; border-radius:6px; }
    .desc { color:var(--content-muted); max-width:340px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tag { display:inline-block; background:var(--surface-muted); border:1px solid var(--surface-border); color:var(--content-muted);
      font:600 13px var(--font-sans); padding:2px 7px; border-radius:6px; margin-right:6px; }
    .tag--gate { background:var(--warning-bg); color:var(--warning); border-color:transparent; }
    .fbadge { display:inline-grid; place-items:center; min-width:18px; height:18px; padding:0 5px; margin-left:2px;
      background:var(--brand-600); color:#fff; border-radius:999px; font:700 14px var(--font-sans); }
  `]
})
export class PermissionList implements OnInit {
  private readonly service = inject(PermissionService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly access = inject(AccessService);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly filterOpen = signal(false);
  readonly page = signal<Page<Permission>>(emptyPage<Permission>());
  readonly sort = signal<SortState | null>({ active: 'displayOrder', direction: 'asc' });

  private query: PageQuery = { page: 0, size: 50, sort: 'displayOrder,asc' };
  private readonly filters = signal<PermissionSearchRequest>({});
  readonly activeFilters = computed(() =>
    Object.values(this.filters()).filter((v) => v != null && (!Array.isArray(v) || v.length)).length);

  readonly canAssign = computed(() => this.access.canAccess({ roles: ASSIGNERS, permissions: ['PERMISSION_ASSIGN'] }));

  readonly columns: TableColumn<Permission>[] = [
    { key: 'module', header: 'Module', sortable: true },
    { key: 'permissionCode', header: 'Permission Code', sortable: true },
    { key: 'permissionName', header: 'Permission Name', sortable: true },
    { key: 'description', header: 'Description' },
    { key: 'status', header: 'Status', sortable: true, width: '150px' }
  ];

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Access Control' }, { label: 'Permissions' }]);
    this.load();
  }

  private buildQuery(size?: number): PageQuery {
    const f = this.filters();
    return {
      ...this.query, ...(size ? { size, page: 0 } : {}),
      module: f.module as unknown as string | undefined,
      action: f.action as unknown as string | undefined,
      status: f.status, isSystemPermission: f.isSystemPermission,
      resource: f.resource, planGatedOnly: f.planGatedOnly
    };
  }

  private load(): void {
    this.loading.set(true);
    this.service.list(this.buildQuery()).subscribe({
      next: (p) => { this.page.set(p); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  pretty = prettyToken;

  onSearch(t: string) { this.query = { ...this.query, search: t || undefined, page: 0 }; this.load(); }
  onPage(i: number) { this.query = { ...this.query, page: i }; this.load(); }
  onSort(s: SortState) { this.sort.set(s); this.query = { ...this.query, sort: `${s.active},${s.direction}`, page: 0 }; this.load(); }
  onFilter(f: PermissionSearchRequest) { this.filters.set(f); this.query = { ...this.query, page: 0 }; this.filterOpen.set(false); this.load(); }

  view(p: Permission) { this.router.navigate(['/permissions', p.id]); }
  assign() { this.router.navigate(['/permissions/assign']); }

  exportCsv(): void {
    this.exporting.set(true);
    this.service.list(this.buildQuery(200)).subscribe({
      next: (p) => { this.download(p.content); this.exporting.set(false); },
      error: () => { this.exporting.set(false); this.notify.error('Export failed.'); }
    });
  }

  private download(rows: Permission[]): void {
    const cols: (keyof Permission)[] = ['module', 'permissionCode', 'permissionName', 'action', 'resource', 'status', 'isSystemPermission', 'requiredFeatureFlag'];
    const lines = rows.map((r) => cols.map((c) => r[c] as string | number | boolean));
    downloadCsv(`permissions-${new Date().toISOString().slice(0, 10)}.csv`, cols, lines);
    this.notify.info(`Exported ${rows.length} permission(s).`);
  }
}
