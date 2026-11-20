import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { RateResponse, CreateRateRequest, UpdateRateRequest } from '@core/models/rate.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { MasterDataService } from '@features/masters/master-data.service';
import { RateForm } from './components/rate-form';
import { RateService } from './rate.service';

/** Edit Rate — loads the rate, PUTs a full replacement, handles 409. */
@Component({
  selector: 'app-rate-edit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiLoader, RateForm],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Edit Rate</h1><p class="text-caption">Update the rate. Code is immutable; status has its own actions.</p></div>
      </header>
      @if (loading()) {
        <app-loader [minHeight]="280" caption="Loading…" />
      } @else if (!rate()) {
        <app-card><p class="empty">Rate not found or outside your scope.</p></app-card>
      } @else {
        <app-rate-form mode="edit" [rate]="rate()" [saving]="saving()"
                      [routeOptions]="routeOptions()" [serviceTypeOptions]="serviceTypeOptions()"
                      [packageTypeOptions]="packageTypeOptions()" [paymentModeOptions]="paymentModeOptions()"
                      (saved)="save($event)" (cancelled)="cancel()" />
      }
    </div>
  `,
  styles: [`.empty{ font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }`]
})
export class RateEdit implements OnInit {
  private readonly service = inject(RateService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly rate = signal<RateResponse | null>(null);
  readonly routeOptions = signal<SelectOption[]>([]);
  readonly serviceTypeOptions = signal<SelectOption[]>([]);
  readonly packageTypeOptions = signal<SelectOption[]>([]);
  readonly paymentModeOptions = signal<SelectOption[]>([]);
  private id = '';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.masters.options('routes').subscribe((o) => this.routeOptions.set(o));
    this.masters.options('service-types').subscribe((o) => this.serviceTypeOptions.set(o));
    this.masters.options('package-types').subscribe((o) => this.packageTypeOptions.set(o));
    this.masters.options('payment-modes').subscribe((o) => this.paymentModeOptions.set(o));
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.get(this.id).subscribe({
      next: (r) => {
        this.rate.set(r);
        this.breadcrumb.set([{ label: 'Rate Master', route: '/rates' }, { label: r.rateCode, route: `/rates/${this.id}` }, { label: 'Edit' }]);
        this.loading.set(false);
      },
      error: () => { this.rate.set(null); this.loading.set(false); }
    });
  }

  save(body: CreateRateRequest | UpdateRateRequest): void {
    this.saving.set(true);
    this.service.update(this.id, body as UpdateRateRequest).subscribe({
      next: () => { this.saving.set(false); this.notify.success('Rate updated.'); this.router.navigate(['/rates', this.id]); },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 409) { this.notify.error('This rate changed since you opened it. Reloading the latest version.'); this.load(); }
        else if (err.status === 400 || err.status === 422) this.notify.error(err.error?.message ?? 'Please correct the highlighted fields.');
        else this.notify.error('Could not update the rate.');
      }
    });
  }

  cancel(): void { this.router.navigate(['/rates', this.id]); }
}
