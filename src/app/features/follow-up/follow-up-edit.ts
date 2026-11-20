import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { FollowUpService } from '@core/services/follow-up.service';
import { FollowUp, FollowUpPriority, FollowUpType, FOLLOW_UP_PRIORITIES, FOLLOW_UP_TYPES } from '@core/models/follow-up.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiAutocomplete } from '@shared/components/ui-autocomplete/ui-autocomplete';

const PRIORITY_OPTIONS: SelectOption[] = FOLLOW_UP_PRIORITIES.map((p) => ({ value: p, label: p }));
const TYPE_OPTIONS: SelectOption[] = FOLLOW_UP_TYPES.map((t) => ({ value: t, label: t.charAt(0) + t.slice(1).toLowerCase() }));

function toDateInput(iso: string): string { return iso ? iso.substring(0, 10) : ''; }

/** Edit a follow-up. Assignee/branch reassignment lives on the detail page's own
 *  Assignment card — this page is the plain-field edit (title/description/type/
 *  priority/due date), refused server-side once COMPLETED/CANCELLED. */
@Component({
  selector: 'app-follow-up-edit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiLoader, UiButton, UiInput, UiSelect, UiAutocomplete],
  template: `
    @if (loading()) {
      <app-loader [minHeight]="280" caption="Loading…" />
    } @else if (!followUp()) {
      <app-card><p class="empty">Follow-up not found or outside your scope.</p></app-card>
    } @else {
      <div class="page">
        <header class="page__head">
          <div><h1 class="text-h1">Edit Follow-up</h1><p class="text-caption">{{ followUp()!.title }}</p></div>
        </header>

        <app-card title="Follow-up Details">
          <div class="grid">
            <app-input class="fld--wide" [control]="titleControl" label="Title" [required]="true" [maxLength]="200" />
            <label class="fld fld--wide"><span class="fld__l">Description</span>
              <textarea class="ta" rows="3" maxlength="5000" [formControl]="descriptionControl"></textarea>
            </label>
            <app-select [control]="typeControl" label="Type" [options]="typeOptions" />
            <app-select [control]="priorityControl" label="Priority" [options]="priorityOptions" />
            <app-autocomplete [control]="branchControl" label="Branch" [options]="branchOptions()" placeholder="Branch" />
            <app-input [control]="dueDateControl" type="date" label="Due Date" [required]="true" />
          </div>
        </app-card>

        <div class="actions">
          <app-button variant="stroked" (pressed)="cancel()">Cancel</app-button>
          <app-button icon="save" [loading]="saving()" [disabled]="!canSubmit()" (pressed)="submit()">Save Changes</app-button>
        </div>
      </div>
    }
  `,
  styles: [`
    .grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:20px; }
    .fld { display:flex; flex-direction:column; gap:6px; }
    .fld--wide { grid-column:1 / -1; }
    .fld__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .ta { border:0; outline:0; padding:12px 14px; background:var(--surface-muted); border-radius:var(--r-field);
      box-shadow:var(--shadow-clay-inset); font:400 17px var(--font-sans); color:var(--content-fg); resize:vertical; }
    .actions { display:flex; justify-content:flex-end; gap:12px; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
    @media (max-width:720px) { .grid { grid-template-columns:1fr; } }
  `]
})
export class FollowUpEdit implements OnInit {
  private readonly service = inject(FollowUpService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private id = '';
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly followUp = signal<FollowUp | null>(null);
  readonly branchOptions = signal<SelectOption[]>([]);

  readonly titleControl = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(200)] });
  readonly descriptionControl = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(5000)] });
  readonly typeControl = new FormControl<FollowUpType>('GENERAL', { nonNullable: true });
  readonly priorityControl = new FormControl<FollowUpPriority>('MEDIUM', { nonNullable: true });
  readonly branchControl = new FormControl<string | null>(null);
  readonly dueDateControl = new FormControl('', { nonNullable: true, validators: [Validators.required] });

  readonly typeOptions = TYPE_OPTIONS;
  readonly priorityOptions = PRIORITY_OPTIONS;

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.masters.branchDirectory().subscribe((branches) =>
      this.branchOptions.set(branches.map((b) => ({ value: b.id, label: `${b.branchName} (${b.branchCode})` }))));
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.get(this.id).subscribe({
      next: (f) => {
        this.followUp.set(f);
        this.titleControl.setValue(f.title);
        this.descriptionControl.setValue(f.description ?? '');
        this.typeControl.setValue(f.followUpType);
        this.priorityControl.setValue(f.priority);
        this.branchControl.setValue(f.branchId);
        this.dueDateControl.setValue(toDateInput(f.dueDate));
        this.breadcrumb.set([{ label: 'Follow-ups', route: '/follow-ups' }, { label: f.title, route: `/follow-ups/${f.id}` }, { label: 'Edit' }]);
        this.loading.set(false);
      },
      error: () => { this.followUp.set(null); this.loading.set(false); }
    });
  }

  canSubmit(): boolean {
    return this.titleControl.valid && this.dueDateControl.valid;
  }

  submit(): void {
    const f = this.followUp();
    if (!f || !this.canSubmit()) return;
    this.saving.set(true);
    this.service.update(f.id, {
      branchId: this.branchControl.value,
      title: this.titleControl.value.trim(),
      description: this.descriptionControl.value.trim() || null,
      followUpType: this.typeControl.value,
      priority: this.priorityControl.value,
      dueDate: new Date(this.dueDateControl.value).toISOString(),
      version: f.version
    }).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.notify.success('Follow-up updated.');
        this.router.navigate(['/follow-ups', updated.id]);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 409) {
          this.notify.error('This follow-up changed elsewhere — reloading the latest version.');
          this.load();
          return;
        }
        this.notify.error(err.error?.message ?? 'Could not save the changes.');
      }
    });
  }

  cancel(): void { this.router.navigate(['/follow-ups', this.id]); }
}
