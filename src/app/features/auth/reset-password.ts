import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '@core/auth/auth.service';
import { NotificationService } from '@core/services/notification.service';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiButton } from '@shared/components/ui-button/ui-button';

/** Completes a reset using the token from the emailed link (`?token=`). */
@Component({
  selector: 'app-reset-password',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, UiInput, UiButton],
  template: `
    <div class="auth-card app-card">
      <div class="auth-card__head">
        <h1 class="text-h1">Set a new password</h1>
        <p class="text-caption">Choose a strong password you don't use elsewhere.</p>
      </div>

      @if (!token) {
        <p class="auth-card__error">This reset link is invalid or has expired. Request a new one.</p>
        <a class="auth-card__back" routerLink="/forgot-password">Request a new link</a>
      } @else {
        <form class="auth-card__form" [formGroup]="form" (ngSubmit)="submit()">
          <app-input [control]="ctrl('newPassword')" label="New password" type="password" [maxLength]="72"
                     placeholder="••••••••" icon="lock" [required]="true" [togglePassword]="true"
                     autocomplete="new-password" />
          <app-input [control]="ctrl('confirm')" label="Confirm password" type="password" [maxLength]="72"
                     placeholder="••••••••" icon="lock" [required]="true" [togglePassword]="true"
                     autocomplete="new-password" />
          @if (mismatch()) { <p class="auth-card__error">Passwords do not match.</p> }
          @if (error()) { <p class="auth-card__error">{{ error() }}</p> }
          <app-button type="submit" [loading]="loading()" [disabled]="form.invalid">Reset password</app-button>
        </form>
        <a class="auth-card__back" routerLink="/login">← Back to sign in</a>
      }
    </div>
  `,
  styles: [`
    .auth-card { width:400px; max-width:100%; padding:32px; }
    .auth-card__head { margin-bottom:24px; }
    .auth-card__form { display:flex; flex-direction:column; gap:16px; }
    .auth-card__error { background:var(--danger-bg); color:var(--danger); padding:10px 12px;
      border-radius:10px; font:500 16px var(--font-sans); margin:0; }
    .auth-card__back { display:inline-block; margin-top:20px; font:600 16px var(--font-sans);
      color:var(--brand-600); text-decoration:none; }
    app-button { display:block; }
  `]
})
export class ResetPassword {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly notify = inject(NotificationService);

  readonly token = this.route.snapshot.queryParamMap.get('token');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    newPassword: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(72)]],
    confirm: ['', [Validators.required, Validators.maxLength(72)]]
  }, { validators: [matchPasswords] });

  ctrl(name: 'newPassword' | 'confirm') { return this.form.controls[name]; }
  mismatch(): boolean {
    return this.form.hasError('mismatch') && this.form.controls.confirm.touched;
  }

  submit(): void {
    if (this.form.invalid || !this.token) { this.form.markAllAsTouched(); return; }
    this.loading.set(true); this.error.set(null);
    this.auth.resetPassword({ token: this.token, newPassword: this.form.getRawValue().newPassword }).subscribe({
      next: () => {
        this.notify.success('Password reset. Sign in with your new password.');
        this.router.navigateByUrl('/login');
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(err.error?.message ?? 'Could not reset password. The link may have expired.');
      }
    });
  }
}

/** Cross-field: the two password entries must be equal. */
function matchPasswords(group: AbstractControl): ValidationErrors | null {
  const pw = group.get('newPassword')?.value;
  const confirm = group.get('confirm')?.value;
  return pw && confirm && pw !== confirm ? { mismatch: true } : null;
}
