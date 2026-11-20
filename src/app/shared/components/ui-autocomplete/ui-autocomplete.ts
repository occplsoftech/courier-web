import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, signal, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { SelectOption } from '../ui-select/ui-select';

const MAX_VISIBLE_OPTIONS = 10;

/** Labelled type-to-filter combobox over a FormControl — same {value,label} options shape
 *  as `UiSelect`, for fields with a long enough option list that scrolling a dropdown is
 *  slower than typing a few letters (e.g. Package Type in the item grid). The control's
 *  value is the option `value` (a string), not the typed label. */
@Component({
  selector: 'app-autocomplete',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatAutocompleteModule, MatFormFieldModule, MatInputModule],
  template: `
    <label class="ac">
      @if (label()) { <span class="ac__label">{{ label() }}</span> }
      <mat-form-field appearance="outline" class="ac__field" subscriptSizing="dynamic">
        <input #inputEl matInput [formControl]="control()" [placeholder]="placeholder()" [matAutocomplete]="auto"
               (focus)="query.set('')" (input)="query.set(input($event))" />
        <mat-autocomplete #auto="matAutocomplete" [displayWith]="displayWith">
          @for (opt of filtered(); track opt.value) {
            <mat-option [value]="opt.value">{{ opt.label }}</mat-option>
          }
        </mat-autocomplete>
      </mat-form-field>
    </label>
  `,
  styles: [`
    .ac { display:flex; flex-direction:column; gap:6px; }
    .ac__label { font:500 16px var(--font-sans); color:var(--content-fg); }
    .ac__field { width:100%; }
    .ac__field ::ng-deep .mdc-notched-outline > * { border-color:transparent !important; }
    .ac__field ::ng-deep .mat-mdc-text-field-wrapper {
      background:var(--surface-muted); border-radius:var(--r-field); box-shadow:var(--shadow-clay-inset);
    }
    .ac__field ::ng-deep .mat-mdc-form-field-flex { min-height:44px; align-items:center; }
    .ac__field.mat-focused ::ng-deep .mat-mdc-text-field-wrapper { box-shadow:var(--shadow-clay-inset), 0 0 0 3px var(--brand-100); }
  `]
})
export class UiAutocomplete {
  readonly control = input.required<FormControl>();
  readonly options = input<SelectOption[]>([]);
  readonly label = input('');
  readonly placeholder = input('Type to search…');

  protected readonly query = signal('');

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const opts = this.options();
    const matches = q ? opts.filter((o) => o.label.toLowerCase().includes(q)) : opts;
    return matches.slice(0, MAX_VISIBLE_OPTIONS);
  });

  protected readonly displayWith = (value: string | null): string =>
    this.options().find((o) => o.value === value)?.label ?? '';

  private readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('inputEl');

  /**
   * `MatAutocompleteTrigger`'s own `writeValue` re-renders the input's text from
   * `displayWith` on every control value change — except when that change comes from a
   * program setting the control *before* this component's `options` have propagated down
   * as an input signal, which leaves the field blank forever despite holding a real value
   * underneath (`ShipmentCreate`'s package-type default hit this). Subscribing directly
   * covers that case: it re-applies `displayWith` against whatever `options` holds *now*,
   * independent of when the value was set relative to the options load.
   */
  constructor() {
    effect((onCleanup) => {
      const el = this.inputEl()?.nativeElement;
      const ctrl = this.control();
      if (!el) return;
      const sync = () => { if (document.activeElement !== el) el.value = this.displayWith(ctrl.value); };
      sync();
      const sub = ctrl.valueChanges.subscribe(sync);
      onCleanup(() => sub.unsubscribe());
    });
  }

  protected input(e: Event): string { return (e.target as HTMLInputElement).value; }
}
