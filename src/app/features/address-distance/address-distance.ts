import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { UiAutocomplete } from '@shared/components/ui-autocomplete/ui-autocomplete';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { AddressDistanceResponse } from '@core/models/address-distance.model';
import { AddressDistanceService } from './address-distance.service';

/**
 * Resolves and lists the road distance between two branches. Branch-only for now — the
 * backend also has a customer-address path, but nothing geocodes a customer address yet
 * (see backend/CHANGELOG 0.19.0), so there is nothing for a customer picker to resolve.
 *
 * A resolve is cache-or-compute on the backend: the same pair returns instantly on every
 * call after the first. "Refresh" is the explicit escape hatch for when a branch's
 * location changes after its distance was first resolved.
 */
@Component({
  selector: 'app-address-distance',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, ReactiveFormsModule, UiCard, UiAutocomplete, UiButton],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">Address Distance</h1>
          <p class="text-caption">Resolve the road distance between two branches.</p>
        </div>
      </header>

      <app-card title="Resolve a distance">
        <form [formGroup]="form" (ngSubmit)="resolve()" class="resolve">
          <div class="grid">
            <app-autocomplete [control]="c('fromBranchId')" label="From Branch" [options]="branchOptions()" placeholder="Search branch…" />
            <app-autocomplete [control]="c('toBranchId')" label="To Branch" [options]="branchOptions()" placeholder="Search branch…" />
          </div>
          <div class="resolve__bar">
            <app-button type="submit" icon="social_distance" [loading]="busy()">Resolve</app-button>
          </div>
        </form>

        @if (error()) {
          <p class="resolve__err">{{ error() }}</p>
        }

        @if (result(); as r) {
          <div class="result">
            <dl class="kv">
              <dt>Distance</dt><dd class="mono">{{ r.distanceKm | number: '1.3-3' }} km</dd>
              <dt>Distance</dt><dd class="mono">{{ r.distanceMeter | number: '1.0-0' }} m</dd>
              <dt>Travel Time</dt><dd class="mono">{{ r.requiredTimeMinutes | number: '1.0-0' }} min</dd>
            </dl>
          </div>
        }
      </app-card>

      <app-card title="Resolved distances" subtitle="Every branch pair looked up so far, cached from the first resolve.">
        @if (loadingList()) {
          <p class="text-caption">Loading…</p>
        } @else if (rows().length === 0) {
          <p class="text-caption">No distances resolved yet.</p>
        } @else {
          <table class="tbl">
            <thead>
              <tr><th>#</th><th>From</th><th>To</th><th>Distance</th><th>Time</th><th></th></tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.id; let i = $index) {
                <tr>
                  <td>{{ i + 1 }}</td>
                  <td>{{ branchLabel(row.fromId) }}</td>
                  <td>{{ branchLabel(row.toId) }}</td>
                  <td class="mono">{{ row.distanceKm | number: '1.3-3' }} km</td>
                  <td class="mono">{{ row.requiredTimeMinutes | number: '1.0-0' }} min</td>
                  <td class="tbl__actions">
                    <app-button variant="text" icon="refresh" [loading]="busyRowId() === row.id" (pressed)="refreshRow(row)">Refresh</app-button>
                    <app-button variant="text" icon="delete" [loading]="busyRowId() === row.id" (pressed)="deleteRow(row)">Delete</app-button>
                  </td>
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
    .resolve { display:flex; flex-direction:column; gap:16px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }
    .resolve__bar { display:flex; justify-content:flex-end; }
    .resolve__err { font:500 16px var(--font-sans); color:var(--danger); padding:10px 12px;
      background:var(--danger-50, rgba(239,68,68,.06)); border-radius:var(--r-field); }
    .result { margin-top:8px; padding:16px; border:1px solid var(--surface-border); border-radius:var(--r-field); background:var(--surface); }
    .kv { display:grid; grid-template-columns:1fr auto; gap:8px 16px; margin:0; }
    .kv dt { font:500 16px var(--font-sans); color:var(--content-muted); }
    .kv dd { font:600 17px var(--font-sans); color:var(--content-fg); margin:0; text-align:right; }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .tbl { width:100%; border-collapse:collapse; font:400 16px var(--font-sans); }
    .tbl th { text-align:left; padding:10px 12px; color:var(--content-muted); font-weight:600; border-bottom:1px solid var(--surface-border); }
    .tbl td { padding:10px 12px; border-bottom:1px solid var(--surface-border); }
    .tbl__actions { display:flex; gap:4px; justify-content:flex-end; }
    @media (max-width:600px){ .grid { grid-template-columns:1fr; } }
  `]
})
export class AddressDistance {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(AddressDistanceService);
  private readonly masters = inject(MasterDataService);
  private readonly confirm = inject(DialogService);
  private readonly breadcrumb = inject(BreadcrumbService);

  protected readonly branchOptions = signal<SelectOption[]>([]);
  private readonly branchLabels = signal<Map<string, string>>(new Map());

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<AddressDistanceResponse | null>(null);

  protected readonly loadingList = signal(true);
  protected readonly rows = signal<AddressDistanceResponse[]>([]);
  protected readonly busyRowId = signal<string | null>(null);

  protected readonly form: FormGroup = this.fb.group({
    fromBranchId: [null as string | null, Validators.required],
    toBranchId: [null as string | null, Validators.required]
  });

  constructor() {
    this.breadcrumb.set([{ label: 'Address Distance' }]);
    this.masters.branchDirectory().subscribe((branches) => {
      this.branchOptions.set(branches.map((b) => ({ value: b.id, label: `${b.branchName} (${b.branchCode})` })));
      this.branchLabels.set(new Map(branches.map((b) => [b.id, `${b.branchName} (${b.branchCode})`])));
    });
    this.loadRows();
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  protected branchLabel(id: string): string {
    return this.branchLabels().get(id) ?? id;
  }

  protected resolve(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const { fromBranchId, toBranchId } = this.form.getRawValue();
    if (fromBranchId === toBranchId) {
      this.error.set("A branch's distance to itself is not meaningful.");
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    this.result.set(null);
    this.service.resolveBranchDistance(fromBranchId, toBranchId).subscribe({
      next: (r) => { this.busy.set(false); this.result.set(r); this.loadRows(); },
      error: (e: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(e?.error?.message ?? 'Could not resolve a distance for this pair.');
      }
    });
  }

  private loadRows(): void {
    this.loadingList.set(true);
    this.service.search({ addressType: 'BRANCH' }).subscribe({
      next: (rows) => { this.rows.set(rows); this.loadingList.set(false); },
      error: () => this.loadingList.set(false)
    });
  }

  protected refreshRow(row: AddressDistanceResponse): void {
    this.busyRowId.set(row.id);
    this.service.refresh(row.id).subscribe({
      next: (updated) => {
        this.busyRowId.set(null);
        this.rows.set(this.rows().map((r) => (r.id === updated.id ? updated : r)));
      },
      error: () => this.busyRowId.set(null)
    });
  }

  protected deleteRow(row: AddressDistanceResponse): void {
    this.confirm.confirm({
      title: 'Delete resolved distance',
      message: `The distance between ${this.branchLabel(row.fromId)} and ${this.branchLabel(row.toId)} will be removed. It can be resolved again afterwards.`,
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.busyRowId.set(row.id);
      this.service.remove(row.id).subscribe({
        next: () => {
          this.busyRowId.set(null);
          this.rows.set(this.rows().filter((r) => r.id !== row.id));
        },
        error: () => this.busyRowId.set(null)
      });
    });
  }
}
