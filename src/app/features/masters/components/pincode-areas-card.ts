import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { NotificationService } from '@core/services/notification.service';
import { PincodeAreaRow } from '@core/models/master.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { MasterDataService } from '../master-data.service';

/**
 * Pincode-only card on the pincode detail page: every Area this pincode's postal record
 * names (not just the single primary one `master.config.ts`'s generic field list already
 * shows), each with its own Serviceable switch, ODA toggle and, once on, an amount.
 *
 * Not part of the shared four-component master architecture on purpose — this is a
 * per-row editable sub-list, not a flat field descriptor `MasterFieldControl` could
 * render generically, so it lives as its own small component `master-view.ts` mounts
 * only when the list is `pincodes`.
 */
@Component({
  selector: 'app-pincode-areas-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatSlideToggleModule, UiCard, UiLoader],
  template: `
    <app-card title="Areas served by this pincode">
      @if (loading()) {
        <app-loader [minHeight]="100" caption="Loading…" />
      } @else if (rows().length) {
        <div class="pa__wrap">
          <table class="pa">
            <thead>
              <tr><th>Area</th><th>City</th><th></th><th>Serviceable</th><th>ODA</th><th>Amount (₹)</th></tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.id) {
                <tr>
                  <td class="pa__name">{{ row.areaName ?? '—' }}</td>
                  <td>{{ row.cityName ?? '—' }}</td>
                  <td>@if (row.primary) { <span class="pa__badge">Primary</span> }</td>
                  <td>
                    <mat-slide-toggle color="primary" [checked]="row.serviceable"
                                       [disabled]="!canWrite() || isSaving(row.id)"
                                       [attr.aria-label]="'Serviceable: ' + (row.areaName ?? '')"
                                       (change)="toggleServiceable(row, $event.checked)" />
                  </td>
                  <td>
                    <mat-slide-toggle color="primary" [checked]="row.odaApplicable"
                                       [disabled]="!canWrite() || isSaving(row.id)"
                                       (change)="toggleOda(row, $event.checked)" />
                  </td>
                  <td>
                    @if (row.odaApplicable) {
                      <input class="pa__amount" type="number" min="0" step="0.01"
                             [value]="row.odaAmount ?? ''"
                             [disabled]="!canWrite() || isSaving(row.id)"
                             (change)="setAmount(row, $any($event.target).value)" />
                    } @else {
                      <span class="pa__dash">—</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p class="pa__empty">No areas recorded yet for this pincode.</p>
      }
    </app-card>
  `,
  styles: [`
    .pa__wrap { overflow-x:auto; }
    .pa { width:100%; border-collapse:collapse; font:400 17px var(--font-sans); }
    .pa th { text-align:left; font:500 15px var(--font-sans); color:var(--content-muted);
      text-transform:uppercase; letter-spacing:.04em; padding:0 12px 8px; }
    .pa td { padding:10px 12px; border-top:1px solid var(--surface-border); color:var(--content-fg); }
    .pa__name { font-weight:500; }
    .pa__badge { font:600 14px var(--font-sans); color:var(--brand-600, #4f46e5);
      background:var(--brand-100, #eef2ff); border-radius:999px; padding:2px 8px; }
    .pa__amount { width:110px; height:34px; padding:0 10px; background:var(--surface);
      border:1px solid var(--surface-border); border-radius:var(--r-field);
      font:400 17px var(--font-sans); color:var(--content-fg); outline:0; }
    .pa__amount:focus { border-color:var(--brand-500); box-shadow:0 0 0 3px var(--brand-100); }
    .pa__dash { color:var(--content-muted); }
    .pa__empty { color:var(--content-muted); font:400 17px var(--font-sans); margin:0; }
  `]
})
export class PincodeAreasCard {
  private readonly service = inject(MasterDataService);
  private readonly notify = inject(NotificationService);

  readonly pincodeId = input.required<string>();
  readonly canWrite = input(false);

  readonly loading = signal(true);
  readonly rows = signal<PincodeAreaRow[]>([]);
  private readonly saving = signal<ReadonlySet<string>>(new Set());

  constructor() {
    effect(() => {
      const id = this.pincodeId();
      if (id) this.fetch(id);
    });
  }

  isSaving(rowId: string): boolean {
    return this.saving().has(rowId);
  }

  /** Switch an area on or off for booking (the pincode itself must be serviceable too). */
  toggleServiceable(row: PincodeAreaRow, checked: boolean): void {
    this.save(row, { serviceable: checked });
  }

  toggleOda(row: PincodeAreaRow, checked: boolean): void {
    this.save(row, { odaApplicable: checked });
  }

  setAmount(row: PincodeAreaRow, raw: string): void {
    const amount = raw === '' ? null : Number(raw);
    if (amount !== null && (Number.isNaN(amount) || amount < 0)) {
      this.notify.error('Enter a valid, non-negative amount.');
      return;
    }
    this.save(row, { odaAmount: amount });
  }

  private fetch(pincodeId: string): void {
    this.loading.set(true);
    this.service.pincodeAreas(pincodeId).subscribe({
      next: (rows) => { this.rows.set(rows); this.loading.set(false); },
      error: () => { this.loading.set(false); }
    });
  }

  private save(row: PincodeAreaRow, patch: { odaApplicable?: boolean; odaAmount?: number | null; serviceable?: boolean }): void {
    this.saving.update((s) => new Set(s).add(row.id));
    this.service.updatePincodeAreaOda(this.pincodeId(), row.id, patch).subscribe({
      next: (updated) => {
        this.rows.update((list) => list.map((r) => (r.id === updated.id ? updated : r)));
        this.saving.update((s) => { const next = new Set(s); next.delete(row.id); return next; });
      },
      error: (e) => {
        this.saving.update((s) => { const next = new Set(s); next.delete(row.id); return next; });
        this.notify.error(e?.error?.message ?? 'Could not save this area.');
      }
    });
  }
}
