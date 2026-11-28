import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { NotificationService } from '@core/services/notification.service';
import {
  CashHandover, CashHandoverMode, HANDOVER_MODES, RecordCashHandoverRequest, UserPerformanceService
} from './user-performance.service';

export interface HandoverUser { userId: string; userName: string; outstanding: number; }

export interface CashHandoverDialogData {
  branchId: string | null;
  users: HandoverUser[];
  /** Pre-selected user (the row's "Receive cash" button). */
  userId?: string | null;
  /** The caller — nobody but a company admin records a handover from themselves. */
  selfId?: string | null;
  today: string;
}

/**
 * Records cash a user hands over (branch manager / accounts / company admin). Prefills the user's outstanding
 * amount; warns, without refusing, when more than that is entered. Closes with the saved handover.
 */
@Component({
  selector: 'app-cash-handover-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatDialogModule, DecimalPipe, UiInput, UiButton],
  template: `
    <div class="md">
      <h2 class="text-h2">Receive cash</h2>
      <p class="text-caption">Record cash a user handed over to you. The branch wallet is not changed.</p>
      <form [formGroup]="form" (ngSubmit)="save()" class="md__form">
        <label class="fld">
          <span class="fld__l">From user<i>*</i></span>
          <select formControlName="userId" aria-label="From user" (change)="onUser()">
            <option value="">Select a user</option>
            @for (u of users; track u.userId) {
              <option [value]="u.userId">{{ u.userName }} — outstanding ₹{{ u.outstanding | number: '1.2-2' }}</option>
            }
          </select>
          @if (invalid('userId')) { <span class="fld__err">Choose who handed over the cash.</span> }
        </label>
        <label class="amt">
          <span class="fld__l">Amount<i>*</i></span>
          <div class="amt__wrap" [class.amt__wrap--err]="invalid('amount')">
            <span class="amt__cur">₹</span>
            <input class="amt__i" type="number" min="0.01" step="0.01" formControlName="amount" placeholder="0.00"
                   aria-label="Amount" />
          </div>
          @if (invalid('amount')) { <span class="fld__err">Enter an amount greater than zero.</span> }
          @if (overOutstanding()) {
            <span class="fld__warn">More than the ₹{{ selected()!.outstanding | number: '1.2-2' }} outstanding — check before saving.</span>
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
        <app-input [control]="c('remarks')" label="Remarks" placeholder="Optional note" [maxLength]="500" />
        <div class="md__actions">
          <app-button variant="stroked" (pressed)="ref.close(null)">Cancel</app-button>
          <app-button type="submit" icon="payments" [loading]="busy()">Record handover</app-button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .md { padding:24px; width:480px; max-width:92vw; display:flex; flex-direction:column; gap:8px; }
    .md__form { display:flex; flex-direction:column; gap:16px; margin-top:8px; }
    .md__actions { display:flex; justify-content:flex-end; gap:10px; margin-top:4px; }
    .row2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .fld, .amt { display:flex; flex-direction:column; gap:6px; }
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
    @media (max-width: 520px) { .row2 { grid-template-columns:1fr; } }
  `]
})
export class CashHandoverDialog {
  readonly ref = inject(MatDialogRef<CashHandoverDialog>);
  readonly data = inject<CashHandoverDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(UserPerformanceService);
  private readonly notify = inject(NotificationService);

  readonly busy = signal(false);
  protected readonly modes = HANDOVER_MODES;
  protected readonly users = this.data.users.filter((u) => u.userId !== this.data.selfId);

  protected readonly form: FormGroup = this.fb.group({
    userId: [this.data.userId ?? '', Validators.required],
    amount: [this.outstandingOf(this.data.userId), [Validators.required, Validators.min(0.01)]],
    mode: ['CASH' as CashHandoverMode, Validators.required],
    handoverDate: [this.data.today, Validators.required],
    reference: ['', Validators.maxLength(100)],
    remarks: ['', Validators.maxLength(500)]
  });

  private readonly values = signal(this.form.getRawValue());
  protected readonly selected = computed(() => this.users.find((u) => u.userId === this.values().userId) ?? null);
  protected readonly overOutstanding = computed(() => {
    const u = this.selected();
    const amount = Number(this.values().amount);
    return !!u && amount > 0 && amount > u.outstanding + 0.005;
  });

  constructor() {
    this.form.valueChanges.subscribe(() => this.values.set(this.form.getRawValue()));
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }
  protected invalid(name: string): boolean { const ct = this.c(name); return ct.invalid && (ct.touched || ct.dirty); }

  onUser(): void {
    const amount = this.outstandingOf(this.c('userId').value);
    this.c('amount').setValue(amount);
  }

  private outstandingOf(userId: string | null | undefined): number | null {
    const u = this.data.users.find((x) => x.userId === userId);
    return u && u.outstanding > 0 ? Math.round(u.outstanding * 100) / 100 : null;
  }

  save(): void {
    if (this.busy()) return;
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();
    const body: RecordCashHandoverRequest = {
      branchId: this.data.branchId,
      userId: v.userId,
      amount: Number(v.amount),
      mode: v.mode,
      handoverDate: v.handoverDate || null,
      reference: v.reference?.trim() || null,
      remarks: v.remarks?.trim() || null
    };
    this.busy.set(true);
    this.service.recordHandover(body).subscribe({
      next: (h: CashHandover) => { this.busy.set(false); this.notify.success('Cash handover recorded.'); this.ref.close(h); },
      error: (e) => { this.busy.set(false); this.notify.error(e?.error?.message ?? 'Could not record the handover.'); }
    });
  }
}
