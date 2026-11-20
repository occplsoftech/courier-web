import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
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
import { TicketService } from '@core/services/ticket.service';
import {
  SlaStatus, Ticket, TicketDetail as TicketDetailModel, TicketPriority, TicketStatus,
  TICKET_PRIORITIES, TICKET_STATUSES
} from '@core/models/ticket.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { TicketConversationTimeline } from './components/ticket-conversation-timeline';

const ADMIN_ROLES = [AppRole.COMPANY_ADMIN, AppRole.SUPER_ADMIN];
const MOVEABLE_STATUSES: TicketStatus[] =
  ['ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_USER', 'WAITING_FOR_INTERNAL_TEAM', 'RESOLVED'];

function label(v: string): string { return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

function priorityTone(p: TicketPriority): 'success' | 'warning' | 'danger' | 'info' {
  if (p === 'CRITICAL') return 'danger';
  if (p === 'HIGH') return 'warning';
  if (p === 'MEDIUM') return 'info';
  return 'success';
}

function statusTone(s: TicketStatus): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (s === 'RESOLVED' || s === 'CLOSED') return 'success';
  if (s === 'REOPENED' || s === 'WAITING_FOR_INTERNAL_TEAM') return 'danger';
  if (s === 'WAITING_FOR_USER') return 'warning';
  if (s === 'OPEN') return 'info';
  return 'neutral';
}

function slaTone(s: SlaStatus): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (s === 'BREACHED') return 'danger';
  if (s === 'WARNING') return 'warning';
  if (s === 'MET' || s === 'ON_TRACK') return 'success';
  return 'neutral';
}

