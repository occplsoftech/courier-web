import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { ShipmentDocument, ShipmentDocumentType, SHIPMENT_DOCUMENT_TYPES } from '@core/models/shipment.model';
import { ShipmentService } from './shipment.service';

const WRITERS = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER, AppRole.BOOKING_OPERATOR];

const TYPE_OPTIONS: SelectOption[] = SHIPMENT_DOCUMENT_TYPES.map((t) => ({
  value: t, label: t.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}));

const ICONS: Record<string, string> = {
  INVOICE: 'receipt_long', EWAY_BILL: 'local_shipping', PACKING_LIST: 'inventory_2',
  LR_COPY: 'description', POD: 'fact_check'
};

/**
 * Shipment Documents — Invoice, E-Way Bill, Packing List, LR Copy, Proof Of Delivery.
 * There is no file-storage backend in this project yet, so uploading is attaching a
 * reference to a document already hosted elsewhere — the same honesty note
 * `features/company`'s `CompanyLogo` carries. GET/POST /shipments/{id}/documents.
 */
@Component({
  selector: 'app-shipment-documents',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, ReactiveFormsModule, MatIconModule, UiCard, UiLoader, UiButton, UiSelect, UiInput],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Shipment Documents</h1>
          <p class="text-caption"><a [routerLink]="['/shipments', id]">← Back to shipment</a></p></div>
        <div class="page__actions">
          @if (canUpload()) { <app-button icon="upload_file" (pressed)="formOpen.set(!formOpen())">Attach Document</app-button> }
        </div>
      </header>

      @if (formOpen()) {
        <app-card title="Attach a Document" subtitle="A reference to a document already hosted elsewhere — there is no file upload yet.">
          <form [formGroup]="form" (ngSubmit)="submit()" class="df">
            <div class="grid3">
              <app-select [control]="c('documentType')" label="Document Type" [options]="typeOptions" placeholder="Select a type" />
              <app-input [control]="c('documentName')" label="Document Name" placeholder="Invoice-2607.pdf" [required]="true" [maxLength]="255" />
              <app-input [control]="c('documentUrl')" label="Document URL" placeholder="https://…" [required]="true" [maxLength]="1000" />
            </div>
            <app-input [control]="c('remarks')" label="Remarks" placeholder="Optional" [maxLength]="500" />
            <div class="df__bar">
              <app-button variant="stroked" type="button" (pressed)="formOpen.set(false)">Cancel</app-button>
              <app-button type="submit" icon="upload_file" [loading]="uploading()">Attach</app-button>
            </div>
          </form>
        </app-card>
      }

      @if (loading()) {
        <app-loader [minHeight]="200" caption="Loading…" />
      } @else if (!documents().length) {
        <app-card><p class="empty">No documents attached to this shipment yet.</p></app-card>
      } @else {
        <div class="dl">
          @for (d of documents(); track d.id) {
            <div class="dl__row">
              <div class="dl__icon"><mat-icon>{{ icon(d.documentType) }}</mat-icon></div>
              <div class="dl__body">
                <div class="dl__head">
                  <strong>{{ d.documentName }}</strong>
                  <span class="chip">{{ pretty(d.documentType) }}</span>
                </div>
                <p class="dl__meta">Added {{ d.createdDate | date: 'medium' }}@if (d.remarks) { — {{ d.remarks }} }</p>
              </div>
              <a class="dl__open" [href]="d.documentUrl" target="_blank" rel="noopener"><mat-icon>open_in_new</mat-icon></a>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .df { display:flex; flex-direction:column; gap:16px; }
    .grid3 { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px 20px; }
    .df__bar { display:flex; justify-content:flex-end; gap:10px; }
    .dl { display:flex; flex-direction:column; gap:10px; }
    .dl__row { display:flex; gap:14px; align-items:center; padding:12px 14px; border:1px solid var(--surface-border); border-radius:var(--r-field); background:var(--surface); }
    .dl__icon { width:36px; height:36px; border-radius:10px; background:var(--surface-muted); color:var(--content-muted); display:grid; place-items:center; flex:0 0 auto; }
    .dl__body { flex:1; min-width:0; }
    .dl__head { display:flex; align-items:center; gap:8px; }
    .dl__head strong { font:600 17px var(--font-sans); color:var(--content-fg); }
    .chip { font:600 13px var(--font-sans); padding:2px 8px; border-radius:999px; background:var(--brand-50); color:var(--brand-700); }
    .dl__meta { margin:2px 0 0; font:400 15px var(--font-sans); color:var(--content-muted); }
    .dl__open { color:var(--content-muted); display:flex; flex:0 0 auto; }
    .dl__open:hover { color:var(--brand-600); }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
    @media (max-width:760px){ .grid3 { grid-template-columns:1fr; } }
  `]
})
export class ShipmentDocuments implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(ShipmentService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly route = inject(ActivatedRoute);

  protected readonly typeOptions = TYPE_OPTIONS;

  readonly loading = signal(true);
  readonly uploading = signal(false);
  readonly formOpen = signal(false);
  readonly documents = signal<ShipmentDocument[]>([]);
  readonly canUpload = computed(() => this.perms.canAccess({ roles: WRITERS, permissions: ['SHIPMENT_UPLOAD'] }));
  id = '';

  protected readonly form: FormGroup = this.fb.group({
    documentType: [null as string | null, Validators.required],
    documentName: ['', [Validators.required, Validators.maxLength(255)]],
    documentUrl: ['', [Validators.required, Validators.maxLength(1000)]],
    remarks: ['', Validators.maxLength(500)]
  });

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.breadcrumb.set([{ label: 'Shipments', route: '/shipments' }, { label: 'Documents' }]);
    this.load();
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  private load(): void {
    this.loading.set(true);
    this.service.documents(this.id).subscribe({
      next: (d) => { this.documents.set(d); this.loading.set(false); },
      error: () => { this.documents.set([]); this.loading.set(false); }
    });
  }

  submit(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();
    this.uploading.set(true);
    this.service.addDocument(this.id, {
      documentType: v.documentType as ShipmentDocumentType, documentName: v.documentName.trim(),
      documentUrl: v.documentUrl.trim(), remarks: v.remarks?.trim() || null
    }).subscribe({
      next: () => {
        this.uploading.set(false);
        this.notify.success('Document attached.');
        this.form.reset();
        this.formOpen.set(false);
        this.load();
      },
      error: (err: HttpErrorResponse) => {
        this.uploading.set(false);
        this.notify.error(err.error?.message ?? 'Could not attach the document.');
      }
    });
  }

  icon(type: string): string { return ICONS[type] ?? 'description'; }
  pretty(v: string): string { return v.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' '); }
}
