import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole, RoleProfile } from '@core/models/role.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { RoleStatusBadge } from './components/role-status-badge';
import { RoleService } from './role.service';

const WRITERS = [AppRole.COMPANY_ADMIN];

/** View Role — full read-only profile plus the gated action bar (lifecycle, clone, delete). */
@Component({
  selector: 'app-role-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, UiCard, UiLoader, UiButton, RoleStatusBadge, MatMenuModule, MatIconModule],
  template: `
    <div class="page">
      @if (loading()) {
        <app-loader [minHeight]="320" caption="Loading…" />
      } @else if (!role()) {
        <app-card><p class="empty">Role not found or outside your scope.</p></app-card>
      } @else {
        <header class="rv__banner app-card">
          <div class="rv__id">
            <span class="rv__av"><mat-icon>badge</mat-icon></span>
            <div>
              <div class="rv__name"><h1 class="text-h1">{{ role()!.roleName }}</h1>
                <app-role-status-badge [status]="role()!.status" /></div>
              <p class="text-caption mono">{{ role()!.roleCode }}</p>
              <div class="rv__tags">
                <span class="tag">{{ pretty(role()!.roleType) }}</span>
                @if (role()!.isSystemRole) { <span class="tag">System</span> }
                @if (role()!.isDefault) { <span class="tag tag--brand">Default</span> }
              </div>
            </div>
          </div>
          <div class="rv__actions">
            @if (can().update) { <app-button variant="stroked" icon="edit" (pressed)="edit()">Edit</app-button> }
            @if (hasMenu()) {
              <button class="kebab" [matMenuTriggerFor]="menu"><mat-icon>more_vert</mat-icon></button>
              <mat-menu #menu="matMenu">
                @if (can().update) {
                  @if (role()!.status === 'INACTIVE') {
                    <button mat-menu-item (click)="lifecycle('activate')"><mat-icon>check_circle</mat-icon><span>Activate</span></button>
                  } @else if (!role()!.isDefault) {
                    <button mat-menu-item (click)="deactivate()"><mat-icon>block</mat-icon><span>Deactivate</span></button>
                  }
                }
                @if (can().create) { <button mat-menu-item (click)="clone()"><mat-icon>content_copy</mat-icon><span>Clone</span></button> }
                @if (can().delete && !role()!.isSystemRole && !role()!.isDefault) {
                  <button mat-menu-item class="danger" (click)="remove()"><mat-icon>delete</mat-icon><span>Delete</span></button>
                }
              </mat-menu>
            }
          </div>
        </header>

        <div class="rv__grid">
          <app-card title="Details">
            <dl class="kv">
              <dt>Role Code</dt><dd class="mono">{{ role()!.roleCode }}</dd>
              <dt>Role Name</dt><dd>{{ role()!.roleName }}</dd>
              <dt>Type</dt><dd>{{ pretty(role()!.roleType) }}</dd>
              <dt>Description</dt><dd>{{ role()!.description || '—' }}</dd>
              <dt>Status</dt><dd>{{ pretty(role()!.status) }}</dd>
              <dt>System Role</dt><dd>{{ role()!.isSystemRole ? 'Yes' : 'No' }}</dd>
              <dt>Default Role</dt><dd>{{ role()!.isDefault ? 'Yes' : 'No' }}</dd>
            </dl>
          </app-card>

          <app-card title="Audit">
            <dl class="kv">
              <dt>Created</dt><dd>{{ role()!.createdDate ? (role()!.createdDate | date:'medium') : '—' }}</dd>
              <dt>Last Updated</dt><dd>{{ role()!.updatedDate ? (role()!.updatedDate | date:'medium') : '—' }}</dd>
              <dt>Version</dt><dd>{{ role()!.version }}</dd>
            </dl>
          </app-card>

          <app-card [title]="'Permissions (' + role()!.permissions.length + ')'"
                    subtitle="Granted through the Permission module.">
            @if (role()!.permissions.length) {
              <div class="chips">@for (p of role()!.permissions; track p) { <span class="chip mono">{{ p }}</span> }</div>
            } @else {
              <p class="empty-inline">No permissions granted yet. Assign them in the Permission module.</p>
            }
          </app-card>
        </div>
      }
    </div>
  `,
  styles: [`
    .rv__banner { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:20px 24px; margin-bottom:16px; }
    .rv__id { display:flex; gap:16px; align-items:center; }
    .rv__av { width:56px; height:56px; border-radius:14px; background:var(--brand-100); color:var(--brand-700); display:grid; place-items:center; }
    .rv__av mat-icon { font-size:28px; width:28px; height:28px; }
    .rv__name { display:flex; align-items:center; gap:12px; }
    .rv__tags { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
    .mono { font-family:var(--font-mono, var(--font-sans)); }
    .tag { display:inline-block; background:var(--surface-muted); border:1px solid var(--surface-border); color:var(--content-muted);
      font:600 14px var(--font-sans); padding:2px 8px; border-radius:6px; }
    .tag--brand { background:var(--brand-50); color:var(--brand-700); border-color:var(--brand-100); }
    .rv__actions { display:flex; gap:10px; align-items:center; }
    .kebab { border:0; background:var(--surface); cursor:pointer; color:var(--content-muted); display:inline-flex;
      padding:8px; border-radius:8px; border:1px solid var(--surface-border); }
    .kebab:hover { background:var(--surface-muted); }
    .danger { color:var(--danger); }
    .rv__grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
    .rv__grid > app-card:last-child { grid-column:1 / -1; }
    .kv { display:grid; grid-template-columns:150px 1fr; gap:10px 16px; margin:0; }
    .kv dt { font:500 16px var(--font-sans); color:var(--content-muted); }
    .kv dd { font:600 17px var(--font-sans); color:var(--content-fg); margin:0; }
    .chips { display:flex; flex-wrap:wrap; gap:6px; }
    .chip { background:var(--brand-50); color:var(--brand-700); border:1px solid var(--brand-100);
      font:600 14px var(--font-sans); padding:3px 9px; border-radius:999px; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
    .empty-inline { font:400 16px var(--font-sans); color:var(--content-muted); }
    @media (max-width:860px){ .rv__grid{ grid-template-columns:1fr; } }
  `]
})
export class RoleView implements OnInit {
  private readonly service = inject(RoleService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly confirm = inject(DialogService);

  readonly loading = signal(true);
  readonly role = signal<RoleProfile | null>(null);
  private id = '';

  readonly can = computed(() => ({
    create: this.perms.canAccess({ roles: WRITERS, permissions: ['ROLE_CREATE'] }),
    update: this.perms.canAccess({ roles: WRITERS, permissions: ['ROLE_UPDATE'] }),
    delete: this.perms.canAccess({ roles: WRITERS, permissions: ['ROLE_DELETE'] })
  }));
  readonly hasMenu = computed(() => { const c = this.can(); return c.create || c.update || c.delete; });

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.get(this.id).subscribe({
      next: (r) => {
        this.role.set(r);
        this.breadcrumb.set([{ label: 'Roles', route: '/roles' }, { label: r.roleName }]);
        this.loading.set(false);
      },
      error: () => { this.role.set(null); this.loading.set(false); }
    });
  }

