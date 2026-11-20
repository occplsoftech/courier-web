import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { MatDialog } from '@angular/material/dialog';
import { CompanyProfile, CompanyStatistics, SubscriptionPlanOption } from '@core/models/company.model';
import { NotificationService } from '@core/services/notification.service';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { StatisticCard } from '@shared/components/statistic-card/statistic-card';
import { SubscriptionDialog, SubscriptionDialogResult } from './components/subscription-dialog';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { CompanySummaryCard } from './components/company-summary-card';
import { ContactInformation } from './components/contact-information';
import { AddressInformation } from './components/address-information';
import { CompanyLogo } from './components/company-logo';
import { CompanyService } from './company.service';

/** Company Profile — read-only view of a company, assembled from the section components. */
@Component({
  selector: 'app-company-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiButton, UiLoader, StatisticCard, CompanySummaryCard, ContactInformation,
    AddressInformation, CompanyLogo],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Company Profile</h1><p class="text-caption">Identity, registration, contact and branding.</p></div>
        @if (company()) {
          <div class="page__actions">
            <app-button icon="edit" (pressed)="edit()">Edit Profile</app-button>
            <app-button variant="stroked" icon="workspace_premium" (pressed)="assign()">Assign Plan</app-button>
            <app-button variant="stroked" icon="autorenew" (pressed)="renew()">Renew</app-button>
            @if (company()!.status !== 'ACTIVE') {
              <app-button variant="stroked" icon="play_circle" (pressed)="activate()">Activate</app-button>
            }
            @if (company()!.status !== 'INACTIVE') {
              <app-button variant="stroked" icon="pause_circle" (pressed)="deactivate()">Deactivate</app-button>
            }
            @if (company()!.status !== 'SUSPENDED') {
              <app-button variant="stroked" icon="block" (pressed)="suspendSubscription()">Suspend Subscription</app-button>
            }
          </div>
        }
      </header>

      @if (loading()) {
        <app-loader [minHeight]="280" caption="Loading profile…" />
      } @else if (!company()) {
        <app-card><p class="empty">Company not found or you do not have access.</p></app-card>
      } @else {
        <app-company-summary-card [company]="company()!" />

        <!-- Counts and quota headroom. No shipment figure: the module that would produce
             one does not exist, and a constant zero reads as "booked nothing". -->
        @if (stats(); as s) {
          <section class="tiles">
            <app-statistic-card icon="group" label="Users" [value]="s.userCount"
              [tone]="s.userQuotaReached ? 'danger' : 'brand'" />
            <app-statistic-card icon="how_to_reg" label="Active users" [value]="s.activeUserCount" tone="success" />
            <app-statistic-card icon="hourglass_top" label="Pending users" [value]="s.pendingUserCount" tone="warning" />
            <app-statistic-card icon="store" label="Branches" [value]="s.branchCount"
              [tone]="s.branchQuotaReached ? 'danger' : 'brand'" />
            <app-statistic-card icon="badge" label="Roles" [value]="s.roleCount" tone="info" />
            <app-statistic-card icon="event" label="Days to expiry"
              [value]="s.daysToExpiry === null ? '—' : s.daysToExpiry"
              [tone]="(s.daysToExpiry ?? 1) < 0 ? 'danger' : (s.daysToExpiry ?? 99) < 15 ? 'warning' : 'success'" />
          </section>

          <p class="quota">
            Plan <strong>{{ s.planName }}</strong> ·
            users {{ s.userCount }} / {{ s.maxUsers ?? 'unlimited' }} ·
            branches {{ s.branchCount }} / {{ s.maxBranches ?? 'unlimited' }}
          </p>
        }

        <div class="grid">
          <app-card title="General Information" subtitle="Names and subscription.">
            <dl class="kv">
              <div class="kv__row"><dt>Company Name</dt><dd>{{ company()!.companyName }}</dd></div>
              <div class="kv__row"><dt>Company Code</dt><dd>{{ company()!.companyCode }}</dd></div>
              <div class="kv__row"><dt>Legal Name</dt><dd>{{ company()!.legalName || '—' }}</dd></div>
              <div class="kv__row"><dt>Display Name</dt><dd>{{ company()!.displayName || '—' }}</dd></div>
              <div class="kv__row"><dt>Status</dt><dd>{{ company()!.status }}</dd></div>
            </dl>
          </app-card>

          <app-card title="Business Information" subtitle="Statutory registration.">
            <dl class="kv">
              <div class="kv__row"><dt>GST Number</dt><dd>{{ company()!.gstNumber || '—' }}</dd></div>
              <div class="kv__row"><dt>PAN Number</dt><dd>{{ company()!.panNumber || '—' }}</dd></div>
              <div class="kv__row"><dt>CIN</dt><dd>{{ company()!.cinNumber || '—' }}</dd></div>
            </dl>
          </app-card>

          <app-card title="Contact Information" subtitle="Reach the company.">
            <app-contact-information [company]="company()!" />
          </app-card>

          <app-card title="Address" subtitle="Registered address.">
            <app-address-information [company]="company()!" />
          </app-card>

          <app-card title="Branding" subtitle="Logo and favicon." class="span-2">
            <app-company-logo [logoUrl]="company()!.logo" [faviconUrl]="company()!.favicon" />
          </app-card>
        </div>
      }
    </div>
  `,
  styles: [`
    .page__actions { display:flex; flex-wrap:wrap; gap:8px; }
    .tiles { display:grid; gap:16px; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); margin-top:16px; }
    .quota { margin:12px 0 0; font:400 16px var(--font-sans); color:var(--content-muted); }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; margin-top:16px; }
    .span-2 { grid-column:1 / -1; }
    .kv { display:flex; flex-direction:column; gap:2px; margin:0; }
    .kv__row { display:flex; justify-content:space-between; gap:16px; padding:10px 0;
      border-bottom:1px solid var(--surface-border); }
    .kv__row:last-child { border-bottom:0; }
    dt { font:500 16px var(--font-sans); color:var(--content-muted); margin:0; }
    dd { font:600 16px var(--font-sans); color:var(--content-fg); margin:0; text-align:right; word-break:break-word; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
    @media (max-width:900px){ .grid{ grid-template-columns:1fr; } .span-2{ grid-column:auto; } }
  `]
})
export class CompanyProfilePage implements OnInit {
  private readonly service = inject(CompanyService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(DialogService);
  private readonly notify = inject(NotificationService);

  readonly loading = signal(true);
  readonly company = signal<CompanyProfile | null>(null);
  readonly stats = signal<CompanyStatistics | null>(null);
  readonly plans = signal<SubscriptionPlanOption[]>([]);

  private id = '';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.breadcrumb.set([{ label: 'Companies', route: '/companies' }, { label: 'Profile' }]);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.getProfile(this.id).subscribe({
      next: (c) => {
        this.company.set(c);
        this.breadcrumb.set([{ label: 'Companies', route: '/companies' }, { label: c.companyName }]);
        this.loading.set(false);
      },
      error: () => { this.company.set(null); this.loading.set(false); }
    });

    // Statistics and plans load alongside and are allowed to fail independently: a
    // missing tile row should not take the profile down with it.
    this.service.statistics(this.id).subscribe({
      next: (s) => this.stats.set(s),
      error: () => this.stats.set(null)
    });
    this.service.plans().subscribe({
      next: (plans) => this.plans.set(plans),
      error: () => this.plans.set([])
    });
  }

  edit(): void { this.router.navigate(['/companies', this.id, 'edit']); }

  // ------------------------------------------------------------------ lifecycle

  activate(): void {
    this.service.activate(this.id).subscribe({
      next: () => { this.notify.success('Company activated.'); this.load(); },
      error: (err) => this.notify.error(err?.error?.message ?? 'Could not activate the company.')
    });
  }

  deactivate(): void {
    const company = this.company();
    if (!company) return;

    // Deliberately worded to distinguish it from suspension, because the two look the
    // same to the customer's users and mean very different things to the customer.
    this.confirm.confirm({
      title: `Deactivate ${company.companyName}?`,
      message: 'Its users will not be able to sign in. This is the switch for a dormant '
        + 'company — not a suspension, which is punitive and needs a reason on record. '
        + 'Reversible with Activate.',
      confirmLabel: 'Deactivate',
      danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.deactivate(this.id).subscribe({
        next: () => { this.notify.success('Company deactivated.'); this.load(); },
        error: (err) => this.notify.error(err?.error?.message ?? 'Could not deactivate the company.')
      });
    });
  }

  // --------------------------------------------------------------- subscription

  assign(): void { this.openSubscription('assign'); }
  renew(): void { this.openSubscription('renew'); }

  private openSubscription(mode: 'assign' | 'renew'): void {
    const company = this.company();
    if (!company) return;

    this.dialog
      .open(SubscriptionDialog, {
        data: {
          mode,
          companyName: company.companyName,
          plans: this.plans(),
          currentPlanId: company.subscriptionPlanId,
          currentEndDate: company.subscriptionEndDate ?? null
        }
      })
      .afterClosed()
      .subscribe((result: SubscriptionDialogResult | undefined) => {
        if (!result) return;

        const call = result.mode === 'assign'
          ? this.service.assignSubscription(this.id, result.body)
          : this.service.renewSubscription(this.id, result.body);

        call.subscribe({
          next: () => {
            this.notify.success(result.mode === 'assign' ? 'Subscription assigned.' : 'Subscription renewed.');
            this.load();
          },
          error: (err) => this.notify.error(err?.error?.message ?? 'The subscription was not changed.')
        });
      });
  }

  suspendSubscription(): void {
    const company = this.company();
    if (!company) return;

    // The reason is collected up front: the endpoint refuses without one, and a confirm
    // followed by a 422 teaches the operator that the button is broken.
    this.confirm.prompt({
      title: `Suspend ${company.companyName}'s subscription?`,
      message: 'The company is suspended and the paid window closes today, so it stops '
        + 'appearing as paid on renewals reports. Reversible by renewing.',
      label: 'Reason',
      placeholder: 'Chargeback on invoice INV-2026-0042',
      confirmLabel: 'Suspend',
      danger: true
    }).subscribe((reason) => {
      if (!reason) return;
      this.service.suspendSubscription(this.id, reason).subscribe({
        next: () => { this.notify.success('Subscription suspended.'); this.load(); },
        error: (err) => this.notify.error(err?.error?.message ?? 'Could not suspend the subscription.')
      });
    });
  }
}
