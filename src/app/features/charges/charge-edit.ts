import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { ChargeResponse, CreateChargeRequest, UpdateChargeRequest } from '@core/models/charge.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { MasterDataService } from '@features/masters/master-data.service';
import { ChargeForm } from './components/charge-form';
import { ChargeService } from './charge.service';

/** Edit Charge — loads the charge, PUTs a full replacement, handles 409. */
@Component({
  selector: 'app-charge-edit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiLoader, ChargeForm],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Edit Charge</h1><p class="text-caption">Update the charge name and service type.</p></div>
      </header>
      @if (loading()) {
        <app-loader [minHeight]="280" caption="Loading…" />
      } @else if (!charge()) {
        <app-card><p class="empty">Charge not found or outside your scope.</p></app-card>
      } @else {
        <app-charge-form mode="edit" [charge]="charge()" [saving]="saving()" [serviceTypeOptions]="serviceTypeOptions()"
                         (saved)="save($event)" (cancelled)="cancel()" />
      }
    </div>
  `,
  styles: [`.empty{ font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }`]
})
export class ChargeEdit implements OnInit {
  private readonly service = inject(ChargeService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly charge = signal<ChargeResponse | null>(null);
  readonly serviceTypeOptions = signal<SelectOption[]>([]);
  private id = '';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.masters.options('service-types').subscribe((o) => this.serviceTypeOptions.set(o));
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.get(this.id).subscribe({
      next: (c) => {
        this.charge.set(c);
        this.breadcrumb.set([{ label: 'Charges', route: '/charges' }, { label: c.chargeName, route: `/charges/${this.id}` }, { label: 'Edit' }]);
        this.loading.set(false);
      },
      error: () => { this.charge.set(null); this.loading.set(false); }
    });
  }

  save(body: CreateChargeRequest | UpdateChargeRequest): void {
    this.saving.set(true);
    this.service.update(this.id, body as UpdateChargeRequest).subscribe({
      next: () => { this.saving.set(false); this.notify.success('Charge updated.'); this.router.navigate(['/charges', this.id]); },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 409) { this.notify.error('This charge changed since you opened it. Reloading the latest version.'); this.load(); }
        else if (err.status === 400 || err.status === 422) this.notify.error(err.error?.message ?? 'Please correct the highlighted fields.');
        else this.notify.error('Could not update the charge.');
      }
    });
  }

  cancel(): void { this.router.navigate(['/charges', this.id]); }
}
