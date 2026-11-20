import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';

export type FieldType = 'text' | 'number' | 'checkbox' | 'select';

export interface SectionField {
  key: string;
  label: string;
  type: FieldType;
  options?: SelectOption[];
  min?: number;
  max?: number;
  step?: number;
}

export interface SettingsSectionDialogData {
  title: string;
  fields: SectionField[];
  values: Record<string, unknown>;
}

/**
 * One generic edit form for a Company Settings section. Field shape is passed in by the
 * caller (see settings-page.ts) so General/SLA/Notification/Security/Branding all reuse
 * this instead of five near-identical dialogs — the section PATCH endpoints already share
 * one request DTO on the backend, so the form doing the same is not a stretch.
 */
@Component({
  selector: 'app-settings-section-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatDialogModule, UiButton, UiInput, UiSelect],
  template: `
    <form class="ssd" [formGroup]="form" (ngSubmit)="submit()">
      <h2 class="text-h2">{{ data.title }}</h2>

      @for (f of data.fields; track f.key) {
        @switch (f.type) {
          @case ('select') {
            <app-select [control]="ctrl(f.key)" [label]="f.label" [options]="f.options ?? []" />
          }
          @case ('checkbox') {
            <label class="ssd__check">
              <input type="checkbox" [formControlName]="f.key" />
              <span>{{ f.label }}</span>
            </label>
          }
          @default {
            <app-input [control]="ctrl(f.key)" [label]="f.label"
                       [type]="f.type === 'number' ? 'number' : 'text'"
                       [min]="f.min ?? null" [max]="f.max ?? null" [step]="f.step ?? null" />
          }
        }
      }

      <div class="ssd__actions">
        <app-button type="button" variant="stroked" (pressed)="close()">Cancel</app-button>
        <app-button type="submit" [disabled]="form.invalid">Save</app-button>
      </div>
    </form>
  `,
  styles: [`
    .ssd { display:flex; flex-direction:column; gap:14px; padding:24px; width:420px; max-width:92vw;
      max-height:85vh; overflow-y:auto; }
    .ssd__check { display:flex; align-items:center; gap:8px; font:400 16px var(--font-sans); color:var(--content-fg); }
    .ssd__actions { display:flex; justify-content:flex-end; gap:8px; margin-top:8px; }
  `]
})
export class SettingsSectionDialog {
  private readonly fb = inject(FormBuilder);
  private readonly ref = inject(MatDialogRef<SettingsSectionDialog>);
  readonly data = inject<SettingsSectionDialogData>(MAT_DIALOG_DATA);

  readonly form = this.fb.group(
    Object.fromEntries(
      this.data.fields.map((f) => [
        f.key,
        this.fb.control(this.data.values[f.key] ?? (f.type === 'checkbox' ? false : ''),
          f.type === 'number' ? [Validators.required] : [])
      ])
    )
  );

  ctrl(key: string) { return this.form.get(key) as FormControl; }

  close(): void { this.ref.close(); }

  submit(): void {
    if (this.form.invalid) return;
    this.ref.close(this.form.value);
  }
}
