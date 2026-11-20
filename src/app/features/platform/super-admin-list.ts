import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { SuperAdminUser } from '@core/models/company.model';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { TemporaryPasswordDialog } from './components/temporary-password-dialog';
import { SuperAdminService } from './super-admin.service';

/**
 * Platform operators: who acts above the companies, and adding another.
 *
 * <p>List and create on one screen. There are a handful of these accounts, not a paged
 * table of thousands, and a separate create route for a five-field form would be
 * ceremony.
 *
 * <p>`PLATFORM_ADMIN` accounts appear alongside `SUPER_ADMIN` ones because the question
 * this screen answers is "who operates above the companies" — omitting the role that can
 * impersonate any company would make the answer wrong in the one direction that matters.
 * They cannot be created here: this form makes super admins and nothing else.
 */
@Component({
  selector: 'app-super-admin-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, ReactiveFormsModule, MatIconModule, StatusBadge, UiButton, UiCard, UiInput, UiLoader],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">Platform Operators</h1>
          <p class="text-caption">Accounts that act above every company.</p>
        </div>
      </header>

      <app-card title="Accounts" subtitle="Super admins and platform admins, across all companies.">
        @if (loading()) {
          <app-loader [minHeight]="200" caption="Loading operators…" />
        } @else if (users().length === 0) {
          <p class="empty">No platform operators are listed. If that is a surprise, check that
            you are signed in as a super admin — nobody else may read this.</p>
        } @else {
          <table class="ops">
            <thead>
              <tr><th>#</th><th>Email</th><th>Name</th><th>Roles</th><th>Status</th><th>Last sign-in</th></tr>
            </thead>
            <tbody>
              @for (user of users(); track user.id; let i = $index) {
                <tr>
                  <td>{{ i + 1 }}</td>
                  <td class="mono">{{ user.email }}</td>
                  <td>{{ fullName(user) }}</td>
                  <td class="roles">
                    @for (role of user.roles; track role) { <span class="chip">{{ role }}</span> }
                  </td>
                  <td><app-status-badge [value]="user.status" /></td>
                  <td>{{ user.lastLoginAt ? (user.lastLoginAt | date: 'medium') : 'Never' }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </app-card>

      <app-card title="Add a super admin"
        subtitle="The address must be unused across the whole platform, not just one company.">
        <form [formGroup]="form" (ngSubmit)="submit()" class="form">
          <app-input [control]="ctrl('email')" label="Email" type="email" [required]="true"
            placeholder="ops@platform.test" [maxLength]="255" />
          <app-input [control]="ctrl('firstName')" label="First name" [maxLength]="100" />
          <app-input [control]="ctrl('lastName')" label="Last name" [maxLength]="100" />
          <app-input [control]="ctrl('phone')" label="Phone" type="tel" [maxLength]="20" />
          <app-input [control]="ctrl('password')" label="Password (optional)" type="password"
            [togglePassword]="true" [maxLength]="72" />

          <p class="hint">
            <mat-icon>info</mat-icon>
            Leave the password blank and one is generated and shown to you once. It is never
            emailed, logged, or retrievable afterwards.
          </p>

          <div class="actions">
            <app-button type="submit" icon="person_add" [disabled]="saving() || form.invalid">
              {{ saving() ? 'Creating…' : 'Create super admin' }}
            </app-button>
          </div>
        </form>
      </app-card>
    </div>
  `,
  styles: [`
    .ops { width:100%; border-collapse:collapse; font:17px var(--font-sans); }
    .ops th { text-align:left; padding:8px 12px; color:var(--text-muted); font-weight:600; }
    .ops td { padding:10px 12px; border-top:1px solid var(--surface-border); }
    .mono { font-family:var(--font-mono,monospace); }
    .roles { display:flex; flex-wrap:wrap; gap:6px; }
    .chip { padding:2px 8px; border-radius:999px; background:var(--surface-muted);
      border:1px solid var(--surface-border); font:600 14px var(--font-sans); }
    .empty { color:var(--text-muted); margin:0; }
    .form { display:grid; gap:14px; max-width:520px; }
    .hint { display:flex; gap:8px; margin:0; color:var(--text-muted); font-size:15px; line-height:1.55; }
    .hint mat-icon { font-size:18px; width:18px; height:18px; flex:none; }
    .actions { display:flex; justify-content:flex-end; }
  `]
})
export class SuperAdminListPage implements OnInit {
  private readonly service = inject(SuperAdminService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  private readonly fb = inject(FormBuilder);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly users = signal<SuperAdminUser[]>([]);

  readonly form = this.fb.group({
    // Trimmed before validating: a pasted address with surrounding spaces is valid, and
    // the server trims it anyway, so showing an error about nothing is just wrong.
    email: ['', [Validators.required, trimmedEmail, Validators.maxLength(255)]],
    firstName: ['', Validators.maxLength(100)],
    lastName: ['', Validators.maxLength(100)],
    phone: ['', Validators.maxLength(20)],
    password: ['', Validators.maxLength(72)]
  });

  ngOnInit(): void {
    this.breadcrumbs.set([{ label: 'Platform' }, { label: 'Operators' }]);
    this.load();
  }

  ctrl(name: string): FormControl {
    return this.form.get(name) as FormControl;
  }

  fullName(user: SuperAdminUser): string {
    return [user.firstName, user.lastName].filter(Boolean).join(' ') || '—';
  }

  submit(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);

    const raw = this.form.getRawValue();
    this.service.create({
      email: (raw.email ?? '').trim(),
      firstName: raw.firstName || null,
      lastName: raw.lastName || null,
      phone: raw.phone || null,
      // Blank means "generate one", which is not the same as an empty password.
      password: raw.password ? raw.password : null
    }).subscribe({
      next: (created) => {
        this.saving.set(false);
        this.form.reset();
        this.load();

        if (created.temporaryPassword) {
          this.dialog.open(TemporaryPasswordDialog, {
            // The only moment this password exists in readable form.
            disableClose: true,
            data: {
              subject: 'Platform operator',
              email: created.email,
              password: created.temporaryPassword,
              nextStep: 'The account is active and its address is pre-verified — it can sign '
                + 'in immediately, with no company code.'
            }
          });
        } else {
          this.notify.success('Super admin created.');
        }
      },
      error: (err) => {
        this.saving.set(false);
        this.notify.error(err?.error?.message ?? 'Could not create the account.');
      }
    });
  }

  private load(): void {
    this.loading.set(true);
    this.service.list().subscribe({
      next: (users) => { this.users.set(users); this.loading.set(false); },
      error: () => { this.users.set([]); this.loading.set(false); }
    });
  }
}

/** `Validators.email` on the raw value rejects " a@b.test "; the server would accept it. */
function trimmedEmail(control: { value: unknown }) {
  const value = String(control.value ?? '').trim();
  if (!value) return null;
  return Validators.email({ value } as never);
}
