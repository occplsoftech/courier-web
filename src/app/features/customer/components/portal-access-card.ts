import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NotificationService } from '@core/services/notification.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { PortalAccess, PortalAccessGranted, PortalAccessService } from '../portal-access.service';

/**
 * Customer shipping portal sign-in for one business customer. A company administrator creates it here; the customer
 * gets an activation e-mail, and the temporary password is shown once on this screen.
 */
@Component({
  selector: 'app-portal-access-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, ReactiveFormsModule, UiCard, UiButton, UiInput],
  template: `
    <app-card title="Customer Portal Access" subtitle="Lets this customer sign in to the shipping portal to compare rates, book and track.">
      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else {
        @if (granted(); as g) {
          <div class="granted" role="status">
            <strong>Portal account created for {{ g.email }}.</strong>
            <p>
              @if (g.activationEmailSent) { An activation e-mail has been sent. The customer must open its link before signing in. }
              @else { The activation e-mail could <strong>not</strong> be sent, so the customer cannot activate the account yet. Check the e-mail settings, then disable and grant access again. }
            </p>
            <p>Temporary password (shown only now):</p>
            <div class="pw"><code>{{ g.temporaryPassword }}</code>
              <app-button variant="stroked" icon="content_copy" (pressed)="copy(g)">Copy</app-button></div>
            <p class="muted">Share it only with the customer, by a different channel than the e-mail.</p>
          </div>
        } @else if (access()?.hasAccount) {
          <dl class="kv">
            <dt>Sign-in e-mail</dt><dd>{{ access()!.email }}</dd>
            <dt>Status</dt><dd>{{ statusLabel() }}</dd>
            <dt>Last sign-in</dt><dd>{{ access()!.lastLoginAt ? (access()!.lastLoginAt | date:'medium') : 'Never' }}</dd>
          </dl>
          @if (access()!.status !== 'DISABLED') {
            <div class="bar"><app-button variant="stroked" icon="block" (pressed)="revoke()">Disable access</app-button></div>
          } @else {
            <p class="muted">Access is disabled for this customer.</p>
          }
        } @else if (!editing()) {
          <p class="muted">This customer has no portal sign-in yet.</p>
          <div class="bar"><app-button icon="lock_open" (pressed)="editing.set(true)">Grant portal access</app-button></div>
        } @else {
          <form [formGroup]="form" (ngSubmit)="grant()" class="form">
            <app-input [control]="ctl('email')" label="Sign-in e-mail" type="email" autocomplete="off"
              placeholder="Defaults to the customer's e-mail" />
            <div class="two">
              <app-input [control]="ctl('firstName')" label="First name (optional)" />
              <app-input [control]="ctl('lastName')" label="Last name (optional)" />
            </div>
            @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
            <div class="bar">
              <app-button type="button" variant="stroked" (pressed)="editing.set(false)">Cancel</app-button>
              <app-button type="submit" icon="lock_open" [loading]="saving()">Create account</app-button>
            </div>
          </form>
        }
      }
    </app-card>
  `,
  styles: [`
    .muted { font:400 16px var(--font-sans); color:var(--content-muted); margin:0 0 12px; }
    .kv { display:grid; grid-template-columns:140px 1fr; gap:8px 16px; margin:0 0 12px; }
    .kv dt { font:500 16px var(--font-sans); color:var(--content-muted); }
    .kv dd { font:600 17px var(--font-sans); margin:0; overflow-wrap:anywhere; }
    .bar { display:flex; gap:10px; justify-content:flex-end; }
    .form { display:flex; flex-direction:column; gap:12px; }
    .two { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .error { color:var(--danger); font:500 16px var(--font-sans); margin:0; }
    .granted p { margin:8px 0; font:400 16px var(--font-sans); }
    .pw { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
    .pw code { font:600 19px ui-monospace, monospace; padding:8px 12px; background:var(--surface-muted); border-radius:8px; user-select:all; }
    @media (max-width:560px) { .two { grid-template-columns:1fr; } }
  `]
})
export class PortalAccessCard implements OnInit {
  readonly customerId = input.required<string>();
  readonly customerEmail = input<string | null>(null);

  private readonly service = inject(PortalAccessService);
  private readonly notify = inject(NotificationService);
  private readonly confirm = inject(DialogService);
  private readonly fb = inject(FormBuilder);

  readonly loading = signal(true);
  readonly access = signal<PortalAccess | null>(null);
  readonly granted = signal<PortalAccessGranted | null>(null);
  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.email, Validators.maxLength(255)]],
    firstName: ['', Validators.maxLength(100)],
    lastName: ['', Validators.maxLength(100)]
  });

  ngOnInit(): void {
    this.form.patchValue({ email: this.customerEmail() ?? '' });
    this.load();
  }

  ctl(name: 'email' | 'firstName' | 'lastName') { return this.form.controls[name]; }

  statusLabel(): string {
    switch (this.access()?.status) {
      case 'ACTIVE': return 'Active';
      case 'PENDING': return 'Waiting for the customer to activate (e-mail link)';
      case 'DISABLED': return 'Disabled';
      default: return this.access()?.status ?? '—';
    }
  }

  private load(): void {
    this.service.get(this.customerId()).subscribe({
      next: (a) => { this.access.set(a); this.loading.set(false); },
      error: () => { this.access.set({ hasAccount: false, userId: null, email: null, status: null, lastLoginAt: null }); this.loading.set(false); }
    });
  }

  grant(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();
    const body = {
      ...(v.email.trim() ? { email: v.email.trim() } : {}),
      ...(v.firstName.trim() ? { firstName: v.firstName.trim() } : {}),
      ...(v.lastName.trim() ? { lastName: v.lastName.trim() } : {})
    };
    this.saving.set(true);
    this.error.set(null);
    this.service.grant(this.customerId(), body).subscribe({
      next: (g) => { this.saving.set(false); this.granted.set(g); this.editing.set(false); this.load(); },
      error: (e) => {
        this.saving.set(false);
        this.error.set(e?.error?.message ?? 'The portal account could not be created.');
      }
    });
  }

  revoke(): void {
    this.confirm.confirm({
      title: 'Disable portal access',
      message: 'The customer will be signed out and can no longer use the shipping portal. Their bookings are kept.',
      confirmLabel: 'Disable', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.revoke(this.customerId()).subscribe({
        next: (a) => { this.access.set(a); this.granted.set(null); this.notify.success('Portal access disabled.'); },
        error: (e) => this.notify.error(e?.error?.message ?? 'Could not disable portal access.')
      });
    });
  }

  copy(g: PortalAccessGranted): void {
    navigator.clipboard?.writeText(g.temporaryPassword).then(
      () => this.notify.success('Password copied.'),
      () => this.notify.error('Could not copy. Select the password and copy it by hand.'));
  }
}
