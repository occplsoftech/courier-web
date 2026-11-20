import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { HttpErrorResponse } from '@angular/common/http';
import { NotificationService } from '@core/services/notification.service';
import { UserService } from '../user.service';

export interface ResetPasswordData { userId: string; displayName: string; }

/** Admin password reset — no current password. Re-enables a PENDING account server-side. */
@Component({
  selector: 'app-reset-password-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatDialogModule, MatCheckboxModule, UiInput, UiButton],
  template: `
    <div class="rp">
      <h2 class="text-h2">Reset password</h2>
      <p class="text-caption">{{ data.displayName }} — sets a new password without the old one.</p>

      <app-input [control]="pwd" label="New Password" type="password" [togglePassword]="true" [maxLength]="72"
                 [required]="true" autocomplete="new-password" placeholder="At least 8 characters" />
      <app-input [control]="confirm" label="Confirm Password" type="password" [togglePassword]="true" [maxLength]="72"
                 [required]="true" autocomplete="new-password" placeholder="Re-enter the password" />
      @if (mismatch()) { <span class="rp__err">Passwords do not match.</span> }

      <mat-checkbox [formControl]="mustChange" color="primary">Require a change at next login</mat-checkbox>

      <div class="rp__actions">
        <app-button variant="stroked" (pressed)="ref.close(false)">Cancel</app-button>
        <app-button icon="lock_reset" [loading]="busy()" (pressed)="submit()">Reset Password</app-button>
      </div>
    </div>
  `,
  styles: [`
    .rp { padding:24px; width:440px; max-width:92vw; display:flex; flex-direction:column; gap:14px; }
    .rp__err { font:500 15px var(--font-sans); color:var(--danger); margin-top:-8px; }
    .rp__actions { display:flex; justify-content:flex-end; gap:10px; margin-top:6px; }
  `]
})
export class ResetPasswordDialog {
  readonly ref = inject(MatDialogRef<ResetPasswordDialog>);
  readonly data = inject<ResetPasswordData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(UserService);
  private readonly notify = inject(NotificationService);

  readonly pwd = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(8), Validators.maxLength(72)] });
  readonly confirm = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(72)] });
  readonly mustChange = new FormControl(true, { nonNullable: true });
  readonly busy = signal(false);

  mismatch(): boolean { return !!this.confirm.value && this.pwd.value !== this.confirm.value; }

  submit(): void {
    if (this.pwd.invalid || this.mismatch() || this.busy()) { this.pwd.markAsTouched(); this.confirm.markAsTouched(); return; }
    this.busy.set(true);
    this.service.resetPassword(this.data.userId, this.pwd.value, this.mustChange.value).subscribe({
      next: () => { this.busy.set(false); this.notify.success('Password reset.'); this.ref.close(true); },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.notify.error(err.error?.message ?? 'Could not reset the password.');
      }
    });
  }
}