function slaLabel(s: SlaStatus): string {
  if (s === 'NO_SLA') return 'No SLA';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Ticket Details — header, conversation timeline + reply box, and a right sidebar with
 *  requester/company/branch/agent/category/related-record info and every lifecycle action.
 *  The backend is the real gate on every action here (internal notes, assignment, status
 *  transitions); the UI only hides what a caller almost certainly can't do, to keep the
 *  page honest rather than a second copy of the authorisation rules. */
@Component({
  selector: 'app-ticket-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DatePipe, DecimalPipe, RouterLink, UiCard, UiLoader, UiButton, UiSelect,
    StatusBadge, TicketConversationTimeline],
  template: `
    <div class="page">
      @if (loading()) {
        <app-loader [minHeight]="280" caption="Loading…" />
      } @else if (!detail()) {
        <app-card><p class="empty">Ticket not found or outside your scope.</p></app-card>
      } @else {
        <header class="hd">
          <div class="hd__title">
            <h1 class="text-h1">{{ ticket()!.ticketNumber }}</h1>
            <app-status-badge [value]="ticket()!.status" [label]="label(ticket()!.status)" [tone]="statusTone(ticket()!.status)" />
            <app-status-badge [value]="ticket()!.priority" [tone]="priorityTone(ticket()!.priority)" />
            @if (ticket()!.slaStatus !== 'NO_SLA') {
              <app-status-badge [value]="ticket()!.slaStatus" [label]="slaLabel(ticket()!.slaStatus)" [tone]="slaTone(ticket()!.slaStatus)" />
            }
            @if (ticket()!.escalated) { <app-status-badge value="ESCALATED" tone="danger" /> }
          </div>
          <p class="text-caption">{{ ticket()!.subject }}</p>
        </header>

        <div class="cols">
          <div class="main">
            <app-card title="Description"><p class="desc">{{ ticket()!.description }}</p></app-card>

            <app-card title="Conversation">
              <app-ticket-conversation-timeline
                [messages]="detail()!.messages" [statusHistory]="detail()!.statusHistory"
                [assignmentHistory]="detail()!.assignmentHistory" [userNames]="userNames()" />
            </app-card>

            <app-card title="Reply">
              <label class="fld"><span class="fld__l">Message</span>
                <textarea class="ta" rows="3" placeholder="Write a reply…" maxlength="5000" [formControl]="replyControl"></textarea>
              </label>
              @if (isStaff()) {
                <label class="chk"><input type="checkbox" [formControl]="internalControl" /> Internal note (staff only, hidden from requester)</label>
              }
              <div class="row-actions">
                <app-button icon="send" [loading]="replying()" [disabled]="!replyControl.value.trim()" (pressed)="sendReply()">
                  {{ internalControl.value ? 'Add Internal Note' : 'Send Reply' }}
                </app-button>
              </div>
            </app-card>

            <app-card title="Attachments" [subtitle]="detail()!.attachments.length + ' file(s)'">
              @if (detail()!.attachments.length === 0) {
                <p class="text-caption">No attachments yet.</p>
              } @else {
                <ul class="atts">
                  @for (a of detail()!.attachments; track a.id) {
                    <li><a [href]="a.assetUrl" target="_blank" rel="noopener">{{ a.filename }}</a>
                      <span class="text-caption"> · {{ (a.sizeBytes / 1024) | number: '1.0-0' }} KB</span></li>
                  }
                </ul>
              }
              <label class="fld"><span class="fld__l">Add attachment</span><input type="file" (change)="onFile($event)" /></label>
              <div class="row-actions">
                <app-button variant="stroked" icon="upload" [loading]="uploading()" [disabled]="!pendingFile" (pressed)="uploadFile()">Upload</app-button>
              </div>
            </app-card>
          </div>

          <aside class="side">
            <app-card title="Ticket Info">
              <dl class="kv">
                <dt>Requester</dt><dd>{{ userLabel(ticket()!.createdByUserId) }}</dd>
                <dt>Assigned Agent</dt><dd>{{ ticket()!.assigneeUserId ? userLabel(ticket()!.assigneeUserId!) : 'Unassigned' }}</dd>
                <dt>Category</dt><dd>{{ categoryLabel(ticket()!.categoryId) }}</dd>
                @if (ticket()!.relatedShipmentId) {
                  <dt>Shipment</dt><dd><a [routerLink]="['/shipments', ticket()!.relatedShipmentId]">View shipment</a></dd>
                }
                @if (ticket()!.relatedBranchId) {
                  <dt>Branch/Hub</dt><dd><a [routerLink]="['/branches', ticket()!.relatedBranchId]">{{ branchLabel(ticket()!.relatedBranchId) }}</a></dd>
                }
                @if (ticket()!.relatedCustomerId) {
                  <dt>Customer</dt><dd><a [routerLink]="['/customers', ticket()!.relatedCustomerId]">View customer</a></dd>
                }
                <dt>Created</dt><dd class="text-caption">{{ ticket()!.createdAt | date: 'medium' }}</dd>
                <dt>Updated</dt><dd class="text-caption">{{ ticket()!.updatedAt | date: 'medium' }}</dd>
                @if (ticket()!.firstResponseAt) { <dt>First Response</dt><dd class="text-caption">{{ ticket()!.firstResponseAt | date: 'medium' }}</dd> }
                @if (ticket()!.resolvedAt) { <dt>Resolved</dt><dd class="text-caption">{{ ticket()!.resolvedAt | date: 'medium' }}</dd> }
                @if (ticket()!.closedAt) { <dt>Closed</dt><dd class="text-caption">{{ ticket()!.closedAt | date: 'medium' }}</dd> }
                <dt>SLA</dt>
                <dd>
                  <app-status-badge [value]="ticket()!.slaStatus" [label]="slaLabel(ticket()!.slaStatus)" [tone]="slaTone(ticket()!.slaStatus)" />
                </dd>
                @if (ticket()!.slaFirstResponseDueAt) {
                  <dt>First Response Due</dt><dd class="text-caption">{{ ticket()!.slaFirstResponseDueAt | date: 'medium' }}</dd>
                }
                @if (ticket()!.slaResolutionDueAt) {
                  <dt>Resolution Due</dt><dd class="text-caption">{{ ticket()!.slaResolutionDueAt | date: 'medium' }}</dd>
                }
              </dl>
            </app-card>

            @if (canManage()) {
              <app-card title="Assignment">
                <app-select [control]="agentControl" label="Agent" [options]="agentOptions()" />
                <label class="fld"><span class="fld__l">Remarks</span><input class="fld__i" type="text" [formControl]="assignRemarksControl" placeholder="Optional" maxlength="1000" /></label>
                <div class="row-actions">
                  @if (ticket()!.status === 'OPEN') {
                    <app-button [loading]="acting()" [disabled]="!agentControl.value" (pressed)="assign()">Assign</app-button>
                  } @else if (!isTerminal()) {
                    <app-button variant="stroked" [loading]="acting()" [disabled]="!agentControl.value" (pressed)="reassign()">Reassign</app-button>
                    <app-button variant="danger" [loading]="acting()" [disabled]="!agentControl.value" (pressed)="escalate()">Escalate</app-button>
                  }
                </div>
              </app-card>

              <app-card title="Status">
                <app-select [control]="statusControl" label="Move to" [options]="statusOptions" />
                <label class="fld"><span class="fld__l">Remarks</span><input class="fld__i" type="text" [formControl]="statusRemarksControl" placeholder="Optional" maxlength="1000" /></label>
                <div class="row-actions"><app-button variant="stroked" [loading]="acting()" (pressed)="changeStatus()">Update Status</app-button></div>
              </app-card>

              <app-card title="Priority">
                <app-select [control]="priorityControl" label="Priority" [options]="priorityOptions" />
                <div class="row-actions"><app-button variant="stroked" [loading]="acting()" (pressed)="changePriority()">Update Priority</app-button></div>
              </app-card>

              <app-card title="Category">
                <app-select [control]="categoryControl" label="Category" [options]="categoryOptions()" />
                <app-select [control]="subCategoryControl" label="Sub-category" [options]="subCategoryOptions()" [allowEmpty]="true" />
                <div class="row-actions"><app-button variant="stroked" [loading]="acting()" [disabled]="!categoryControl.value" (pressed)="changeCategory()">Update Category</app-button></div>
              </app-card>
            }

            <app-card title="Resolution">
              <div class="row-actions">
                @if (canReopen()) {
                  <app-button variant="stroked" [loading]="acting()" (pressed)="reopen()">Reopen</app-button>
                }
                @if (canClose()) {
                  <app-button variant="stroked" [loading]="acting()" (pressed)="close()">Close</app-button>
                }
                @if (!canReopen() && !canClose()) {
                  <p class="text-caption">No resolution action available right now.</p>
                }
              </div>
            </app-card>
          </aside>
        </div>
      }
    </div>
  `,
  styles: [`
    .hd__title { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
    .cols { display:grid; grid-template-columns:1fr 340px; gap:20px; align-items:start; }
    .main { display:flex; flex-direction:column; gap:20px; }
    .side { display:flex; flex-direction:column; gap:20px; }
    .desc { white-space:pre-wrap; font:400 17px var(--font-sans); color:var(--content-fg); margin:0; }
    .fld { display:flex; flex-direction:column; gap:6px; margin-top:12px; }
    .fld__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .fld__i { height:40px; padding:0 12px; border:0; border-radius:var(--r-field); background:var(--surface-muted);
      box-shadow:var(--shadow-clay-inset); font:400 17px var(--font-sans); color:var(--content-fg); }
    .ta { border:0; outline:0; padding:12px 14px; background:var(--surface-muted); border-radius:var(--r-field);
      box-shadow:var(--shadow-clay-inset); font:400 17px var(--font-sans); color:var(--content-fg); resize:vertical; width:100%; }
    .chk { display:flex; align-items:center; gap:8px; margin-top:10px; font:500 16px var(--font-sans); color:var(--content-fg); }
    .row-actions { display:flex; gap:10px; margin-top:14px; flex-wrap:wrap; }
    .atts { list-style:none; margin:0 0 14px; padding:0; display:flex; flex-direction:column; gap:6px; }
    .atts a { color:var(--brand-600); font:500 16px var(--font-sans); }
    .kv { display:grid; grid-template-columns:auto 1fr; gap:8px 12px; margin:0; }
    .kv dt { font:600 15px var(--font-sans); color:var(--content-muted); text-transform:uppercase; letter-spacing:.03em; }
    .kv dd { margin:0; font:500 16px var(--font-sans); color:var(--content-fg); }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
    @media (max-width:960px) { .cols { grid-template-columns:1fr; } }
  `]
})
export class TicketDetailPage implements OnInit {
  private readonly service = inject(TicketService);
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
  readonly detail = signal<TicketDetailModel | null>(null);
  readonly ticket = computed<Ticket | null>(() => this.detail()?.ticket ?? null);

