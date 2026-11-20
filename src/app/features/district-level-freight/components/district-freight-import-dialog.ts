import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { NotificationService } from '@core/services/notification.service';
import { ImportSummaryResponse } from '@core/models/district-level-freight.model';
import { DistrictLevelFreightService } from '../district-level-freight.service';

type Stage = 'pick' | 'previewing' | 'previewed' | 'importing' | 'imported';

/**
 * Excel import: pick a file, preview it (parses + validates, writes nothing), then commit.
 * Expected columns: From Station, District, 1KG TO 15 KG, 16 KG TO 50KG, 51 KG TO 100 KG,
 * 101 KG TO 1000 KG, 1001 KG TO 1500 KG, 1501 KG TO 2000KG. Blank rows and the ODA note row
 * are ignored by the backend, not reported here. An existing From Station + District
 * combination is updated (upsert), never rejected as a duplicate — only a combination
 * repeated within the file itself is an error.
 */
@Component({
  selector: 'app-district-freight-import-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatIconModule, UiButton],
  template: `
    <div class="imp">
      <h2 class="text-h2">Import District Level Freight</h2>
      <p class="text-caption">Columns: From Station, District, and the six weight-slab rate columns. Blank rows and the ODA note row are ignored automatically.</p>

      @if (stage() === 'pick' || stage() === 'previewing') {
        <div class="picker">
          <button type="button" class="picker__btn" (click)="fileInput.click()">
            <mat-icon>upload_file</mat-icon> {{ file() ? file()!.name : 'Choose Excel file (.xlsx)' }}
          </button>
          <input #fileInput type="file" accept=".xlsx,.xls" hidden (change)="onFile($event)" />
        </div>
      }

      @if (summary(); as s) {
        <div class="summary">
          <span class="chip">Rows: {{ s.totalDataRows }}</span>
          <span class="chip chip--ok">Succeeded: {{ s.succeeded }}</span>
          <span class="chip chip--err">Failed: {{ s.failed }}</span>
          <span class="chip">{{ s.dryRun ? 'Preview (nothing saved yet)' : 'Committed' }}</span>
        </div>
        <div class="rows app-scroll">
          <table class="rtbl">
            <thead><tr><th>Row</th><th>From Station</th><th>District</th><th>Outcome</th><th>Message</th></tr></thead>
            <tbody>
              @for (r of s.rows; track r.rowNumber) {
                <tr [class.err]="r.outcome === 'ERROR'">
                  <td>{{ r.rowNumber }}</td>
                  <td>{{ r.fromStation }}</td>
                  <td>{{ r.district }}</td>
                  <td>{{ r.outcome }}</td>
                  <td>{{ r.message || '—' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <div class="imp__actions">
        <app-button variant="stroked" (pressed)="close()">{{ stage() === 'imported' ? 'Done' : 'Cancel' }}</app-button>
        @if (stage() === 'pick' || stage() === 'previewing') {
          <app-button icon="visibility" [disabled]="!file()" [loading]="stage() === 'previewing'" (pressed)="preview()">Preview</app-button>
        }
        @if (stage() === 'previewed') {
          <app-button icon="cloud_upload" [disabled]="!summary() || summary()!.totalDataRows === 0" [loading]="stage() === 'importing'" (pressed)="commit()">Import</app-button>
        }
      </div>
    </div>
  `,
  styles: [`
    /* MatDialog's own .mdc-dialog__surface caps at max-width:560px (Angular Material
       default, not overridden globally) — this must fit inside that, or the surface's
       own overflow-x:auto silently clips the action bar with no visible scrollbar. */
    .imp { padding:24px; width:512px; max-width:90vw; box-sizing:border-box; display:flex; flex-direction:column; gap:14px; }
    .picker { display:flex; }
    .picker__btn { display:flex; align-items:center; gap:8px; height:44px; padding:0 16px;
      border:1px dashed var(--surface-border); border-radius:var(--r-field); background:var(--surface);
      color:var(--content-fg); font:500 17px var(--font-sans); cursor:pointer; }
    .picker__btn:hover { border-color:var(--brand-500); }
    .summary { display:flex; gap:8px; flex-wrap:wrap; }
    .chip { display:inline-flex; align-items:center; height:26px; padding:0 10px; border-radius:999px;
      background:var(--surface-muted); font:600 15px var(--font-sans); color:var(--content-fg); }
    .chip--ok { background:var(--success-bg); color:var(--success); }
    .chip--err { background:var(--danger-bg); color:var(--danger); }
    .rows { max-height:320px; overflow:auto; border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .rtbl { width:100%; table-layout:fixed; border-collapse:collapse; font:400 16px var(--font-sans); }
    .rtbl th { position:sticky; top:0; text-align:left; padding:8px 10px; background:var(--surface-muted); font:600 15px var(--font-sans); }
    .rtbl td { padding:6px 10px; border-top:1px solid var(--surface-border); word-break:break-word; }
    .rtbl tr.err td { background:var(--danger-bg); color:var(--danger); }
    .imp__actions { display:flex; justify-content:flex-end; gap:10px; }
  `]
})
export class DistrictFreightImportDialog {
  readonly ref = inject(MatDialogRef<DistrictFreightImportDialog>);
  private readonly service = inject(DistrictLevelFreightService);
  private readonly notify = inject(NotificationService);

  readonly stage = signal<Stage>('pick');
  readonly file = signal<File | null>(null);
  readonly summary = signal<ImportSummaryResponse | null>(null);

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.file.set(input.files?.[0] ?? null);
    this.summary.set(null);
  }

  preview(): void {
    const file = this.file();
    if (!file) return;
    this.stage.set('previewing');
    this.service.previewImport(file).subscribe({
      next: (s) => { this.summary.set(s); this.stage.set('previewed'); },
      error: (e: HttpErrorResponse) => {
        this.stage.set('pick');
        this.notify.error(e?.error?.message ?? 'Could not parse the file.');
      }
    });
  }

  commit(): void {
    const file = this.file();
    if (!file) return;
    this.stage.set('importing');
    this.service.commitImport(file).subscribe({
      next: (s) => {
        this.summary.set(s);
        this.stage.set('imported');
        this.notify.success(`Import complete: ${s.succeeded} succeeded, ${s.failed} failed.`);
      },
      error: (e: HttpErrorResponse) => {
        this.stage.set('previewed');
        this.notify.error(e?.error?.message ?? 'Import failed.');
      }
    });
  }

  close(): void {
    this.ref.close(this.stage() === 'imported' && (this.summary()?.succeeded ?? 0) > 0);
  }
}
