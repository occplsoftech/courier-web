import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PodService } from '@core/services/pod.service';
import { BulkPodUploadRow } from '@core/models/pod.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { PinIllustration } from '@shared/components/illustrations/pin-illustration';

/**
 * Bulk POD Upload — COMPANY_ADMIN only. Drop in a batch of scanned/collected POD photos with
 * no shipment picked in advance: each one is read by the AI provider for real (the shipment/
 * AWB number actually printed or written on it, plus signature/stamp presence — a genuine
 * content check, not the structural-only score `HeuristicPodVerificationProvider` runs), then
 * auto-matched against this company's own shipments via the same lookup Bulk Shipment
 * Tracking uses. A match against an OUT_FOR_DELIVERY/DELIVERED shipment is scored and stored
 * PENDING exactly like the single-shipment Delivery flow — a human still approves/rejects it
 * on the POD Review screen. A photo that can't be read, or matches none/more than one
 * shipment, is reported back unmatched rather than guessed at.
 *
 * See PodVerificationController.bulkUpload / MEMORY/modules/pod-verification.md.
 */
@Component({
  selector: 'app-pod-bulk-upload',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, UiCard, UiButton, UiLoader, PinIllustration],
  template: `
    <div class="page">
      <header class="page__head">
        <div class="page__head-row">
          <app-pin-illustration class="page__head-ill" [size]="52" />
          <div><h1 class="text-h1">Bulk POD Upload</h1>
          <p class="text-caption">Upload many POD photos at once — each is auto-matched to its shipment and AI-scored for real. A human still reviews every result on POD Review.</p></div>
        </div>
      </header>

      <app-card title="Choose Files">
        <div class="drop" [class.drop--over]="dragOver()"
          (dragover)="onDragOver($event)" (dragleave)="dragOver.set(false)" (drop)="onDrop($event)">
          <mat-icon>cloud_upload</mat-icon>
          <p>Drag &amp; drop POD photos here, or</p>
          <button type="button" class="pod__btn" (click)="fileInput.click()">Choose Files</button>
          <input #fileInput type="file" accept="image/*" multiple hidden (change)="onFiles($event)" />
          <p class="text-caption">Up to 50 images per batch — JPG/PNG.</p>
        </div>

        @if (files().length) {
          <ul class="picked">
            @for (f of files(); track f.name + f.size; let i = $index) {
              <li>
                <mat-icon>image</mat-icon>
                <span class="picked__name">{{ f.name }}</span>
                <span class="text-caption">{{ sizeOf(f) }}</span>
                <button type="button" class="picked__remove" (click)="remove(i)"><mat-icon>close</mat-icon></button>
              </li>
            }
          </ul>
          <div class="df__bar">
            <app-button variant="stroked" icon="clear_all" [disabled]="uploading()" (pressed)="clear()">Clear</app-button>
            <app-button icon="cloud_upload" [loading]="uploading()" [disabled]="!files().length"
              (pressed)="upload()">Upload &amp; Score {{ files().length }} File(s)</app-button>
          </div>
        }
        @if (uploading()) { <app-loader [minHeight]="80" caption="Reading and matching each photo…" /> }
      </app-card>

      @if (results().length) {
        <app-card title="Results">
          <p class="text-caption result-summary">{{ matchedCount() }} of {{ results().length }} matched and queued for review.</p>
          <div class="tbl__wrap">
            <table class="tbl">
              <thead>
                <tr><th>File</th><th>Status</th><th>Detected No.</th><th>Matched Shipment</th><th>Score</th><th>Signature</th><th>Stamp</th><th>Detail</th></tr>
              </thead>
              <tbody>
                @for (row of results(); track row.filename) {
                  <tr>
                    <td>{{ row.filename || '—' }}</td>
                    <td><span class="chip" [class]="'chip--' + row.matchStatus.toLowerCase()">{{ row.matchStatus }}</span></td>
                    <td>{{ row.detectedShipmentNumber || row.detectedAwb || '—' }}</td>
                    <td>{{ row.shipmentNumber || '—' }}</td>
                    <td>{{ row.verification ? row.verification.verificationScore : '—' }}</td>
                    <td>{{ row.verification ? (row.verification.signatureDetected ? 'Yes' : 'No') : '—' }}</td>
                    <td>{{ row.verification ? (row.verification.stampDetected ? 'Yes' : 'No') : '—' }}</td>
                    <td class="tbl__msg">{{ row.message }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </app-card>
      }
    </div>
  `,
  styles: [`
    .page__head-row { display:flex; align-items:center; gap:14px; }
    .drop { display:flex; flex-direction:column; align-items:center; gap:6px; padding:32px 16px;
      border:1px dashed var(--surface-border); border-radius:var(--r-field); background:var(--surface-muted);
      text-align:center; transition:border-color .15s ease; }
    .drop--over { border-color:var(--brand); }
    .drop mat-icon { font-size:32px; width:32px; height:32px; color:var(--content-muted); }
    .pod__btn { display:inline-flex; align-items:center; gap:8px; padding:8px 16px; border-radius:var(--r-field);
      border:1px solid var(--surface-border); background:var(--surface); cursor:pointer;
      font:600 16px var(--font-sans); color:var(--content-fg); }
    .picked { list-style:none; margin:16px 0 0; padding:0; display:flex; flex-direction:column; gap:6px; }
    .picked li { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:var(--r-field); background:var(--surface-muted); }
    .picked li mat-icon { font-size:18px; width:18px; height:18px; color:var(--content-muted); }
    .picked__name { flex:1; font:500 16px var(--font-sans); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .picked__remove { border:none; background:none; cursor:pointer; display:flex; color:var(--content-muted); }
    .picked__remove mat-icon { font-size:16px; width:16px; height:16px; }
    .df__bar { display:flex; justify-content:flex-end; gap:10px; margin-top:16px; }
    .result-summary { margin:0 0 12px; }
    .tbl { width:100%; border-collapse:collapse; font:400 16px var(--font-sans); }
    .tbl th { text-align:left; padding:10px 14px; background:var(--surface-muted); color:var(--content-muted); font:600 14px var(--font-sans); text-transform:uppercase; letter-spacing:.03em; white-space:nowrap; }
    .tbl td { padding:10px 14px; border-top:1px solid var(--surface-border); }
    .tbl__msg { color:var(--content-muted); font-size:15px; max-width:280px; white-space:normal; }
    .tbl__wrap { overflow-x:auto; }
    .chip { display:inline-block; padding:2px 10px; border-radius:999px; font:600 14px var(--font-sans); text-transform:uppercase; letter-spacing:.02em; }
    .chip--matched { background:color-mix(in srgb, var(--success) 15%, transparent); color:var(--success); }
    .chip--no_match, .chip--error { background:color-mix(in srgb, var(--danger) 15%, transparent); color:var(--danger); }
    .chip--ambiguous, .chip--invalid_status { background:color-mix(in srgb, var(--warning) 18%, transparent); color:var(--warning); }
  `]
})
export class PodBulkUpload {
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly podService = inject(PodService);

