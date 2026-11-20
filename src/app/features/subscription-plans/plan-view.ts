import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { SubscriptionPlanProfile } from '@core/models/subscription-plan.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { PlanStatusBadge } from './components/plan-status-badge';
import { SubscriptionPlanService } from './subscription-plan.service';

const WRITERS = [AppRole.SUPER_ADMIN];

/** View Subscription Plan — full read-only profile plus the gated action bar (lifecycle, delete). */
@Component({
  selector: 'app-plan-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, UiCard, UiLoader, UiButton, PlanStatusBadge, MatMenuModule, MatIconModule],
  template: `
    <div class="page">
      @if (loading()) {
        <app-loader [minHeight]="320" caption="Loading…" />
      } @else if (!plan()) {
        <app-card><p class="empty">Plan not found.</p></app-card>
      } @else {
        <header class="pv__banner app-card">
          <div class="pv__id">
            <span class="pv__av"><mat-icon>workspace_premium</mat-icon></span>
            <div>
              <div class="pv__name"><h1 class="text-h1">{{ plan()!.planName }}</h1>
                <app-plan-status-badge [status]="plan()!.isActive" /></div>
              <p class="text-caption mono">{{ plan()!.planCode }}</p>
              <div class="pv__tags">
                <span class="tag">{{ pretty(plan()!.planType) }}</span>
                @if (plan()!.unlimited) { <span class="tag tag--brand">Unlimited quotas</span> }
              </div>
            </div>
          </div>
          <div class="pv__actions">
            @if (can().update) { <app-button variant="stroked" icon="edit" (pressed)="edit()">Edit</app-button> }
            @if (hasMenu()) {
              <button class="kebab" [matMenuTriggerFor]="menu"><mat-icon>more_vert</mat-icon></button>
              <mat-menu #menu="matMenu">
                @if (can().update) {
                  @if (!plan()!.isActive) {
                    <button mat-menu-item (click)="lifecycle('activate')"><mat-icon>check_circle</mat-icon><span>Activate</span></button>
                  } @else {
                    <button mat-menu-item (click)="deactivate()"><mat-icon>block</mat-icon><span>Deactivate</span></button>
                  }
                }
                @if (can().delete) {
                  <button mat-menu-item class="danger" (click)="remove()"><mat-icon>delete</mat-icon><span>Delete</span></button>
                }
              </mat-menu>
            }
          </div>
        </header>

        <div class="pv__grid">
          <app-card title="Pricing">
            <dl class="kv">
              <dt>Monthly Price</dt><dd>{{ plan()!.currency }} {{ plan()!.monthlyPrice | number:'1.2-2' }}</dd>
              <dt>Yearly Price</dt><dd>{{ plan()!.currency }} {{ plan()!.yearlyPrice | number:'1.2-2' }}</dd>
              <dt>Trial Days</dt><dd>{{ plan()!.trialDays }}</dd>
              <dt>Display Order</dt><dd>{{ plan()!.displayOrder }}</dd>
            </dl>
          </app-card>

          <app-card title="Details">
            <dl class="kv">
              <dt>Plan Code</dt><dd class="mono">{{ plan()!.planCode }}</dd>
              <dt>Tier</dt><dd>{{ pretty(plan()!.planType) }}</dd>
              <dt>Description</dt><dd>{{ plan()!.description || '—' }}</dd>
              <dt>Status</dt><dd>{{ plan()!.isActive ? 'Active' : 'Inactive' }}</dd>
            </dl>
          </app-card>

          <app-card title="Quotas" subtitle="A dash means unlimited.">
            <dl class="kv">
              <dt>Max Users</dt><dd>{{ q(plan()!.maxUsers) }}</dd>
              <dt>Max Branches</dt><dd>{{ q(plan()!.maxBranches) }}</dd>
              <dt>Max Hubs</dt><dd>{{ q(plan()!.maxHubs) }}</dd>
              <dt>Max Customers</dt><dd>{{ q(plan()!.maxCustomers) }}</dd>
              <dt>Max Drivers</dt><dd>{{ q(plan()!.maxDrivers) }}</dd>
              <dt>Max Vehicles</dt><dd>{{ q(plan()!.maxVehicles) }}</dd>
              <dt>Max Daily Bookings</dt><dd>{{ q(plan()!.maxDailyBookings) }}</dd>
              <dt>Max Monthly Bookings</dt><dd>{{ q(plan()!.maxMonthlyBookings) }}</dd>
              <dt>Storage (GB)</dt><dd>{{ q(plan()!.storageLimitGb) }}</dd>
              <dt>API Rate Limit</dt><dd>{{ q(plan()!.apiRateLimit) }}</dd>
            </dl>
          </app-card>

          <app-card title="Audit">
            <dl class="kv">
              <dt>Created</dt><dd>{{ plan()!.createdAt ? (plan()!.createdAt | date:'medium') : '—' }}</dd>
              <dt>Last Updated</dt><dd>{{ plan()!.updatedAt ? (plan()!.updatedAt | date:'medium') : '—' }}</dd>
              <dt>Version</dt><dd>{{ plan()!.version }}</dd>
            </dl>
          </app-card>
        </div>
      }
    </div>
  `,
  styles: [`
    .pv__banner { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:20px 24px; margin-bottom:16px; }
    .pv__id { display:flex; gap:16px; align-items:center; }
    .pv__av { width:56px; height:56px; border-radius:14px; background:var(--brand-100); color:var(--brand-700); display:grid; place-items:center; }
    .pv__av mat-icon { font-size:28px; width:28px; height:28px; }
    .pv__name { display:flex; align-items:center; gap:12px; }
    .pv__tags { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
    .mono { font-family:var(--font-mono, var(--font-sans)); }
    .tag { display:inline-block; background:var(--surface-muted); border:1px solid var(--surface-border); color:var(--content-muted);
      font:600 14px var(--font-sans); padding:2px 8px; border-radius:6px; }
    .tag--brand { background:var(--brand-50); color:var(--brand-700); border-color:var(--brand-100); }
    .pv__actions { display:flex; gap:10px; align-items:center; }
    .kebab { border:0; background:var(--surface); cursor:pointer; color:var(--content-muted); display:inline-flex;
      padding:8px; border-radius:8px; border:1px solid var(--surface-border); }
    .kebab:hover { background:var(--surface-muted); }
    .danger { color:var(--danger); }
    .pv__grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
    .kv { display:grid; grid-template-columns:170px 1fr; gap:10px 16px; margin:0; }
    .kv dt { font:500 16px var(--font-sans); color:var(--content-muted); }
    .kv dd { font:600 17px var(--font-sans); color:var(--content-fg); margin:0; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
    @media (max-width:860px){ .pv__grid{ grid-template-columns:1fr; } }
  `]
})
export class PlanView implements OnInit {
  private readonly service = inject(SubscriptionPlanService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly confirm = inject(DialogService);

  readonly loading = signal(true);
  readonly plan = signal<SubscriptionPlanProfile | null>(null);
  private id = '';

  readonly can = computed(() => ({
    create: this.perms.canAccess({ roles: WRITERS }),
    update: this.perms.canAccess({ roles: WRITERS }),
    delete: this.perms.canAccess({ roles: WRITERS })
  }));
  readonly hasMenu = computed(() => { const c = this.can(); return c.update || c.delete; });

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.get(this.id).subscribe({
      next: (p) => {
        this.plan.set(p);
        this.breadcrumb.set([{ label: 'Subscription Plans', route: '/subscription-plans' }, { label: p.planName }]);
        this.loading.set(false);
      },
      error: () => { this.plan.set(null); this.loading.set(false); }
    });
  }

