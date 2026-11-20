import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { UiButton } from '@shared/components/ui-button/ui-button';

export interface TemporaryPasswordData {
  /** What was created — "Company admin for Acme Logistics", "Platform operator". */
  subject: string;
  email: string;
  password: string;
  /** Extra line explaining what the holder must do next. */
  nextStep: string;
  /** False when the activation email did not go out, so the operator must act. */
  emailSent?: boolean;
}

/**
 * The one moment a generated password is readable.
 *
 * <p>Opened after creating a company or a platform operator, and never again — nothing
 * can fetch the password back. So the dialog does not close on a backdrop click, says
 * plainly what happens if it is lost, and offers a copy button rather than inviting
 * somebody to transcribe fourteen characters by eye.
 *
 * <p>Generalised from the branch flow's dialog rather than copied: the three creations
 * differ only in wording, and three near-identical dialogs would have drifted the first
 * time the warning text was improved in one of them.
 */
@Component({
  selector: 'app-temporary-password-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatIconModule, UiButton],
  template: `
    <div class="tp">
      <div class="tp__head">
        <mat-icon class="tp__icon">vpn_key</mat-icon>
        <div>
          <h2 class="text-h2">Account created</h2>
          <p class="text-caption">{{ data.subject }}</p>
        </div>
      </div>

      <dl class="tp__grid">
        <dt>Login email</dt>
        <dd class="mono">{{ data.email }}</dd>
        <dt>Temporary password</dt>
        <dd class="mono tp__pwd">{{ data.password }}</dd>
      </dl>

      <p class="tp__next">{{ data.nextStep }}</p>

      @if (data.emailSent === false) {
        <p class="tp__warn">
          <mat-icon>mark_email_unread</mat-icon>
          <span>The activation email did not go out. The account exists, but the link must
            be reissued before anyone can sign in.</span>
        </p>
      }

      <p class="tp__warn">
        <mat-icon>warning</mat-icon>
        <span>Copy this now. The password is not stored in readable form and cannot be
          shown again — if it is lost, reset it rather than looking for it.</span>
      </p>

      <div class="tp__actions">
        <app-button variant="stroked" icon="content_copy" (pressed)="copy()">
          {{ copied() ? 'Copied' : 'Copy credentials' }}
        </app-button>
        <app-button icon="check" (pressed)="ref.close()">I have saved it</app-button>
      </div>
    </div>
  `,
  styles: [`
    .tp { padding:24px; width:520px; max-width:92vw; display:flex; flex-direction:column; gap:18px; }
    .tp__head { display:flex; gap:14px; align-items:flex-start; }
    .tp__icon { color:var(--brand-500); font-size:28px; width:28px; height:28px; }
    .tp__grid { display:grid; grid-template-columns:auto minmax(0,1fr); gap:10px 18px; margin:0;
      padding:16px; background:var(--surface-muted, var(--surface)); border:1px solid var(--surface-border);
      border-radius:var(--r-field); }
    .tp__grid dt { font:500 16px var(--font-sans); color:var(--content-muted); }
    .tp__grid dd { margin:0; font:600 17px var(--font-sans); color:var(--content-fg); word-break:break-all; }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .tp__pwd { letter-spacing:0.04em; }
    .tp__next { margin:0; font:400 16px var(--font-sans); color:var(--content-muted); line-height:1.55; }
    .tp__warn { display:flex; gap:10px; margin:0; font:400 15px var(--font-sans);
      color:var(--content-muted); line-height:1.55; }
    .tp__warn mat-icon { font-size:18px; width:18px; height:18px; color:var(--warning, #b26a00); flex:none; }
    .tp__actions { display:flex; justify-content:flex-end; gap:10px; }
  `]
})
export class TemporaryPasswordDialog {
  readonly ref = inject(MatDialogRef<TemporaryPasswordDialog>);
  readonly data = inject<TemporaryPasswordData>(MAT_DIALOG_DATA);
  readonly copied = signal(false);

  copy(): void {
    const text = `${this.data.subject}\nEmail: ${this.data.email}\nPassword: ${this.data.password}`;
    navigator.clipboard?.writeText(text).then(
      () => this.copied.set(true),
      // Clipboard access can be refused; the password is on screen either way, so a
      // failure here must not look like the account failed.
      () => this.copied.set(false)
    );
  }
}
