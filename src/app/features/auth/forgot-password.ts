import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiButton } from '@shared/components/ui-button/ui-button';

/**
 * Requests a reset link. The backend answers 200 whether or not the account exists, so
 * this always shows the same confirmation and never reveals a registered address.
 * A company id is required by the API, so it is collected as "Company ID".
 */
@Component({
  selector: 'app-forgot-password',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, UiInput, UiButton],
  template: `
    <div class="auth-card app-card">
      @if (!sent()) {
        <div class="auth-card__head">
          <h1 class="text-h1">Forgot password</h1>
          <p class="text-caption">Enter your account details and we'll email you a reset link.</p>
        </div>
        <form class="auth-card__form" [formGroup]="form" (ngSubmit)="submit()">
          <app-input [control]="ctrl('companyId')" label="Company ID" placeholder="Your company id"
                     icon="apartment" [required]="true" [maxLength]="50" />
          <app-input [control]="ctrl('email')" label="Email" type="email" placeholder="you@company.com"
                     icon="mail" [required]="true" autocomplete="username" [maxLength]="255" />
          <app-button type="submit" [loading]="loading()" [disabled]="form.invalid">Send reset link</app-button>
        </form>
      } @else {
        <div class="auth-card__head">
          <div class="auth-card__ok"><span>✓</span></div>
          <h1 class="text-h1">Check your inbox</h1>
          <p class="text-caption">If that account exists, a password reset link is on its way.</p>
        </div>
      }
      <a class="auth-card__back" routerLink="/login">← Back to sign in</a>
    </div>
  `,
  styles: [`
    .auth-card { width:400px; max-width:100%; padding:32px; }
    .auth-card__head { margin-bottom:24px; }
    .auth-card__form { display:flex; flex-direction:column; gap:16px; }
    .auth-card__ok { width:44px; height:44px; border-radius:16px; background:var(--success-bg); color:var(--success);
      display:grid; place-items:center; font-size:25px; font-weight:700; margin-bottom:12px; box-shadow:var(--shadow-clay-sm); }
    .auth-card__back { display:inline-block; margin-top:20px; font:600 16px var(--font-sans);
      color:var(--brand-600); text-decoration:none; }
    app-button { display:block; }
  `]
})
export class ForgotPassword {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);

  readonly loading = signal(false);
  readonly sent = signal(false);

  readonly form = this.fb.nonNullable.group({
    companyId: ['', [Validators.required, Validators.maxLength(50)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(255)]]
  });

  ctrl(name: 'companyId' | 'email') { return this.form.controls[name]; }

  submit(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.loading.set(true);
    const { companyId, email } = this.form.getRawValue();
    this.auth.forgotPassword({ companyId, email }).subscribe({
      // Success and failure look identical by design — the account must not be disclosed.
      next: () => { this.loading.set(false); this.sent.set(true); },
      error: () => { this.loading.set(false); this.sent.set(true); }
    });
  }
}
