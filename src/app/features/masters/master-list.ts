import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { MasterRecord } from '@core/models/master.model';
import { SortState } from '@shared/components/ui-table/ui-table';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiDrawer } from '@shared/components/ui-drawer/ui-drawer';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { downloadCsv } from '@shared/utils/csv-export.util';
import { MasterDataService } from './master-data.service';
import { MasterFilter } from './components/master-filter';
import { MasterAction, MasterPerms, MasterTable } from './components/master-table';
import {
  MASTER_PERMISSIONS, MASTER_WRITERS, MasterDefinition, writeAccessFor, readAccessFor, findMaster
} from './master.config';

/**
 * One list screen for all twelve masters, selected by the `:master` route parameter.
 *
 * Server pagination, sort, debounced search, an advanced-filter drawer, CSV export and
 * permission-gated row actions — the same contract every other list in the console
 * offers, so a user who has learned one has learned all twelve.
 *
 * The catalogue lists (vehicle, package, service, payment, weight) also offer a "Seed
 * standard set" action, which calls the idempotent bootstrap endpoint. It is deliberately
 * a button rather than something that happened silently at company creation: a company
 * that has curated its own catalogue should never find rows reappearing in it.
 */
@Component({
  selector: 'app-master-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButton, UiDrawer, UiPagination, UiSearch, MasterTable, MasterFilter],
  template: `
    @if (def(); as d) {
      <div class="page">
        <header class="page__head">
          <div>
            <h1 class="text-h1">{{ d.plural }}</h1>
            <p class="text-caption">{{ d.description }} — {{ page().totalElements }} in all.</p>
          </div>
          <div class="page__actions">
            <app-search placeholder="Search code, name, description…" (changed)="onSearch($event)" />
            <app-button variant="stroked" icon="filter_list" (pressed)="filterOpen.set(true)">
              Filters@if (activeFilters()) { <span class="fbadge">{{ activeFilters() }}</span> }
            </app-button>
            <app-button variant="stroked" icon="download" [loading]="exporting()" (pressed)="exportCsv()">
              Export
            </app-button>
            @if (d.seeded && can().create) {
              <app-button variant="stroked" icon="auto_awesome" [loading]="seeding()" (pressed)="seed()">
                Seed standard set
              </app-button>
            }
            @if (can().create) {
              <app-button icon="add" (pressed)="create()">New {{ d.singular.toLowerCase() }}</app-button>
            }
          </div>
        </header>

        <app-master-table [def]="d" [rows]="page().content" [loading]="loading()" [sort]="sort()"
          [startIndex]="page().page * page().size"
                          [perms]="tablePerms()" (sortChange)="onSort($event)" (action)="onAction($event)" />

        <app-pagination [page]="page()" (pageChange)="onPage($event)" />

        <app-drawer [open]="filterOpen()" title="Advanced filters"
                    [subtitle]="'Narrow the ' + d.plural.toLowerCase() + ' list.'"
                    (closed)="filterOpen.set(false)">
          @if (filterOpen()) { <app-master-filter [def]="d" (changed)="onFilter($event)" /> }
        </app-drawer>
      </div>
    }
  `,
  styles: [`
    .fbadge { display:inline-grid; place-items:center; min-width:18px; height:18px; padding:0 5px;
      margin-left:2px; background:var(--brand-600); color:#fff; border-radius:999px;
      font:700 14px var(--font-sans); }
  `]
})
export class MasterList {
  private readonly service = inject(MasterDataService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly confirm = inject(DialogService);

  /** Reacts to the route parameter, so navigating between masters reuses this component. */
  readonly def = toSignal(
    this.route.paramMap.pipe(map((params) => findMaster(params.get('master')))),
    { initialValue: null as MasterDefinition | null }
  );

  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly seeding = signal(false);
  readonly filterOpen = signal(false);
  readonly page = signal<Page<MasterRecord>>(emptyPage<MasterRecord>());
  readonly sort = signal<SortState | null>(null);

  private query: PageQuery = { page: 0, size: 20 };
  private readonly filters = signal<Record<string, string | boolean | undefined>>({});
  readonly activeFilters = computed(() => Object.keys(this.filters()).length);

  // Read from the definition rather than a constant: the shared geography is written by
  // a SUPER_ADMIN, a company's own catalogues by its COMPANY_ADMIN, and the same four
  // components serve both.
  readonly can = computed(() => {
    const def = this.def();
    const access = def ? writeAccessFor(def) : { roles: MASTER_WRITERS, permissions: MASTER_PERMISSIONS };
    return {
      create: this.perms.canAccess({ roles: access.roles, permissions: access.permissions.create }),
      update: this.perms.canAccess({ roles: access.roles, permissions: access.permissions.update }),
      delete: this.perms.canAccess({ roles: access.roles, permissions: access.permissions.delete })
    };
  });
  readonly tablePerms = computed<MasterPerms>(() => ({
    update: this.can().update, delete: this.can().delete
  }));

  constructor() {
    effect(() => {
      const def = this.def();
      if (!def) {
        this.router.navigate(['/masters/countries']);
        return;
      }
      // The route guard admits both tiers (geography + a company's own catalogues share
      // one route); this is the per-list narrowing writeAccessFor's buttons already rely on.
      const access = readAccessFor(def);
      if (!this.perms.canAccess({ roles: access.roles, permissions: access.permissions.view })) {
        this.router.navigate(['/unauthorized']);
        return;
      }
      this.breadcrumb.set([{ label: 'Masters' }, { label: def.group }, { label: def.plural }]);
      // untracked: load() reads the filters signal (via buildQuery), and without this the
      // effect would pick that up as a dependency too — so applying a filter (which writes
      // filters) would re-trigger this def-driven reset and silently clear what was just
      // applied. This effect exists to react to the route param alone.
      untracked(() => {
        // A different master means different filters and a different sort; start clean
        // rather than carrying a filter that does not exist on the new list.
        const initialSort = def.defaultSort
          ? { active: def.defaultSort.field, direction: def.defaultSort.direction }
          : null;
        this.query = {
          page: 0, size: 20,
          ...(def.defaultSort ? { sort: `${def.defaultSort.field},${def.defaultSort.direction}` } : {})
        };
        this.filters.set({});
        this.sort.set(initialSort);
        this.load();
      });
    });
  }

  private buildQuery(size?: number): PageQuery {
    return { ...this.query, ...this.filters(), ...(size ? { size, page: 0 } : {}) } as PageQuery;
  }

  private load(): void {
    const def = this.def();
    if (!def) return;

    this.loading.set(true);
    this.service.list(def, this.buildQuery()).subscribe({
      next: (p) => { this.page.set(p); this.loading.set(false); },
      error: () => { this.page.set(emptyPage<MasterRecord>()); this.loading.set(false); }
    });
  }

  onSearch(term: string): void {
    this.query = { ...this.query, search: term || undefined, page: 0 };
    this.load();
  }

  onPage(index: number): void {
    this.query = { ...this.query, page: index };
    this.load();
  }

  onSort(sort: SortState): void {
    this.sort.set(sort);
    this.query = { ...this.query, sort: `${sort.active},${sort.direction}`, page: 0 };
    this.load();
  }

  onFilter(filters: Record<string, string | boolean | undefined>): void {
    this.filters.set(filters);
    this.query = { ...this.query, page: 0 };
    this.filterOpen.set(false);
    this.load();
  }

  create(): void {
    this.router.navigate(['/masters', this.def()!.key, 'new']);
  }

  onAction({ type, row }: { type: MasterAction; row: MasterRecord }): void {
    const def = this.def()!;
    switch (type) {
      case 'view': return void this.router.navigate(['/masters', def.key, row.id]);
      case 'edit': return void this.router.navigate(['/masters', def.key, row.id, 'edit']);
      case 'activate': return this.lifecycle(row, 'activate');
      case 'deactivate': return this.confirmDeactivate(row);
      case 'delete': return this.confirmDelete(row);
    }
  }

  private lifecycle(row: MasterRecord, operation: 'activate' | 'deactivate'): void {
    const def = this.def()!;
    this.service[operation](def, row.id).subscribe({
      next: () => { this.notify.success(`${def.singular} ${operation}d.`); this.load(); },
      // The backend refuses activation under an inactive parent, and its message names the
      // parent — far more useful than anything invented here.
      error: (e) => this.notify.error(e?.error?.message ?? `Could not ${operation} the ${def.singular.toLowerCase()}.`)
    });
  }

  private confirmDeactivate(row: MasterRecord): void {
    const def = this.def()!;
    this.confirm.confirm({
      title: `Deactivate ${def.singular.toLowerCase()}`,
      message: `"${row.name}" will stop appearing in pickers. Records that already reference it are unaffected.`,
      confirmLabel: 'Deactivate', danger: true
    }).subscribe((ok) => { if (ok) this.lifecycle(row, 'deactivate'); });
  }

  private confirmDelete(row: MasterRecord): void {
    const def = this.def()!;
    this.confirm.confirm({
      title: `Delete ${def.singular.toLowerCase()}`,
      message: `"${row.name}" will be removed. Its code stays reserved and cannot be reused.`,
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.remove(def, row.id).subscribe({
        next: () => { this.notify.success(`${def.singular} deleted.`); this.load(); },
        // A parent with children comes back 422 naming the count; show it verbatim.
        error: (e) => this.notify.error(e?.error?.message ?? `Could not delete the ${def.singular.toLowerCase()}.`)
      });
    });
  }

  seed(): void {
    this.seeding.set(true);
    this.service.bootstrap().subscribe({
      next: (result) => {
        this.seeding.set(false);
        const created = Object.values(result.created).reduce((a, b) => a + b, 0);
        if (created > 0) this.notify.success(`Seeded ${created} row(s) across the standard catalogues.`);
        else this.notify.info('Every standard row already exists — nothing was changed.');
        this.load();
      },
      error: (e) => {
        this.seeding.set(false);
        this.notify.error(e?.error?.message ?? 'Could not seed the standard catalogues.');
      }
    });
  }

  exportCsv(): void {
    const def = this.def()!;
    this.exporting.set(true);
    this.service.list(def, this.buildQuery(100)).subscribe({
      next: (p) => { this.download(def, p.content); this.exporting.set(false); },
      error: () => { this.exporting.set(false); this.notify.error('Export failed.'); }
    });
  }

  private download(def: MasterDefinition, rows: MasterRecord[]): void {
    const lines = rows.map((row) => def.exportColumns.map((key) => row[key] as string | number | boolean));
    // Master field types vary per definition (country/state/city/vehicle-type/...), so numeric
    // columns are detected from the actual data rather than a hardcoded index list.
    const numericCols = def.exportColumns
      .map((key, i) => (rows.some((row) => typeof row[key] === 'number') ? i : -1))
      .filter((i) => i >= 0);
    downloadCsv(`${def.key}-${new Date().toISOString().slice(0, 10)}.csv`, def.exportColumns, lines, numericCols);
    this.notify.info(`Exported ${rows.length} row(s).`);
  }
}
