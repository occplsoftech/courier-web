import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiSelect } from '@shared/components/ui-select/ui-select';
import { MasterOption, MASTER_STATUSES } from '@core/models/master.model';
import { MasterDataService } from '../master-data.service';
import { MasterDefinition, MasterField, MasterKey } from '../master.config';

/**
 * The advanced-filter drawer, built from the definition's `filters`.
 *
 * Status is offered on every list; anything else is the list's own — a parent picker for
 * the geography levels, a unit for weight slabs, a branch for routes.
 *
 * Boolean filters are three-state rather than a checkbox: "any", "yes", "no". A checkbox
 * cannot express "I do not care", which is the state a filter starts in and the one users
 * spend most of their time in.
 */
@Component({
  selector: 'app-master-filter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiButton, UiSelect],
  template: `
    <form class="mf" [formGroup]="form" (ngSubmit)="apply()">
      <app-select [control]="statusControl" label="Status" [options]="statusOptions"
                  [allowEmpty]="true" emptyLabel="Any status" />

      @for (f of extraFilters(); track f.key) {
        @if (f.kind === 'boolean') {
          <app-select [control]="controlFor(f.key)" [label]="f.label" [options]="triState"
                      [allowEmpty]="true" emptyLabel="Any" />
        } @else if (f.kind === 'select') {
          <app-select [control]="controlFor(f.key)" [label]="f.label" [options]="f.options ?? []"
                      [allowEmpty]="true" emptyLabel="Any" />
        } @else if (f.kind === 'lookup') {
          <app-select [control]="controlFor(f.key)" [label]="f.label" [options]="lookupOptions(f)"
                      [allowEmpty]="true" emptyLabel="Any" />
        } @else {
          <label class="mf__field">
            <span class="mf__label">{{ f.label }}</span>
            <input class="mf__input" type="text" [formControl]="controlFor(f.key)"
                   [attr.maxlength]="f.maxLength ?? null" />
          </label>
        }
      }

      <div class="mf__actions">
        <app-button type="submit" icon="filter_list">Apply</app-button>
        <app-button variant="stroked" type="button" (pressed)="reset()">Reset</app-button>
      </div>
    </form>
  `,
  styles: [`
    .mf { display:flex; flex-direction:column; gap:16px; }
    .mf__field { display:flex; flex-direction:column; gap:6px; }
    .mf__label { font:500 16px var(--font-sans); color:var(--content-fg); }
    .mf__input { height:42px; padding:0 12px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-field); font:400 17px var(--font-sans); color:var(--content-fg); outline:0; }
    .mf__actions { display:flex; gap:8px; margin-top:4px; }
  `]
})
export class MasterFilter implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(MasterDataService);

  readonly def = input.required<MasterDefinition>();
  readonly changed = output<Record<string, string | boolean | undefined>>();

  readonly statusOptions = MASTER_STATUSES.map((s) => ({ value: s, label: s === 'ACTIVE' ? 'Active' : 'Inactive' }));
  readonly triState = [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }];

  readonly extraFilters = computed(() => this.def().filters ?? []);
  private readonly options = signal<Record<string, MasterOption[]>>({});

  form!: FormGroup;

  get statusControl(): FormControl {
    return this.form.get('status') as FormControl;
  }

  ngOnInit(): void {
    const controls: Record<string, FormControl> = { status: this.fb.control(null) };
    for (const filter of this.extraFilters()) {
      // A dependsOn field starts with nothing to pick from until its parent has a value —
      // disabled rather than merely empty, so it reads as "pick a State first" and its
      // (excluded, while disabled) value never leaks into apply()'s form.value.
      controls[filter.key] = this.fb.control({ value: null, disabled: !!filter.dependsOn });
    }
    this.form = this.fb.group(controls);

    for (const filter of this.extraFilters()) {
      if (filter.kind !== 'lookup' || !filter.lookup) continue;
      if (filter.dependsOn) {
        this.watchDependent(filter);
        continue;
      }
      this.service.options(filter.lookup).subscribe({
        next: (options) => this.options.update((current) => ({ ...current, [filter.key]: options })),
        // A picker that cannot load leaves the filter empty rather than blocking the drawer.
        error: () => this.options.update((current) => ({ ...current, [filter.key]: [] }))
      });
    }
  }

  /** Wires one `dependsOn` lookup field to reload (and its own value to reset) whenever
   *  the parent field it depends on changes. */
  private watchDependent(filter: MasterField): void {
    const parentKey = filter.dependsOn!;
    const paramName = filter.dependsOnParam ?? parentKey;
    const parent = this.form.get(parentKey);
    const child = this.controlFor(filter.key);
    if (!parent) return;

    parent.valueChanges.subscribe((parentValue: string | null) => {
      child.reset(null);
      if (!parentValue) {
        child.disable({ emitEvent: false });
        this.options.update((current) => ({ ...current, [filter.key]: [] }));
        return;
      }
      child.enable({ emitEvent: false });
      // dependsOn cascading is only meaningful for real master lookups (a geography
      // parent), never the 'branches' lookup — safe to narrow here.
      this.service.masterOptionsScoped(filter.lookup! as MasterKey, { [paramName]: parentValue }).subscribe({
        next: (options) => this.options.update((current) => ({ ...current, [filter.key]: options })),
        error: () => this.options.update((current) => ({ ...current, [filter.key]: [] }))
      });
    });
  }

  controlFor(key: string): FormControl {
    return this.form.get(key) as FormControl;
  }

  lookupOptions(field: MasterField): MasterOption[] {
    return this.options()[field.key] ?? [];
  }

  apply(): void {
    const raw = this.form.value as Record<string, string | null>;
    const applied: Record<string, string | boolean | undefined> = {};

    for (const [key, value] of Object.entries(raw)) {
      if (value === null || value === '') continue;
      const field = this.extraFilters().find((f) => f.key === key);
      applied[key] = field?.kind === 'boolean' ? value === 'true' : value;
    }
    this.changed.emit(applied);
  }

  reset(): void {
    this.form.reset();
    // form.reset() clears values but leaves each control's enabled/disabled state as-is —
    // a dependsOn field left enabled from a prior State pick would show empty options
    // with no clue why, so put it back to "pick the parent first".
    for (const filter of this.extraFilters()) {
      if (!filter.dependsOn) continue;
      this.controlFor(filter.key).disable({ emitEvent: false });
      this.options.update((current) => ({ ...current, [filter.key]: [] }));
    }
    this.changed.emit({});
  }
}
