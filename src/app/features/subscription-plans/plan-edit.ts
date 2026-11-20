import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { CreateSubscriptionPlanRequest, SubscriptionPlanProfile, UpdateSubscriptionPlanRequest } from '@core/models/subscription-plan.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { PlanForm } from './components/plan-form';
import { SubscriptionPlanService } from './subscription-plan.service';

/** Edit Subscription Plan — loads the profile, PUTs a full replacement, handles the 409 optimistic lock. */
@Component({
  selector: 'app-plan-edit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiLoader, PlanForm],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Edit Plan</h1><p class="text-caption">Update the plan. The code is immutable; activation has its own action.</p></div>
      </header>
      @if (loading()) {
        <app-loader [minHeight]="280" caption="Loading…" />
      } @else if (!plan()) {
        <app-card><p class="empty">Plan not found.</p></app-card>
      } @else {
        <app-plan-form mode="edit" [plan]="plan()" [saving]="saving()" (saved)="save($event)" (cancelled)="cancel()" />
      }
    </div>
  `,
  styles: [`.empty{ font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }`]
})
export class PlanEdit implements OnInit {
  private readonly service = inject(SubscriptionPlanService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly plan = signal<SubscriptionPlanProfile | null>(null);
  private id = '';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.breadcrumb.set([{ label: 'Subscription Plans', route: '/subscription-plans' }, { label: 'Edit' }]);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.get(this.id).subscribe({
      next: (p) => {
        this.plan.set(p);
        this.breadcrumb.set([{ label: 'Subscription Plans', route: '/subscription-plans' }, { label: p.planName, route: `/subscription-plans/${this.id}` }, { label: 'Edit' }]);
        this.loading.set(false);
      },
      error: () => { this.plan.set(null); this.loading.set(false); }
    });
  }

  save(body: CreateSubscriptionPlanRequest | UpdateSubscriptionPlanRequest): void {
    this.saving.set(true);
    this.service.update(this.id, body as UpdateSubscriptionPlanRequest).subscribe({
      next: () => { this.saving.set(false); this.notify.success('Plan updated.'); this.router.navigate(['/subscription-plans', this.id]); },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 409) { this.notify.error('This plan changed since you opened it. Reloading the latest version.'); this.load(); }
        else if (err.status === 400 || err.status === 422) this.notify.error(err.error?.message ?? 'Please correct the highlighted fields.');
        else this.notify.error('Could not update the plan.');
      }
    });
  }

  cancel(): void { this.router.navigate(['/subscription-plans', this.id]); }
}
