import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { switchMap } from 'rxjs/operators';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { NotificationService } from '@core/services/notification.service';
import { TopupRequest, CreateTopupRequestRequest } from '@core/models/wallet.model';
import { BranchWalletService } from '../branch-wallet.service';

export interface RequestTopupDialogData {
  branchId: string;
  walletName: string;
  currency: string;
}

/**
 * A branch's ask to fund its own wallet — distinct from Recharge (which pays the platform
 * directly): this raises a PENDING request and credits nothing. The company admin approves
 * or rejects it from the Top-up Requests queue; approval is what actually moves money.
 */
@Component({
  selector: 'app-request-topup-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatDialogModule, UiInput, UiButton],
  template: `
    <div class="md">
      <h2 class="text-h2">Request top-up</h2>
      <p class="text-caption">{{ data.walletName }} · sent to your company admin for approval</p>
      <form [formGroup]="form" (ngSubmit)="save()" class="md__form">
        <label class="amt">
          <span class="amt__l">Amount<i>*</i></span>
          <div class="amt__wrap" [class.amt__wrap--err]="invalid('amount')">
            <span class="amt__cur">{{ data.currency }}</span>
            <input class="amt__i" type="number" min="0.01" step="0.01" formControlName="amount" placeholder="0.00" />
          </div>
          @if (invalid('amount')) { <span class="amt__err">Enter an amount greater than zero.</span> }
        </label>
        <app-input [control]="c('remarks')" label="Remarks" placeholder="Why the branch needs it" [maxLength]="300" />
        <label class="proof">
          <span class="proof__l">Proof of payment<i>*</i></span>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" (change)="onProofSelected($event)" />
          @if (selectedProof(); as f) {
            <span class="text-caption">{{ f.name }}</span>
            <app-button variant="stroked" icon="close" (pressed)="clearProof()">Remove</app-button>
          }
          @if (proofMissing()) { <span class="amt__err">Upload a proof image before sending.</span> }
        </label>
        <div class="md__actions">
          <app-button variant="stroked" (pressed)="ref.close(null)">Cancel</app-button>
          <app-button type="submit" icon="send" [loading]="busy()">Send Request</app-button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .md { padding:24px; width:440px; max-width:92vw; display:flex; flex-direction:column; gap:8px; }
    .md__form { display:flex; flex-direction:column; gap:16px; margin-top:8px; }
    .md__actions { display:flex; justify-content:flex-end; gap:10px; margin-top:4px; }
    .amt { display:flex; flex-direction:column; gap:6px; }
    .amt__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .amt__l i { color:var(--danger); margin-left:2px; font-style:normal; }
    .amt__wrap { display:flex; align-items:center; gap:8px; height:46px; padding:0 14px; background:var(--surface);
      border:1px solid var(--surface-border); border-radius:var(--r-field); transition:.15s; }
    .amt__wrap:focus-within { border-color:var(--brand-500); box-shadow:0 0 0 3px var(--brand-100); }
    .amt__wrap--err { border-color:var(--danger); }
    .amt__cur { font:600 16px var(--font-sans); color:var(--content-muted); }
    .amt__i { border:0; outline:0; background:transparent; flex:1; font:700 23px var(--font-sans); color:var(--content-fg); }
    .amt__err { font:500 15px var(--font-sans); color:var(--danger); }
    .proof { display:flex; flex-direction:column; align-items:flex-start; gap:6px; }
    .proof__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .proof__l i { color:var(--danger); margin-left:2px; font-style:normal; }
  `]
})
export class RequestTopupDialog {
  readonly ref = inject(MatDialogRef<RequestTopupDialog>);
  readonly data = inject<RequestTopupDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(BranchWalletService);
  private readonly notify = inject(NotificationService);

  readonly busy = signal(false);
  readonly selectedProof = signal<File | null>(null);
  readonly proofMissing = signal(false);

  protected readonly form: FormGroup = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    remarks: ['', Validators.maxLength(300)]
  });

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }
  protected invalid(name: string): boolean { const ct = this.c(name); return ct.invalid && (ct.touched || ct.dirty); }

  protected onProofSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.selectedProof.set(file);
    if (file) this.proofMissing.set(false);
  }

  protected clearProof(): void {
    this.selectedProof.set(null);
  }

  save(): void {
    if (this.busy()) return;
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const proof = this.selectedProof();
    if (!proof) { this.proofMissing.set(true); return; }

    const v = this.form.getRawValue();
    this.busy.set(true);
    this.service.uploadTopupProof(proof).pipe(
      switchMap((uploaded) => {
        const body: CreateTopupRequestRequest = {
          branchId: this.data.branchId,
          amount: Number(v.amount),
          remarks: v.remarks?.trim() || null,
          proofImageUrl: uploaded.url
        };
        return this.service.createTopupRequest(body);
      })
    ).subscribe({
      next: (r: TopupRequest) => { this.busy.set(false); this.notify.success('Top-up request sent.'); this.ref.close(r); },
      error: (e) => { this.busy.set(false); this.notify.error(e?.error?.message ?? 'Could not send the request.'); }
    });
  }
}
