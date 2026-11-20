import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { AuthService } from '@core/auth/auth.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { FreightFactor } from '@core/models/freight-factor.model';
import { FreightFactorService } from './freight-factor.service';
import { FreightFactorFormDialog } from './components/freight-factor-form-dialog';

/**
 * Freight Factor: a standalone, company-level distance x weight pricing grid,
 * independent of Rate Master (see MEMORY/modules/freight-factor.md). The grid table —
 * a new cell is added inline, as an editable row in the table itself, not a popup
 * dialog (direct request); editing an existing cell still uses the dialog
 * (`FreightFactorFormDialog`, untouched — out of scope for this request). Its own
 * Calculate card moved to the Rate Master Calculator page as a tab. No routed
 * create/edit/view pages — proportionate to a 5-field entity, unlike Rate Master's
 * wizard.
 */
@Component({
  selector: 'app-freight-factor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, ReactiveFormsModule, UiCard, UiButton, StatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">Freight Factor</h1>
          <p class="text-caption">Company distance x weight pricing grid. Freight = matched factor x weight.</p>
        </div>
      </header>

      <app-card title="Freight Factor Grid" subtitle="Distance range x weight range -> factor.">
        @if (canWrite() && !adding()) {
          <div card-actions>
            <app-button icon="add" variant="stroked" (pressed)="startAdd()">Add Cell</app-button>
          </div>
        }

        @if (loading()) {
          <p class="text-caption">Loading…</p>
        } @else if (rows().length === 0 && !adding()) {
          <p class="text-caption">No freight factor cells yet.</p>
        } @else {
          <table class="tbl">
            <thead>
              <tr>
                <th>#</th><th>From (km)</th><th>To (km)</th><th>From (kg)</th><th>To (kg)</th><th>Factor</th><th>Status</th>
                @if (canWrite()) { <th></th> }
              </tr>
            </thead>
            <tbody [formGroup]="addForm">
              @if (adding()) {
                <tr class="tbl__row--edit">
                  <td class="text-caption">—</td>
                  <td><input class="tbl__input" type="number" step="0.001" min="0" formControlName="fromKm" placeholder="0" /></td>
                  <td><input class="tbl__input" type="number" step="0.001" min="0" formControlName="toKm" placeholder="100" /></td>
                  <td><input class="tbl__input" type="number" step="0.001" min="0" formControlName="fromWeight" placeholder="0" /></td>
                  <td><input class="tbl__input" type="number" step="0.001" min="0" formControlName="toWeight" placeholder="10" /></td>
                  <td><input class="tbl__input" type="number" step="0.01" min="0" formControlName="factor" placeholder="12.50" /></td>
                  <td class="text-caption">—</td>
                  <td class="tbl__actions">
                    <app-button variant="text" icon="close" [disabled]="addBusy()" (pressed)="cancelAdd()">Cancel</app-button>
                    <app-button variant="text" icon="save" [loading]="addBusy()" (pressed)="saveAdd()">Save</app-button>
                  </td>
                </tr>
                @if (addError()) {
                  <tr><td colspan="8" class="tbl__err">{{ addError() }}</td></tr>
                }
              }
              @for (row of rows(); track row.id; let i = $index) {
                <tr>
                  <td>{{ i + 1 }}</td>
                  <td class="mono">{{ row.fromKm | number: '1.0-3' }}</td>
                  <td class="mono">{{ row.toKm | number: '1.0-3' }}</td>
                  <td class="mono">{{ row.fromWeight | number: '1.0-3' }}</td>
                  <td class="mono">{{ row.toWeight | number: '1.0-3' }}</td>
                  <td class="mono">{{ row.factor | number: '1.2-4' }}</td>
                  <td><app-status-badge [value]="row.status" /></td>
                  @if (canWrite()) {
                    <td class="tbl__actions">
                      <app-button variant="text" icon="edit" [loading]="busyRowId() === row.id" (pressed)="openEdit(row)">Edit</app-button>
                      @if (row.status === 'ACTIVE') {
                        <app-button variant="text" icon="block" [loading]="busyRowId() === row.id" (pressed)="deactivateRow(row)">Deactivate</app-button>
                      } @else {
                        <app-button variant="text" icon="check_circle" [loading]="busyRowId() === row.id" (pressed)="activateRow(row)">Activate</app-button>
                      }
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        }
      </app-card>
    </div>
  `,
  styles: [`
    .page { display:flex; flex-direction:column; gap:20px; }
    .page__head { display:flex; align-items:flex-start; justify-content:space-between; }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .tbl { width:100%; border-collapse:collapse; font:400 16px var(--font-sans); }
    .tbl th { text-align:left; padding:10px 12px; color:var(--content-muted); font-weight:600; border-bottom:1px solid var(--surface-border); }
    .tbl td { padding:10px 12px; border-bottom:1px solid var(--surface-border); }
    .tbl__actions { display:flex; gap:4px; justify-content:flex-end; }
    .tbl__row--edit td { background:var(--surface); padding:6px 12px; }
    .tbl__input { width:100%; height:34px; padding:0 8px; background:var(--surface-2, var(--surface));
      border:1px solid var(--surface-border); border-radius:var(--r-field); font:400 16px var(--font-sans); color:var(--content-fg); }
    .tbl__input:focus { outline:0; border-color:var(--brand-500); box-shadow:0 0 0 3px var(--brand-100); }
    .tbl__err { color:var(--danger); font:500 16px var(--font-sans); padding:8px 12px; }
  `]
})
export class FreightFactorPage {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(FreightFactorService);
  private readonly confirm = inject(DialogService);
  private readonly dialog = inject(MatDialog);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly auth = inject(AuthService);

  protected readonly canWrite = computed(() => this.auth.roles().includes('COMPANY_ADMIN'));

  protected readonly loading = signal(true);
  protected readonly rows = signal<FreightFactor[]>([]);
  protected readonly busyRowId = signal<string | null>(null);

  protected readonly adding = signal(false);
  protected readonly addBusy = signal(false);
  protected readonly addError = signal<string | null>(null);

  protected readonly addForm: FormGroup = this.fb.group({
    fromKm: [null as number | null, [Validators.required, Validators.min(0)]],
    toKm: [null as number | null, [Validators.required, Validators.min(0)]],
    fromWeight: [null as number | null, [Validators.required, Validators.min(0)]],
    toWeight: [null as number | null, [Validators.required, Validators.min(0)]],
    factor: [null as number | null, [Validators.required, Validators.min(0.0001)]]
  });

  constructor() {
    this.breadcrumb.set([{ label: 'Freight Factor' }]);
    this.loadRows();
  }

  private loadRows(): void {
    this.loading.set(true);
    this.service.list().subscribe({
      next: (page) => { this.rows.set(page.content); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  protected startAdd(): void {
    this.addForm.reset();
    this.addError.set(null);
    this.adding.set(true);
  }

  protected cancelAdd(): void {
    this.adding.set(false);
    this.addError.set(null);
  }

  protected saveAdd(): void {
    if (this.addForm.invalid) { this.addForm.markAllAsTouched(); return; }
    const v = this.addForm.getRawValue();

    this.addBusy.set(true);
    this.addError.set(null);
    this.service.create({
      fromKm: Number(v.fromKm), toKm: Number(v.toKm),
      fromWeight: Number(v.fromWeight), toWeight: Number(v.toWeight),
      factor: Number(v.factor)
    }).subscribe({
      next: (created) => {
        this.addBusy.set(false);
        this.adding.set(false);
        this.rows.set([...this.rows(), created].sort((a, b) => a.fromKm - b.fromKm));
      },
      error: (e: HttpErrorResponse) => {
        this.addBusy.set(false);
        this.addError.set(e?.error?.message ?? 'Could not save the freight factor.');
      }
    });
  }

  protected openEdit(cell: FreightFactor): void {
    this.dialog.open(FreightFactorFormDialog, { data: { cell }, autoFocus: false, panelClass: 'app-dialog' })
      .afterClosed().subscribe((saved: FreightFactor | null) => {
        if (!saved) return;
        this.rows.set(this.rows().map((r) => (r.id === saved.id ? saved : r)));
      });
  }

  protected activateRow(row: FreightFactor): void {
    this.busyRowId.set(row.id);
    this.service.activate(row.id).subscribe({
      next: (updated) => { this.busyRowId.set(null); this.rows.set(this.rows().map((r) => (r.id === updated.id ? updated : r))); },
      error: () => this.busyRowId.set(null)
    });
  }

  protected deactivateRow(row: FreightFactor): void {
    this.confirm.confirm({
      title: 'Deactivate freight factor',
      message: `Range ${row.fromKm}-${row.toKm} km / ${row.fromWeight}-${row.toWeight} kg will be withdrawn from calculation. It can be reactivated later.`,
      confirmLabel: 'Deactivate', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.busyRowId.set(row.id);
      this.service.deactivate(row.id).subscribe({
        next: (updated) => { this.busyRowId.set(null); this.rows.set(this.rows().map((r) => (r.id === updated.id ? updated : r))); },
        error: () => this.busyRowId.set(null)
      });
    });
  }
}
