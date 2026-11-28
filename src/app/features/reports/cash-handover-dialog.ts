import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { switchMap } from 'rxjs';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { NotificationService } from '@core/services/notification.service';
import {
  CashHandover, CashHandoverMode, HANDOVER_MODES, SubmitCashHandoverRequest, UserPerformanceService
} from './user-performance.service';

export interface CashHandoverDialogData {
  branchId: string | null;
  /** The signed-in user's cash not yet handed over (approved) nor already sent for approval. */
  outstanding: number;
  today: string;
}

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * The signed-in user hands over their collected cash: amount (prefilled with what they still hold), how, when, and a
 * proof image — deposit slip, UPI screenshot or a photo of the counted cash. Uploads the image, then submits; the
 * branch manager / accounts desk approves it after viewing the proof. Closes with the submitted handover.
 */
@Component({
  selector: 'app-cash-handover-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatDialogModule, DecimalPipe, UiInput, UiButton],
  template: `
    <div class="md">
      <h2 class="text-h2">Hand over cash</h2>
      <p class="text-caption">You hold ₹{{ data.outstanding | number: '1.2-2' }} not yet handed over. Attach proof — your
        branch manager or the accounts desk approves it after checking.</p>
      <form [formGroup]="form" (ngSubmit)="save()" class="md__form">
        <label class="amt">
          <span class="fld__l">Amount<i>*</i></span>
          <div class="amt__wrap" [class.amt__wrap--err]="invalid('amount')">
            <span class="amt__cur">₹</span>
            <input class="amt__i" type="number" min="0.01" step="0.01" formControlName="amount" placeholder="0.00"
                   aria-label="Amount" />
          </div>
          @if (invalid('amount')) { <span class="fld__err">Enter an amount greater than zero.</span> }
          @if (overOutstanding()) {
            <span class="fld__warn">More than the ₹{{ data.outstanding | number: '1.2-2' }} you hold — check before sending.</span>
          }
        </label>
        <div class="row2">
          <label class="fld">
            <span class="fld__l">Mode<i>*</i></span>
            <select formControlName="mode" aria-label="Mode">
              @for (m of modes; track m.value) { <option [value]="m.value">{{ m.label }}</option> }
            </select>
          </label>
          <label class="fld">
            <span class="fld__l">Date<i>*</i></span>
            <input type="date" formControlName="handoverDate" [max]="data.today" aria-label="Handover date" />
          </label>
        </div>
        <app-input [control]="c('reference')" label="Reference" [maxLength]="100"
                   [placeholder]="form.value.mode === 'CASH' ? 'Optional' : 'Deposit slip no. / UPI UTR'" />

        <div class="proof">
          <span class="fld__l">Proof image<i>*</i></span>
          <span class="text-caption">{{ proofHint() }}</span>
          <label class="proof__pick" [class.proof__pick--err]="proofError()">
            <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" aria-label="Proof image"
                   (change)="onProof($event)" />
            @if (preview()) {
              <img [src]="preview()" alt="Selected proof" class="proof__img" />
            } @else {
              <span class="proof__empty">Tap to choose or take a photo</span>
            }
          </label>
          @if (file()) { <span class="text-caption">{{ file()!.name }}</span> }
          @if (proofError()) { <span class="fld__err">{{ proofError() }}</span> }
        </div>

        <app-input [control]="c('remarks')" label="Remarks" placeholder="Optional note" [maxLength]="500" />
        <div class="md__actions">
          <app-button variant="stroked" (pressed)="ref.close(null)">Cancel</app-button>
          <app-button type="submit" icon="send" [loading]="busy()">Send for approval</app-button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .md { padding:24px; width:500px; max-width:92vw; display:flex; flex-direction:column; gap:8px; }
    .md__form { display:flex; flex-direction:column; gap:16px; margin-top:8px; }
    .md__actions { display:flex; justify-content:flex-end; gap:10px; margin-top:4px; }
    .row2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .fld, .amt, .proof { display:flex; flex-direction:column; gap:6px; }
    .fld__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .fld__l i { color:var(--danger); margin-left:2px; font-style:normal; }
    .fld select, .fld input { height:46px; padding:0 12px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-field); font:400 16px var(--font-sans); color:var(--content-fg); }
    .fld__err { font:500 15px var(--font-sans); color:var(--danger); }
    .fld__warn { font:500 15px var(--font-sans); color:var(--warning, #b45309); }
    .amt__wrap { display:flex; align-items:center; gap:8px; height:46px; padding:0 14px; background:var(--surface);
      border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .amt__wrap:focus-within { border-color:var(--brand-500); box-shadow:0 0 0 3px var(--brand-100); }
    .amt__wrap--err { border-color:var(--danger); }
    .amt__cur { font:600 16px var(--font-sans); color:var(--content-muted); }
    .amt__i { border:0; outline:0; background:transparent; flex:1; font:700 23px var(--font-sans); color:var(--content-fg); }
    .proof__pick { position:relative; display:flex; align-items:center; justify-content:center; min-height:120px;
      border:1px dashed var(--surface-border); border-radius:var(--r-field); background:var(--surface); cursor:pointer; overflow:hidden; }
    .proof__pick--err { border-color:var(--danger); }
    .proof__pick input { position:absolute; inset:0; opacity:0; cursor:pointer; }
    .proof__img { max-height:200px; max-width:100%; object-fit:contain; }
    .proof__empty { font:500 15px var(--font-sans); color:var(--content-muted); }
    @media (max-width: 520px) { .row2 { grid-template-columns:1fr; } }
  `]
})
export class CashHandoverDialog implements OnDestroy {
  readonly ref = inject(MatDialogRef<CashHandoverDialog>);
  readonly data = inject<CashHandoverDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(UserPerformanceService);
  private readonly notify = inject(NotificationService);

