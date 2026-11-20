import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { BranchUserResponse } from '@core/models/branch.model';

export interface BranchCredentialsData {
  branchCode: string;
  branchName: string;
  user: BranchUserResponse;
  /** The code the branch's own login page needs (see AuthService.companyCode). Null
   *  when this session has none stashed — the copy button then omits that line rather
   *  than guessing. */
  companyCode: string | null;
}

/**
 * Shown once, immediately after a branch is created, when the server generated the
 * password. It is the only moment that password is readable — nothing can fetch it again,
 * so the dialog does not close on a backdrop click and says plainly what happens if it is
 * lost. When the administrator chose the password there is nothing to reveal and this
 * dialog is not opened at all.
 */
@Component({
  selector: 'app-branch-credentials-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatIconModule, UiButton],
  template: `
    <div class="bc">
      <div class="bc__head">
        <mat-icon class="bc__icon">vpn_key</mat-icon>
        <div>
          <h2 class="text-h2">Branch user created</h2>
          <p class="text-caption">{{ data.branchName }} ({{ data.branchCode }}) — branch, user and wallet are ready.</p>
        </div>
      </div>

      <dl class="bc__grid">
        @if (data.companyCode) {
          <dt>Company code</dt>
          <dd class="mono">{{ data.companyCode }}</dd>
        }
        <dt>Login email</dt>
        <dd class="mono">{{ data.user.email }}</dd>
        <dt>Password</dt>
        <dd class="mono bc__pwd">{{ data.user.temporaryPassword }}</dd>
        <dt>Role</dt>
        <dd>{{ roleLabel() }}{{ data.user.assignedAsManager ? ' · manager of this branch' : '' }}</dd>
      </dl>

      <p class="bc__warn">
        <mat-icon>warning</mat-icon>
        <span>Copy this now. The password is not stored in readable form and cannot be shown
          again — if it is lost, reset it from the user's profile.</span>
      </p>

      <div class="bc__actions">
        <app-button variant="stroked" icon="content_copy" (pressed)="copy()">
          {{ copied() ? 'Copied' : 'Copy credentials' }}
        </app-button>
        <app-button icon="check" (pressed)="ref.close()">I have saved it</app-button>
      </div>
    </div>
  `,
  styles: [`
    .bc { padding:24px; width:520px; max-width:92vw; display:flex; flex-direction:column; gap:18px; }
    .bc__head { display:flex; gap:14px; align-items:flex-start; }
    .bc__icon { color:var(--brand-500); font-size:28px; width:28px; height:28px; }
    .bc__grid { display:grid; grid-template-columns:auto minmax(0,1fr); gap:10px 18px; margin:0;
      padding:16px; background:var(--surface-muted, var(--surface)); border:1px solid var(--surface-border);
      border-radius:var(--r-field); }
    .bc__grid dt { font:500 16px var(--font-sans); color:var(--content-muted); }
    .bc__grid dd { margin:0; font:600 17px var(--font-sans); color:var(--content-fg); word-break:break-all; }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .bc__pwd { letter-spacing:0.04em; }
    .bc__warn { display:flex; gap:10px; margin:0; font:400 15px var(--font-sans);
      color:var(--content-muted); line-height:1.55; }
    .bc__warn mat-icon { font-size:18px; width:18px; height:18px; color:var(--warning, #b26a00); flex:none; }
    .bc__actions { display:flex; justify-content:flex-end; gap:10px; }
  `]
})
export class BranchCredentialsDialog {
  readonly ref = inject(MatDialogRef<BranchCredentialsDialog>);
  readonly data = inject<BranchCredentialsData>(MAT_DIALOG_DATA);
  readonly copied = signal(false);

  /**
   * The company role the server granted, read from the response rather than assumed. It is
   * `BRANCH_MANAGER` today; a company that renames the role should see its own name here,
   * and an older backend that sends nothing still reads correctly.
   */
  roleLabel(): string {
    const code = this.data.user.roleCode;
    if (!code) return 'Branch Manager';
    return code.toLowerCase().split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Full login triple, in the order the login form itself asks for them — company
   * code, email, password — so this can be pasted straight into that form or handed
   * to the branch as-is, not just the email+password the dialog used to copy.
   */
  copy(): void {
    const lines = [
      `${this.data.branchName} (${this.data.branchCode})`,
      ...(this.data.companyCode ? [`Company code: ${this.data.companyCode}`] : []),
      `Email: ${this.data.user.email}`,
      `Password: ${this.data.user.temporaryPassword}`
    ];
    navigator.clipboard?.writeText(lines.join('\n')).then(
      () => this.copied.set(true),
      // Clipboard access can be refused; the password is on screen either way, so this
      // must not look like the account failed.
      () => this.copied.set(false)
    );
  }
}
