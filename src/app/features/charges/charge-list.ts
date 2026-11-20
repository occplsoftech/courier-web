import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { Charge, ChargeSearchRequest } from '@core/models/charge.model';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { SortState } from '@shared/components/ui-table/ui-table';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiDrawer } from '@shared/components/ui-drawer/ui-drawer';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { ChargeTable, ChargePerms, ChargeAction } from './components/charge-table';
import { ChargeFilter } from './components/charge-filter';
import { ChargeService } from './charge.service';

const WRITERS = [AppRole.COMPANY_ADMIN];

/** Charge directory — server pagination, sort, debounced search and an advanced filter
 *  drawer. Service Type id is resolved to a name once, from the same master picker the
 *  form uses, and handed to the table as a lookup map. COMPANY_ADMIN-only, both reads
 *  and writes — this is a company's own pricing configuration. */
@Component({
  selector: 'app-charge-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiPagination, UiSearch, UiButton, UiDrawer, ChargeTable, ChargeFilter],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Charges</h1><p class="text-caption">Charge & Charge Settings configuration — {{ page().totalElements }} in all.</p></div>
        <div class="page__actions">
          <app-search placeholder="Search charge name…" (changed)="onSearch($event)" />
          <app-button variant="stroked" icon="filter_list" (pressed)="filterOpen.set(true)">
            Filters@if (activeFilters()) { <span class="fbadge">{{ activeFilters() }}</span> }
          </app-button>
          @if (can().create) { <app-button icon="add" (pressed)="create()">New Charge</app-button> }
        </div>
      </header>

      <app-charge-table [rows]="page().content" [loading]="loading()" [sort]="sort()" [perms]="tablePerms()"
        [startIndex]="page().page * page().size" [serviceTypeNames]="serviceTypeNames()"
        (sortChange)="onSort($event)" (action)="onAction($event)" />

      <app-pagination [page]="page()" (pageChange)="onPage($event)" />

      <app-drawer [open]="filterOpen()" title="Advanced filters" subtitle="Narrow the charge list." (closed)="filterOpen.set(false)">
        <app-charge-filter [serviceTypeOptions]="serviceTypeOptions()" (changed)="onFilter($event)" />
      </app-drawer>
    </div>
  `,
  styles: [`
    .fbadge { display:inline-grid; place-items:center; min-width:18px; height:18px; padding:0 5px; margin-left:2px;
      background:var(--brand-600); color:#fff; border-radius:999px; font:700 14px var(--font-sans); }
  `]
})
export class ChargeList implements OnInit {
  private readonly service = inject(ChargeService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly confirm = inject(DialogService);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly filterOpen = signal(false);
  readonly page = signal<Page<Charge>>(emptyPage<Charge>());
  readonly sort = signal<SortState | null>({ active: 'chargeName', direction: 'asc' });

  readonly serviceTypeOptions = signal<SelectOption[]>([]);
  readonly serviceTypeNames = computed(() => new Map(this.serviceTypeOptions().map((o) => [o.value, o.label])));

  private query: PageQuery = { page: 0, size: 20, sort: 'chargeName,asc' };
  private readonly filters = signal<ChargeSearchRequest>({});
  readonly activeFilters = computed(() =>
    Object.values(this.filters()).filter((v) => v != null && (!Array.isArray(v) || v.length)).length);

  readonly can = computed(() => ({
    create: this.perms.canAccess({ roles: WRITERS, permissions: ['CHARGE_CREATE'] }),
    update: this.perms.canAccess({ roles: WRITERS, permissions: ['CHARGE_UPDATE'] }),
    delete: this.perms.canAccess({ roles: WRITERS, permissions: ['CHARGE_DELETE'] }),
    lifecycle: this.perms.canAccess({ roles: WRITERS, permissions: ['CHARGE_ACTIVATE', 'CHARGE_DEACTIVATE'] })
  }));
  readonly tablePerms = computed<ChargePerms>(() => ({
    update: this.can().update, lifecycle: this.can().lifecycle, delete: this.can().delete
  }));

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Charges' }]);
    this.masters.options('service-types').subscribe((o) => this.serviceTypeOptions.set(o));
    this.load();
  }

  private buildQuery(): PageQuery {
    const f = this.filters();
    return {
      ...this.query,
      serviceTypeId: f.serviceTypeId as unknown as string | undefined,
      status: f.status as unknown as string | undefined
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
  onFilter(f: ChargeSearchRequest) { this.filters.set(f); this.query = { ...this.query, page: 0 }; this.filterOpen.set(false); this.load(); }

  create() { this.router.navigate(['/charges/new']); }

  onAction({ type, charge }: { type: ChargeAction; charge: Charge }): void {
    switch (type) {
      case 'view': return void this.router.navigate(['/charges', charge.id]);
      case 'edit': return void this.router.navigate(['/charges', charge.id, 'edit']);
      case 'activate': return this.lifecycle(charge, 'activate');
      case 'deactivate': return this.lifecycle(charge, 'deactivate');
      case 'delete': return this.remove(charge);
    }
  }

  private lifecycle(charge: Charge, op: 'activate' | 'deactivate'): void {
    this.service[op](charge.id).subscribe({
      next: () => { this.notify.success(`Charge ${op}d.`); this.load(); },
      error: (e) => this.notify.error(e?.error?.message ?? `Could not ${op} the charge.`)
    });
  }

  private remove(charge: Charge): void {
    this.confirm.confirm({
      title: 'Delete charge',
      message: `"${charge.chargeName}" will be removed. This is refused if it still has any charge setting — remove those first.`,
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.delete(charge.id).subscribe({
        next: () => { this.notify.success('Charge deleted.'); this.load(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not delete the charge.')
      });
    });
  }
}
