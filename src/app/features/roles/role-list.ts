import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole, CompanyRole, RoleSearchRequest } from '@core/models/role.model';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { SortState } from '@shared/components/ui-table/ui-table';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { downloadCsv } from '@shared/utils/csv-export.util';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiDrawer } from '@shared/components/ui-drawer/ui-drawer';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { RoleTable, RolePerms, RoleAction } from './components/role-table';
import { RoleFilter } from './components/role-filter';
import { RoleService } from './role.service';

const WRITERS = [AppRole.COMPANY_ADMIN];

/**
 * Role directory — server pagination, sort, debounced search, advanced filter drawer and
 * CSV export. Row actions (lifecycle, clone, delete) route through confirms, each gated by
 * permission. No mock data; every read/write hits the API.
 */
@Component({
  selector: 'app-role-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiPagination, UiSearch, UiButton, UiDrawer, RoleTable, RoleFilter],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Roles</h1><p class="text-caption">What your staff are allowed to do.</p></div>
        <div class="page__actions">
          <app-search placeholder="Search code, name, description…" (changed)="onSearch($event)" />
          <app-button variant="stroked" icon="filter_list" (pressed)="filterOpen.set(true)">
            Filters@if (activeFilters()) { <span class="fbadge">{{ activeFilters() }}</span> }
          </app-button>
          <app-button variant="stroked" icon="download" [loading]="exporting()" (pressed)="exportCsv()">Export</app-button>
          @if (can().create) { <app-button icon="add" (pressed)="create()">New Role</app-button> }
        </div>
      </header>

      <app-role-table [rows]="page().content" [loading]="loading()" [sort]="sort()" [perms]="tablePerms()"
        [startIndex]="page().page * page().size"
                      (sortChange)="onSort($event)" (action)="onAction($event)" />

      <app-pagination [page]="page()" (pageChange)="onPage($event)" />

      <app-drawer [open]="filterOpen()" title="Advanced filters" subtitle="Narrow the catalogue." (closed)="filterOpen.set(false)">
        <app-role-filter (changed)="onFilter($event)" />
      </app-drawer>
    </div>
  `,
  styles: [`
    .fbadge { display:inline-grid; place-items:center; min-width:18px; height:18px; padding:0 5px; margin-left:2px;
      background:var(--brand-600); color:#fff; border-radius:999px; font:700 14px var(--font-sans); }
  `]
})
export class RoleList implements OnInit {
  private readonly service = inject(RoleService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly router = inject(Router);
  private readonly confirm = inject(DialogService);

  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly filterOpen = signal(false);
  readonly page = signal<Page<CompanyRole>>(emptyPage<CompanyRole>());
  readonly sort = signal<SortState | null>({ active: 'roleCode', direction: 'asc' });

  private query: PageQuery = { page: 0, size: 20, sort: 'roleCode,asc' };
  private filters = signal<RoleSearchRequest>({});
  readonly activeFilters = computed(() =>
    Object.values(this.filters()).filter((v) => v != null && (!Array.isArray(v) || v.length)).length);

  readonly can = computed(() => ({
    create: this.perms.canAccess({ roles: WRITERS, permissions: ['ROLE_CREATE'] }),
    update: this.perms.canAccess({ roles: WRITERS, permissions: ['ROLE_UPDATE'] }),
    delete: this.perms.canAccess({ roles: WRITERS, permissions: ['ROLE_DELETE'] })
  }));
  readonly tablePerms = computed<RolePerms>(() => this.can());

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Management' }, { label: 'Roles' }]);
    this.load();
  }

  private buildQuery(size?: number): PageQuery {
    const f = this.filters();
    return {
      ...this.query, ...(size ? { size, page: 0 } : {}),
      status: f.status, roleType: f.roleType as unknown as string | undefined,
      isSystemRole: f.isSystemRole, isDefault: f.isDefault, permissionCode: f.permissionCode
    };
  }

  private load(): void {
    this.loading.set(true);
    this.service.list(this.buildQuery()).subscribe({
      next: (p) => { this.page.set(p); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  onSearch(t: string) { this.query = { ...this.query, search: t || undefined, page: 0 }; this.load(); }
  onPage(i: number) { this.query = { ...this.query, page: i }; this.load(); }
  onSort(s: SortState) { this.sort.set(s); this.query = { ...this.query, sort: `${s.active},${s.direction}`, page: 0 }; this.load(); }
  onFilter(f: RoleSearchRequest) { this.filters.set(f); this.query = { ...this.query, page: 0 }; this.filterOpen.set(false); this.load(); }

  create() { this.router.navigate(['/roles/new']); }

  onAction({ type, role }: { type: RoleAction; role: CompanyRole }): void {
    switch (type) {
      case 'view': return void this.router.navigate(['/roles', role.id]);
      case 'edit': return void this.router.navigate(['/roles', role.id, 'edit']);
      case 'clone': return void this.router.navigate(['/roles/new'], { queryParams: { cloneFrom: role.id } });
      case 'activate': return this.lifecycle(role, 'activate');
      case 'deactivate': return this.confirmDeactivate(role);
      case 'delete': return this.deleteRole(role);
    }
  }

  private lifecycle(role: CompanyRole, op: 'activate' | 'deactivate'): void {
    this.service[op](role.id).subscribe({
      next: () => { this.notify.success(`Role ${op}d.`); this.load(); },
      error: (e) => this.notify.error(e?.error?.message ?? `Could not ${op} the role.`)
    });
  }

  private confirmDeactivate(role: CompanyRole): void {
    this.confirm.confirm({
      title: 'Deactivate role',
      message: `"${role.roleName}" will be withdrawn from the assignment list. Users who already hold it keep it.`,
      confirmLabel: 'Deactivate', danger: true
    }).subscribe((ok) => { if (ok) this.lifecycle(role, 'deactivate'); });
  }

  private deleteRole(role: CompanyRole): void {
    this.confirm.confirm({
      title: 'Delete role',
      message: `"${role.roleName}" will be removed. Its code stays reserved and holders are not reassigned.`,
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.remove(role.id).subscribe({
        next: () => { this.notify.success('Role deleted.'); this.load(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not delete the role.')
      });
    });
  }

  exportCsv(): void {
    this.exporting.set(true);
    this.service.list(this.buildQuery(100)).subscribe({
      next: (p) => { this.download(p.content); this.exporting.set(false); },
      error: () => { this.exporting.set(false); this.notify.error('Export failed.'); }
    });
  }

  private download(rows: CompanyRole[]): void {
    const cols: (keyof CompanyRole)[] = ['roleCode', 'roleName', 'roleType', 'status', 'isSystemRole', 'isDefault', 'permissionCount'];
    const lines = rows.map((r) => cols.map((c) => r[c] as string | number | boolean));
    downloadCsv(`roles-${new Date().toISOString().slice(0, 10)}.csv`, cols, lines, [6]);
    this.notify.info(`Exported ${rows.length} role(s).`);
  }
}
