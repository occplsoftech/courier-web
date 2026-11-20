import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { PermissionService } from '@core/auth/permission.service';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { AppRole } from '@core/models/role.model';
import { MasterDataService } from '@features/masters/master-data.service';
import { UserService } from '@features/users/user.service';
import { FollowUpService } from '@core/services/follow-up.service';
import {
  FollowUp, FollowUpHistoryEntry, FollowUpPriority, FollowUpStatus,
  MOVEABLE_FOLLOW_UP_STATUSES
} from '@core/models/follow-up.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { FollowUpHistoryTimeline } from './components/follow-up-history-timeline';

const ADMIN_ROLES = [AppRole.COMPANY_ADMIN, AppRole.SUPER_ADMIN];

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

/** Follow-up Details — header, description, timeline + add-note box, and a right
 *  sidebar with follow-up info and every lifecycle action (assign, status, reschedule).
 *  The backend is the real gate on every action here; the UI only hides what a caller
 *  almost certainly can't do, same posture as `TicketDetailPage`. */
@Component({
  selector: 'app-follow-up-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DatePipe, RouterLink, UiCard, UiLoader, UiButton, UiSelect,
    StatusBadge, FollowUpHistoryTimeline],
  template: `
    <div class="page">
      @if (loading()) {
        <app-loader [minHeight]="280" caption="Loading…" />
      } @else if (!followUp()) {
        <app-card><p class="empty">Follow-up not found or outside your scope.</p></app-card>
      } @else {
        <header class="hd">
          <div class="hd__title">
            <h1 class="text-h1">{{ followUp()!.title }}</h1>
            <app-status-badge [value]="followUp()!.status" [label]="label(followUp()!.status)" [tone]="statusTone(followUp()!.status)" />
            <app-status-badge [value]="followUp()!.priority" [tone]="priorityTone(followUp()!.priority)" />
            @if (followUp()!.overdue) { <app-status-badge value="OVERDUE" tone="danger" /> }
          </div>
          @if (!isTerminal()) {
            <a class="edit-link" [routerLink]="['/follow-ups', followUp()!.id, 'edit']">Edit</a>
          }
        </header>

        <div class="cols">
          <div class="main">
            @if (followUp()!.description) {
              <app-card title="Description"><p class="desc">{{ followUp()!.description }}</p></app-card>
            }

            <app-card title="History">
              <app-follow-up-history-timeline [entries]="history()" [userNames]="userNames()" />
            </app-card>

            <app-card title="Add Note">
              <label class="fld"><span class="fld__l">Note</span>
                <textarea class="ta" rows="3" placeholder="Add a note to this follow-up's history…" maxlength="1000" [formControl]="noteControl"></textarea>
              </label>
              <div class="row-actions">
                <app-button icon="send" [loading]="noting()" [disabled]="!noteControl.value.trim()" (pressed)="addNote()">Add Note</app-button>
              </div>
            </app-card>
          </div>

          <aside class="side">
            <app-card title="Follow-up Info">
              <dl class="kv">
                <dt>Type</dt><dd>{{ label(followUp()!.followUpType) }}</dd>
                <dt>Branch</dt><dd>{{ branchLabel(followUp()!.branchId) }}</dd>
                <dt>Assigned To</dt><dd>{{ followUp()!.assignedUserId ? userLabel(followUp()!.assignedUserId!) : 'Unassigned' }}</dd>
                <dt>Created By</dt><dd>{{ userLabel(followUp()!.createdBy) }}</dd>
                @if (followUp()!.shipmentId) {
                  <dt>Shipment</dt><dd><a [routerLink]="['/shipments', followUp()!.shipmentId]">View shipment</a></dd>
                }
                @if (followUp()!.customerId) {
                  <dt>Customer</dt><dd><a [routerLink]="['/customers', followUp()!.customerId]">View customer</a></dd>
                }
                <dt>Due Date</dt><dd [class.overdue]="followUp()!.overdue">{{ followUp()!.dueDate | date: 'medium' }}</dd>
                @if (followUp()!.nextFollowUpDate) {
                  <dt>Next Follow-up</dt><dd class="text-caption">{{ followUp()!.nextFollowUpDate | date: 'medium' }}</dd>
                }
                @if (followUp()!.completedAt) {
                  <dt>Completed</dt><dd class="text-caption">{{ followUp()!.completedAt | date: 'medium' }} by {{ userLabel(followUp()!.completedBy) }}</dd>
                }
                <dt>Created</dt><dd class="text-caption">{{ followUp()!.createdAt | date: 'medium' }}</dd>
                <dt>Updated</dt><dd class="text-caption">{{ followUp()!.updatedAt | date: 'medium' }}</dd>
              </dl>
            </app-card>

            @if (!isTerminal()) {
              <app-card title="Assignment">
                <app-select [control]="assigneeControl" label="Assign To" [options]="userOptions()" />
                <label class="fld"><span class="fld__l">Remarks</span><input class="fld__i" type="text" [formControl]="assignRemarksControl" placeholder="Optional" maxlength="1000" /></label>
                <div class="row-actions">
                  <app-button [loading]="acting()" [disabled]="!assigneeControl.value" (pressed)="assign()">Assign</app-button>
                </div>
              </app-card>

              <app-card title="Status">
                <app-select [control]="statusControl" label="Move to" [options]="statusOptions" />
                <label class="fld"><span class="fld__l">Remarks</span><input class="fld__i" type="text" [formControl]="statusRemarksControl" placeholder="Optional" maxlength="1000" /></label>
                <div class="row-actions"><app-button variant="stroked" [loading]="acting()" (pressed)="changeStatus()">Update Status</app-button></div>
              </app-card>

              <app-card title="Reschedule">
                <label class="fld"><span class="fld__l">New Due Date</span><input class="fld__i" type="date" [formControl]="rescheduleDateControl" /></label>
                <label class="fld"><span class="fld__l">Reason</span><input class="fld__i" type="text" [formControl]="rescheduleReasonControl" placeholder="Optional" maxlength="1000" /></label>
                <div class="row-actions">
                  <app-button variant="stroked" icon="event_repeat" [loading]="acting()" [disabled]="!rescheduleDateControl.value" (pressed)="reschedule()">Reschedule</app-button>
                </div>
              </app-card>
            } @else {
              <app-card title="Resolution">
                <p class="text-caption">This follow-up is {{ label(followUp()!.status).toLowerCase() }} and can no longer be changed — see its history above.</p>
              </app-card>
            }
          </aside>
        </div>
      }
    </div>
  `,
  styles: [`
    .hd { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap; }
    .hd__title { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
    .edit-link { display:inline-flex; align-items:center; gap:6px; padding:8px 16px; border-radius:var(--r-pill);
      background:var(--surface-muted); box-shadow:var(--shadow-clay-sm); font:600 16px var(--font-sans); color:var(--brand-600); }
    .cols { display:grid; grid-template-columns:1fr 340px; gap:20px; align-items:start; }
    .main { display:flex; flex-direction:column; gap:20px; }
    .side { display:flex; flex-direction:column; gap:20px; }
    .desc { white-space:pre-wrap; font:400 17px var(--font-sans); color:var(--content-fg); margin:0; }
    .fld { display:flex; flex-direction:column; gap:6px; margin-top:12px; }
    .fld__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .fld__i { height:40px; padding:0 12px; border:0; border-radius:var(--r-field); background:var(--surface-muted);
      box-shadow:var(--shadow-clay-inset); font:400 17px var(--font-sans); color:var(--content-fg); width:100%; box-sizing:border-box; }
    .ta { border:0; outline:0; padding:12px 14px; background:var(--surface-muted); border-radius:var(--r-field);
      box-shadow:var(--shadow-clay-inset); font:400 17px var(--font-sans); color:var(--content-fg); resize:vertical; width:100%; box-sizing:border-box; }
    .row-actions { display:flex; gap:10px; margin-top:14px; flex-wrap:wrap; }
    .kv { display:grid; grid-template-columns:auto 1fr; gap:8px 12px; margin:0; }
    .kv dt { font:600 15px var(--font-sans); color:var(--content-muted); text-transform:uppercase; letter-spacing:.03em; }
    .kv dd { margin:0; font:500 16px var(--font-sans); color:var(--content-fg); }
    .overdue { color:var(--danger); font-weight:600; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
    @media (max-width:960px) { .cols { grid-template-columns:1fr; } }
  `]
})
export class FollowUpDetailPage implements OnInit {
  private readonly service = inject(FollowUpService);
  private readonly masters = inject(MasterDataService);
  private readonly users = inject(UserService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly perms = inject(PermissionService);
  private readonly confirmDialog = inject(DialogService);
  private readonly route = inject(ActivatedRoute);

  private id = '';
  readonly loading = signal(true);
  readonly followUp = signal<FollowUp | null>(null);
  readonly history = signal<FollowUpHistoryEntry[]>([]);
  readonly noting = signal(false);
  readonly acting = signal(false);

  readonly userOptions = signal<SelectOption[]>([]);
  private readonly branchNames = signal<Map<string, string>>(new Map());
  readonly userNames = signal<Map<string, string>>(new Map());

  readonly noteControl = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(1000)] });
  readonly assigneeControl = new FormControl<string | null>(null);
  readonly assignRemarksControl = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(1000)] });
  readonly statusControl = new FormControl<FollowUpStatus>('IN_PROGRESS', { nonNullable: true, validators: [Validators.required] });
  readonly statusRemarksControl = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(1000)] });
  readonly rescheduleDateControl = new FormControl('', { nonNullable: true });
  readonly rescheduleReasonControl = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(1000)] });

  readonly statusOptions: SelectOption[] = MOVEABLE_FOLLOW_UP_STATUSES.map((s) => ({ value: s, label: label(s) }));

  readonly isAdmin = computed(() => this.perms.hasAnyRole(ADMIN_ROLES));
  readonly isTerminal = computed(() => {
    const s = this.followUp()?.status;
    return s === 'COMPLETED' || s === 'CANCELLED';
  });

  label = label;
  priorityTone = priorityTone;
  statusTone = statusTone;

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.masters.branchDirectory().subscribe((branches) =>
      this.branchNames.set(new Map(branches.map((b) => [b.id, `${b.branchName} (${b.branchCode})`]))));
    this.users.list({ page: 0, size: 200, sort: 'displayName,asc' }).subscribe((p) => {
      this.userOptions.set(p.content.map((u) => ({ value: u.id, label: u.displayName })));
      this.userNames.update((m) => {
        const next = new Map(m);
        p.content.forEach((u) => next.set(u.id, u.displayName));
        return next;
      });
    });
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.get(this.id).subscribe({
      next: (f) => {
        this.followUp.set(f);
        this.assigneeControl.setValue(f.assignedUserId ?? null, { emitEvent: false });
        this.breadcrumb.set([{ label: 'Follow-ups', route: '/follow-ups' }, { label: f.title }]);
        this.loadHistory(f);
        this.loading.set(false);
      },
      error: () => { this.followUp.set(null); this.loading.set(false); }
    });
  }

  private loadHistory(f: FollowUp): void {
    this.service.history(f.id).subscribe((entries) => {
      this.history.set(entries);
      this.resolveMissingUsers(f, entries);
    });
  }

  /** The creator/assignee/history actors may not be in the first 200 users fetched
   *  above — fetch anyone still unresolved individually, same pattern
   *  `TicketDetailPage.resolveMissingUsers` uses. */
  private resolveMissingUsers(f: FollowUp, entries: FollowUpHistoryEntry[]): void {
    const known = this.userNames();
    const ids = new Set<string>([
      ...(f.createdBy ? [f.createdBy] : []),
      ...(f.assignedUserId ? [f.assignedUserId] : []),
      ...(f.completedBy ? [f.completedBy] : []),
      ...entries.flatMap((e) => [e.changedByUserId, e.assignedToUserId].filter((x): x is string => !!x))
    ]);
    const missing = [...ids].filter((id) => !known.has(id));
    if (missing.length === 0) return;
    forkJoin(missing.map((id) => this.users.get(id, { silent: true }).pipe(catchError(() => of(null)))))
      .subscribe((profiles) => {
        this.userNames.update((m) => {
          const next = new Map(m);
          profiles.forEach((p, i) => { if (p) next.set(missing[i], p.displayName); });
          return next;
        });
      });
  }

  userLabel(id?: string | null): string { return id ? (this.userNames().get(id) ?? id) : 'System'; }
  branchLabel(id?: string | null): string { return id ? (this.branchNames().get(id) ?? id) : '—'; }

  addNote(): void {
    const note = this.noteControl.value.trim();
    if (!note) return;
    this.noting.set(true);
    this.service.addNote(this.id, { note }).subscribe({
      next: () => { this.noting.set(false); this.noteControl.setValue(''); this.notify.success('Note added.'); this.loadHistory(this.followUp()!); },
      error: (err: HttpErrorResponse) => { this.noting.set(false); this.notify.error(err.error?.message ?? 'Could not add the note.'); }
    });
  }

  assign(): void {
    if (!this.assigneeControl.value) return;
    this.acting.set(true);
    this.service.assign(this.id, {
      assignedUserId: this.assigneeControl.value, remarks: this.assignRemarksControl.value.trim() || null
    }).subscribe({
      next: () => { this.acting.set(false); this.assignRemarksControl.setValue(''); this.notify.success('Follow-up assigned.'); this.load(); },
      error: (err: HttpErrorResponse) => { this.acting.set(false); this.notify.error(err.error?.message ?? 'Could not assign the follow-up.'); }
    });
  }

  changeStatus(): void {
    this.acting.set(true);
    this.service.changeStatus(this.id, { status: this.statusControl.value, remarks: this.statusRemarksControl.value.trim() || null })
      .subscribe({
        next: () => { this.acting.set(false); this.statusRemarksControl.setValue(''); this.notify.success('Status updated.'); this.load(); },
        error: (err: HttpErrorResponse) => { this.acting.set(false); this.notify.error(err.error?.message ?? 'Could not update the status.'); }
      });
  }

  reschedule(): void {
    if (!this.rescheduleDateControl.value) return;
    this.confirmDialog.confirm({
      title: 'Reschedule follow-up', message: `Move the due date to ${this.rescheduleDateControl.value}?`,
      confirmLabel: 'Reschedule'
    }).subscribe((ok) => {
      if (!ok) return;
      this.acting.set(true);
      this.service.reschedule(this.id, {
        newDueDate: new Date(this.rescheduleDateControl.value).toISOString(),
        reason: this.rescheduleReasonControl.value.trim() || null
      }).subscribe({
        next: () => {
          this.acting.set(false); this.rescheduleDateControl.setValue(''); this.rescheduleReasonControl.setValue('');
          this.notify.success('Follow-up rescheduled.'); this.load();
        },
        error: (err: HttpErrorResponse) => { this.acting.set(false); this.notify.error(err.error?.message ?? 'Could not reschedule.'); }
      });
    });
  }
}
