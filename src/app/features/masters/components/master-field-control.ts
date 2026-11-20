import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect } from '@shared/components/ui-select/ui-select';
import { MasterField, MasterFieldOption } from '../master.config';

/**
 * Renders one {@link MasterField} against its FormControl.
 *
 * This is where the field descriptors in `master.config.ts` become real inputs, and it is
 * the only component that knows how a `kind` looks. Adding a field to a master is
 * therefore a data change, not a template change.
 *
 * The shared `UiInput` and `UiSelect` do the styling and error text, so a master form
 * looks exactly like the branch and user forms rather than like a generated one.
 */
@Component({
  selector: 'app-master-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatSlideToggleModule, UiInput, UiSelect],
  template: `
    @switch (field().kind) {
      @case ('boolean') {
        <div class="fld fld--toggle">
          <mat-slide-toggle [formControl]="control()" color="primary">
            {{ field().label }}
          </mat-slide-toggle>
          @if (field().hint) { <span class="fld__hint">{{ field().hint }}</span> }
        </div>
      }
      @case ('textarea') {
        <label class="fld">
          <span class="fld__label">{{ field().label }}</span>
          <textarea class="fld__area" rows="3" [formControl]="control()"
                    [attr.maxlength]="field().maxLength ?? null"
                    [placeholder]="field().placeholder ?? ''"></textarea>
          @if (error()) { <span class="fld__err">{{ error() }}</span> }
          @else if (field().hint) { <span class="fld__hint">{{ field().hint }}</span> }
        </label>
      }
      @case ('select') {
        <div class="fld">
          <app-select [control]="control()" [label]="field().label" [options]="field().options ?? []"
                      [allowEmpty]="!field().required" emptyLabel="None" />
          @if (error()) { <span class="fld__err">{{ error() }}</span> }
          @else if (field().hint) { <span class="fld__hint">{{ field().hint }}</span> }
        </div>
      }
      @case ('lookup') {
        <div class="fld">
          <app-select [control]="control()" [label]="field().label" [options]="options()"
                      [allowEmpty]="!field().required" emptyLabel="None"
                      [placeholder]="options().length ? 'Select…' : 'Nothing to choose yet'" />
          @if (error()) { <span class="fld__err">{{ error() }}</span> }
          @else if (!options().length) {
            <span class="fld__hint">No active {{ field().label.toLowerCase() }} exists yet — create one first.</span>
          } @else if (field().hint) { <span class="fld__hint">{{ field().hint }}</span> }
        </div>
      }
      @case ('time') {
        <label class="fld">
          <span class="fld__label">{{ field().label }}</span>
          <input class="fld__plain" type="time" step="60" [formControl]="control()" />
          @if (error()) { <span class="fld__err">{{ error() }}</span> }
          @else if (field().hint) { <span class="fld__hint">{{ field().hint }}</span> }
        </label>
      }
      @case ('number') {
        <label class="fld">
          <span class="fld__label">{{ field().label }}@if (field().required) {<i>*</i>}</span>
          <input class="fld__plain" type="number" step="1" [formControl]="control()"
                 [attr.min]="field().min ?? null" [attr.max]="field().max ?? null"
                 [placeholder]="field().placeholder ?? ''" />
          @if (error()) { <span class="fld__err">{{ error() }}</span> }
          @else if (field().hint) { <span class="fld__hint">{{ field().hint }}</span> }
        </label>
      }
      @case ('decimal') {
        <label class="fld">
          <span class="fld__label">{{ field().label }}@if (field().required) {<i>*</i>}</span>
          <input class="fld__plain" type="number" step="0.001" [formControl]="control()"
                 [attr.min]="field().min ?? null"
                 [placeholder]="field().placeholder ?? ''" />
          @if (error()) { <span class="fld__err">{{ error() }}</span> }
          @else if (field().hint) { <span class="fld__hint">{{ field().hint }}</span> }
        </label>
      }
      @default {
        <div class="fld">
          <!-- The message is handed to UiInput rather than printed alongside it: two
               messages for one problem reads as two problems, and UiInput's generic
               "Invalid value." says nothing about a pattern this field declared. -->
          <app-input [control]="control()" [label]="field().label" [required]="!!field().required"
                     [placeholder]="field().placeholder ?? ''" [errorMessage]="error() ?? ''"
                     [maxLength]="field().maxLength ?? null" />
          @if (!error() && field().hint) { <span class="fld__hint">{{ field().hint }}</span> }
        </div>
      }
    }
  `,
  styles: [`
    .fld { display:flex; flex-direction:column; gap:6px; }
    .fld--toggle { padding-top:22px; }
    .fld__label { font:500 16px var(--font-sans); color:var(--content-fg); }
    .fld__label i { color:var(--danger); margin-left:2px; font-style:normal; }
    .fld__plain, .fld__area { width:100%; padding:0 12px; height:42px; background:var(--surface);
      border:1px solid var(--surface-border); border-radius:var(--r-field);
      font:400 17px var(--font-sans); color:var(--content-fg); outline:0; }
    .fld__area { height:auto; padding:10px 12px; resize:vertical; font:400 17px var(--font-sans); }
    .fld__plain:focus, .fld__area:focus { border-color:var(--brand-500); box-shadow:0 0 0 3px var(--brand-100); }
    .fld__hint { font:400 15px var(--font-sans); color:var(--content-muted); }
    .fld__err { font:500 15px var(--font-sans); color:var(--danger); }
  `]
})
export class MasterFieldControl {
  readonly field = input.required<MasterField>();
  readonly control = input.required<FormControl>();
  /** Resolved picker options for a `lookup` field. */
  readonly options = input<MasterFieldOption[]>([]);

  /**
   * The message for whichever validator failed, and only once the user has touched the
   * field — errors that appear before anyone has typed read as accusations.
   */
  error(): string | null {
    const control = this.control();
    if (!control.invalid || !(control.touched || control.dirty)) return null;

    const errors = control.errors ?? {};
    const field = this.field();
    if (errors['required']) return `${field.label} is required.`;
    if (errors['pattern']) return field.patternMessage ?? `${field.label} is not in the expected format.`;
    if (errors['maxlength']) return `At most ${field.maxLength} characters.`;
    if (errors['min']) return `Must be ${field.min} or more.`;
    if (errors['max']) return `Must be ${field.max} or less.`;
    return 'Please check this value.';
  }
}
