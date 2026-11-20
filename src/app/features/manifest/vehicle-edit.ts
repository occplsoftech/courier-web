import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { CreateVehicleRequest, UpdateVehicleRequest, Vehicle } from '@core/models/shipment.model';
import { VehicleForm } from './components/vehicle-form';
import { VehicleService } from './vehicle.service';

/** Edit Vehicle — loads the vehicle + branch directory, PUTs a full replacement, handles 409. */
@Component({
  selector: 'app-vehicle-edit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiLoader, VehicleForm],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Edit Vehicle</h1><p class="text-caption">Update the vehicle. Active/inactive has its own action on the list.</p></div>
      </header>
      @if (loading()) {
        <app-loader [minHeight]="280" caption="Loading…" />
      } @else if (!vehicle()) {
        <app-card><p class="empty">Vehicle not found or outside your scope.</p></app-card>
      } @else {
        <app-vehicle-form mode="edit" [vehicle]="vehicle()" [branchOptions]="branchOptions()" [saving]="saving()"
                          (saved)="save($event)" (cancelled)="cancel()" />
      }
    </div>
  `,
  styles: [`.empty{ font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }`]
})
export class VehicleEdit implements OnInit {
  private readonly service = inject(VehicleService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly vehicle = signal<Vehicle | null>(null);
  readonly branchOptions = signal<SelectOption[]>([]);
  private id = '';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    forkJoin({ vehicle: this.service.get(this.id), branches: this.masters.branchDirectory() }).subscribe({
      next: (l) => {
        this.vehicle.set(l.vehicle);
        this.branchOptions.set(l.branches.map((b) => ({ value: b.id, label: `${b.branchName} (${b.branchCode})` })));
        this.breadcrumb.set([{ label: 'Vehicles', route: '/masters/vehicles' }, { label: l.vehicle.vehicleNumber }, { label: 'Edit' }]);
        this.loading.set(false);
      },
      error: () => { this.vehicle.set(null); this.loading.set(false); }
    });
  }

  save(body: CreateVehicleRequest | UpdateVehicleRequest): void {
    this.saving.set(true);
    this.service.update(this.id, body as UpdateVehicleRequest).subscribe({
      next: () => { this.saving.set(false); this.notify.success('Vehicle updated.'); this.router.navigate(['/masters/vehicles']); },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 409) { this.notify.error('This vehicle changed since you opened it. Reloading the latest version.'); this.load(); }
        else if (err.status === 400 || err.status === 422) this.notify.error(err.error?.message ?? 'Please correct the highlighted fields.');
        else this.notify.error('Could not update the vehicle.');
      }
    });
  }

  cancel(): void { this.router.navigate(['/masters/vehicles']); }
}
