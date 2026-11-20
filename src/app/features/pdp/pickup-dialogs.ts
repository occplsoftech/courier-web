import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { PickupRequest } from '@core/models/pdp.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';

/** Pick the Pickup-Delivery Partner a request is assigned to. */
@Component({
  selector: 'app-pickup-assign-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, ReactiveFormsModule, UiButton, UiSelect],
  template: `
    <h2 mat-dialog-title>Assign pickup</h2>
    <mat-dialog-content>
      <p class="sub">{{ data.pickup.pickupNo }} — {{ data.pickup.contactName }}, {{ data.pickup.pincode }}</p>
      <app-select [control]="partner" label="Pickup-Delivery Partner" [options]="data.partners" placeholder="Select a partner" />
      @if (data.suggested && !data.pickup.pdpBranchId) { <p class="hint">Preselected: the partner mapped to pincode {{ data.pickup.pincode }}.</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <app-button variant="stroked" (pressed)="ref.close()">Cancel</app-button>
      <app-button icon="person_add" [disabled]="partner.invalid" (pressed)="ref.close(partner.value)">Assign</app-button>
    </mat-dialog-actions>
  `,
  styles: [`.sub { font:400 16px var(--font-sans); color:var(--content-muted); margin:0 0 12px; } .hint { font:400 15px var(--font-sans); color:var(--content-muted); margin:8px 0 0; } mat-dialog-content { min-width:340px; }`]
})
export class PickupAssignDialog {
  protected readonly data = inject<{ pickup: PickupRequest; partners: SelectOption[]; suggested?: string }>(MAT_DIALOG_DATA);
  protected readonly ref = inject(MatDialogRef<PickupAssignDialog>);
  protected readonly partner = new FormControl<string>(this.data.pickup.pdpBranchId ?? this.data.suggested ?? '', { nonNullable: true, validators: [Validators.required] });
}

/** Record what was actually collected. */
@Component({
  selector: 'app-pickup-complete-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, ReactiveFormsModule, UiButton, UiInput],
  template: `
    <h2 mat-dialog-title>Goods collected</h2>
    <mat-dialog-content>
      <p class="sub">{{ data.pickup.pickupNo }} — expected {{ data.pickup.expectedParcels }} parcel(s)@if (data.pickup.expectedWeightKg) { , {{ data.pickup.expectedWeightKg }} kg}</p>
      <div class="g">
        <app-input [control]="parcels" label="Parcels collected" type="number" [min]="1" />
        <app-input [control]="weight" label="Total weight (kg)" type="number" [min]="0.001" [step]="0.5" />
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <app-button variant="stroked" (pressed)="ref.close()">Cancel</app-button>
      <app-button icon="inventory_2" [disabled]="parcels.invalid || weight.invalid" (pressed)="ref.close({ parcels: +parcels.value, weight: +weight.value })">Confirm</app-button>
    </mat-dialog-actions>
  `,
  styles: [`.sub { font:400 16px var(--font-sans); color:var(--content-muted); margin:0 0 12px; } .g { display:grid; grid-template-columns:1fr 1fr; gap:16px; } mat-dialog-content { min-width:360px; }`]
})
export class PickupCompleteDialog {
  protected readonly data = inject<{ pickup: PickupRequest }>(MAT_DIALOG_DATA);
  protected readonly ref = inject(MatDialogRef<PickupCompleteDialog>);
  protected readonly parcels = new FormControl<number>(this.data.pickup.expectedParcels, { nonNullable: true, validators: [Validators.required, Validators.min(1)] });
  protected readonly weight = new FormControl<number>(this.data.pickup.expectedWeightKg ?? 0, { nonNullable: true, validators: [Validators.required, Validators.min(0.001)] });
}
