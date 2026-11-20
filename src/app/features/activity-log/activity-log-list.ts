import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { ActivityLogService } from '@core/services/activity-log.service';
import { UserService } from '@features/users/user.service';
import { emptyPage } from '@core/models/page.model';
import { ActivityLog, ActivityStatus } from '@core/models/activity-log.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiAutocomplete } from '@shared/components/ui-autocomplete/ui-autocomplete';
import { UiTable, TableColumn } from '@shared/components/ui-table/ui-table';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { UiDrawer } from '@shared/components/ui-drawer/ui-drawer';

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'SUCCESS', label: 'Success' },
  { value: 'FAILURE', label: 'Failure' }
];

/**
 * Admin Activity Log screen (requirement 6): filter by user/module/action/entity/status/
 * date range/free text, table of results, and a details drawer with the complete record
 * — old/new value, request info, user info, timestamp. Every row here comes from the
 * automatic `ActivityLoggingFilter` on the backend; nothing on this page is hand-curated.
 */
@Component({
  selector: 'app-activity-log-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DatePipe, UiCard, UiButton, UiSearch, UiInput, UiSelect, UiAutocomplete,
    UiTable, UiPagination, StatusBadge, UiDrawer],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Activity Log</h1>
          <p class="text-caption">Every action performed in the system — who, what, on which record, when, from where.</p></div>
        <app-button icon="download" variant="stroked" [loading]="exporting()" (pressed)="export()">Export CSV</app-button>
      </header>

      <app-card>
        <div class="filters">
          <app-search label="Search" placeholder="Description / username / entity id…" (changed)="onSearch($event)" />
          <app-autocomplete [control]="userControl" label="User" [options]="userOptions()" placeholder="All users" />
          <app-select [control]="moduleControl" label="Module" [options]="moduleOptions()" [allowEmpty]="true" />
          <app-select [control]="actionControl" label="Action" [options]="actionOptions()" [allowEmpty]="true" />
          <app-select [control]="statusControl" label="Status" [options]="statusOptions" [allowEmpty]="true" />
          <app-select [control]="entityTypeControl" label="Entity Type" [options]="entityTypeOptions()" [allowEmpty]="true" />
          <app-input [control]="entityIdControl" label="Entity Id" placeholder="Record id" />
        </div>
        <div class="filters filters--dates">
          <label class="dt"><span class="dt__l">Date From</span>
            <input class="dt__i" type="date" [formControl]="dateFromControl" (change)="load()" /></label>
          <label class="dt"><span class="dt__l">Date To</span>
            <input class="dt__i" type="date" [formControl]="dateToControl" (change)="load()" /></label>
          <app-button variant="text" (pressed)="clearFilters()">Clear all</app-button>
        </div>
      </app-card>

      <app-table
        [columns]="columns" [rows]="page().content" [loading]="loading()"
        [startIndex]="page().page * page().size"
        emptyTitle="No activity" emptyHint="Nothing matches these filters yet."
        (rowClick)="open($event)">
        <ng-template #row let-a>
          <td class="text-caption">{{ a.occurredAt | date: 'medium' }}</td>
          <td>{{ a.username || '—' }}</td>
          <td>{{ a.module || '—' }}</td>
          <td>{{ a.action }}</td>
          <td>{{ a.entityType ? (a.entityType + (a.entityId ? ' · ' + shortId(a.entityId) : '')) : '—' }}</td>
          <td class="desc">{{ a.description || '—' }}</td>
          <td class="text-caption">{{ a.ipAddress || '—' }}</td>
          <td><app-status-badge [value]="a.status" [tone]="a.status === 'SUCCESS' ? 'success' : 'danger'" /></td>
        </ng-template>
      </app-table>

      <app-pagination [page]="page()" (pageChange)="goToPage($event)" />
    </div>

    <app-drawer [open]="!!selected()" title="Activity Detail" [subtitle]="selected()?.action || ''" (closed)="selected.set(null)">
      @if (selected(); as a) {
        <div class="detail">
          <div class="detail__row"><span>Timestamp</span><strong>{{ a.occurredAt | date: 'medium' }}</strong></div>
          <div class="detail__row"><span>User</span><strong>{{ a.username || '—' }}</strong></div>
          <div class="detail__row"><span>Module / Submodule</span><strong>{{ a.module || '—' }} / {{ a.submodule || '—' }}</strong></div>
          <div class="detail__row"><span>Action</span><strong>{{ a.action }}</strong></div>
          <div class="detail__row"><span>Entity</span><strong>{{ a.entityType || '—' }} · {{ a.entityId || '—' }}</strong></div>
          <div class="detail__row"><span>Description</span><strong>{{ a.description || '—' }}</strong></div>
          <div class="detail__row"><span>Status</span><app-status-badge [value]="a.status" [tone]="a.status === 'SUCCESS' ? 'success' : 'danger'" /></div>
          @if (a.errorMessage) { <div class="detail__row"><span>Error</span><strong>{{ a.errorMessage }}</strong></div> }
          <div class="detail__row"><span>Request</span><strong>{{ a.requestMethod }} {{ a.apiEndpoint }}</strong></div>
          <div class="detail__row"><span>IP Address</span><strong>{{ a.ipAddress || '—' }}</strong></div>
          <div class="detail__row"><span>Device</span><strong>{{ a.device || '—' }} · {{ a.browser || '—' }} · {{ a.os || '—' }}</strong></div>
          @if (a.sessionId) { <div class="detail__row"><span>Session</span><strong>{{ a.sessionId }}</strong></div> }
          @if (a.oldValue) {
            <div class="detail__block"><span>Old Value</span><pre>{{ pretty(a.oldValue) }}</pre></div>
          }
          @if (a.newValue) {
            <div class="detail__block"><span>New Value</span><pre>{{ pretty(a.newValue) }}</pre></div>
          }
        </div>
      }
    </app-drawer>
  `,
  styles: [`
    .page__head { display:flex; justify-content:space-between; align-items:flex-start; }
    .filters { display:flex; gap:16px; flex-wrap:wrap; }
    .filters > * { min-width:160px; flex:1 1 160px; }
    .filters--dates { align-items:flex-end; margin-top:12px; }
    .dt { display:flex; flex-direction:column; gap:6px; flex:1 1 160px; }
    .dt__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .dt__i { height:42px; padding:0 12px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-field); font:400 17px var(--font-sans); color:var(--content-fg); }
    .desc { max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .detail { display:flex; flex-direction:column; gap:14px; }
    .detail__row { display:flex; flex-direction:column; gap:2px; font-size:17px; }
    .detail__row span { color:var(--content-muted); font-size:15px; }
    .detail__block span { color:var(--content-muted); font-size:15px; display:block; margin-bottom:6px; }
    .detail__block pre { background:var(--surface-muted); border-radius:var(--r-field); padding:12px;
      font-size:15px; overflow:auto; max-height:220px; }
  `]
})
export class ActivityLogList implements OnInit {
  private readonly service = inject(ActivityLogService);
  private readonly users = inject(UserService);
  private readonly breadcrumb = inject(BreadcrumbService);

  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly page = signal(emptyPage<ActivityLog>());
  readonly selected = signal<ActivityLog | null>(null);
  readonly userOptions = signal<SelectOption[]>([]);
  readonly moduleOptions = signal<SelectOption[]>([]);
  readonly actionOptions = signal<SelectOption[]>([]);
  readonly entityTypeOptions = signal<SelectOption[]>([]);

  readonly statusOptions = STATUS_OPTIONS;
  readonly userControl = new FormControl<string | null>(null);
  readonly moduleControl = new FormControl<string | null>(null);
  readonly actionControl = new FormControl<string | null>(null);
  readonly entityTypeControl = new FormControl<string | null>(null);
  readonly entityIdControl = new FormControl<string>('');
  readonly statusControl = new FormControl<ActivityStatus | null>(null);
  readonly dateFromControl = new FormControl<string>('');
  readonly dateToControl = new FormControl<string>('');

  readonly columns: TableColumn<ActivityLog>[] = [
    { key: 'occurredAt', header: 'Date/Time' },
    { key: 'username', header: 'User' },
    { key: 'module', header: 'Module' },
    { key: 'action', header: 'Action' },
    { key: 'entity', header: 'Entity' },
    { key: 'description', header: 'Description' },
    { key: 'ipAddress', header: 'IP Address' },
    { key: 'status', header: 'Status' }
  ];

  private search = '';
  private pageIndex = 0;

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Settings' }, { label: 'Activity Log' }]);

    this.users.list({ page: 0, size: 200, sort: 'displayName,asc' }).subscribe((p) => {
      this.userOptions.set(p.content.map((u) => ({ value: u.id, label: u.displayName })));
    });
    this.service.filterOptions().subscribe((o) => {
      this.moduleOptions.set(o.modules.map((m) => ({ value: m, label: m })));
      this.actionOptions.set(o.actions.map((a) => ({ value: a, label: a })));
      this.entityTypeOptions.set(o.entityTypes.map((e) => ({ value: e, label: e })));
    });

    for (const control of [this.userControl, this.moduleControl, this.actionControl,
      this.entityTypeControl, this.entityIdControl, this.statusControl]) {
      control.valueChanges.subscribe(() => { this.pageIndex = 0; this.load(); });
    }
    this.load();
  }

  onSearch(term: string): void { this.search = term; this.pageIndex = 0; this.load(); }
  goToPage(index: number): void { this.pageIndex = index; this.load(); }
  open(a: ActivityLog): void { this.selected.set(a); }
  shortId(id: string): string { return id.length > 8 ? id.slice(0, 8) : id; }

  pretty(json: string): string {
    try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return json; }
  }

  clearFilters(): void {
    this.search = '';
    this.userControl.setValue(null);
    this.moduleControl.setValue(null);
    this.actionControl.setValue(null);
    this.entityTypeControl.setValue(null);
    this.entityIdControl.setValue('');
    this.statusControl.setValue(null);
    this.dateFromControl.setValue('');
    this.dateToControl.setValue('');
    this.pageIndex = 0;
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.service.search({
      page: this.pageIndex, size: 25, sort: 'occurredAt,desc',
      ...(this.search ? { search: this.search } : {}),
      ...(this.userControl.value ? { userId: this.userControl.value } : {}),
      ...(this.moduleControl.value ? { module: this.moduleControl.value! } : {}),
      ...(this.actionControl.value ? { action: this.actionControl.value! } : {}),
      ...(this.entityTypeControl.value ? { entityType: this.entityTypeControl.value! } : {}),
      ...(this.entityIdControl.value ? { entityId: this.entityIdControl.value! } : {}),
      ...(this.statusControl.value ? { status: this.statusControl.value } : {}),
      ...(this.dateFromControl.value ? { dateFrom: this.dateFromControl.value + 'T00:00:00Z' } : {}),
      ...(this.dateToControl.value ? { dateTo: this.dateToControl.value + 'T23:59:59Z' } : {})
    }).subscribe({
      next: (p) => { this.page.set(p); this.loading.set(false); },
      error: () => { this.page.set(emptyPage()); this.loading.set(false); }
    });
  }

  export(): void {
    this.exporting.set(true);
    this.service.export({
      ...(this.search ? { search: this.search } : {}),
      ...(this.userControl.value ? { userId: this.userControl.value } : {}),
      ...(this.moduleControl.value ? { module: this.moduleControl.value! } : {}),
      ...(this.actionControl.value ? { action: this.actionControl.value! } : {}),
      ...(this.statusControl.value ? { status: this.statusControl.value } : {}),
      ...(this.dateFromControl.value ? { dateFrom: this.dateFromControl.value + 'T00:00:00Z' } : {}),
      ...(this.dateToControl.value ? { dateTo: this.dateToControl.value + 'T23:59:59Z' } : {})
    }).subscribe({
      next: (blob) => {
        this.exporting.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'activity-log.csv';
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.exporting.set(false)
    });
  }
}
