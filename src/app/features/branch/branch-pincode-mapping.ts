import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ApiService } from '@core/services/api.service';
import { API } from '@core/config/api-endpoints';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { MasterRecord } from '@core/models/master.model';
import { BranchPincode } from '@core/models/branch.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { SelectOption, UiSelect } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { MasterDataService } from '../masters/master-data.service';
import { BranchService } from './branch.service';

/**
 * Pincode Branch Mapping — pick a branch, see every pincode it serves, add several at once
 * (search + checkbox picker, one request for the whole batch) or remove one. A pincode is
 * served by exactly one branch per company: the backend refuses (`conflicts`) a pincode
 * already owned by a different branch rather than moving it — surfaced here as an inline
 * warning, not silently retried.
 */
@Component({
  selector: 'app-branch-pincode-mapping',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiLoader, UiSearch, UiSelect, UiButton],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">Pincode Branch Mapping</h1>
          <p class="text-caption">Which branch owns delivery for which pincode. A pincode belongs to one branch at a time.</p>
        </div>
      </header>

      <app-card title="Branch">
        <app-select [control]="branchControl" [options]="branchOptions()" placeholder="Choose a branch…" />
      </app-card>

      @if (branchControl.value) {
        <app-card title="Add pincodes" subtitle="Search, tick the ones this branch should serve, then add them together.">
          <app-search placeholder="Search pincode or locality…" (changed)="onSearch($event)" />

          @if (searching()) {
            <app-loader [minHeight]="80" caption="Searching…" />
          } @else if (searchResults().length) {
            <ul class="pick">
              @for (r of searchResults(); track r.id) {
                <li class="pick__row">
                  <label class="pick__label">
                    <input type="checkbox" [checked]="selected().has(r.id)" (change)="toggle(r)" />
                    <span class="pick__code">{{ r.code }}</span>
                    <span class="pick__name">{{ r.name }}</span>
                  </label>
                </li>
              }
            </ul>
          } @else if (searchTerm()) {
            <p class="pick__empty">No pincode matches "{{ searchTerm() }}".</p>
          }

          @if (selected().size) {
            <div class="chips">
              @for (r of selected().values(); track r.id) {
                <span class="chip">{{ r.code }}<button type="button" (click)="untoggle(r.id)">✕</button></span>
              }
            </div>
            <app-button [loading]="adding()" (pressed)="addSelected()">Add {{ selected().size }} pincode(s)</app-button>
          }
        </app-card>

        <app-card [title]="'Mapped pincodes (' + mapped().length + ')'">
          @if (loadingMapped()) {
            <app-loader [minHeight]="100" caption="Loading…" />
          } @else if (mapped().length) {
            <div class="tbl__wrap">
              <table class="tbl">
                <thead><tr><th>Pincode</th><th>Locality</th><th></th></tr></thead>
                <tbody>
                  @for (row of mapped(); track row.id) {
                    <tr>
                      <td class="tbl__code">{{ row.pincodeCode }}</td>
                      <td>{{ row.pincodeName ?? '—' }}</td>
                      <td class="tbl__actions">
                        <app-button variant="text" icon="delete" [loading]="removing().has(row.id)"
                                    (pressed)="remove(row)">Remove</app-button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="pick__empty">This branch serves no pincodes yet.</p>
          }
        </app-card>
      }
    </div>
  `,
  styles: [`
    .pick { list-style:none; margin:12px 0 0; padding:0; max-height:280px; overflow-y:auto;
      border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .pick__row { border-top:1px solid var(--surface-border); }
    .pick__row:first-child { border-top:0; }
    .pick__label { display:flex; align-items:center; gap:10px; padding:10px 14px; cursor:pointer; font:400 17px var(--font-sans); }
    .pick__code { font-weight:600; color:var(--content-fg); }
    .pick__name { color:var(--content-muted); }
    .pick__empty { color:var(--content-muted); font:400 17px var(--font-sans); margin:12px 0 0; }
    .chips { display:flex; flex-wrap:wrap; gap:8px; margin:14px 0; }
    .chip { display:inline-flex; align-items:center; gap:6px; background:var(--brand-100, #eef2ff);
      color:var(--brand-700, #4338ca); border-radius:999px; padding:4px 6px 4px 12px; font:600 15px var(--font-sans); }
    .chip button { border:0; background:transparent; cursor:pointer; color:inherit; font:inherit; line-height:1; padding:2px; }
    .tbl__wrap { overflow-x:auto; }
    .tbl { width:100%; border-collapse:collapse; font:400 17px var(--font-sans); }
    .tbl th { text-align:left; font:500 15px var(--font-sans); color:var(--content-muted);
      text-transform:uppercase; letter-spacing:.04em; padding:0 12px 8px; }
    .tbl td { padding:10px 12px; border-top:1px solid var(--surface-border); color:var(--content-fg); }
    .tbl__code { font-weight:600; }
    .tbl__actions { text-align:right; }
  `]
})
export class BranchPincodeMapping implements OnInit {
  private readonly branchService = inject(BranchService);
  private readonly masterData = inject(MasterDataService);
  private readonly api = inject(ApiService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly confirm = inject(DialogService);

  readonly branchControl = new FormControl<string | null>(null);
  readonly branchOptions = signal<SelectOption[]>([]);

  readonly mapped = signal<BranchPincode[]>([]);
  readonly loadingMapped = signal(false);
  readonly removing = signal<ReadonlySet<string>>(new Set());

  readonly searchTerm = signal('');
  readonly searching = signal(false);
  readonly searchResults = signal<MasterRecord[]>([]);
  readonly selected = signal<Map<string, MasterRecord>>(new Map());
  readonly adding = signal(false);

  private readonly mappedPincodeIds = computed(() => new Set(this.mapped().map((m) => m.pincodeId)));

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Masters' }, { label: 'Pincode Branch Mapping' }]);
    this.masterData.branchDirectory().subscribe({
      next: (list) =>
        this.branchOptions.set(list.map((b) => ({ value: b.id, label: `${b.branchName} (${b.branchCode})` }))),
      error: () => {}
    });
    this.branchControl.valueChanges.subscribe((id) => {
      this.searchTerm.set('');
      this.searchResults.set([]);
      this.selected.set(new Map());
      if (id) this.loadMapped(id);
      else this.mapped.set([]);
    });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    if (!term) {
      this.searchResults.set([]);
      return;
    }
    this.searching.set(true);
    this.api
      .page<MasterRecord>(`${API.globalMasters}/pincodes`, { page: 0, size: 30, search: term, status: 'ACTIVE' })
      .subscribe({
        next: (p) => {
          this.searchResults.set(p.content.filter((r) => !this.mappedPincodeIds().has(r.id)));
          this.searching.set(false);
        },
        error: () => this.searching.set(false)
      });
  }

  toggle(row: MasterRecord): void {
    this.selected.update((m) => {
      const next = new Map(m);
      if (next.has(row.id)) next.delete(row.id); else next.set(row.id, row);
      return next;
    });
  }

  untoggle(id: string): void {
    this.selected.update((m) => { const next = new Map(m); next.delete(id); return next; });
  }

  addSelected(): void {
    const branchId = this.branchControl.value;
    const ids = [...this.selected().keys()];
    if (!branchId || !ids.length) return;

    this.adding.set(true);
    this.branchService.addBranchPincodes(branchId, ids).subscribe({
      next: (result) => {
        this.adding.set(false);
        this.mapped.update((rows) => [...rows, ...result.added]);
        this.selected.set(new Map());
        this.searchResults.set([]);
        this.searchTerm.set('');

        if (result.added.length) this.notify.success(`Mapped ${result.added.length} pincode(s).`);
        if (result.conflicts.length) {
          this.notify.error(
            result.conflicts.map((c) => `${c.pincodeCode} is already mapped to ${c.branchCode}`).join('; '));
        }
      },
      error: (e) => {
        this.adding.set(false);
        this.notify.error(e?.error?.message ?? 'Could not map the selected pincodes.');
      }
    });
  }

  remove(row: BranchPincode): void {
    const branchId = this.branchControl.value;
    if (!branchId) return;
    this.confirm.confirm({
      title: 'Remove pincode',
      message: `"${row.pincodeCode}" will no longer be served by this branch.`,
      confirmLabel: 'Remove', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.removing.update((s) => new Set(s).add(row.id));
      this.branchService.removeBranchPincode(branchId, row.id).subscribe({
        next: () => {
          this.mapped.update((rows) => rows.filter((r) => r.id !== row.id));
          this.removing.update((s) => { const next = new Set(s); next.delete(row.id); return next; });
          this.notify.success('Pincode removed.');
        },
        error: (e) => {
          this.removing.update((s) => { const next = new Set(s); next.delete(row.id); return next; });
          this.notify.error(e?.error?.message ?? 'Could not remove this pincode.');
        }
      });
    });
  }

  private loadMapped(branchId: string): void {
    this.loadingMapped.set(true);
    this.branchService.branchPincodes(branchId).subscribe({
      next: (rows) => { this.mapped.set(rows); this.loadingMapped.set(false); },
      error: () => this.loadingMapped.set(false)
    });
  }
}
