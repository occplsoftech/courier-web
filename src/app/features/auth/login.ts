import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { PlatformSsoService } from '@core/auth/platform-sso.service';
import { NotificationService } from '@core/services/notification.service';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { HttpErrorResponse } from '@angular/common/http';
import { environment } from '@env/environment';
import { companyCodeForHostname } from '@core/config/company-domain-map';
import { PUBLIC_PAGE_LINKS } from '@features/public/public-page.content';

/** Sign-in. Company slug (company code) is optional — the backend resolves it. The
 *  identifier field accepts either an email or a registered mobile number. */
@Component({
  selector: 'app-login',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, UiInput, UiButton],
  template: `
    <div class="login-wrap">
    <div class="login app-card">
      <div class="login__head">
        <h1 class="text-h1">Welcome back</h1>
        <p class="text-caption">Sign in to your Courier SaaS console.</p>
      </div>
      <a class="login__track" routerLink="/track-shipment">Track your shipment without signing in →</a>
      <form class="login__form" [formGroup]="form" (ngSubmit)="submit()">
        @if (devMode || companyLocked()) {
          <app-input [control]="ctrl('companyCode')" label="Company code" placeholder="e.g. ACME_LOGISTICS"
                     icon="apartment" autocomplete="organization" [maxLength]="50" />
          @if (companyLocked()) {
            <button type="button" class="login__unlock" (click)="clearCompanyLock()">Not your company? Sign in without one</button>
          }
        }
        <app-input [control]="ctrl('email')" label="Email or Mobile Number" type="text" placeholder="you@company.com or mobile number"
                   icon="mail" [required]="true" autocomplete="username" [maxLength]="255" />
        <app-input [control]="ctrl('password')" label="Password" type="password" placeholder="••••••••"
                   icon="lock" [required]="true" [togglePassword]="true" autocomplete="current-password" [maxLength]="72" />
        <div class="login__row">
          <label class="login__remember">
            <input type="checkbox" formControlName="rememberMe" /> <span>Remember me</span>
          </label>
          <a class="login__forgot" routerLink="/forgot-password">Forgot password?</a>
        </div>
        <app-button type="submit" [loading]="loading()" [disabled]="form.invalid">Sign in</app-button>
        @if (error()) { <p class="login__error">{{ error() }}</p> }
      </form>
      @if (ssoAvailable()) {
        <a class="login__sso" routerLink="/sso">Sign in with OCCPL</a>
      }

      @if (devMode) {
        <div class="login__dev">
          <span class="login__dev-label">Dev quick fill</span>
          <div class="login__dev-btns">
            <button type="button" class="login__dev-btn" (click)="fill('occplSupport')">OCCPL Support</button>
            <button type="button" class="login__dev-btn" (click)="fill('admin')">Super Admin</button>
            <button type="button" class="login__dev-btn" (click)="fill('company')">Company Admin</button>
            <button type="button" class="login__dev-btn" (click)="fill('pune')">Pune Branch</button>
            <button type="button" class="login__dev-btn" (click)="fill('satara')">Satara Branch</button>
            <button type="button" class="login__dev-btn" (click)="fill('kolhapur')">Kolhapur Branch</button>
            <button type="button" class="login__dev-btn" (click)="fill('hub')">Pune Test Hub</button>
            <button type="button" class="login__dev-btn" (click)="fill('hubPun')">Pune Hub (HB-PUN)</button>
          </div>
        </div>
      }
    </div>

    <footer class="login-public">
      <div class="login-public__brand">Amazing Logistics</div>
      <nav class="login-public__links">
        @for (link of publicLinks; track link.key) {
          <a [routerLink]="'/' + link.key">{{ link.label }}</a>
        }
      </nav>
      <p class="text-caption">© {{ year }} Amazing Logistics. All rights reserved.</p>
    </footer>
    </div>
  `,
  styles: [`
    .login-wrap { width:400px; max-width:100%; display:flex; flex-direction:column; gap:20px; }
    .login { padding:36px; }
    .login__head { margin-bottom:16px; }
    .login__track { display:inline-block; margin-bottom:20px; font:600 16px var(--font-sans); color:var(--brand-600); text-decoration:none; }
    .login__track:hover { text-decoration:underline; }
    .login__form { display:flex; flex-direction:column; gap:16px; }
    .login__row { display:flex; align-items:center; justify-content:space-between; }
    .login__remember { display:flex; align-items:center; gap:8px; font:500 16px var(--font-sans); color:var(--content-muted); cursor:pointer; }
    .login__sso { display:block; text-align:center; margin-top:12px; padding:10px 12px; border:1px solid var(--brand-600); border-radius:8px; font:600 17px var(--font-sans); color:var(--brand-600); text-decoration:none; }
    .login__forgot { font:500 16px var(--font-sans); color:var(--brand-600); text-decoration:none; }
    .login__error { background:var(--danger-bg); color:var(--danger); padding:10px 12px; border-radius:10px; font:500 16px var(--font-sans); margin:0; }
    app-button { display:block; }
    .login__dev { margin-top:20px; padding-top:16px; border-top:1px dashed var(--surface-border); }
    .login__dev-label { display:block; font:600 13px var(--font-sans); letter-spacing:.06em; text-transform:uppercase; color:var(--content-muted); margin-bottom:8px; }
    .login__dev-btns { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .login__dev-btn { flex:1; padding:8px 10px; border:0; border-radius:10px; background:var(--surface-muted);
      box-shadow:var(--shadow-clay-inset); color:var(--content-fg); font:600 15px var(--font-sans); cursor:pointer; transition:color .15s; }
    .login__dev-btn:hover { color:var(--brand-700); }
    .login__unlock { align-self:flex-start; margin-top:-8px; padding:0; border:0; background:none; color:var(--brand-600);
      font:500 15px var(--font-sans); cursor:pointer; text-decoration:underline; }
    .login-public { display:flex; flex-direction:column; align-items:center; gap:10px; text-align:center; padding:0 4px; }
    .login-public__brand { font:700 17px var(--font-display); color:var(--content-fg); letter-spacing:-.01em; }
    .login-public__links { display:flex; flex-wrap:wrap; justify-content:center; gap:6px 16px; }
    .login-public__links a { font:500 15px var(--font-sans); color:var(--content-muted); text-decoration:none; }
    .login-public__links a:hover { color:var(--brand-600); text-decoration:underline; }
  `]
})
export class Login {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly notify = inject(NotificationService);
  private readonly sso = inject(PlatformSsoService);
  /** True once the platform sign-in is switched on and this browser has used it before. */
  readonly ssoAvailable = signal(false);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Dev-only credential quick-fill; stripped from production builds. */
  readonly devMode = !environment.production;
  /** True while the company code is prefilled from this hostname's own domain map
   *  (see {@link companyCodeForHostname}) — shows the field (even outside devMode)
   *  with an escape hatch, since a platform-role account (SUPER_ADMIN/PLATFORM_ADMIN)
   *  has no company and must be able to clear it rather than be silently locked into
   *  whichever company this domain maps to. */
  readonly companyLocked = signal(false);
  protected readonly publicLinks = PUBLIC_PAGE_LINKS;
  protected readonly year = new Date().getFullYear();

