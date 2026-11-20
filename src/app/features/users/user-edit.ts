import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { CreateUserRequest, UpdateUserRequest, UserProfile } from '@core/models/user.model';
import { CompanyRole } from '@core/models/role.model';
import { Department } from '@core/models/department.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UserForm } from './components/user-form';
import { Lookup, UserService } from './user.service';

/** Edit User — loads the profile + lookups, PUTs a full replacement, handles the 409 lock. */
@Component({
  selector: 'app-user-edit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiLoader, UserForm],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Edit User</h1><p class="text-caption">Update the profile. Identity, roles and password have their own actions.</p></div>
      </header>
      @if (loading()) {
        <app-loader [minHeight]="280" caption="Loading…" />
      } @else if (!user()) {
        <app-card><p class="empty">User not found or outside your scope.</p></app-card>
      } @else {
        <app-user-form mode="edit" [user]="user()" [departments]="departments()" [branches]="branches()" [hubs]="hubs()"
                       [managers]="managers()" [saving]="saving()" (saved)="save($event)" (cancelled)="cancel()" />
      }
    </div>
  `,
  styles: [`.empty{ font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }`]
})
export class UserEdit implements OnInit {
  private readonly service = inject(UserService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly user = signal<UserProfile | null>(null);
  readonly departments = signal<Department[]>([]);
  readonly branches = signal<Lookup[]>([]);
  readonly hubs = signal<Lookup[]>([]);
  readonly managers = signal<Lookup[]>([]);
  private id = '';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.breadcrumb.set([{ label: 'Users', route: '/users' }, { label: 'Edit' }]);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    forkJoin({
      user: this.service.get(this.id), departments: this.service.departments(),
      branches: this.service.branches(), hubs: this.service.hubs(), managers: this.service.managers(this.id)
    }).subscribe({
        next: (l) => {
          this.user.set(l.user); this.departments.set(l.departments); this.branches.set(l.branches);
          this.hubs.set(l.hubs); this.managers.set(l.managers);
          this.breadcrumb.set([{ label: 'Users', route: '/users' }, { label: l.user.displayName, route: `/users/${this.id}` }, { label: 'Edit' }]);
          this.loading.set(false);
        },
        error: () => { this.user.set(null); this.loading.set(false); }
      });
  }

  save(body: CreateUserRequest | UpdateUserRequest): void {
    this.saving.set(true);
    this.service.update(this.id, body as UpdateUserRequest).subscribe({
      next: () => { this.saving.set(false); this.notify.success('User updated.'); this.router.navigate(['/users', this.id]); },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 409) { this.notify.error('This user changed since you opened it. Reloading the latest version.'); this.load(); }
        else if (err.status === 400 || err.status === 422) this.notify.error(err.error?.message ?? 'Please correct the highlighted fields.');
        else this.notify.error('Could not update the user.');
      }
    });
  }

  cancel(): void { this.router.navigate(['/users', this.id]); }
}
