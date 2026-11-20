import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { Branch } from '@core/models/branch.model';
import { Page, PageQuery, emptyPage } from '@core/models/page.model';
import { UiTable, TableColumn, SortState } from '@shared/components/ui-table/ui-table';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { HubService } from './hub.service';

/** Hubs — a filtered Branch list (`branchType: 'HUB'`, see `HubService`). Create/edit
 *  reuse the Branch screens directly (a hub is created exactly like a branch, just with
 *  Hub picked as its type). */
@Component({
  selector: 'app-hub-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiTable, UiPagination, UiSearch, UiButton, StatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Hubs</h1><p class="text-caption">Sorting hubs in your network.</p></div>
        <div class="page__actions">
          <app-search placeholder="Search hubs…" (changed)="onSearch($event)" />
          <app-button icon="add" (pressed)="newHub()">New Hub</app-button>
        </div>
      </header>
      <app-table [columns]="columns" [rows]="page().content" [loading]="loading()" [sort]="sort()"
                 [startIndex]="page().page * page().size"
                 emptyTitle="No hubs yet" emptyHint="Create a branch with type Hub to get started."
                 (sortChange)="onSort($event)" (rowClick)="openHub($event)" idKey="id">
        <ng-template #row let-h>
          <td><div class="cs">{{ h.branchName }}</div><div class="text-caption">{{ h.branchCode }}</div></td>
          <td>{{ h.city || '—' }}</td>
          <td><app-status-badge [value]="h.status" /></td>
        </ng-template>
      </app-table>
      <app-pagination [page]="page()" (pageChange)="onPage($event)" />
    </div>
  `,
  styles: [`.cs{font:600 17px var(--font-sans)}`]
})
export class HubList implements OnInit {
  private readonly service = inject(HubService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly page = signal<Page<Branch>>(emptyPage());
  readonly sort = signal<SortState | null>(null);
  private query: PageQuery = { page: 0, size: 20 };

  readonly columns: TableColumn<Branch>[] = [
    { key: 'branchName', header: 'Hub' },
    { key: 'city', header: 'Location' },
    { key: 'status', header: 'Status', width: '120px' }
  ];

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Hub Operations' }, { label: 'Hubs' }]);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.list(this.query).subscribe({
      next: (p) => { this.page.set(p); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  onSearch(t: string): void { this.query = { ...this.query, search: t || undefined, page: 0 }; this.load(); }
  onPage(i: number): void { this.query = { ...this.query, page: i }; this.load(); }
  onSort(s: SortState): void { this.sort.set(s); this.load(); }
  newHub(): void { this.router.navigateByUrl('/branches/new'); }
  openHub(h: Branch): void { this.router.navigateByUrl(`/branches/${h.id}`); }
}