  private static readonly MAX_FILES = 50;

  readonly files = signal<File[]>([]);
  readonly dragOver = signal(false);
  readonly uploading = signal(false);
  readonly results = signal<BulkPodUploadRow[]>([]);

  constructor() {
    this.breadcrumb.set([{ label: 'Operations' }, { label: 'Bulk POD Upload' }]);
  }

  matchedCount(): number {
    return this.results().filter((r) => r.matchStatus === 'MATCHED').length;
  }

  sizeOf(f: File): string {
    return f.size > 1024 * 1024 ? `${(f.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(f.size / 1024)} KB`;
  }

  onFiles(event: Event): void {
    const picked = Array.from((event.target as HTMLInputElement).files ?? []);
    this.addFiles(picked);
    (event.target as HTMLInputElement).value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    this.addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  private addFiles(picked: File[]): void {
    const images = picked.filter((f) => f.type.startsWith('image/'));
    const merged = [...this.files(), ...images].slice(0, PodBulkUpload.MAX_FILES);
    this.files.set(merged);
    if (picked.length > images.length) this.notify.error('Only image files are accepted.');
  }

  remove(index: number): void {
    this.files.set(this.files().filter((_, i) => i !== index));
  }

  clear(): void {
    this.files.set([]);
    this.results.set([]);
  }

  upload(): void {
    if (!this.files().length) return;
    this.uploading.set(true);
    this.podService.bulkUpload(this.files()).subscribe({
      next: (rows) => {
        this.uploading.set(false);
        this.results.set(rows);
        this.files.set([]);
        const matched = rows.filter((r) => r.matchStatus === 'MATCHED').length;
        this.notify.success(`${matched} of ${rows.length} matched and queued for review.`);
      },
      error: (e: HttpErrorResponse) => {
        this.uploading.set(false);
        this.notify.error(e.error?.message ?? 'Could not upload this batch.');
      }
    });
  }
}
