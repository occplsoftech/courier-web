import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

/** Labelled text/password/email field bound to a reactive FormControl, with error text
 *  and an optional show/hide toggle for passwords. */
@Component({
  selector: 'app-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatIconModule],
  template: `
    <label class="field">
      @if (label()) { <span class="field__label">{{ label() }}@if (required()) {<i>*</i>}</span> }
      <span class="field__wrap" [class.field__wrap--err]="invalid">
        @if (icon()) { <mat-icon class="field__icon">{{ icon() }}</mat-icon> }
        <input class="field__input" [type]="effectiveType()" [placeholder]="placeholder()"
               [formControl]="control()" [attr.autocomplete]="autocomplete()"
               [attr.min]="min()" [attr.max]="max()" [attr.step]="step()"
               [attr.maxlength]="maxLength()" />
        @if (canToggle()) {
          <button type="button" class="field__eye" (click)="reveal.set(!reveal())"
                  [attr.aria-label]="reveal() ? 'Hide password' : 'Show password'" tabindex="-1">
            <mat-icon>{{ reveal() ? 'visibility_off' : 'visibility' }}</mat-icon>
          </button>
        }
      </span>
      @if (invalid) { <span class="field__err">{{ errorText }}</span> }
    </label>
  `,
  styles: [`
    .field { display:flex; flex-direction:column; gap:6px; }
    .field__label { font:500 16px var(--font-sans); color:var(--content-fg); }
    .field__label i { color:var(--danger); margin-left:2px; font-style:normal; }
    .field__wrap { display:flex; align-items:center; gap:8px; height:44px; padding:0 14px;
      background:var(--surface-muted); border:1px solid transparent; border-radius:var(--r-field);
      box-shadow:var(--shadow-clay-inset); transition:box-shadow .15s, border-color .15s; }
    .field__wrap:focus-within { border-color:var(--brand-400); box-shadow:var(--shadow-clay-inset), 0 0 0 3px var(--brand-100); }
    .field__wrap--err { border-color:var(--danger); }
    .field__icon { color:var(--content-muted); font-size:20px; }
    .field__input { border:0; outline:0; background:transparent; flex:1; font:400 17px var(--font-sans); color:var(--content-fg); }
    .field__input:-webkit-autofill, .field__input:-webkit-autofill:hover,
    .field__input:-webkit-autofill:focus, .field__input:-webkit-autofill:active {
      -webkit-text-fill-color:var(--content-fg); caret-color:var(--content-fg);
      -webkit-box-shadow:0 0 0 1000px var(--surface-muted) inset;
      transition:background-color 9999s ease-in-out 0s;
    }
    .field__eye { display:grid; place-items:center; border:0; background:transparent; cursor:pointer; color:var(--content-muted); padding:0; }
    .field__eye mat-icon { font-size:20px; width:20px; height:20px; }
    .field__err { font:500 15px var(--font-sans); color:var(--danger); }
  `]
})
export class UiInput {
  readonly control = input.required<FormControl>();
  readonly label = input('');
  readonly type = input<'text' | 'password' | 'email' | 'tel' | 'number' | 'date' | 'time'>('text');
  readonly placeholder = input('');
  readonly icon = input<string | null>(null);
  readonly required = input(false);
  readonly autocomplete = input('off');
  readonly togglePassword = input(false);
  readonly min = input<number | null>(null);
  readonly max = input<number | null>(null);
  readonly step = input<number | null>(null);
  readonly maxLength = input<number | null>(null);
  /**
   * Overrides the generic message when the caller knows a better one — a pattern the
   * caller declared, for instance, where "Invalid value." says nothing useful. Empty
   * falls back to the built-in mapping below.
   */
  readonly errorMessage = input('');

  protected readonly reveal = signal(false);
  protected readonly canToggle = computed(() => this.togglePassword() && this.type() === 'password');
  protected readonly effectiveType = computed(() => (this.canToggle() && this.reveal() ? 'text' : this.type()));

  get invalid(): boolean { const c = this.control(); return c.invalid && (c.touched || c.dirty); }
  get errorText(): string {
    const e = this.control().errors;
    if (!e) return '';
    if (this.errorMessage()) return this.errorMessage();
    if (e['required']) return 'This field is required.';
    if (e['email']) return 'Enter a valid email address.';
    if (e['minlength']) return `At least ${e['minlength'].requiredLength} characters.`;
    if (e['maxlength']) return `At most ${e['maxlength'].requiredLength} characters.`;
    if (e['min']) return `Must be at least ${e['min'].min}.`;
    if (e['max']) return `Must be at most ${e['max'].max}.`;
    return 'Invalid value.';
  }
}
