import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { UserService } from '@features/users/user.service';
import { FollowUpService } from '@core/services/follow-up.service';
import { FollowUpPriority, FollowUpType, FOLLOW_UP_PRIORITIES, FOLLOW_UP_TYPES } from '@core/models/follow-up.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiAutocomplete } from '@shared/components/ui-autocomplete/ui-autocomplete';

const PRIORITY_OPTIONS: SelectOption[] = FOLLOW_UP_PRIORITIES.map((p) => ({ value: p, label: p }));
const TYPE_OPTIONS: SelectOption[] = FOLLOW_UP_TYPES.map((t) => ({ value: t, label: t.charAt(0) + t.slice(1).toLowerCase() }));

/** Create a follow-up. Reachable standalone (Follow-ups > Create) or from a related
 *  record's own page (Shipment/Customer) via `shipmentId`/`customerId`/`branchId` query
 *  params — pre-filled here and linked on the follow-up the moment it's created. */
@Component({
  selector: 'app-follow-up-create',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiButton, UiInput, UiSelect, UiAutocomplete],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Create Follow-up</h1><p class="text-caption">Set a reminder to take manual action — a due date is required.</p></div>
      </header>

      <app-card title="Follow-up Details">
        <div class="grid">
          <app-input class="fld--wide" [control]="titleControl" label="Title" placeholder="e.g. Call customer about delivery time" [required]="true" [maxLength]="200" />
          <label class="fld fld--wide"><span class="fld__l">Description</span>
            <textarea class="ta" rows="3" placeholder="What needs to happen, and why…" maxlength="5000" [formControl]="descriptionControl"></textarea>
          </label>
          <app-select [control]="typeControl" label="Type" [options]="typeOptions" />
          <app-select [control]="priorityControl" label="Priority" [options]="priorityOptions" />
          <app-autocomplete [control]="branchControl" label="Branch" [options]="branchOptions()" placeholder="Your own branch" />
          <app-autocomplete [control]="assigneeControl" label="Assign To" [options]="userOptions()" placeholder="Unassigned" />
          <app-input [control]="dueDateControl" type="date" label="Due Date" [required]="true" />
        </div>

        @if (shipmentId) { <p class="linked"><strong>Linked shipment:</strong> {{ shipmentId }}</p> }
        @if (customerId) { <p class="linked"><strong>Linked customer:</strong> {{ customerId }}</p> }
      </app-card>

      <div class="actions">
        <app-button variant="stroked" (pressed)="cancel()">Cancel</app-button>
        <app-button icon="event_available" [loading]="saving()" [disabled]="!canSubmit()" (pressed)="submit()">Create Follow-up</app-button>
      </div>
    </div>
  `,
  styles: [`
    .grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:20px; }
    .fld { display:flex; flex-direction:column; gap:6px; }
    .fld--wide { grid-column:1 / -1; }
    .fld__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .ta { border:0; outline:0; padding:12px 14px; background:var(--surface-muted); border-radius:var(--r-field);
      box-shadow:var(--shadow-clay-inset); font:400 17px var(--font-sans); color:var(--content-fg); resize:vertical; }
    .linked { margin:16px 0 0; padding:10px 14px; background:var(--info-bg); color:var(--info);
      border-radius:var(--r-field); font:500 16px var(--font-sans); }
    .actions { display:flex; justify-content:flex-end; gap:12px; }
    @media (max-width:720px) { .grid { grid-template-columns:1fr; } }
  `]
})
export class FollowUpCreate implements OnInit {
  private readonly service = inject(FollowUpService);
  private readonly masters = inject(MasterDataService);
  private readonly users = inject(UserService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly saving = signal(false);
  readonly branchOptions = signal<SelectOption[]>([]);
  readonly userOptions = signal<SelectOption[]>([]);

  shipmentId: string | null = null;
  customerId: string | null = null;

  readonly titleControl = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(200)] });
  readonly descriptionControl = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(5000)] });
  readonly typeControl = new FormControl<FollowUpType>('GENERAL', { nonNullable: true });
  readonly priorityControl = new FormControl<FollowUpPriority>('MEDIUM', { nonNullable: true });
  readonly branchControl = new FormControl<string | null>(null);
  readonly assigneeControl = new FormControl<string | null>(null);
  readonly dueDateControl = new FormControl('', { nonNullable: true, validators: [Validators.required] });

  readonly typeOptions = TYPE_OPTIONS;
  readonly priorityOptions = PRIORITY_OPTIONS;

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Follow-ups', route: '/follow-ups' }, { label: 'New' }]);

    const params = this.route.snapshot.queryParamMap;
    this.shipmentId = params.get('shipmentId');
    this.customerId = params.get('customerId');
    const branchId = params.get('branchId') ?? this.auth.user()?.branchId ?? null;
    if (this.shipmentId) this.typeControl.setValue('SHIPMENT');
    else if (this.customerId) this.typeControl.setValue('CUSTOMER');

    this.masters.branchDirectory().subscribe((branches) => {
      this.branchOptions.set(branches.map((b) => ({ value: b.id, label: `${b.branchName} (${b.branchCode})` })));
      if (branchId) this.branchControl.setValue(branchId);
    });
    this.users.list({ page: 0, size: 200, sort: 'displayName,asc' }).subscribe((p) =>
      this.userOptions.set(p.content.map((u) => ({ value: u.id, label: u.displayName }))));
  }

  canSubmit(): boolean {
    return this.titleControl.valid && this.dueDateControl.valid;
  }

  submit(): void {
    if (!this.canSubmit()) return;
    this.saving.set(true);
    this.service.create({
      branchId: this.branchControl.value,
      referenceType: this.typeControl.value,
      customerId: this.customerId,
      shipmentId: this.shipmentId,
      assignedUserId: this.assigneeControl.value,
      title: this.titleControl.value.trim(),
      description: this.descriptionControl.value.trim() || null,
      followUpType: this.typeControl.value,
      priority: this.priorityControl.value,
      dueDate: new Date(this.dueDateControl.value).toISOString()
    }).subscribe({
      next: (followUp) => {
        this.notify.success('Follow-up created.');
        this.saving.set(false);
        this.router.navigate(['/follow-ups', followUp.id]);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.notify.error(err.error?.message ?? 'Could not create the follow-up.');
      }
    });
  }

  cancel(): void { this.router.navigate(['/follow-ups']); }
}
