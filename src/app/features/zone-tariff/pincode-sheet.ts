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
import { AuthService } from '@core/auth/auth.service';
import { NotificationService } from '@core/services/notification.service';
import { AppRole } from '@core/models/role.model';

/** One row of the pincode master sheet: every value is the text the sheet shows. */
export interface PincodeSheetRow {
  rowNo: number;
  pincode: string | null; city: string | null; state: string | null; region: string | null; zone: string | null;
  docIsOda: string | null; docServ: string | null; docTat: string | null;
  surfaceServ: string | null; surfaceTat: string | null; airService: string | null; airTat: string | null;
  // The 2026-11-27 sheet's cargo and premium columns (V185).
  airCargoTat?: string | null; surfaceCargoTat?: string | null; airCargoOda?: string | null; surfaceCargoOda?: string | null;
  premiumService?: string | null; premiumTat?: string | null;
  /** Live, from the pincode master (what bookings check): true on, false off, null not set / pincode not on file. */
  livePremium?: boolean | null; liveAirCargo?: boolean | null; liveSurfaceCargo?: boolean | null;
}

/** The networks the sheet can switch per pincode, with the row field holding each one's live state. */
export type SwitchNetwork = 'PREMIUM' | 'AIR_CARGO' | 'SURFACE_CARGO';
export const SWITCHES: { network: SwitchNetwork; field: 'livePremium' | 'liveAirCargo' | 'liveSurfaceCargo'; label: string }[] = [
  { network: 'PREMIUM', field: 'livePremium', label: 'Premium' },
  { network: 'AIR_CARGO', field: 'liveAirCargo', label: 'Air Cargo' },
  { network: 'SURFACE_CARGO', field: 'liveSurfaceCargo', label: 'Surface Cargo' }
];

const PAGE_SIZE = 50;
const REGIONS = ['PUNE', 'X - PUNE', 'MAHARASHTRA', 'X - MAHARASHTRA', 'VIDHARBHA', 'REST OF INDIA', 'NORTH EAST', 'INTERNATIONAL'];
const ZONES = ['NORTH', 'SOUTH', 'EAST', 'WEST', 'CENTRAL', 'INTERNATIONAL'];

/**
 * OCCPL's pincode master sheet (Pincode_Master_NEW_DT_15-4-2024) exactly as given: same columns, same values, same
 * row order, read only. The working data built from it lives on the pincodes and the tariff zones.
 *
 * Beside the sheet's columns, three live switches per row — Premium, Air Cargo, Surface Cargo — show and change what the
 * pincode master says (what a booking on those services checks). They never change the sheet's own text. Company and
 * super admins switch them; everyone else sees On / Off.
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
          @for (sw of switches; track sw.network) {
            <td class="live">
              @if (r[sw.field] === undefined || (r[sw.field] === null && !r.pincode)) { <span class="muted">—</span> }
              @else if (canSwitch) {
                <label class="sw" [class.sw--busy]="busy().has(r.pincode + sw.network)">
                  <input type="checkbox" [checked]="!!r[sw.field]" [disabled]="busy().has(r.pincode + sw.network)"
                         (change)="toggle(r, sw.network, sw.field, $any($event.target))"
                         [attr.aria-label]="sw.label + ' at ' + r.pincode" />
                  <span>{{ r[sw.field] ? 'On' : 'Off' }}</span>
                </label>
              } @else { <span [class.on]="r[sw.field]">{{ r[sw.field] ? 'On' : 'Off' }}</span> }
            </td>
          }
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
    .live { white-space:nowrap; }
    .sw { display:inline-flex; align-items:center; gap:6px; cursor:pointer; }
    .sw input { width:16px; height:16px; accent-color:var(--brand-600); cursor:pointer; }
    .sw--busy { opacity:.55; cursor:progress; }
    .on { font-weight:600; color:var(--success-600, #15803d); }
    .muted { color:var(--content-muted); }
    @media (max-width:640px){ .filters { grid-template-columns:1fr; } }
  `]
})
export class PincodeSheet implements OnInit {
  private readonly api = inject(ApiService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);

  protected readonly switches = SWITCHES;
  /** Same rule as the server's pincode edit: company admin or super admin. */
  protected readonly canSwitch = this.auth.roles().some((r) => r === AppRole.COMPANY_ADMIN || r === AppRole.SUPER_ADMIN);
  /** Cells saving now, keyed pincode + network. */
  protected readonly busy = signal<Set<string>>(new Set());

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
    { key: 'livePremium', header: 'Premium (live)' },
    { key: 'liveAirCargo', header: 'Air Cargo (live)' },
    { key: 'liveSurfaceCargo', header: 'Surface Cargo (live)' },
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

  /** Saves one switch at once; on failure the row keeps its old state and the reason is shown. */
  toggle(row: PincodeSheetRow, network: SwitchNetwork, field: (typeof SWITCHES)[number]['field'], box: HTMLInputElement): void {
    const on = box.checked;
    if (!row.pincode) return;
    const key = row.pincode + network;
    this.busy.update((s) => new Set(s).add(key));
    const label = SWITCHES.find((s) => s.network === network)?.label ?? network;
    this.api.put<{ premium: boolean | null; airCargo: boolean | null; surfaceCargo: boolean | null }>(
      `${API.globalMasters}/pincode-sheet/${encodeURIComponent(row.pincode)}/coverage`, { network, serviceable: on }
    ).subscribe({
      next: (live) => {
        this.patch(row.pincode!, { livePremium: live?.premium, liveAirCargo: live?.airCargo, liveSurfaceCargo: live?.surfaceCargo });
        this.done(key);
        this.notify.success(`${label} ${on ? 'on' : 'off'} at ${row.pincode}.`);
      },
      error: (e) => {
        // The bound value did not change, so Angular would leave the box as clicked: put it back by hand.
        box.checked = !!row[field];
        this.done(key);
        this.notify.error(e?.error?.message ?? `Could not switch ${label} at ${row.pincode}.`);
      }
    });
  }

  private done(key: string): void {
    this.busy.update((s) => { const n = new Set(s); n.delete(key); return n; });
  }

  private patch(pincode: string, change: Partial<PincodeSheetRow>): void {
    const p = this.page();
    if (!p) return;
    this.page.set({ ...p, content: p.content.map((r) => (r.pincode === pincode ? { ...r, ...change } : r)) });
  }
}
