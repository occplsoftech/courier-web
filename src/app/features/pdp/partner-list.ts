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
import { PdpService } from './pdp.service';

/** Pickup-Delivery Partners — a filtered Branch list (see `PdpService`). New / edit reuse the
 *  Branch screens: a partner is created exactly like a branch with the PDP type preselected. */
@Component({
  selector: 'app-partner-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiTable, UiPagination, UiSearch, UiButton, StatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Pickup Delivery Partners</h1>
          <p class="text-caption">Partners who collect (pickup) and deliver shipments for your company.</p></div>
        <div class="page__actions">
          <app-search placeholder="Search partners…" (changed)="onSearch($event)" />
          <app-button icon="add" (pressed)="newPartner()">New Partner</app-button>
        </div>
      </header>
      <app-table [columns]="columns" [rows]="page().content" [loading]="loading()" [sort]="sort()"
                 [startIndex]="page().page * page().size"
                 emptyTitle="No partners yet" emptyHint="Create a Pickup-Delivery Partner to get started."
                 (sortChange)="onSort($event)" (rowClick)="open($event)" idKey="id">
        <ng-template #row let-p>
          <td><div class="cs">{{ p.branchName }}</div><div class="text-caption">{{ p.branchCode }}</div></td>
          <td>{{ p.city || '—' }}</td>
          <td>{{ p.state || '—' }}</td>
          <td><app-status-badge [value]="p.status" /></td>
          <td class="col-actions" (click)="$event.stopPropagation()">
            <app-button variant="stroked" icon="request_quote" (pressed)="rates(p)">Rates</app-button>
          </td>
        </ng-template>
      </app-table>
      <app-pagination [page]="page()" (pageChange)="onPage($event)" />
    </div>
  `,
  styles: [`.cs{font:600 17px var(--font-sans)} .col-actions{text-align:right;width:130px}`]
})
export class PartnerList implements OnInit {
  private readonly service = inject(PdpService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly page = signal<Page<Branch>>(emptyPage());
  readonly sort = signal<SortState | null>(null);
  private query: PageQuery = { page: 0, size: 20 };

  readonly columns: TableColumn<Branch>[] = [
    { key: 'branchName', header: 'Partner' },
    { key: 'city', header: 'Location' },
    { key: 'state', header: 'State' },
    { key: 'status', header: 'Status', width: '120px' },
    { key: 'actions', header: '', width: '130px', align: 'right' }
  ];

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Pickup Delivery Partner Management' }, { label: 'Partners' }]);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.partners(this.query).subscribe({
      next: (p) => { this.page.set(p); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  onSearch(t: string): void { this.query = { ...this.query, search: t || undefined, page: 0 }; this.load(); }
  onPage(i: number): void { this.query = { ...this.query, page: i }; this.load(); }
  onSort(s: SortState): void { this.sort.set(s); this.load(); }
  newPartner(): void { this.router.navigate(['/branches/new'], { queryParams: { type: 'PICKUP_DELIVERY_PARTNER' } }); }
  open(p: Branch): void { this.router.navigateByUrl(`/branches/${p.id}`); }
  rates(p: Branch): void { this.router.navigate(['/pdp/rates', p.id]); }
}
