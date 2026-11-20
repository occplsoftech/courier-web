import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import {
  AssignSubscriptionRequest, BILLING_CYCLES, RenewSubscriptionRequest, SubscriptionPlanOption
} from '@core/models/company.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect } from '@shared/components/ui-select/ui-select';

export type SubscriptionMode = 'assign' | 'renew';

export interface SubscriptionDialogData {
  mode: SubscriptionMode;
  companyName: string;
  plans: SubscriptionPlanOption[];
  currentPlanId?: string | null;
  currentEndDate?: string | null;
}

export type SubscriptionDialogResult =
  | { mode: 'assign'; body: AssignSubscriptionRequest }
  | { mode: 'renew'; body: RenewSubscriptionRequest };

/**
 * Assign or renew a company's subscription.
 *
 * <p>One dialog for both, because the two forms differ by exactly one field — assigning
 * picks a start date, renewing does not. Renewal has no start date on purpose: the server
 * extends from the later of the current end and today, so paying early keeps the days
 * already bought and paying late is not billed for the gap. Offering the operator a start
 * date would let them get that wrong by hand.
 *
 * <p>Suspension is not here. It is a one-field reason and a materially different decision,
 * and folding it into a form that also grants access would be a mis-click away from the
 * opposite of what was intended.
 */
@Component({
  selector: 'app-subscription-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatDialogModule, MatIconModule, UiButton, UiInput, UiSelect],
  template: `
    <form class="sub" [formGroup]="form" (ngSubmit)="submit()">
      <div class="sub__head">
        <mat-icon class="sub__icon">{{ renewing() ? 'autorenew' : 'workspace_premium' }}</mat-icon>
        <div>
          <h2 class="text-h2">{{ renewing() ? 'Renew subscription' : 'Assign subscription' }}</h2>
          <p class="text-caption">{{ data.companyName }}</p>
        </div>
      </div>

      @if (renewing() && data.currentEndDate) {
        <p class="sub__note">
          <mat-icon>info</mat-icon>
          <span>Currently paid to <strong>{{ data.currentEndDate }}</strong>. The new period
            starts from that date, or from today if it has already passed — so nothing
            already paid for is lost, and no lapsed gap is billed.</span>
        </p>
      }

      <app-select [control]="ctrl('subscriptionPlanId')"
        [label]="renewing() ? 'Plan (leave as-is to continue on the current one)' : 'Plan'"
        [options]="planOptions()" />

      <div class="sub__row">
        <app-select [control]="ctrl('billingCycle')" label="Billing cycle" [options]="cycleOptions" />
        <app-input [control]="ctrl('periods')" label="Periods" type="text" />
      </div>

      @if (!renewing()) {
        <app-input [control]="ctrl('startDate')" label="Start date (YYYY-MM-DD, today if blank)" />
      }

      <app-input [control]="ctrl('endDate')"
        label="Explicit end date (YYYY-MM-DD, optional)" />
      <p class="sub__hint">
        A negotiated term that does not land on a cycle boundary goes here — it overrides
        the cycle, because the contract is what the invoice will say.
      </p>

      <app-input [control]="ctrl('remarks')" label="Reference (PO or invoice number)" [maxLength]="500" />

      @if (!renewing()) {
        <p class="sub__note">
          <mat-icon>warning</mat-icon>
          <span>Assigning a paid plan ends any trial in progress and activates the company.</span>
        </p>
      }

      <div class="sub__actions">
        <app-button variant="stroked" type="button" (pressed)="ref.close()">Cancel</app-button>
        <app-button type="submit" [disabled]="form.invalid || saving()">
          {{ renewing() ? 'Renew' : 'Assign' }}
        </app-button>
      </div>
    </form>
  `,
  styles: [`
    .sub { padding:24px; width:540px; max-width:92vw; display:flex; flex-direction:column; gap:16px; }
    .sub__head { display:flex; gap:14px; align-items:flex-start; }
    .sub__icon { color:var(--brand-500); font-size:28px; width:28px; height:28px; }
    .sub__row { display:grid; grid-template-columns:2fr 1fr; gap:12px; }
    .sub__note { display:flex; gap:10px; margin:0; font:400 15px var(--font-sans);
      color:var(--content-muted); line-height:1.55; }
    .sub__note mat-icon { font-size:18px; width:18px; height:18px; flex:none; }
    .sub__hint { margin:-8px 0 0; font:400 15px var(--font-sans); color:var(--content-muted); line-height:1.5; }
    .sub__actions { display:flex; justify-content:flex-end; gap:10px; }
    @media (max-width:420px) { .sub { width:auto; padding:20px; } .sub__row { grid-template-columns:1fr; } }
  `]
})
export class SubscriptionDialog {
  readonly ref = inject(MatDialogRef<SubscriptionDialog, SubscriptionDialogResult>);
  readonly data = inject<SubscriptionDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);

  readonly saving = signal(false);
  readonly renewing = computed(() => this.data.mode === 'renew');

  readonly cycleOptions = BILLING_CYCLES.map((c) => ({ value: c.value, label: c.label }));
  readonly planOptions = computed(() =>
    this.data.plans.map((plan) => ({ value: plan.id, label: `${plan.planName} (${plan.planCode})` })));

  readonly form = this.fb.group({
    subscriptionPlanId: [this.data.currentPlanId ?? '',
      this.data.mode === 'assign' ? [Validators.required] : []],
    billingCycle: ['YEARLY'],
    periods: ['1', [Validators.pattern(/^[1-9][0-9]{0,2}$/)]],
    startDate: ['', [isoDate]],
    endDate: ['', [isoDate]],
    remarks: ['', Validators.maxLength(500)]
  });

  ctrl(name: string): FormControl {
    return this.form.get(name) as FormControl;
  }

  submit(): void {
    if (this.form.invalid) return;
    const raw = this.form.getRawValue();
    const periods = Number(raw.periods || '1');

    if (this.data.mode === 'renew') {
      this.ref.close({
        mode: 'renew',
        body: {
          // Unchanged plan means "continue on the current one"; sending it back would be
          // read as an upgrade to itself and audited as a plan change that never happened.
          subscriptionPlanId:
            raw.subscriptionPlanId && raw.subscriptionPlanId !== this.data.currentPlanId
              ? raw.subscriptionPlanId
              : null,
          billingCycle: raw.endDate ? null : (raw.billingCycle as never),
          periods,
          endDate: raw.endDate || null,
          remarks: raw.remarks || null
        }
      });
      return;
    }

    this.ref.close({
      mode: 'assign',
      body: {
        subscriptionPlanId: raw.subscriptionPlanId!,
        billingCycle: raw.endDate ? null : (raw.billingCycle as never),
        periods,
        startDate: raw.startDate || null,
        endDate: raw.endDate || null,
        remarks: raw.remarks || null
      }
    });
  }
}

/** Blank or ISO `YYYY-MM-DD`. The API takes a LocalDate and nothing else parses reliably. */
function isoDate(control: { value: unknown }) {
  const value = String(control.value ?? '').trim();
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : { isoDate: true };
}
