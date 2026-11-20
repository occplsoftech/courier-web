import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { Permission, prettyToken } from '@core/models/permission.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { PermissionService } from './permission.service';

/** Permission Details — full read-only profile of one catalogue right. */
@Component({
  selector: 'app-permission-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatIconModule, UiCard, UiLoader, UiButton, StatusBadge],
  template: `
    <div class="page">
      @if (loading()) {
        <app-loader [minHeight]="320" caption="Loading…" />
      } @else if (!perm()) {
        <app-card><p class="empty">Permission not found.</p></app-card>
      } @else {
        <header class="pv__banner app-card">
          <div class="pv__id">
            <span class="pv__av"><mat-icon>{{ icon() }}</mat-icon></span>
            <div>
              <div class="pv__name"><h1 class="text-h1">{{ perm()!.permissionName }}</h1>
                <app-status-badge [value]="perm()!.status" /></div>
              <p class="text-caption mono">{{ perm()!.permissionCode }}</p>
              <div class="pv__tags">
                <span class="tag tag--brand">{{ pretty(perm()!.module) }}</span>
                <span class="tag">{{ pretty(perm()!.action) }}</span>
                @if (perm()!.isSystemPermission) { <span class="tag">System</span> }
                @if (perm()!.requiredFeatureFlag) { <span class="tag tag--gate"><mat-icon>lock</mat-icon>Plan-gated</span> }
              </div>
            </div>
          </div>
          <app-button variant="stroked" icon="arrow_back" (pressed)="back()">Back</app-button>
        </header>

        <div class="pv__grid">
          <app-card title="Details">
            <dl class="kv">
              <dt>Permission Code</dt><dd class="mono">{{ perm()!.permissionCode }}</dd>
              <dt>Permission Name</dt><dd>{{ perm()!.permissionName }}</dd>
              <dt>Module</dt><dd>{{ pretty(perm()!.module) }}</dd>
              <dt>Action</dt><dd>{{ pretty(perm()!.action) }}</dd>
              <dt>Resource</dt><dd class="mono">{{ perm()!.resource || '—' }}</dd>
              <dt>Description</dt><dd>{{ perm()!.description || '—' }}</dd>
              <dt>Status</dt><dd>{{ pretty(perm()!.status) }}</dd>
              <dt>System Permission</dt><dd>{{ perm()!.isSystemPermission ? 'Yes — seeded, read-only' : 'No' }}</dd>
              <dt>Required Plan Feature</dt><dd class="mono">{{ perm()!.requiredFeatureFlag || '— (unconditional)' }}</dd>
              <dt>Display Order</dt><dd>{{ perm()!.displayOrder }}</dd>
            </dl>
          </app-card>

          <app-card title="Audit">
            <dl class="kv">
              <dt>Created</dt><dd>{{ perm()!.createdDate ? (perm()!.createdDate | date:'medium') : '—' }}</dd>
              <dt>Last Updated</dt><dd>{{ perm()!.updatedDate ? (perm()!.updatedDate | date:'medium') : '—' }}</dd>
              <dt>Version</dt><dd>{{ perm()!.version }}</dd>
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
    .mono { font-family:var(--font-mono, ui-monospace); }
    .tag { display:inline-flex; align-items:center; gap:3px; background:var(--surface-muted); border:1px solid var(--surface-border);
      color:var(--content-muted); font:600 14px var(--font-sans); padding:2px 8px; border-radius:6px; }
    .tag mat-icon { font-size:13px; width:13px; height:13px; }
    .tag--brand { background:var(--brand-50); color:var(--brand-700); border-color:var(--brand-100); }
    .tag--gate { background:var(--warning-bg); color:var(--warning); border-color:transparent; }
    .pv__grid { display:grid; grid-template-columns:2fr 1fr; gap:16px; }
    .kv { display:grid; grid-template-columns:170px 1fr; gap:10px 16px; margin:0; }
    .kv dt { font:500 16px var(--font-sans); color:var(--content-muted); }
    .kv dd { font:600 17px var(--font-sans); color:var(--content-fg); margin:0; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
    @media (max-width:860px){ .pv__grid { grid-template-columns:1fr; } }
  `]
})
export class PermissionView implements OnInit {
  private readonly service = inject(PermissionService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly perm = signal<Permission | null>(null);

  pretty = prettyToken;
  icon(): string { return this.perm() ? this.moduleIcon(this.perm()!.module) : 'lock'; }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.service.get(id).subscribe({
      next: (p) => {
        this.perm.set(p);
        this.breadcrumb.set([{ label: 'Permissions', route: '/permissions' }, { label: p.permissionName }]);
        this.loading.set(false);
      },
      error: () => { this.perm.set(null); this.loading.set(false); }
    });
  }

  back(): void { this.router.navigate(['/permissions']); }

  private moduleIcon(module: string): string {
    const map: Record<string, string> = {
      AUTH: 'vpn_key', COMPANY: 'business', USER: 'group', ROLE: 'badge', PERMISSION: 'lock',
      BRANCH: 'store', HUB: 'hub', CUSTOMER: 'person', SHIPMENT: 'local_shipping', TRACKING: 'my_location',
      PAYMENT: 'credit_card', INVOICE: 'description', REPORT: 'assessment', DASHBOARD: 'dashboard',
      SETTINGS: 'settings', NOTIFICATION: 'notifications', AUDIT: 'fact_check'
    };
    return map[module] ?? 'lock';
  }
}