  private reload(): void { this.service.get(this.id).subscribe((r) => this.role.set(r)); }

  pretty(v?: string): string { return v ? v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : '—'; }

  edit(): void { this.router.navigate(['/roles', this.id, 'edit']); }
  clone(): void { this.router.navigate(['/roles/new'], { queryParams: { cloneFrom: this.id } }); }

  lifecycle(op: 'activate'): void {
    this.service[op](this.id).subscribe({
      next: () => { this.notify.success(`Role ${op}d.`); this.reload(); },
      error: (e) => this.notify.error(e?.error?.message ?? `Could not ${op} the role.`)
    });
  }

  deactivate(): void {
    this.confirm.confirm({
      title: 'Deactivate role',
      message: `"${this.role()!.roleName}" will be withdrawn from the assignment list. Users who already hold it keep it.`,
      confirmLabel: 'Deactivate', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.deactivate(this.id).subscribe({
        next: () => { this.notify.success('Role deactivated.'); this.reload(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not deactivate the role.')
      });
    });
  }

  remove(): void {
    this.confirm.confirm({
      title: 'Delete role',
      message: `"${this.role()!.roleName}" will be removed. Its code stays reserved and holders are not reassigned.`,
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.remove(this.id).subscribe({
        next: () => { this.notify.success('Role deleted.'); this.router.navigate(['/roles']); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not delete the role.')
      });
    });
  }
}