  readonly replying = signal(false);
  readonly uploading = signal(false);
  readonly acting = signal(false);
  pendingFile: File | null = null;

  readonly agentOptions = signal<SelectOption[]>([]);
  readonly categoryOptions = signal<SelectOption[]>([]);
  readonly subCategoryOptions = signal<SelectOption[]>([]);
  private readonly branchNames = signal<Map<string, string>>(new Map());
  private readonly categoryNames = signal<Map<string, string>>(new Map());
  readonly userNames = signal<Map<string, string>>(new Map());

  readonly replyControl = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(5000)] });
  readonly internalControl = new FormControl(false, { nonNullable: true });
  readonly agentControl = new FormControl<string | null>(null);
  readonly assignRemarksControl = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(1000)] });
  readonly statusControl = new FormControl<TicketStatus>('IN_PROGRESS', { nonNullable: true, validators: [Validators.required] });
  readonly statusRemarksControl = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(1000)] });
  readonly priorityControl = new FormControl<TicketPriority>('MEDIUM', { nonNullable: true });
  readonly categoryControl = new FormControl<string | null>(null);
  readonly subCategoryControl = new FormControl<string | null>(null);

  readonly statusOptions: SelectOption[] = MOVEABLE_STATUSES.map((s) => ({ value: s, label: label(s) }));
  readonly priorityOptions: SelectOption[] = TICKET_PRIORITIES.map((p) => ({ value: p, label: p }));

  readonly isAdmin = computed(() => this.perms.hasAnyRole(ADMIN_ROLES));
  readonly isStaff = computed(() => {
    const t = this.ticket();
    if (!t) return false;
    return this.isAdmin() || t.assigneeUserId === this.auth.user()?.userId;
  });
  readonly canManage = computed(() => this.isStaff());
  readonly isTerminal = computed(() => {
    const s = this.ticket()?.status;
    return s === 'RESOLVED' || s === 'CLOSED';
  });
  readonly canReopen = computed(() => {
    const t = this.ticket();
    if (!t) return false;
    const owns = t.createdByUserId === this.auth.user()?.userId || this.isAdmin();
    return owns && (t.status === 'RESOLVED' || t.status === 'CLOSED');
  });
  readonly canClose = computed(() => this.isStaff() && this.ticket()?.status === 'RESOLVED');

  label = label;
  priorityTone = priorityTone;
  statusTone = statusTone;
  slaTone = slaTone;
  slaLabel = slaLabel;

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.masters.branchDirectory().subscribe((branches) =>
      this.branchNames.set(new Map(branches.map((b) => [b.id, `${b.branchName} (${b.branchCode})`]))));
    this.service.categories().subscribe((cats) => {
      this.categoryNames.set(new Map(cats.map((c) => [c.id, c.name])));
      this.categoryOptions.set(cats.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name })));
    });
    this.categoryControl.valueChanges.subscribe((categoryId) => {
      this.subCategoryControl.setValue(null, { emitEvent: false });
      this.subCategoryOptions.set([]);
      if (!categoryId) return;
      this.service.subCategories(categoryId).subscribe((subs) =>
        this.subCategoryOptions.set(subs.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))));
    });
    this.users.list({ page: 0, size: 200, sort: 'displayName,asc' }).subscribe((p) => {
      this.agentOptions.set(p.content.map((u) => ({ value: u.id, label: u.displayName })));
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
      next: (d) => {
        this.detail.set(d);
        this.priorityControl.setValue(d.ticket.priority, { emitEvent: false });
        this.agentControl.setValue(d.ticket.assigneeUserId ?? null, { emitEvent: false });
        this.categoryControl.setValue(d.ticket.categoryId, { emitEvent: false });
        if (d.ticket.categoryId) {
          this.service.subCategories(d.ticket.categoryId).subscribe((subs) => {
            this.subCategoryOptions.set(subs.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name })));
            this.subCategoryControl.setValue(d.ticket.subCategoryId ?? null, { emitEvent: false });
          });
        }
        this.breadcrumb.set([{ label: 'Support' }, { label: 'Tickets', route: '/support/tickets' }, { label: d.ticket.ticketNumber }]);
        this.resolveMissingUsers(d);
        this.loading.set(false);
      },
      error: () => { this.detail.set(null); this.loading.set(false); }
    });
  }

  /** The requester and every conversation/history actor may not be in the first 200
   *  agents fetched above (a customer role, or a large company) — fetch anyone still
   *  unresolved individually rather than pretend they don't exist. */
  private resolveMissingUsers(d: TicketDetailModel): void {
    const known = this.userNames();
    const ids = new Set<string>([
      ...(d.ticket.createdByUserId ? [d.ticket.createdByUserId] : []),
      ...(d.ticket.assigneeUserId ? [d.ticket.assigneeUserId] : []),
      ...d.messages.map((m) => m.authorUserId),
      ...d.statusHistory.map((h) => h.changedByUserId),
      ...d.assignmentHistory.flatMap((h) => [h.assignedToUserId, h.assignedByUserId])
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

  userLabel(id: string | null): string { return id ? (this.userNames().get(id) ?? id) : 'System'; }
  branchLabel(id?: string | null): string { return id ? (this.branchNames().get(id) ?? id) : '—'; }
  categoryLabel(id: string): string { return this.categoryNames().get(id) ?? id; }

  onFile(e: Event): void { this.pendingFile = (e.target as HTMLInputElement).files?.[0] ?? null; }

  uploadFile(): void {
    if (!this.pendingFile) return;
    this.uploading.set(true);
    this.service.uploadAttachment(this.id, this.pendingFile).subscribe({
      next: () => { this.uploading.set(false); this.pendingFile = null; this.notify.success('Attachment uploaded.'); this.load(); },
      error: (err: HttpErrorResponse) => { this.uploading.set(false); this.notify.error(err.error?.message ?? 'Upload failed.'); }
    });
  }

  sendReply(): void {
    const body = this.replyControl.value.trim();
    if (!body) return;
    this.replying.set(true);
    this.service.reply(this.id, { body, internalNote: this.internalControl.value }).subscribe({
      next: () => { this.replying.set(false); this.replyControl.setValue(''); this.internalControl.setValue(false); this.load(); },
      error: (err: HttpErrorResponse) => { this.replying.set(false); this.notify.error(err.error?.message ?? 'Could not send the reply.'); }
    });
  }

  assign(): void { this.runAssignment(() => this.service.assign(this.id, this.assignBody()), 'Ticket assigned.'); }
  reassign(): void { this.runAssignment(() => this.service.reassign(this.id, this.assignBody()), 'Ticket reassigned.'); }

  escalate(): void {
    this.confirmDialog.confirm({
      title: 'Escalate ticket', message: 'This flags the ticket as escalated and updates the assignee.',
      confirmLabel: 'Escalate', danger: true
    }).subscribe((ok) => { if (ok) this.runAssignment(() => this.service.escalate(this.id, this.assignBody()), 'Ticket escalated.'); });
  }

  private assignBody() {
    return { assigneeUserId: this.agentControl.value, remarks: this.assignRemarksControl.value.trim() || null };
  }

  private runAssignment(call: () => ReturnType<TicketService['assign']>, message: string): void {
    this.acting.set(true);
    call().subscribe({
      next: () => { this.acting.set(false); this.assignRemarksControl.setValue(''); this.notify.success(message); this.load(); },
      error: (err: HttpErrorResponse) => { this.acting.set(false); this.notify.error(err.error?.message ?? 'Could not update the assignment.'); }
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

  changePriority(): void {
    this.acting.set(true);
    this.service.changePriority(this.id, { priority: this.priorityControl.value }).subscribe({
      next: () => { this.acting.set(false); this.notify.success('Priority updated.'); this.load(); },
      error: (err: HttpErrorResponse) => { this.acting.set(false); this.notify.error(err.error?.message ?? 'Could not update the priority.'); }
    });
  }

  changeCategory(): void {
    if (!this.categoryControl.value) return;
    this.acting.set(true);
    this.service.changeCategory(this.id, {
      categoryId: this.categoryControl.value, subCategoryId: this.subCategoryControl.value
    }).subscribe({
      next: () => { this.acting.set(false); this.notify.success('Category updated.'); this.load(); },
      error: (err: HttpErrorResponse) => { this.acting.set(false); this.notify.error(err.error?.message ?? 'Could not update the category.'); }
    });
  }

  reopen(): void {
    this.confirmDialog.prompt({
      title: 'Reopen ticket', message: 'Tell the team why this isn\'t resolved yet.',
      label: 'Reason', placeholder: 'The issue is still happening…', confirmLabel: 'Reopen'
    }).subscribe((remarks) => {
      if (remarks === undefined) return;
      this.acting.set(true);
      this.service.reopen(this.id, { remarks: remarks || null }).subscribe({
        next: () => { this.acting.set(false); this.notify.success('Ticket reopened.'); this.load(); },
        error: (err: HttpErrorResponse) => { this.acting.set(false); this.notify.error(err.error?.message ?? 'Could not reopen the ticket.'); }
      });
    });
  }

  close(): void {
    this.confirmDialog.confirm({ title: 'Close ticket', message: 'The requester can still reopen this later if needed.', confirmLabel: 'Close' })
      .subscribe((ok) => {
        if (!ok) return;
        this.acting.set(true);
        this.service.close(this.id, {}).subscribe({
          next: () => { this.acting.set(false); this.notify.success('Ticket closed.'); this.load(); },
          error: (err: HttpErrorResponse) => { this.acting.set(false); this.notify.error(err.error?.message ?? 'Could not close the ticket.'); }
        });
      });
  }
}