  private reload(): void { this.service.get(this.id).subscribe((p) => this.plan.set(p)); }

  pretty(v?: string): string { return v ? v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : '—'; }
  q(v?: number | null): string { return v == null ? 'Unlimited' : String(v); }

  edit(): void { this.router.navigate(['/subscription-plans', this.id, 'edit']); }

  lifecycle(op: 'activate'): void {
    this.service[op](this.id).subscribe({
      next: () => { this.notify.success(`Plan ${op}d.`); this.reload(); },
      error: (e) => this.notify.error(e?.error?.message ?? `Could not ${op} the plan.`)
    });
  }

  deactivate(): void {
    this.confirm.confirm({
      title: 'Deactivate plan',
      message: `"${this.plan()!.planName}" will be withdrawn from the catalogue offered to new companies. Companies already on it are unaffected.`,
      confirmLabel: 'Deactivate', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.deactivate(this.id).subscribe({
        next: () => { this.notify.success('Plan deactivated.'); this.reload(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not deactivate the plan.')
      });
    });
  }

  remove(): void {
    this.confirm.confirm({
      title: 'Delete plan',
      message: `"${this.plan()!.planName}" will be removed. Its code and name stay reserved so a later plan cannot reuse them.`,
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.remove(this.id).subscribe({
        next: () => { this.notify.success('Plan deleted.'); this.router.navigate(['/subscription-plans']); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not delete the plan.')
      });
    });
  }
}
