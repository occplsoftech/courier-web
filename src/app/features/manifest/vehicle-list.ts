import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { AuthService } from '@core/auth/auth.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { NotificationService } from '@core/services/notification.service';
import { Vehicle } from '@core/models/shipment.model';
import { VehicleService } from './vehicle.service';

/**
 * Fleet management — full vehicle records (registration, class, ownership dates,
 * statutory document expiries, base branch). Grown from the minimal fleet-picker table
 * Dispatch/THC reads (0.25.0, see MEMORY/modules/shipment-movement.md).
 * COMPANY_ADMIN/BRANCH_MANAGER write, matching VehicleServiceImpl's own gate.
 */
@Component({
  selector: 'app-vehicle-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, UiCard, UiButton, StatusBadge],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">Vehicles</h1>
          <p class="text-caption">The fleet Trip Hire Challan's "Assign Vehicle" picker reads from.</p>
        </div>
      </header>

      <app-card title="Fleet" [subtitle]="rows().length + ' vehicle(s)'">
        @if (canWrite()) {
          <div card-actions>
            <app-button icon="add" variant="stroked" (pressed)="openAdd()">Add Vehicle</app-button>
          </div>
        }

        @if (loading()) {
          <p class="text-caption">Loading…</p>
        } @else if (rows().length === 0) {
          <p class="text-caption">No vehicles yet.</p>
        } @else {
          <div class="tbl-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>#</th><th>Number</th><th>Type</th><th>Make / Model</th><th>Capacity (kg)</th>
                  <th>Branch</th><th>Status</th><th>Active</th>
                  @if (canWrite()) { <th></th> }
                </tr>
              </thead>
              <tbody>
                @for (row of rows(); track row.id; let i = $index) {
                  <tr>
                    <td>{{ i + 1 }}</td>
                    <td class="mono">{{ row.vehicleNumber }}</td>
                    <td>{{ row.vehicleType }}</td>
                    <td>{{ makeModel(row) }}</td>
                    <td class="mono">{{ row.capacityKg != null ? (row.capacityKg | number: '1.0-3') : '—' }}</td>
                    <td>{{ branchLabel(row.branchId) }}</td>
                    <td><app-status-badge [value]="row.status" [tone]="statusTone(row.status)" /></td>
                    <td><app-status-badge [value]="row.active ? 'ACTIVE' : 'INACTIVE'" /></td>
                    @if (canWrite()) {
                      <td class="tbl__actions">
                        <app-button variant="text" icon="edit" [loading]="busyRowId() === row.id" (pressed)="openEdit(row)">Edit</app-button>
                        @if (row.active) {
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
          </div>
        }
      </app-card>
    </div>
  `,
  styles: [`
    .page { display:flex; flex-direction:column; gap:20px; }
    .page__head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
    .tbl-wrap { overflow-x:auto; }
    .tbl { width:100%; border-collapse:collapse; font:400 16px var(--font-sans); }
    .tbl th { text-align:left; padding:10px 12px; color:var(--content-muted); font-weight:600; white-space:nowrap; }
    .tbl td { padding:10px 12px; border-top:1px solid var(--border-subtle); white-space:nowrap; }
    .tbl .mono { font-family:var(--font-mono, monospace); }
    .tbl__actions { display:flex; gap:4px; }
  `]
})
export class VehicleList {
  private readonly vehicleService = inject(VehicleService);
  private readonly masters = inject(MasterDataService);
  private readonly router = inject(Router);
  private readonly confirmSvc = inject(DialogService);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly breadcrumb = inject(BreadcrumbService);

  protected readonly canWrite = computed(() => {
    const roles = this.auth.roles();
    return roles.includes('COMPANY_ADMIN') || roles.includes('BRANCH_MANAGER');
  });

  protected readonly loading = signal(true);
  protected readonly rows = signal<Vehicle[]>([]);
  protected readonly busyRowId = signal<string | null>(null);
  private readonly branchLabels = signal<Map<string, string>>(new Map());

  constructor() {
    this.breadcrumb.set([{ label: 'Vehicles' }]);
    this.masters.branchDirectory().subscribe((branches) => {
      this.branchLabels.set(new Map(branches.map((b) => [b.id, `${b.branchName} (${b.branchCode})`])));
    });
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.vehicleService.list(false).subscribe({
      next: (list) => { this.rows.set(list); this.loading.set(false); },
      error: () => { this.loading.set(false); this.notify.error('Could not load vehicles.'); }
    });
  }

  protected branchLabel(id: string | null | undefined): string {
    return id ? (this.branchLabels().get(id) ?? id) : '—';
  }

  protected makeModel(row: Vehicle): string {
    return [row.make, row.model].filter(Boolean).join(' ') || '—';
  }

  protected statusTone(status: string): 'success' | 'info' | 'warning' | 'danger' {
    if (status === 'AVAILABLE') return 'success';
    if (status === 'IN_USE') return 'info';
    if (status === 'MAINTENANCE') return 'warning';
    return 'danger';
  }

  protected openAdd(): void {
    this.router.navigate(['/masters/vehicles/new']);
  }

  protected openEdit(row: Vehicle): void {
    this.router.navigate(['/masters/vehicles', row.id, 'edit']);
  }

  protected activateRow(row: Vehicle): void {
    this.busyRowId.set(row.id);
    this.vehicleService.activate(row.id).subscribe({
      next: () => { this.busyRowId.set(null); this.notify.success('Vehicle activated.'); this.load(); },
      error: (e) => { this.busyRowId.set(null); this.notify.error(e?.error?.message ?? 'Could not activate the vehicle.'); }
    });
  }

  protected deactivateRow(row: Vehicle): void {
    this.confirmSvc.confirm({
      title: 'Deactivate vehicle', message: `Deactivate ${row.vehicleNumber}? It will drop out of Dispatch's vehicle picker.`,
      confirmLabel: 'Deactivate', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.busyRowId.set(row.id);
      this.vehicleService.deactivate(row.id).subscribe({
        next: () => { this.busyRowId.set(null); this.notify.success('Vehicle deactivated.'); this.load(); },
        error: (e) => { this.busyRowId.set(null); this.notify.error(e?.error?.message ?? 'Could not deactivate the vehicle.'); }
      });
    });
  }
}
