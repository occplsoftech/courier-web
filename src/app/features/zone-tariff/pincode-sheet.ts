import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { ApiService } from '@core/services/api.service';
import { Page } from '@core/models/page.model';
import { API } from '@core/config/api-endpoints';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiTable, TableColumn } from '@shared/components/ui-table/ui-table';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';

/** One row of the pincode master sheet: every value is the text the sheet shows. */
export interface PincodeSheetRow {
  rowNo: number;
  pincode: string | null; city: string | null; state: string | null; region: string | null; zone: string | null;
  docIsOda: string | null; docServ: string | null; docTat: string | null;
  surfaceServ: string | null; surfaceTat: string | null; airService: string | null; airTat: string | null;
  // The 2026-11-27 sheet's cargo and premium columns (V185).
  airCargoTat?: string | null; surfaceCargoTat?: string | null; airCargoOda?: string | null; surfaceCargoOda?: string | null;
  premiumService?: string | null; premiumTat?: string | null;
}

const PAGE_SIZE = 50;
const REGIONS = ['PUNE', 'X - PUNE', 'MAHARASHTRA', 'X - MAHARASHTRA', 'VIDHARBHA', 'REST OF INDIA', 'NORTH EAST', 'INTERNATIONAL'];
const ZONES = ['NORTH', 'SOUTH', 'EAST', 'WEST', 'CENTRAL', 'INTERNATIONAL'];

/**
 * OCCPL's pincode master sheet (Pincode_Master_NEW_DT_15-4-2024) exactly as given: same columns, same values, same
 * row order, read only. The working data built from it lives on the pincodes and the tariff zones.
 */
@Component({
  selector: 'app-pincode-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiSearch, UiSelect, UiTable, UiPagination],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Pincode Master Sheet</h1>
          <p class="text-caption">The pincode master as provided in Excel, row for row — {{ page()?.totalElements ?? 0 }} rows shown.</p></div>
        <div class="page__actions">
          <app-search placeholder="Search pincode, city or state…" (changed)="onSearch($event)" />
        </div>
      </header>

      <div class="filters">
        <app-select [control]="regionCtl" label="Region" [options]="regionOpts" [allowEmpty]="true" emptyLabel="All" placeholder="All" />
        <app-select [control]="zoneCtl" label="zone" [options]="zoneOpts" [allowEmpty]="true" emptyLabel="All" placeholder="All" />
      </div>

      <app-table [columns]="columns" [rows]="page()?.content ?? []" [loading]="loading()"
                 emptyTitle="No rows" emptyHint="Nothing in the sheet matches this search.">
        <ng-template #row let-r>
          <td class="pin">{{ r.pincode }}</td>
          <td>{{ r.city }}</td>
          <td>{{ r.state }}</td>
          <td>{{ r.region }}</td>
          <td>{{ r.zone }}</td>
          <td>{{ r.docIsOda }}</td>
          <td>{{ r.docServ }}</td>
          <td>{{ r.docTat }}</td>
          <td>{{ r.surfaceServ }}</td>
          <td>{{ r.surfaceTat }}</td>
          <td>{{ r.airService }}</td>
          <td>{{ r.airTat }}</td>
          <td>{{ r.airCargoTat }}</td>
          <td>{{ r.surfaceCargoTat }}</td>
          <td>{{ r.airCargoOda }}</td>
          <td>{{ r.surfaceCargoOda }}</td>
          <td>{{ r.premiumService }}</td>
          <td>{{ r.premiumTat }}</td>
        </ng-template>
      </app-table>
      @if (page(); as pg) {
        @if (pg.totalPages > 1) { <app-pagination [page]="pg" (pageChange)="load($event)" /> }
      }
    </div>
  `,
  styles: [`
    .filters { display:grid; grid-template-columns:repeat(2,minmax(0,280px)); gap:16px; margin:16px 0; }
    .pin { font-weight:600; font-variant-numeric:tabular-nums; }
    @media (max-width:640px){ .filters { grid-template-columns:1fr; } }
  `]
})
export class PincodeSheet implements OnInit {
  private readonly api = inject(ApiService);
  private readonly breadcrumb = inject(BreadcrumbService);

  protected readonly regionCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly zoneCtl = new FormControl<string>('', { nonNullable: true });
  protected readonly regionOpts: SelectOption[] = REGIONS.map((r) => ({ value: r, label: r }));
  protected readonly zoneOpts: SelectOption[] = ZONES.map((z) => ({ value: z, label: z }));
  protected readonly page = signal<Page<PincodeSheetRow> | null>(null);
  protected readonly loading = signal(true);
  private search = '';

  /** The sheet's own column headings, as written in the Excel file. */
  protected readonly columns: TableColumn<PincodeSheetRow>[] = [
    { key: 'pincode', header: 'Pincode' },
    { key: 'city', header: 'City' },
    { key: 'state', header: 'State' },
    { key: 'region', header: 'Region' },
    { key: 'zone', header: 'zone' },
    { key: 'docIsOda', header: 'Doc Is ODA' },
    { key: 'docServ', header: 'Doc Serv y/n' },
    { key: 'docTat', header: 'Doc TAT' },
    { key: 'surfaceServ', header: 'Surface Serv Y/N' },
    { key: 'surfaceTat', header: 'Surface TAT' },
    { key: 'airService', header: 'Air Service Y/N' },
    { key: 'airTat', header: 'Air TAT' },
    { key: 'airCargoTat', header: 'Air Cargo TAT' },
    { key: 'surfaceCargoTat', header: 'Surface Cargo TAT' },
    { key: 'airCargoOda', header: 'Air Cargo ODA' },
    { key: 'surfaceCargoOda', header: 'Surface Cargo ODA' },
    { key: 'premiumService', header: 'Premium Service' },
    { key: 'premiumTat', header: 'Premium TAT' }
  ];

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Zone Tariff' }, { label: 'Pincode Master Sheet' }]);
    this.regionCtl.valueChanges.subscribe(() => this.load(0));
    this.zoneCtl.valueChanges.subscribe(() => this.load(0));
    this.load(0);
  }

  onSearch(text: string): void { this.search = text; this.load(0); }

  load(page: number): void {
    this.loading.set(true);
    this.api.page<PincodeSheetRow>(`${API.globalMasters}/pincode-sheet`, {
      page, size: PAGE_SIZE, search: this.search || undefined,
      region: this.regionCtl.value || undefined, zone: this.zoneCtl.value || undefined
    }).subscribe({
      next: (p) => { this.page.set(p); this.loading.set(false); },
      error: () => { this.page.set(null); this.loading.set(false); }
    });
  }
}
