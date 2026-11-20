import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { CreateRoleRequest, RoleProfile, UpdateRoleRequest } from '@core/models/role.model';
import { Department } from '@core/models/department.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { RoleForm } from './components/role-form';
import { RoleService } from './role.service';
import { DepartmentService } from '../departments/department.service';

/** Edit Role — loads the profile, PUTs a full replacement, handles the 409 optimistic lock. */
@Component({
  selector: 'app-role-edit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiLoader, RoleForm],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Edit Role</h1><p class="text-caption">Update the role. The code is immutable; permissions have their own module.</p></div>
      </header>
      @if (loading()) {
        <app-loader [minHeight]="280" caption="Loading…" />
      } @else if (!role()) {
        <app-card><p class="empty">Role not found or outside your scope.</p></app-card>
      } @else {
        <app-role-form mode="edit" [role]="role()" [saving]="saving()" [departments]="departments()"
                       (departmentsChanged)="pendingDepartmentIds = $event"
                       (saved)="save($event)" (cancelled)="cancel()" />
      }
    </div>
  `,
  styles: [`.empty{ font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }`]
})
export class RoleEdit implements OnInit {
  private readonly service = inject(RoleService);
  private readonly departmentService = inject(DepartmentService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly role = signal<RoleProfile | null>(null);
  readonly departments = signal<Department[]>([]);
  protected pendingDepartmentIds: string[] | null = null;
  private id = '';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.breadcrumb.set([{ label: 'Roles', route: '/roles' }, { label: 'Edit' }]);
    this.departmentService.list().subscribe({ next: (d) => this.departments.set(d), error: () => {} });
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.service.get(this.id).subscribe({
      next: (r) => {
        this.role.set(r);
        this.breadcrumb.set([{ label: 'Roles', route: '/roles' }, { label: r.roleName, route: `/roles/${this.id}` }, { label: 'Edit' }]);
        this.loading.set(false);
      },
      error: () => { this.role.set(null); this.loading.set(false); }
    });
  }

  save(body: CreateRoleRequest | UpdateRoleRequest): void {
    this.saving.set(true);
    this.service.update(this.id, body as UpdateRoleRequest).subscribe({
      next: () => {
        this.saving.set(false); this.notify.success('Role updated.');
        if (this.pendingDepartmentIds === null) { this.router.navigate(['/roles', this.id]); return; }
        this.departmentService.syncRoleGrants(this.id, this.pendingDepartmentIds).subscribe({
          next: () => this.router.navigate(['/roles', this.id]),
          error: () => {
            this.notify.error('Role updated, but the department changes failed — adjust them from the Departments page.');
            this.router.navigate(['/roles', this.id]);
          }
        });
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 409) { this.notify.error('This role changed since you opened it. Reloading the latest version.'); this.load(); }
        else if (err.status === 400 || err.status === 422) this.notify.error(err.error?.message ?? 'Please correct the highlighted fields.');
        else this.notify.error('Could not update the role.');
      }
    });
  }

  cancel(): void { this.router.navigate(['/roles', this.id]); }
}
