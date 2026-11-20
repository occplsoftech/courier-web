import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { CompanyProfile, CompanyRequest, SubscriptionPlanOption } from '@core/models/company.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { CompanyForm } from './components/company-form';
import { CompanyService } from './company.service';

/** Edit Company Profile — wraps CompanyForm, wires it to the API and navigates on save. */
@Component({
  selector: 'app-company-profile-edit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiLoader, CompanyForm],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Edit Company Profile</h1><p class="text-caption">Update identity, registration, contact, address and branding.</p></div>
      </header>

      @if (loading()) {
        <app-loader [minHeight]="280" caption="Loading…" />
      } @else if (!company()) {
        <app-card><p class="empty">Company not found or you do not have access.</p></app-card>
      } @else {
        <app-company-form [profile]="company()!" [plans]="plans()" [saving]="saving()"
                          (saved)="save($event)" (cancelled)="cancel()" />
      }
    </div>
  `,
  styles: [`.empty{ font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }`]
})
export class CompanyProfileEditPage implements OnInit {
  private readonly service = inject(CompanyService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly company = signal<CompanyProfile | null>(null);
  readonly plans = signal<SubscriptionPlanOption[]>([]);

  private id = '';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.breadcrumb.set([{ label: 'Companies', route: '/companies' }, { label: 'Edit Profile' }]);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    forkJoin({
      company: this.service.getProfile(this.id),
      plans: this.service.plans()
    }).subscribe({
      next: ({ company, plans }) => {
        this.company.set(company);
        this.plans.set(plans);
        this.breadcrumb.set([
          { label: 'Companies', route: '/companies' },
          { label: company.companyName, route: `/companies/${this.id}` },
          { label: 'Edit' }
        ]);
        this.loading.set(false);
      },
      error: () => { this.company.set(null); this.loading.set(false); }
    });
  }

  save(body: CompanyRequest): void {
    this.saving.set(true);
    this.service.update(this.id, body).subscribe({
      next: (updated) => {
        this.company.set(updated);
        this.saving.set(false);
        this.notify.success('Company profile updated.');
        this.router.navigate(['/companies', this.id]);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 409) {
          this.notify.error('This profile changed since you opened it. Reloading the latest version.');
          this.load();
        } else if (err.status === 400 || err.status === 422) {
          this.notify.error(err.error?.message ?? 'Please correct the highlighted fields.');
        }
      }
    });
  }

  cancel(): void { this.router.navigate(['/companies', this.id]); }
}
