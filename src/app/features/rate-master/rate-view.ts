import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { Rate, RateResponse } from '@core/models/rate.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { MasterDataService } from '@features/masters/master-data.service';
import { RateStatusBadge } from './components/rate-status-badge';
import { WeightSlabGrid } from './components/weight-slab-grid';
import { RateService } from './rate.service';

const WRITERS = [AppRole.COMPANY_ADMIN];
const LIFECYCLE = [AppRole.COMPANY_ADMIN];

/** View Rate — full read-only detail, the lane's other weight slabs, and the gated action bar. */
@Component({
  selector: 'app-rate-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, MatMenuModule, MatIconModule, UiCard, UiLoader, UiButton, RateStatusBadge, WeightSlabGrid],
  template: `
    @if (loading()) {
      <app-loader [minHeight]="320" caption="Loading…" />
    } @else if (!rate()) {
      <app-card><p class="empty">Rate not found or outside your scope.</p></app-card>
    } @else {
      <header class="rv__banner app-card">
        <div class="rv__id">
          <span class="rv__code mono">{{ rate()!.rateCode }}</span>
          <span class="rv__name">{{ rate()!.rateName }}</span>
          <app-rate-status-badge [status]="rate()!.status" />
        </div>
        <div class="rv__actions">
          @if (can().update) { <app-button variant="stroked" icon="edit" (pressed)="edit()">Edit</app-button> }
          @if (can().lifecycle) {
            <button class="kebab" [matMenuTriggerFor]="menu"><mat-icon>more_vert</mat-icon></button>
            <mat-menu #menu="matMenu">
              @if (rate()!.status === 'INACTIVE') {
                <button mat-menu-item (click)="lifecycle('activate')"><mat-icon>check_circle</mat-icon><span>Activate</span></button>
              } @else {
                <button mat-menu-item (click)="deactivate()"><mat-icon>block</mat-icon><span>Deactivate</span></button>
              }
            </mat-menu>
          }
        </div>
      </header>

      <div class="rv__grid">
        <app-card title="Combination">
          <dl class="kv">
            <dt>Route</dt><dd>{{ routeNames().get(rate()!.routeId) || rate()!.routeId }}</dd>
            <dt>Service Type</dt><dd>{{ serviceTypeNames().get(rate()!.serviceTypeId) || rate()!.serviceTypeId }}</dd>
            <dt>Package Type</dt><dd>{{ packageTypeNames().get(rate()!.packageTypeId) || rate()!.packageTypeId }}</dd>
            <dt>Payment Mode</dt><dd>{{ paymentModeNames().get(rate()!.paymentModeId) || rate()!.paymentModeId }}</dd>
          </dl>
        </app-card>

        <app-card title="Weight Slab">
          <dl class="kv">
            <dt>Range</dt><dd class="mono">[{{ rate()!.minimumWeight }}, {{ rate()!.maximumWeight }}) {{ rate()!.weightUnit }}</dd>
            <dt>Additional Weight</dt><dd class="mono">{{ rate()!.additionalWeight }} {{ rate()!.weightUnit }}</dd>
            <dt>Additional Weight Rate</dt><dd class="mono">{{ rate()!.additionalWeightRate | number: '1.2-2' }}</dd>
          </dl>
        </app-card>

        <app-card title="Freight">
          <dl class="kv">
            <dt>Base Rate</dt><dd class="mono">{{ rate()!.baseRate | number: '1.2-2' }}</dd>
            <dt>Minimum Charge</dt><dd class="mono">{{ rate()!.minimumCharge | number: '1.2-2' }}</dd>
            <dt>GST %</dt><dd class="mono">{{ rate()!.gstPercentage }}%</dd>
          </dl>
        </app-card>

        <app-card title="Surcharges">
          <dl class="kv">
            <dt>Fuel Surcharge</dt><dd class="mono">{{ rate()!.fuelSurcharge | number: '1.2-2' }}</dd>
            <dt>Handling Charge</dt><dd class="mono">{{ rate()!.handlingCharge | number: '1.2-2' }}</dd>
            <dt>ODA Charge</dt><dd class="mono">{{ rate()!.odaCharge | number: '1.2-2' }}</dd>
            <dt>Insurance Charge</dt><dd class="mono">{{ rate()!.insuranceCharge | number: '1.2-2' }}</dd>
          </dl>
        </app-card>

        <app-card title="Effective Window">
          <dl class="kv">
            <dt>Effective From</dt><dd>{{ rate()!.effectiveFrom }}</dd>
            <dt>Effective To</dt><dd>{{ rate()!.effectiveTo || 'Open-ended' }}</dd>
          </dl>
        </app-card>

        <app-card title="Audit">
          <dl class="kv">
            <dt>Created</dt><dd>{{ rate()!.createdDate ? (rate()!.createdDate | date: 'medium') : '—' }}</dd>
            <dt>Last Updated</dt><dd>{{ rate()!.updatedDate ? (rate()!.updatedDate | date: 'medium') : '—' }}</dd>
            <dt>Version</dt><dd>{{ rate()!.version }}</dd>
          </dl>
        </app-card>

        <app-card title="Other Weight Slabs" subtitle="Every rate sharing this Route + Service Type + Package Type + Payment Mode.">
          @if (loadingSlabs()) {
            <p class="empty">Loading…</p>
          } @else {
            <app-weight-slab-grid [rows]="siblingSlabs()" [currentId]="rate()!.id" />
          }
        </app-card>
      </div>
    }
  `,
  styles: [`
    .rv__banner { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:20px 24px; margin-bottom:16px; }
    .rv__id { display:flex; flex-direction:column; gap:6px; }
    .rv__code { font:700 19px var(--font-mono, ui-monospace); color:var(--brand-600); }
    .rv__name { font:600 21px var(--font-sans); color:var(--content-fg); }
    .rv__actions { display:flex; gap:10px; align-items:center; flex:0 0 auto; }
    .kebab { border:1px solid var(--surface-border); background:var(--surface); cursor:pointer; color:var(--content-muted);
      display:inline-flex; padding:8px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
    .rv__grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
    .rv__grid app-card:last-child { grid-column:1 / -1; }
    .kv { display:grid; grid-template-columns:180px 1fr; gap:10px 16px; margin:0; }
    .kv dt { font:500 16px var(--font-sans); color:var(--content-muted); }
    .kv dd { font:600 17px var(--font-sans); color:var(--content-fg); margin:0; }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
    @media (max-width:860px){ .rv__grid { grid-template-columns:1fr; } }
  `]
})
export class RateView implements OnInit {
  private readonly service = inject(RateService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly confirm = inject(DialogService);

  readonly loading = signal(true);
  readonly loadingSlabs = signal(false);
  readonly rate = signal<RateResponse | null>(null);
  readonly siblingSlabs = signal<Rate[]>([]);
  private id = '';

  private readonly routeOptions = signal<SelectOption[]>([]);
  private readonly serviceTypeOptions = signal<SelectOption[]>([]);
  private readonly packageTypeOptions = signal<SelectOption[]>([]);
  private readonly paymentModeOptions = signal<SelectOption[]>([]);
  readonly routeNames = computed(() => new Map(this.routeOptions().map((o) => [o.value, o.label])));
  readonly serviceTypeNames = computed(() => new Map(this.serviceTypeOptions().map((o) => [o.value, o.label])));
  readonly packageTypeNames = computed(() => new Map(this.packageTypeOptions().map((o) => [o.value, o.label])));
  readonly paymentModeNames = computed(() => new Map(this.paymentModeOptions().map((o) => [o.value, o.label])));

  readonly can = computed(() => ({
    update: this.perms.canAccess({ roles: WRITERS, permissions: ['RATE_MASTER_UPDATE'] }),
    lifecycle: this.perms.canAccess({ roles: LIFECYCLE, permissions: ['RATE_MASTER_ACTIVATE', 'RATE_MASTER_DEACTIVATE'] })
  }));

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
        this.breadcrumb.set([{ label: 'Rate Master', route: '/rates' }, { label: r.rateCode }]);
        this.loading.set(false);
        this.loadSlabs(r);
      },
      error: () => { this.rate.set(null); this.loading.set(false); }
    });
  }

  private loadSlabs(r: RateResponse): void {
    this.loadingSlabs.set(true);
    this.service.siblings(r.routeId, r.serviceTypeId, r.packageTypeId, r.paymentModeId).subscribe({
      next: (page) => { this.siblingSlabs.set(page.content); this.loadingSlabs.set(false); },
      error: () => { this.siblingSlabs.set([]); this.loadingSlabs.set(false); }
    });
  }

  private reload(): void { this.service.get(this.id).subscribe((r) => { this.rate.set(r); this.loadSlabs(r); }); }

  edit(): void { this.router.navigate(['/rates', this.id, 'edit']); }

  lifecycle(op: 'activate'): void {
    this.service[op](this.id).subscribe({
      next: () => { this.notify.success(`Rate ${op}d.`); this.reload(); },
      error: (e) => this.notify.error(e?.error?.message ?? `Could not ${op} the rate.`)
    });
  }

  deactivate(): void {
    this.confirm.confirm({
      title: 'Deactivate rate',
      message: `"${this.rate()!.rateCode}" will be withdrawn from pricing until reactivated. Shipments already booked against it are unaffected.`,
      confirmLabel: 'Deactivate', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.deactivate(this.id).subscribe({
        next: () => { this.notify.success('Rate deactivated.'); this.reload(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not deactivate the rate.')
      });
    });
  }
}
