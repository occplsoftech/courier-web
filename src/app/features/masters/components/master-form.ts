import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { catchError, debounceTime, distinctUntilChanged, filter, of, switchMap } from 'rxjs';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { MasterOption, MasterRecord, PincodeAreaLookup, PincodeAreaPreview } from '@core/models/master.model';
import { MasterDataService } from '../master-data.service';
import { MasterDefinition, MasterField, MasterKey } from '../master.config';
import { MasterFieldControl } from './master-field-control';

type PincodeLookupState =
  | { status: 'idle' | 'loading' | 'not-found' | 'error' }
  | { status: 'matched'; message: string };

/**
 * The create and edit form for every master list.
 *
 * Controls, validators and layout are all derived from the definition's `fields`, so the
 * twelve forms cannot drift apart and adding a field is a one-line data change. Validators
 * mirror the DTOs deliberately: the user should be told that a code is malformed before
 * the round trip, not by a 400 afterwards.
 *
 * `code` is disabled in edit mode rather than hidden. Hiding it would leave the user
 * wondering where it went; showing it greyed out says "this is permanent", which is the
 * actual rule — operational records quote the code.
 */
@Component({
  selector: 'app-master-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiButton, UiCard, MasterFieldControl],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="mform">
      @for (group of groups(); track group.name) {
        <app-card [title]="group.name">
          <div class="mform__grid">
            @for (field of group.fields; track field.key) {
              <app-master-field [field]="field" [control]="controlFor(field.key)"
                                [options]="optionsFor(field)" />
              @if (isPincodeCodeField(field)) {
                <div class="mform__lookup">
                  @switch (pincodeLookup().status) {
                    @case ('loading') { <span class="mform__lookup--pending">Looking up area…</span> }
                    @case ('matched') { <span class="mform__lookup--ok">{{ lookupMessage() }}</span> }
                    @case ('not-found') { <span class="mform__lookup--warn">No postal record for this pincode — an Area could not be resolved, so it cannot be created yet. Try a different pincode.</span> }
                    @case ('error') { <span class="mform__lookup--warn">Area lookup failed — try again in a moment.</span> }
                  }
                </div>
              }
            }
          </div>
        </app-card>
      }

      @if (def().key === 'pincodes' && !record() && pincodeAreaPreview().length) {
        <app-card title="Areas served by this pincode">
          <div class="mform__areas-wrap">
            <table class="mform__areas">
              <thead><tr><th>Area</th><th>City</th><th></th></tr></thead>
              <tbody>
                @for (row of pincodeAreaPreview(); track row.areaId) {
                  <tr>
                    <td>{{ row.areaName ?? '—' }}</td>
                    <td>{{ row.cityName ?? '—' }}</td>
                    <td>@if (row.primary) { <span class="mform__areas-badge">Primary</span> }</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="mform__areas-hint">ODA can be set per area once this pincode is created.</p>
        </app-card>
      }

      <div class="mform__actions">
        <app-button variant="stroked" type="button" (pressed)="cancelled.emit()">Cancel</app-button>
        <app-button type="submit" [loading]="saving()" [disabled]="saving()">
          {{ record() ? 'Save changes' : 'Create ' + def().singular.toLowerCase() }}
        </app-button>
      </div>
    </form>
  `,
  styles: [`
    .mform { display:flex; flex-direction:column; gap:16px; }
    .mform__grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:16px; }
    .mform__actions { display:flex; justify-content:flex-end; gap:8px; }
    .mform__lookup { grid-column:1 / -1; margin-top:-8px; font:400 15px var(--font-sans); }
    .mform__lookup--pending { color:var(--content-muted); }
    .mform__lookup--ok { color:var(--success, #2e7d32); }
    .mform__lookup--warn { color:var(--content-muted); }
    .mform__areas-wrap { overflow-x:auto; }
    .mform__areas { width:100%; border-collapse:collapse; font:400 17px var(--font-sans); }
    .mform__areas th { text-align:left; font:500 15px var(--font-sans); color:var(--content-muted);
      text-transform:uppercase; letter-spacing:.04em; padding:0 12px 8px; }
    .mform__areas td { padding:10px 12px; border-top:1px solid var(--surface-border); color:var(--content-fg); }
    .mform__areas-badge { font:600 14px var(--font-sans); color:var(--brand-600, #4f46e5);
      background:var(--brand-100, #eef2ff); border-radius:999px; padding:2px 8px; }
    .mform__areas-hint { font:400 15px var(--font-sans); color:var(--content-muted); margin:10px 0 0; }
  `]
})
export class MasterForm implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(MasterDataService);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Pincode-only: fetching the Area on pincode entry (create only — an edit's code is
   * fixed and its area already set). Keyed off `def().key` here rather than a generic
   * field flag in `master.config.ts`, since the postal directory is specific to this one
   * list, not a shape every master could reuse.
   */
  readonly pincodeLookup = signal<PincodeLookupState>({ status: 'idle' });
  readonly lookupMessage = computed(() => {
    const state = this.pincodeLookup();
    return state.status === 'matched' ? state.message : '';
  });
  /** Preview of every Area this pincode will link once saved — same rows the detail
   *  page's "Areas served" card shows after creation, primary first. Nothing here is
   *  saved until the pincode itself is; ODA is only ever set from the detail page. */
  readonly pincodeAreaPreview = signal<PincodeAreaPreview[]>([]);

  readonly def = input.required<MasterDefinition>();
  /** The row being edited, or null when creating. */
  readonly record = input<MasterRecord | null>(null);
  readonly saving = input(false);

  readonly saved = output<Record<string, unknown>>();
  readonly cancelled = output<void>();

  form!: FormGroup;

  private readonly lookupOptions = signal<Record<string, MasterOption[]>>({});
  /** Options for a create-form `dependsOn` field, keyed by its own field key (not its
   *  lookup source — unlike {@link lookupOptions}, these are scoped to one specific
   *  parent value and must not be shared across fields that happen to share a source). */
  private readonly dependentOptions = signal<Record<string, MasterOption[]>>({});

  /**
   * Fields laid out by their `group`, in declaration order. Pincode's `areaId` is
   * excluded here — auto-fetch is the only way it's ever set now, so it stays a real,
   * validated form control (see `buildControl`/`payload`) with nothing rendered for it;
   * a group left with zero visible fields (Pincode's old "Placement" card, now that
   * `areaId` was its only field) is dropped rather than shown as an empty card.
   */
  readonly groups = computed(() => {
    const ordered: { name: string; fields: MasterField[] }[] = [];
    for (const field of this.def().fields) {
      if (this.isHiddenField(field)) continue;
      const name = field.group ?? 'Details';
      const existing = ordered.find((g) => g.name === name);
      if (existing) existing.fields.push(field);
      else ordered.push({ name, fields: [field] });
    }
    return ordered;
  });

  private isHiddenField(field: MasterField): boolean {
    if (this.def().key === 'pincodes' && field.key === 'areaId') return true;
    // A transient field (Country/State narrowing City's District) only helps a create
    // form find the right option — an edit form has nothing to re-derive it from and
    // falls back to the plain unscoped list on the field it's actually persisted on.
    if (field.transient && !!this.record()) return true;
    return false;
  }

  constructor() {
    // The record arrives after the form is built (the page fetches it), so patch when it lands.
    effect(() => {
      const record = this.record();
      if (record && this.form) this.patch(record);
    });
  }

  ngOnInit(): void {
    this.form = this.fb.group(
      Object.fromEntries(this.def().fields.map((field) => [field.key, this.buildControl(field)]))
    );

    const record = this.record();
    if (record) this.patch(record);

    const editing = !!record;
    for (const field of this.def().fields) {
      if (field.kind !== 'lookup' || !field.lookup) continue;

      // A create form's dependsOn field starts empty and disabled — see buildControl —
      // and loads its own scoped options once its parent is picked. An edit form ignores
      // dependsOn (see isHiddenField's note) and falls through to the plain load below.
      if (field.dependsOn && !editing) {
        this.watchDependent(field);
        continue;
      }

      const source = field.lookup;
      this.service.options(source).subscribe({
        next: (options) => {
          this.lookupOptions.update((c) => ({ ...c, [source]: options }));
          if (!editing) this.maybeApplyDefault(field, options);
        },
        // An empty picker with an explanation beats a form that will not open.
        error: () => this.lookupOptions.update((c) => ({ ...c, [source]: [] }))
      });
    }

    if (this.def().key === 'pincodes' && !this.record()) {
      this.watchPincodeForAreaLookup();
    }
  }

  /**
   * As the operator finishes typing a pincode, fetch the real post office from India's
   * postal directory and auto-select (creating if needed) the matching Area — the whole
   * point being that nobody has to go hunt for one by hand.
   */
  private watchPincodeForAreaLookup(): void {
    this.controlFor('code').valueChanges.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      filter((v): v is string => !!v && /^[0-9]{4,10}$/.test(v)),
      switchMap((code) => {
        this.pincodeLookup.set({ status: 'loading' });
        return this.service.lookupPincodeArea(code).pipe(
          catchError(() => of(null as PincodeAreaLookup | null))
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((result) => this.applyPincodeLookupResult(result));
  }

  private applyPincodeLookupResult(result: PincodeAreaLookup | null): void {
    if (!result) {
      this.pincodeLookup.set({ status: 'error' });
      this.pincodeAreaPreview.set([]);
      return;
    }
    if (!result.matched || !result.areaId) {
      this.pincodeLookup.set({ status: 'not-found' });
      this.pincodeAreaPreview.set([]);
      return;
    }
    this.pincodeAreaPreview.set(result.areas ?? []);

    this.controlFor('areaId').setValue(result.areaId);

    // Post office / locality auto-fills from the same match. `pristine`, not "empty" —
    // an empty check would let one auto-fill permanently block every later one (retyping
    // the pincode after an auto-fill already landed would leave the *first* match's name
    // stuck, since the field would no longer read as empty). `pristine` survives our own
    // `setValue` (immediately re-marked below) but flips false the moment the operator
    // actually types into the field themselves, which is the real signal to stop.
    const nameControl = this.controlFor('name');
    if (nameControl.pristine && result.postOfficeName) {
      nameControl.setValue(result.postOfficeName);
      nameControl.markAsPristine();
    }

    const path = [result.areaName, result.cityName, result.districtName, result.stateName]
      .filter((v): v is string => !!v).join(', ');
    const alternates = result.alternateCount > 1
      ? ` (1 of ${result.alternateCount} post offices sharing this pincode)` : '';
    this.pincodeLookup.set({ status: 'matched', message: `Matched to ${path}${alternates}.` });
  }

  isPincodeCodeField(field: MasterField): boolean {
    return this.def().key === 'pincodes' && field.key === 'code' && !this.record();
  }

  controlFor(key: string): FormControl {
    return this.form.get(key) as FormControl;
  }

  optionsFor(field: MasterField): MasterOption[] {
    if (!field.lookup) return [];
    if (field.dependsOn && !this.record()) return this.dependentOptions()[field.key] ?? [];
    return this.lookupOptions()[field.lookup] ?? [];
  }

  /** Wires one create-form `dependsOn` field to reload (and its own value to reset)
   *  whenever the parent field it depends on changes — mirrors the filter drawer's own
   *  cascade, minus the three-state boolean handling that drawer doesn't need here. */
  private watchDependent(field: MasterField): void {
    const parentKey = field.dependsOn!;
    const paramName = field.dependsOnParam ?? parentKey;
    const parent = this.form.get(parentKey);
    const child = this.controlFor(field.key);
    if (!parent) return;

    parent.valueChanges.subscribe((parentValue: string | null) => {
      child.reset(null);
      if (!parentValue) {
        child.disable({ emitEvent: false });
        this.dependentOptions.update((c) => ({ ...c, [field.key]: [] }));
        return;
      }
      child.enable({ emitEvent: false });
      this.service.masterOptionsScoped(field.lookup as MasterKey, { [paramName]: parentValue }).subscribe({
        next: (options) => {
          this.dependentOptions.update((c) => ({ ...c, [field.key]: options }));
          this.maybeApplyDefault(field, options);
        },
        error: () => this.dependentOptions.update((c) => ({ ...c, [field.key]: [] }))
      });
    });
  }

  /** Create-mode only: once a `defaultOptionMatch` field's options load, preselect the
   *  first one whose label starts with that text — e.g. Country defaulting to India,
   *  which in turn fires {@link watchDependent} for State, defaulting that to Maharashtra,
   *  which fires it again for District. Only while the control is still untouched and
   *  empty, so a real pick (including one this same default already made) is never
   *  overwritten. */
  private maybeApplyDefault(field: MasterField, options: MasterOption[]): void {
    if (!field.defaultOptionMatch) return;
    const control = this.controlFor(field.key);
    if (control.dirty || control.value) return;
    const needle = field.defaultOptionMatch.toLowerCase();
    const match = options.find((o) => o.label.toLowerCase().startsWith(needle));
    if (match) control.setValue(match.value);
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saved.emit(this.payload());
  }

  /**
   * The body to send. Blank strings become null so an emptied optional field is cleared
   * rather than stored as `""`, and the create-only code is omitted on edit — the update
   * DTO has no field for it.
   */
  private payload(): Record<string, unknown> {
    const editing = !!this.record();
    const body: Record<string, unknown> = {};

    for (const field of this.def().fields) {
      if (field.transient) continue;
      if (editing && field.createOnly) continue;
      const value = this.form.get(field.key)?.value;
      if (field.kind === 'boolean') {
        body[field.key] = !!value;
      } else if (value === '' || value === undefined) {
        body[field.key] = null;
      } else {
        body[field.key] = value;
      }
    }
    if (editing) body['version'] = this.record()!.version;
    return body;
  }

  private buildControl(field: MasterField): FormControl {
    const validators = [];
    if (field.required && field.kind !== 'boolean') validators.push(Validators.required);
    if (field.maxLength) validators.push(Validators.maxLength(field.maxLength));
    if (field.pattern) validators.push(Validators.pattern(field.pattern));
    if (field.min !== undefined) validators.push(Validators.min(field.min));
    if (field.max !== undefined) validators.push(Validators.max(field.max));

    // A toggle has no "unset" state to show, so its create-form default is declared in the
    // definition; everything else starts empty.
    const initial = field.kind === 'boolean' ? field.initial === true : null;
    // A create-form dependsOn field has nothing to pick from until its parent has a value
    // — disabled rather than merely empty, so it reads as "pick that first" (see
    // watchDependent) and its value never leaks into payload() while it's still moot. An
    // edit form ignores dependsOn entirely (isHiddenField's note) and always starts enabled.
    const disabled = !!field.dependsOn && !this.record();
    return this.fb.control({ value: initial, disabled }, validators);
  }

  private patch(record: MasterRecord): void {
    for (const field of this.def().fields) {
      const control = this.form.get(field.key);
      if (!control) continue;

      const value = record[field.key];
      control.setValue(field.kind === 'boolean' ? !!value : value ?? null, { emitEvent: false });

      // Immutable once set, and shown rather than hidden so the rule is visible.
      if (field.createOnly) control.disable({ emitEvent: false });
    }
  }
}
