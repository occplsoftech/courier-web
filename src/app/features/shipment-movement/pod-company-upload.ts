import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { ShipmentService } from '@features/shipment/shipment.service';
import { ShipmentResponse } from '@core/models/shipment.model';
import { PodService } from '@core/services/pod.service';
import { PodVerification } from '@core/models/pod.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { PinIllustration } from '@shared/components/illustrations/pin-illustration';

/**
 * Company-level POD upload — COMPANY_ADMIN only, no branch login/delivery-assignment
 * context required. Looks a shipment up by tracking/shipment number (the same `GET
 * /shipments/track/{trackingNumber}` the public Track Shipment page uses), then uploads a
 * POD for it directly via `PodService.uploadByCompany`, which is always auto-approved
 * server-side (no AI call, no PENDING step) — the company vouching for it directly, on
 * direct user request ("if uploaded by company then it should be direct approved").
 */
@Component({
  selector: 'app-pod-company-upload',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatIconModule, UiCard, UiButton, UiInput, UiLoader, UiSelect, PinIllustration],
  template: `
    <div class="page">
      <header class="page__head">
        <div class="page__head-row">
          <app-pin-illustration class="page__head-ill" [size]="52" />
          <div><h1 class="text-h1">Upload POD (Company)</h1>
          <p class="text-caption">Upload a proof of delivery for any of the company's shipments — no branch login needed. Auto-approved.</p></div>
        </div>
      </header>

      @if (!shipment()) {
        <app-card title="Find Shipment">
          <form [formGroup]="searchForm" class="df" (ngSubmit)="find()">
            <app-input [control]="sc('query')" label="Tracking No. / Shipment No." [required]="true" />
            <div class="df__bar">
              <app-button icon="search" type="submit" [loading]="searching()" [disabled]="searchForm.invalid">Find</app-button>
            </div>
          </form>
        </app-card>
        @if (searching()) { <app-loader [minHeight]="80" caption="Looking up…" /> }
      }

      @if (shipment(); as s) {
        <app-card>
          <div class="sh">
            <div><strong>{{ s.shipmentNumber }}</strong>
              <span class="text-caption">{{ s.senderName }} → {{ s.receiverName }} · {{ s.status }}</span></div>
            <app-button variant="stroked" icon="close" (pressed)="reset()">Back to Search</app-button>
          </div>
        </app-card>

        @if (result(); as r) {
          <app-card title="Uploaded">
            <div class="ok">
              <mat-icon>check_circle</mat-icon>
              <p>POD uploaded and auto-approved — status <strong>{{ r.verificationStatus }}</strong>.</p>
            </div>
            @if (r.deliveryDate || r.deliveredBy || r.podDate || r.podTime || r.entryStatus || r.remark) {
              <dl class="reg">
                @if (r.deliveryDate) { <div><dt>Delivery Date</dt><dd>{{ r.deliveryDate }}</dd></div> }
                @if (r.deliveredBy) { <div><dt>Delivered By</dt><dd>{{ r.deliveredBy }}</dd></div> }
                @if (r.podDate) { <div><dt>POD Date</dt><dd>{{ r.podDate }}</dd></div> }
                @if (r.podTime) { <div><dt>POD Time</dt><dd>{{ r.podTime }}</dd></div> }
                @if (r.entryStatus) { <div><dt>Status</dt><dd>{{ r.entryStatus }}</dd></div> }
                @if (r.remark) { <div><dt>Remark</dt><dd>{{ r.remark }}</dd></div> }
              </dl>
            }
            <app-button variant="stroked" icon="upload_file" (pressed)="reset()">Upload Another</app-button>
          </app-card>
        } @else {
          <app-card title="Upload POD">
            <form [formGroup]="form" class="df">
              <app-input [control]="c('receiverName')" label="Receiver Name" [required]="true" [maxLength]="150" />
              <div class="grid2">
                <app-input [control]="c('deliveryDate')" type="date" label="Delivery Date" />
                <app-input [control]="c('deliveredBy')" label="Delivered By" [maxLength]="150" />
                <app-input [control]="c('podDate')" type="date" label="POD Date" />
                <app-input [control]="c('podTime')" type="time" label="POD Time" />
                <app-select [control]="c('status')" label="Status" [options]="statusOptions" [allowEmpty]="true" emptyLabel="—" />
              </div>
              <app-input [control]="c('remark')" label="Remark" [maxLength]="1000" />
              <div class="pod-row">
                <div class="pod">
                  <span class="pod__label">Photo <em>required</em></span>
                  <button type="button" class="pod__btn" (click)="photoFile.click()">
                    <mat-icon>photo_camera</mat-icon> {{ photo() ? photo()!.name : 'Choose file' }}
                  </button>
                  <input #photoFile type="file" accept="image/*" hidden (change)="onFile($event, 'photo')" />
                </div>
                <div class="pod">
                  <span class="pod__label">Signature <em>optional</em></span>
                  <button type="button" class="pod__btn" (click)="signatureFile.click()">
                    <mat-icon>draw</mat-icon> {{ signature() ? signature()!.name : 'Choose file' }}
                  </button>
                  <input #signatureFile type="file" accept="image/*" hidden (change)="onFile($event, 'signature')" />
                </div>
              </div>
              <div class="df__bar">
                <app-button icon="cloud_upload" [loading]="uploading()"
                  [disabled]="!photo() || form.invalid" (pressed)="upload()">Upload & Approve</app-button>
              </div>
            </form>
          </app-card>
        }
      }
    </div>
  `,
  styles: [`
    .page__head-row { display:flex; align-items:center; gap:14px; }
    .df { display:flex; flex-direction:column; gap:16px; }
    .df__bar { display:flex; justify-content:flex-end; gap:10px; }
    .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px 20px; }
    @media (max-width:760px){ .grid2 { grid-template-columns:1fr; } }
    .sh { display:flex; justify-content:space-between; align-items:center; gap:12px; }
    .sh strong { display:block; font:600 18px var(--font-sans); }
    .pod-row { display:flex; gap:16px; flex-wrap:wrap; }
    .pod { display:flex; flex-direction:column; gap:6px; }
    .pod__label { font:600 14px var(--font-sans); color:var(--content-muted); text-transform:uppercase; letter-spacing:.03em; }
    .pod__label em { color:var(--danger); font-style:normal; }
    .pod__btn { display:inline-flex; align-items:center; gap:8px; padding:10px 16px; border-radius:var(--r-field);
      border:1px dashed var(--surface-border); background:var(--surface-muted); cursor:pointer;
      font:600 16px var(--font-sans); color:var(--content-fg); }
    .ok { display:flex; align-items:center; gap:12px; padding:8px 0 16px; }
    .ok mat-icon { font-size:32px; width:32px; height:32px; color:var(--success); }
    .reg { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px 16px; margin:0 0 16px; }
    .reg dt { font:600 14px var(--font-sans); color:var(--content-muted); text-transform:uppercase; letter-spacing:.03em; }
    .reg dd { margin:2px 0 0; font:500 16px var(--font-sans); }
  `]
})
export class PodCompanyUpload {
  private readonly fb = inject(FormBuilder);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly shipmentService = inject(ShipmentService);
  private readonly podService = inject(PodService);

