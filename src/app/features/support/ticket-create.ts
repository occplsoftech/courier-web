import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { TicketService } from '@core/services/ticket.service';
import { TicketPriority, TICKET_PRIORITIES } from '@core/models/ticket.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiAutocomplete } from '@shared/components/ui-autocomplete/ui-autocomplete';

const PRIORITY_OPTIONS: SelectOption[] = TICKET_PRIORITIES.map((p) => ({ value: p, label: p }));

/** Raise a ticket. Reachable standalone (Support > Raise Ticket) or from a related record's
 *  own page (Shipment/Customer/Branch/Wallet/User) via `shipmentId`/`customerId`/`branchId`
 *  query params — pre-filled here and linked on the ticket the moment it's created. */
@Component({
  selector: 'app-ticket-create',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiButton, UiInput, UiSelect, UiAutocomplete],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Raise Ticket</h1><p class="text-caption">Describe the issue — a support agent will pick it up shortly.</p></div>
      </header>

      <app-card title="Ticket Details">
        <div class="grid">
          <app-input [control]="subjectControl" label="Subject" placeholder="Short summary of the issue" [required]="true" [maxLength]="200" />
          <label class="fld fld--wide"><span class="fld__l">Description<i>*</i></span>
            <textarea class="ta" rows="4" placeholder="What happened, when, and what you expected instead…"
              maxlength="5000" [formControl]="descriptionControl"></textarea>
          </label>
          <app-select [control]="categoryControl" label="Category" [options]="categoryOptions()" />
          <app-select [control]="subCategoryControl" label="Sub-category" [options]="subCategoryOptions()" [allowEmpty]="true" />
          <app-select [control]="priorityControl" label="Priority" [options]="priorityOptions" />
          <app-autocomplete [control]="branchControl" label="Related Branch/Hub" [options]="branchOptions()" placeholder="None" />
        </div>

        @if (shipmentId) {
          <p class="linked"><strong>Linked shipment:</strong> {{ shipmentId }}</p>
        }
        @if (customerId) {
          <p class="linked"><strong>Linked customer:</strong> {{ customerId }}</p>
        }

        <label class="fld fld--wide"><span class="fld__l">Attachment</span>
          <input type="file" (change)="onFile($event)" />
          @if (fileName()) { <span class="text-caption">{{ fileName() }} selected — uploaded once the ticket is raised.</span> }
        </label>
      </app-card>

      <div class="actions">
        <app-button variant="stroked" (pressed)="cancel()">Cancel</app-button>
        <app-button icon="send" [loading]="saving()" [disabled]="!canSubmit()" (pressed)="submit()">Raise Ticket</app-button>
      </div>
    </div>
  `,
  styles: [`
    .grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:20px; }
    .fld { display:flex; flex-direction:column; gap:6px; }
    .fld--wide { grid-column:1 / -1; }
    .fld__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .fld__l i { color:var(--danger); margin-left:2px; font-style:normal; }
    .ta { border:0; outline:0; padding:12px 14px; background:var(--surface-muted); border-radius:var(--r-field);
      box-shadow:var(--shadow-clay-inset); font:400 17px var(--font-sans); color:var(--content-fg); resize:vertical; }
    .linked { margin:16px 0 0; padding:10px 14px; background:var(--info-bg); color:var(--info);
      border-radius:var(--r-field); font:500 16px var(--font-sans); }
    .actions { display:flex; justify-content:flex-end; gap:12px; }
    @media (max-width:720px) { .grid { grid-template-columns:1fr; } }
  `]
})
export class TicketCreate implements OnInit {
  private readonly service = inject(TicketService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly saving = signal(false);
  readonly categoryOptions = signal<SelectOption[]>([]);
  readonly subCategoryOptions = signal<SelectOption[]>([]);
  readonly branchOptions = signal<SelectOption[]>([]);
  readonly fileName = signal<string | null>(null);
  private file: File | null = null;

  shipmentId: string | null = null;
  customerId: string | null = null;

  readonly subjectControl = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(200)] });
  readonly descriptionControl = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(5000)] });
  readonly categoryControl = new FormControl<string | null>(null, Validators.required);
  readonly subCategoryControl = new FormControl<string | null>(null);
  readonly priorityControl = new FormControl<TicketPriority>('MEDIUM', { nonNullable: true });
  readonly branchControl = new FormControl<string | null>(null);

  readonly priorityOptions = PRIORITY_OPTIONS;

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Support' }, { label: 'Tickets', route: '/support/tickets' }, { label: 'New' }]);

    const params = this.route.snapshot.queryParamMap;
    this.shipmentId = params.get('shipmentId');
    this.customerId = params.get('customerId');
    const branchId = params.get('branchId');

    this.service.categories().subscribe((cats) =>
      this.categoryOptions.set(cats.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))));
    this.masters.branchDirectory().subscribe((branches) => {
      this.branchOptions.set(branches.map((b) => ({ value: b.id, label: `${b.branchName} (${b.branchCode})` })));
      if (branchId) this.branchControl.setValue(branchId);
    });

    this.categoryControl.valueChanges.subscribe((categoryId) => {
      this.subCategoryControl.setValue(null);
      this.subCategoryOptions.set([]);
      if (!categoryId) return;
      this.service.subCategories(categoryId).subscribe((subs) =>
        this.subCategoryOptions.set(subs.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))));
    });
  }

  canSubmit(): boolean {
    return this.subjectControl.valid && this.descriptionControl.valid && this.categoryControl.valid;
  }

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.file = input.files?.[0] ?? null;
    this.fileName.set(this.file?.name ?? null);
  }

  submit(): void {
    if (!this.canSubmit()) return;
    this.saving.set(true);
    this.service.create({
      subject: this.subjectControl.value.trim(),
      description: this.descriptionControl.value.trim(),
      categoryId: this.categoryControl.value!,
      subCategoryId: this.subCategoryControl.value,
      priority: this.priorityControl.value,
      relatedShipmentId: this.shipmentId,
      relatedCustomerId: this.customerId,
      relatedBranchId: this.branchControl.value
    }).subscribe({
      next: (ticket) => {
        this.notify.success(`Ticket ${ticket.ticketNumber} raised.`);
        if (this.file) {
          // Fire-and-forget, same as the Shipment Booking image upload: a failed
          // attachment never blocks the ticket itself, which already exists.
          this.service.uploadAttachment(ticket.id, this.file).subscribe({ error: () => this.notify.error('Ticket raised, but the attachment failed to upload.') });
        }
        this.saving.set(false);
        this.router.navigate(['/support/tickets', ticket.id]);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.notify.error(err.error?.message ?? 'Could not raise the ticket.');
      }
    });
  }

  cancel(): void { this.router.navigate(['/support/tickets']); }
}
