import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { UserService } from '@features/users/user.service';
import { FollowUpService } from '@core/services/follow-up.service';
import { PageQuery, emptyPage } from '@core/models/page.model';
import {
  FollowUp, FollowUpPriority, FollowUpStatus, FollowUpType,
  FOLLOW_UP_PRIORITIES, FOLLOW_UP_STATUSES, FOLLOW_UP_TYPES
} from '@core/models/follow-up.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiAutocomplete } from '@shared/components/ui-autocomplete/ui-autocomplete';
import { UiTable, TableColumn } from '@shared/components/ui-table/ui-table';
import { UiPagination } from '@shared/components/ui-pagination/ui-pagination';
import { StatusBadge } from '@shared/components/status-badge/status-badge';

const STATUS_OPTIONS: SelectOption[] = FOLLOW_UP_STATUSES.map((s) => ({ value: s, label: label(s) }));
const PRIORITY_OPTIONS: SelectOption[] = FOLLOW_UP_PRIORITIES.map((p) => ({ value: p, label: p }));
const TYPE_OPTIONS: SelectOption[] = FOLLOW_UP_TYPES.map((t) => ({ value: t, label: label(t) }));

function label(v: string): string { return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

function priorityTone(p: FollowUpPriority): 'success' | 'warning' | 'danger' | 'info' {
  if (p === 'URGENT') return 'danger';
  if (p === 'HIGH') return 'warning';
  if (p === 'MEDIUM') return 'info';
  return 'success';
}

function statusTone(s: FollowUpStatus): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (s === 'COMPLETED') return 'success';
  if (s === 'CANCELLED') return 'neutral';
  if (s === 'RESCHEDULED') return 'warning';
  if (s === 'IN_PROGRESS') return 'info';
  return 'neutral';
}

/** Follow-up list — search/filter/sort/paginate over every follow-up the caller may see
 *  (backend scopes: own branch for non-admins, plus anything they created or are
 *  assigned, whole company for COMPANY_ADMIN). Row click opens the detail page. */
