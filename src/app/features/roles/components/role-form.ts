import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import {
  CreateRoleRequest, UpdateRoleRequest, RoleProfile, RoleType, ROLE_TYPES
} from '@core/models/role.model';
import { Department } from '@core/models/department.model';

// Mirrors the backend CreateRoleRequest pattern: 3-50 chars, letters/digits/space/-/_,
// no leading or trailing separator. Saved uppercased with spaces → underscores.
const CODE = /^[A-Za-z0-9][A-Za-z0-9_ -]{1,48}[A-Za-z0-9]$/;

const TYPE_OPTIONS: SelectOption[] = ROLE_TYPES.map((t) => ({
  value: t, label: t.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}));

/**
 * Reactive create/edit editor for a company role. Validators mirror CreateRoleRequest /
 * UpdateRoleRequest so a bad body is rejected before the API. In edit mode `roleCode` is
 * immutable and shown read-only, and the form emits UpdateRoleRequest carrying the
 * last-read `version`. Permissions are not managed here — that is the Permission module.
 */
@Component({
  selector: 'app-role-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiInput, UiSelect, UiButton],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="rform">
      <app-card title="Role Details" subtitle="Identity and functional grouping.">
        <div class="grid">
          @if (isCreate()) {
            <app-input [control]="c('roleCode')" label="Role Code" [required]="true" placeholder="NIGHT_SHIFT_SUPERVISOR" [maxLength]="50" />
            <div class="hint-cell">
              <span class="hint">Saved uppercased, spaces become underscores. Immutable afterwards.</span>
              @if (codePreview()) { <span class="preview">Will save as <b>{{ codePreview() }}</b></span> }
            </div>
          } @else {
            <div class="stat"><span class="stat__l">Role Code</span>
              <span class="stat__v mono">{{ role()?.roleCode }}</span><span class="stat__h">Immutable</span></div>
            <div></div>
          }
          <app-input [control]="c('roleName')" label="Role Name" [required]="true" placeholder="Night Shift Supervisor" [maxLength]="100" />
          <app-select [control]="c('roleType')" label="Role Type" [options]="typeOptions" placeholder="Select a type" />
        </div>
        <div class="full">
          <app-input [control]="c('description')" label="Description" placeholder="What this role is for." [maxLength]="255" />
        </div>
      </app-card>

      <app-card title="Behaviour" subtitle="How the role is assigned.">
        <label class="chk">
          <input type="checkbox" [formControl]="c('isDefault')" />
          <span><b>Default role</b> — assigned to new users when none is specified. Promoting this
            demotes whichever role currently holds the flag.</span>
        </label>
        @if (!isCreate() && role()?.isSystemRole) {
          <p class="sys">This is a <b>system role</b>: it may be renamed and re-typed, but never deleted.</p>
        }
        <p class="note">A new role starts <b>Active</b> with <b>no permissions</b> — granting them is the
          Permission module's job. Activation and deactivation have their own actions.</p>
      </app-card>

      <app-card title="Departments" subtitle="Which departments may place a user in this role.">
        <app-select [control]="c('departmentIds')" label="Departments" [options]="departmentOptions()"
                    [multiple]="true" placeholder="Offer this role via…" />
        <p class="note">Optional. A department's own role picker only shows roles offered here —
          skip this and add it from the Departments page later.</p>
      </app-card>

      <div class="rform__bar">
        <span class="rform__note">
          @if (form.invalid && form.touched) { Fix the highlighted fields before saving. }
        </span>
        <div class="rform__actions">
          <app-button variant="stroked" (pressed)="cancelled.emit()">Cancel</app-button>
          <app-button type="submit" icon="save" [loading]="saving()"
                      [disabled]="!isCreate() && form.pristine">
            {{ isCreate() ? 'Create Role' : 'Save Changes' }}
          </app-button>
        </div>
      </div>
    </form>
  `,
  styles: [`
    .rform { display:flex; flex-direction:column; gap:16px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }
    .full { margin-top:16px; }
    .hint-cell { display:flex; flex-direction:column; gap:4px; justify-content:center; }
    .hint { font:400 15px var(--font-sans); color:var(--content-muted); }
    .preview { font:400 15px var(--font-sans); color:var(--content-fg); }
    .preview b { font-family:var(--font-mono, var(--font-sans)); }
    .stat { display:flex; flex-direction:column; gap:6px; justify-content:center; }
    .stat__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .stat__v { font:600 17px var(--font-sans); color:var(--content-fg); }
    .stat__v.mono { font-family:var(--font-mono, var(--font-sans)); }
    .stat__h { font:400 15px var(--font-sans); color:var(--content-muted); }
    .chk { display:flex; gap:10px; align-items:flex-start; font:400 17px var(--font-sans); color:var(--content-fg); cursor:pointer; }
    .chk input { margin-top:3px; width:16px; height:16px; accent-color:var(--brand-600); }
    .sys { margin-top:14px; font:400 16px var(--font-sans); color:var(--warning); }
    .note { margin-top:10px; font:400 16px var(--font-sans); color:var(--content-muted); }
    .rform__bar { position:sticky; bottom:0; display:flex; align-items:center; justify-content:space-between;
      gap:16px; padding:14px 16px; background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .rform__note { font:500 16px var(--font-sans); color:var(--danger); }
    .rform__actions { display:flex; gap:10px; }
    @media (max-width:760px){ .grid{ grid-template-columns:1fr; } }
  `]
})
export class RoleForm {
  private readonly fb = inject(FormBuilder);

  readonly mode = input<'create' | 'edit'>('create');
  readonly role = input<RoleProfile | null>(null);
  /** Optional prefill for cloning: name/type/description/default copied, code left blank. */
  readonly prefill = input<RoleProfile | null>(null);
  readonly saving = input(false);
  /** ACTIVE departments to offer this role via — same catalogue the Departments page uses. */
  readonly departments = input<Department[]>([]);

  readonly saved = output<CreateRoleRequest | UpdateRoleRequest>();
  /** Fired alongside `saved`, in edit mode reflecting the delta from what the role already
   *  offered — the caller (RoleCreate/RoleEdit) reconciles it via DepartmentService.syncRoleGrants
   *  once the role itself is saved and its id is known. */
  readonly departmentsChanged = output<string[]>();
  readonly cancelled = output<void>();

  protected readonly typeOptions = TYPE_OPTIONS;
  protected readonly isCreate = computed(() => this.mode() === 'create');
  protected readonly departmentOptions = computed<SelectOption[]>(() => this.departments()
    .filter((d) => d.status === 'ACTIVE')
    .map((d) => ({ value: d.id, label: d.departmentName })));
  private hydrated = signal(false);
  private prefilled = signal(false);
  private departmentsHydrated = signal(false);

  protected readonly form: FormGroup = this.build();

  protected readonly codePreview = signal('');

  constructor() {
    effect(() => { const r = this.role(); if (r && this.mode() === 'edit') this.hydrate(r); });
    effect(() => { const p = this.prefill(); if (p && this.mode() === 'create') this.applyPrefill(p); });
    // Departments load separately (own API call) and may resolve after the role does —
    // re-check both on every change, only actually hydrating once, the same one-shot
    // guard `hydrate` uses for the role's own fields.
    effect(() => {
      const r = this.role(); const depts = this.departments();
      if (r && this.mode() === 'edit' && depts.length && !this.departmentsHydrated()) {
        const selected = depts.filter((d) => d.roles.some((x) => x.id === r.id)).map((d) => d.id);
        this.form.patchValue({ departmentIds: selected }, { emitEvent: false });
        this.departmentsHydrated.set(true);
      }
    });
    this.c('roleCode').valueChanges.subscribe((v: string) => this.codePreview.set(this.normalise(v)));
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  private normalise(v: string): string {
    return (v || '').trim().toUpperCase().replace(/\s+/g, '_');
  }

  private hydrate(r: RoleProfile): void {
    if (this.hydrated()) return;
    this.form.patchValue({
      roleName: r.roleName ?? '', description: r.description ?? '',
      roleType: r.roleType ?? null, isDefault: r.isDefault ?? false
    }, { emitEvent: false });
    this.form.markAsPristine();
    this.hydrated.set(true);
  }

  private applyPrefill(p: RoleProfile): void {
    if (this.prefilled()) return;
    this.form.patchValue({
      roleName: `${p.roleName} (Copy)`, description: p.description ?? '',
      roleType: p.roleType ?? null, isDefault: false
    });
    this.prefilled.set(true);
  }

  private build(): FormGroup {
    return this.fb.group({
      roleCode: ['', [Validators.required, Validators.maxLength(50), Validators.pattern(CODE)]],
      roleName: ['', [Validators.required, Validators.maxLength(100)]],
      description: ['', Validators.maxLength(255)],
      roleType: [null as RoleType | null, Validators.required],
      isDefault: [false],
      departmentIds: [[] as string[]]
    });
  }

  protected submit(): void {
    if (this.isCreate()) this.c('roleCode').markAsTouched();
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();
    const trim = (s: string) => (s && s.trim() ? s.trim() : null);

    this.departmentsChanged.emit(v.departmentIds ?? []);

    if (this.isCreate()) {
      this.saved.emit({
        roleCode: this.normalise(v.roleCode), roleName: v.roleName.trim(),
        description: trim(v.description), roleType: v.roleType as RoleType, isDefault: !!v.isDefault
      } as CreateRoleRequest);
    } else {
      this.saved.emit({
        roleName: v.roleName.trim(), description: trim(v.description),
        roleType: v.roleType as RoleType, isDefault: !!v.isDefault, version: this.role()!.version
      } as UpdateRoleRequest);
    }
  }
}