  readonly form = this.fb.nonNullable.group({
    companyCode: ['', Validators.maxLength(50)],
    // No Validators.email — this field accepts a mobile number too (direct request:
    // "user able to login using there contact number as well"); the backend resolves
    // either shape to the account's own email, or fails with the usual invalid-
    // credentials message, so no client-side shape check is needed here.
    email: ['', [Validators.required, Validators.maxLength(255)]],
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(72)]],
    rememberMe: [false]
  });

  constructor() {
    if (this.sso.lastCompany) {
      this.sso.config().subscribe((config) => this.ssoAvailable.set(config !== null));
    }
    const companyCode = companyCodeForHostname(window.location.hostname);
    if (companyCode) {
      this.form.controls.companyCode.setValue(companyCode);
      this.companyLocked.set(true);
    }
  }

  clearCompanyLock(): void {
    this.form.controls.companyCode.setValue('');
    this.companyLocked.set(false);
  }

  ctrl(name: 'companyCode' | 'email' | 'password') { return this.form.controls[name]; }

  /** Fills known dev credentials. Super admin signs in with no company code; the rest use
   *  the current dev company, AMAZING_LOGISTICS — COMPANY-C1's fixtures were wiped when
   *  courier_db was replaced with a prod dump on 2026-09-18. No Latur/Hub branch exists
   *  under this company, so those slots were repointed to real branches (Satara/Kolhapur)
   *  instead of being left broken. */
  fill(kind: 'occplSupport' | 'admin' | 'company' | 'pune' | 'satara' | 'kolhapur' | 'hub' | 'hubPun'): void {
    this.error.set(null);
    const creds: Record<typeof kind, { companyCode: string; email: string; password: string }> = {
      // The dev server's own company (courier.dev.occplsoftech.com).
      occplSupport: { companyCode: 'OCCPL', email: 'support@occplsoftech.com', password: 'Shubhu@9767' },
      admin:     { companyCode: '', email: 'it.shubham.rk@gmail.com', password: 'Password@1234' },
      company:   { companyCode: 'AMAZING_LOGISTICS', email: 'ashwin@amazinglpl.com', password: 'Verify@1234' },
      pune:      { companyCode: 'AMAZING_LOGISTICS', email: 'shubham@gmail.com', password: 'Password@1234' },
      satara:    { companyCode: 'AMAZING_LOGISTICS', email: 'jagtaptransportservice@gmail.com', password: 'Password@1234' },
      kolhapur:  { companyCode: 'AMAZING_LOGISTICS', email: 'mohasinbargir007@gmail.in', password: 'Password@1234' },
      hub:       { companyCode: 'AMAZING_LOGISTICS', email: 'hub.pune.test@amazinglpl.com', password: 'Password@1234' },
      hubPun:    { companyCode: 'AMAZING_LOGISTICS', email: 'punehub@gmail.com', password: 'Password@1234' }
    };
    const { companyCode, email, password } = creds[kind];
    this.form.patchValue({ companyCode, email, password });
  }

  submit(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.loading.set(true); this.error.set(null);
    const { companyCode, email, password, rememberMe } = this.form.getRawValue();
    this.auth.login({ companyCode: companyCode || undefined, email, password, rememberMe }).subscribe({
      next: () => {
        this.notify.success('Signed in.');
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/dashboard';
        this.router.navigateByUrl(returnUrl);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(err.error?.message ?? 'Invalid credentials. Please try again.');
      }
    });
  }
}