  readonly searchForm: FormGroup = this.fb.group({
    query: ['', Validators.required]
  });
  readonly searching = signal(false);
  readonly shipment = signal<ShipmentResponse | null>(null);

  readonly form: FormGroup = this.fb.group({
    receiverName: ['', [Validators.required, Validators.maxLength(150)]],
    deliveryDate: [''],
    deliveredBy: ['', Validators.maxLength(150)],
    podDate: [''],
    podTime: [''],
    status: [null],
    remark: ['', Validators.maxLength(1000)]
  });

  readonly statusOptions: SelectOption[] = [
    { value: 'DELIVERED', label: 'Delivered' },
    { value: 'NOT_DELIVERED', label: 'Not Delivered' },
    { value: 'RETURNED', label: 'Returned' },
    { value: 'RTO', label: 'RTO' }
  ];

  readonly photo = signal<File | null>(null);
  readonly signature = signal<File | null>(null);
  readonly uploading = signal(false);
  readonly result = signal<PodVerification | null>(null);

  constructor() {
    this.breadcrumb.set([{ label: 'Operations' }, { label: 'Upload POD (Company)' }]);
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }
  protected sc(name: string): FormControl { return this.searchForm.get(name) as FormControl; }

  find(): void {
    if (this.searchForm.invalid) return;
    const number = (this.sc('query').value as string).trim();
    if (!number) return;
    this.searching.set(true);
    this.shipmentService.getByTrackingNumber(number).subscribe({
      next: (s) => {
        this.searching.set(false);
        if (s.status !== 'OUT_FOR_DELIVERY' && s.status !== 'DELIVERED') {
          this.notify.error(`${s.shipmentNumber} is ${s.status} — a company POD upload only applies to an OUT_FOR_DELIVERY or DELIVERED shipment.`);
          return;
        }
        this.shipment.set(s);
        this.form.patchValue({ receiverName: s.receiverName });
      },
      error: (e: HttpErrorResponse) => {
        this.searching.set(false);
        this.notify.error(e.error?.message ?? 'No shipment found for that number.');
      }
    });
  }

  onFile(event: Event, kind: 'photo' | 'signature'): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    if (kind === 'photo') this.photo.set(file); else this.signature.set(file);
  }

  upload(): void {
    const s = this.shipment();
    const photo = this.photo();
    if (!s || !photo || this.form.invalid) return;
    this.uploading.set(true);
    const v = this.form.getRawValue();
    this.podService.uploadByCompany(s.id, {
      photo, signature: this.signature(), receiverName: v.receiverName.trim(),
      deliveryDate: v.deliveryDate || null, deliveredBy: v.deliveredBy?.trim() || null,
      podDate: v.podDate || null, podTime: v.podTime || null,
      status: v.status || null, remark: v.remark?.trim() || null
    }).subscribe({
      next: (r) => {
        this.uploading.set(false);
        this.result.set(r);
        this.notify.success('POD uploaded and auto-approved.');
      },
      error: (e: HttpErrorResponse) => {
        this.uploading.set(false);
        this.notify.error(e.error?.message ?? 'Could not upload the POD.');
      }
    });
  }

  reset(): void {
    this.shipment.set(null);
    this.result.set(null);
    this.photo.set(null);
    this.signature.set(null);
    this.searchForm.reset();
    this.form.reset();
  }
}
