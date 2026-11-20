import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppRole } from '@core/models/role.model';
import { Department, CreateDepartmentRequest, UpdateDepartmentRequest } from '@core/models/department.model';
import { CompanyRole } from '@core/models/role.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiDrawer } from '@shared/components/ui-drawer/ui-drawer';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { RoleService } from '@features/roles/role.service';
import { DepartmentForm } from './components/department-form';
import { DepartmentService } from './department.service';

const WRITERS = [AppRole.COMPANY_ADMIN];

/**
 * Department directory. Unpaged — a company has a handful of departments, not a
 * catalogue — with create/edit done inline in a drawer rather than a separate route,
 * since the form is short. COMPANY_ADMIN-only, both reads and writes.
 */
@Component({
  selector: 'app-department-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiLoader, UiButton, UiDrawer, StatusBadge, MatIconModule, MatMenuModule, DepartmentForm],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Departments</h1><p class="text-caption">Organise staff into departments, and the roles each one offers — {{ departments().length }} in all.</p></div>
        <div class="page__actions">
          @if (can().create) { <app-button icon="add" (pressed)="create()">New Department</app-button> }
        </div>
      </header>

      @if (loading()) {
        <app-loader [minHeight]="280" caption="Loading…" />
      } @else if (departments().length === 0) {
        <app-card><p class="empty">No departments yet. Create one to start grouping roles for user placement.</p></app-card>
      } @else {
        <app-card>
          <div class="tbl__wrap">
            <table class="tbl">
              <thead>
                <tr><th>Code</th><th>Name</th><th>Description</th><th>Roles</th><th>Status</th><th style="width:56px"></th></tr>
              </thead>
              <tbody>
                @for (d of departments(); track d.id) {
                  <tr>
                    <td class="mono">{{ d.departmentCode }}</td>
                    <td class="name">{{ d.departmentName }}</td>
                    <td class="muted">{{ d.description || '—' }}</td>
                    <td>
                      @if (d.roles.length) {
                        <span class="chips">
                          @for (r of d.roles; track r.id) { <span class="chip">{{ r.roleName }}</span> }
                        </span>
                      } @else { <span class="muted">None</span> }
                    </td>
                    <td><app-status-badge [value]="d.status" /></td>
                    <td class="col-actions">
                      @if (can().update || can().delete) {
                        <button class="kebab" [matMenuTriggerFor]="menu" aria-label="Actions"><mat-icon>more_vert</mat-icon></button>
                        <mat-menu #menu="matMenu">
                          @if (can().update) {
                            <button mat-menu-item (click)="edit(d)"><mat-icon>edit</mat-icon><span>Edit</span></button>
                            @if (d.status === 'INACTIVE') {
                              <button mat-menu-item (click)="lifecycle(d, 'activate')"><mat-icon>check_circle</mat-icon><span>Activate</span></button>
                            } @else {
                              <button mat-menu-item (click)="lifecycle(d, 'deactivate')"><mat-icon>block</mat-icon><span>Deactivate</span></button>
                            }
                          }
                          @if (can().delete) {
                            <button mat-menu-item (click)="remove(d)"><mat-icon>delete</mat-icon><span>Delete</span></button>
                          }
                        </mat-menu>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </app-card>
      }

      <app-drawer [open]="formOpen()" [title]="editing() ? 'Edit Department' : 'New Department'"
                  subtitle="Roles this department offers to a user placed in it." (closed)="closeForm()">
        <app-department-form [mode]="editing() ? 'edit' : 'create'" [department]="editing()" [roles]="roles()"
                              [saving]="saving()" (saved)="save($event)" (cancelled)="closeForm()" />
      </app-drawer>
    </div>
  `,
  styles: [`
    .tbl__wrap { overflow-x:auto; }
    .tbl { width:100%; border-collapse:collapse; font:400 17px var(--font-sans); }
    .tbl th { text-align:left; padding:10px 12px; font:600 15px var(--font-sans); color:var(--content-muted);
      border-bottom:1px solid var(--surface-border); white-space:nowrap; }
    .tbl td { padding:10px 12px; border-bottom:1px solid var(--surface-border); vertical-align:top; }
    .tbl .name { font:600 17px var(--font-sans); color:var(--content-fg); }
    .tbl .mono { font-family:var(--font-mono, var(--font-sans)); }
    .tbl .muted { color:var(--content-muted); }
    .chips { display:flex; flex-wrap:wrap; gap:6px; }
    .chip { padding:2px 8px; background:var(--surface-muted); border-radius:999px; font:500 15px var(--font-sans); }
    .col-actions { text-align:right; width:56px; }
    .kebab { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:inline-flex; padding:4px; border-radius:8px; }
    .kebab:hover { background:var(--surface-muted); }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }
  `]
})
export class DepartmentList implements OnInit {
  private readonly service = inject(DepartmentService);
  private readonly roleService = inject(RoleService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly perms = inject(PermissionService);
  private readonly confirm = inject(DialogService);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly formOpen = signal(false);
  readonly editing = signal<Department | null>(null);
  readonly departments = signal<Department[]>([]);
  readonly roles = signal<CompanyRole[]>([]);

  readonly can = computed(() => ({
    create: this.perms.canAccess({ roles: WRITERS, permissions: ['DEPARTMENT_CREATE'] }),
    update: this.perms.canAccess({ roles: WRITERS, permissions: ['DEPARTMENT_UPDATE'] }),
    delete: this.perms.canAccess({ roles: WRITERS, permissions: ['DEPARTMENT_DELETE'] })
  }));

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Departments' }]);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    forkJoin({ departments: this.service.list(), roles: this.roleService.assignable() }).subscribe({
      next: (r) => { this.departments.set(r.departments); this.roles.set(r.roles); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  create(): void { this.editing.set(null); this.formOpen.set(true); }
  edit(d: Department): void { this.editing.set(d); this.formOpen.set(true); }
  closeForm(): void { this.formOpen.set(false); this.editing.set(null); }

  save(body: CreateDepartmentRequest | UpdateDepartmentRequest): void {
    this.saving.set(true);
    const editing = this.editing();
    const request = editing
      ? this.service.update(editing.id, body as UpdateDepartmentRequest)
      : this.service.create(body as CreateDepartmentRequest);

    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.notify.success(editing ? 'Department updated.' : 'Department created.');
        this.closeForm();
        this.load();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 409) this.notify.error(err.error?.message ?? 'This department changed since you opened it.');
        else if (err.status === 400 || err.status === 422) this.notify.error(err.error?.message ?? 'Please correct the highlighted fields.');
        else this.notify.error(editing ? 'Could not update the department.' : 'Could not create the department.');
      }
    });
  }

  lifecycle(d: Department, op: 'activate' | 'deactivate'): void {
    this.service[op](d.id).subscribe({
      next: () => { this.notify.success(`Department ${op}d.`); this.load(); },
      error: (e) => this.notify.error(e?.error?.message ?? `Could not ${op} the department.`)
    });
  }

  remove(d: Department): void {
    this.confirm.confirm({
      title: 'Delete department',
      message: `"${d.departmentName}" will be removed. This is refused if any user is still placed in it — move them first.`,
      confirmLabel: 'Delete', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.remove(d.id).subscribe({
        next: () => { this.notify.success('Department deleted.'); this.load(); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not delete the department.')
      });
    });
  }
}