  readonly busy = signal(false);
  readonly file = signal<File | null>(null);
  readonly preview = signal<string | null>(null);
  readonly proofError = signal<string | null>(null);
  protected readonly modes = HANDOVER_MODES;

  protected readonly form: FormGroup = this.fb.group({
    amount: [this.data.outstanding > 0 ? Math.round(this.data.outstanding * 100) / 100 : null,
      [Validators.required, Validators.min(0.01)]],
    mode: ['CASH' as CashHandoverMode, Validators.required],
    handoverDate: [this.data.today, Validators.required],
    reference: ['', Validators.maxLength(100)],
    remarks: ['', Validators.maxLength(500)]
  });

  private readonly values = signal(this.form.getRawValue());
  protected readonly overOutstanding = computed(() => {
    const amount = Number(this.values().amount);
    return amount > 0 && amount > this.data.outstanding + 0.005;
  });
  protected readonly proofHint = computed(() => {
    const mode = this.values().mode as CashHandoverMode;
    return mode === 'BANK_DEPOSIT' ? 'Photo of the stamped deposit slip.'
      : mode === 'UPI' ? 'Screenshot of the UPI payment showing the UTR.'
      : 'Photo of the counted cash, or the receipt the receiver signed.';
  });

  constructor() {
    this.form.valueChanges.subscribe(() => this.values.set(this.form.getRawValue()));
  }

  ngOnDestroy(): void { this.revokePreview(); }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }
  protected invalid(name: string): boolean { const ct = this.c(name); return ct.invalid && (ct.touched || ct.dirty); }

  onProof(event: Event): void {
    const f = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.revokePreview();
    this.file.set(null);
    if (!f) return;
    if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic)$/i.test(f.name)) {
      this.proofError.set('Choose a JPEG, PNG, WEBP or HEIC image.');
      return;
    }
    if (f.size > MAX_BYTES) {
      this.proofError.set('The image is too large; keep it under 10 MB.');
      return;
    }
    this.proofError.set(null);
    this.file.set(f);
    this.preview.set(typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : null);
  }

  private revokePreview(): void {
    const url = this.preview();
    if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
    this.preview.set(null);
  }

  save(): void {
    if (this.busy()) return;
    const proof = this.file();
    if (!proof && !this.proofError()) this.proofError.set('Attach a proof image before sending.');
    if (this.form.invalid || !proof) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();
    this.busy.set(true);
    this.service.uploadHandoverProof(proof).pipe(
      switchMap((uploaded) => {
        const body: SubmitCashHandoverRequest = {
          branchId: this.data.branchId,
          amount: Number(v.amount),
          mode: v.mode,
          handoverDate: v.handoverDate || null,
          reference: v.reference?.trim() || null,
          remarks: v.remarks?.trim() || null,
          proofImageUrl: uploaded.url
        };
        return this.service.submitHandover(body);
      })
    ).subscribe({
      next: (h: CashHandover) => { this.busy.set(false); this.notify.success('Sent for approval.'); this.ref.close(h); },
      error: (e) => { this.busy.set(false); this.notify.error(e?.error?.message ?? 'Could not send the handover.'); }
    });
  }
}