@Component({
  selector: 'app-follow-up-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DatePipe, UiCard, UiButton, UiSearch, UiSelect, UiAutocomplete,
    UiTable, UiPagination, StatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Follow-ups</h1><p class="text-caption">Operational tasks needing manual action — shipments, customers, deliveries, payments and more.</p></div>
        <app-button icon="add" (pressed)="createFollowUp()">Create Follow-up</app-button>
      </header>

      <app-card>
        <div class="filters">
          <app-search placeholder="Search title…" (changed)="onSearch($event)" />
          <app-select [control]="statusControl" label="Status" [options]="statusOptions" [allowEmpty]="true" />
          <app-select [control]="priorityControl" label="Priority" [options]="priorityOptions" [allowEmpty]="true" />
          <app-select [control]="typeControl" label="Type" [options]="typeOptions" [allowEmpty]="true" />
          <app-autocomplete [control]="branchControl" label="Branch" [options]="branchOptions()" placeholder="All branches" />
          <app-autocomplete [control]="assigneeControl" label="Assigned To" [options]="userOptions()" placeholder="All users" />
          <label class="chk"><input type="checkbox" [formControl]="overdueControl" /> Overdue only</label>
        </div>
      </app-card>

      <app-table
        [columns]="columns" [rows]="page().content" [loading]="loading()"
        [startIndex]="page().page * page().size"
        emptyTitle="No follow-ups" emptyHint="Nothing matches these filters yet."
        (rowClick)="open($event)">
        <ng-template #row let-f>
          <td><strong>{{ f.title }}</strong></td>
          <td>{{ label(f.followUpType) }}</td>
          <td><app-status-badge [value]="f.priority" [tone]="priorityTone(f.priority)" /></td>
          <td><app-status-badge [value]="f.status" [label]="label(f.status)" [tone]="statusTone(f.status)" /></td>
          <td>{{ branchLabel(f.branchId) }}</td>
          <td>{{ userLabel(f.assignedUserId) }}</td>
          <td>
            <span [class.overdue]="f.overdue">{{ f.dueDate | date: 'medium' }}</span>
            @if (f.overdue) { <app-status-badge value="OVERDUE" tone="danger" /> }
          </td>
          <td class="text-caption">{{ f.createdAt | date: 'medium' }}</td>
        </ng-template>
      </app-table>

      <app-pagination [page]="page()" (pageChange)="goToPage($event)" />
    </div>
  `,
  styles: [`
    .page__head { display:flex; justify-content:space-between; align-items:flex-start; }
    .filters { display:flex; gap:16px; flex-wrap:wrap; align-items:center; }
    .filters > * { min-width:180px; flex:1 1 180px; }
    .chk { display:flex; align-items:center; gap:8px; font:500 16px var(--font-sans); color:var(--content-fg); flex:0 0 auto; min-width:auto; }
    .overdue { color:var(--danger); font-weight:600; }
  `]
})
export class FollowUpList implements OnInit {
  private readonly service = inject(FollowUpService);
  private readonly masters = inject(MasterDataService);
  private readonly users = inject(UserService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(true);
  readonly page = signal(emptyPage<FollowUp>());
  readonly branchOptions = signal<SelectOption[]>([]);
  readonly userOptions = signal<SelectOption[]>([]);
  private readonly branchNames = signal<Map<string, string>>(new Map());
  private readonly userNames = signal<Map<string, string>>(new Map());

  readonly statusOptions = STATUS_OPTIONS;
  readonly priorityOptions = PRIORITY_OPTIONS;
  readonly typeOptions = TYPE_OPTIONS;
  readonly statusControl = new FormControl<string | null>(null);
  readonly priorityControl = new FormControl<string | null>(null);
  readonly typeControl = new FormControl<string | null>(null);
  readonly branchControl = new FormControl<string | null>(null);
  readonly assigneeControl = new FormControl<string | null>(null);
  readonly overdueControl = new FormControl(false, { nonNullable: true });

  readonly columns: TableColumn<FollowUp>[] = [
    { key: 'title', header: 'Title' },
    { key: 'type', header: 'Type' },
    { key: 'priority', header: 'Priority' },
    { key: 'status', header: 'Status' },
    { key: 'branch', header: 'Branch' },
    { key: 'assignee', header: 'Assigned To' },
    { key: 'dueDate', header: 'Due Date' },
    { key: 'createdAt', header: 'Created' }
  ];

  private search = '';
  private pageIndex = 0;
  private dueDateFilter: string | null = null;

  label = label;
  priorityTone = priorityTone;
  statusTone = statusTone;

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Follow-ups' }]);

    // The dashboard widget's tiles link here with a filter pre-applied — e.g.
    // ?overdue=true or ?priority=URGENT.
    const q = this.route.snapshot.queryParamMap;
    if (q.get('status')) this.statusControl.setValue(q.get('status'), { emitEvent: false });
    if (q.get('priority')) this.priorityControl.setValue(q.get('priority'), { emitEvent: false });
    if (q.get('type')) this.typeControl.setValue(q.get('type'), { emitEvent: false });
    if (q.get('branch')) this.branchControl.setValue(q.get('branch'), { emitEvent: false });
    if (q.get('assignedUser')) this.assigneeControl.setValue(q.get('assignedUser'), { emitEvent: false });
    if (q.get('overdue') === 'true') this.overdueControl.setValue(true, { emitEvent: false });
    if (q.get('dueDate')) this.dueDateFilter = q.get('dueDate');

    this.masters.branchDirectory().subscribe((branches) => {
      this.branchOptions.set(branches.map((b) => ({ value: b.id, label: `${b.branchName} (${b.branchCode})` })));
      this.branchNames.set(new Map(branches.map((b) => [b.id, `${b.branchName} (${b.branchCode})`])));
    });
    this.users.list({ page: 0, size: 200, sort: 'displayName,asc' }).subscribe((p) => {
      this.userOptions.set(p.content.map((u) => ({ value: u.id, label: u.displayName })));
      this.userNames.set(new Map(p.content.map((u) => [u.id, u.displayName])));
    });

    for (const control of [this.statusControl, this.priorityControl, this.typeControl,
      this.branchControl, this.assigneeControl]) {
      control.valueChanges.subscribe(() => this.load());
    }
    this.overdueControl.valueChanges.subscribe(() => this.load());
    this.load();
  }

  onSearch(term: string): void { this.search = term; this.pageIndex = 0; this.load(); }
  goToPage(index: number): void { this.pageIndex = index; this.load(); }

  createFollowUp(): void { this.router.navigate(['/follow-ups/new']); }
  open(f: FollowUp): void { this.router.navigate(['/follow-ups', f.id]); }

  branchLabel(id?: string | null): string { return id ? (this.branchNames().get(id) ?? '—') : '—'; }
  userLabel(id?: string | null): string { return id ? (this.userNames().get(id) ?? '—') : 'Unassigned'; }

  private load(): void {
    this.loading.set(true);
    const query: PageQuery = {
      page: this.pageIndex, size: 20, sort: 'dueDate,asc',
      ...(this.search ? { search: this.search } : {}),
      ...(this.statusControl.value ? { status: this.statusControl.value } : {}),
      ...(this.priorityControl.value ? { priority: this.priorityControl.value } : {}),
      ...(this.typeControl.value ? { type: this.typeControl.value } : {}),
      ...(this.branchControl.value ? { branch: this.branchControl.value } : {}),
      ...(this.assigneeControl.value ? { assignedUser: this.assigneeControl.value } : {}),
      ...(this.overdueControl.value ? { overdue: true } : {}),
      ...(this.dueDateFilter ? { dueDate: this.dueDateFilter } : {})
    };
    this.service.search(query).subscribe({
      next: (p) => { this.page.set(p); this.loading.set(false); },
      error: () => { this.page.set(emptyPage()); this.loading.set(false); }
    });
  }
}
