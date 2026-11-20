import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { CreateDepartmentRequest, UpdateDepartmentRequest, Department } from '@core/models/department.model';
import { CompanyRole } from '@core/models/role.model';

// Mirrors the backend CreateDepartmentRequest pattern: 3-50 chars, letters/digits/space/-/_,
// no leading or trailing separator. Saved uppercased with spaces → underscores.
const CODE = /^[A-Za-z0-9][A-Za-z0-9_ -]{1,48}[A-Za-z0-9]$/;

/**
 * Reactive create/edit editor for a department. Validators mirror CreateDepartmentRequest /
 * UpdateDepartmentRequest. In edit mode `departmentCode` is immutable and shown read-only,
 * and the form emits UpdateDepartmentRequest carrying the last-read `version`. `roleIds` is
 * the complete set the department should offer afterwards, not a delta — same "full
 * replacement" shape the backend takes.
 */
@Component({
  selector: 'app-department-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiInput, UiSelect, UiButton],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="dform">
      <app-card title="Department Details" subtitle="Identity.">
        <div class="grid">
          @if (isCreate()) {
            <app-input [control]="c('departmentCode')" label="Department Code" [required]="true" placeholder="OPERATIONS" [maxLength]="50" />
            <div class="hint-cell">
              <span class="hint">Saved uppercased, spaces become underscores. Immutable afterwards.</span>
              @if (codePreview()) { <span class="preview">Will save as <b>{{ codePreview() }}</b></span> }
            </div>
          } @else {
            <div class="stat"><span class="stat__l">Department Code</span>
              <span class="stat__v mono">{{ department()?.departmentCode }}</span><span class="stat__h">Immutable</span></div>
            <div></div>
          }
          <app-input [control]="c('departmentName')" label="Department Name" [required]="true" placeholder="Operations" [maxLength]="100" />
        </div>
        <div class="full">
          <app-input [control]="c('description')" label="Description" placeholder="What this department is for." [maxLength]="255" />
        </div>
      </app-card>

      <app-card title="Roles" subtitle="Roles this department offers to a user placed in it.">
        <app-select [control]="c('roleIds')" label="Roles" [options]="roleOptions()" [multiple]="true"
                    placeholder="None yet" />
        <p class="note">Picking a department on user creation narrows the role picker to just these.</p>
      </app-card>

      <div class="dform__bar">
        <span class="dform__note">
          @if (form.invalid && form.touched) { Fix the highlighted fields before saving. }
        </span>
        <div class="dform__actions">
          <app-button variant="stroked" (pressed)="cancelled.emit()">Cancel</app-button>
          <app-button type="submit" icon="save" [loading]="saving()"
                      [disabled]="!isCreate() && form.pristine">
            {{ isCreate() ? 'Create Department' : 'Save Changes' }}
          </app-button>
        </div>
      </div>
    </form>
  `,
  styles: [`
    .dform { display:flex; flex-direction:column; gap:16px; }
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
    .note { margin-top:10px; font:400 16px var(--font-sans); color:var(--content-muted); }
    .dform__bar { position:sticky; bottom:0; display:flex; align-items:center; justify-content:space-between;
      gap:16px; padding:14px 16px; background:var(--surface); border:1px solid var(--surface-border); border-radius:var(--r-field); }
    .dform__note { font:500 16px var(--font-sans); color:var(--danger); }
    .dform__actions { display:flex; gap:10px; }
    @media (max-width:760px){ .grid{ grid-template-columns:1fr; } }
  `]
})
export class DepartmentForm {
  private readonly fb = inject(FormBuilder);

  readonly mode = input<'create' | 'edit'>('create');
  readonly department = input<Department | null>(null);
  readonly roles = input<CompanyRole[]>([]);
  readonly saving = input(false);

  readonly saved = output<CreateDepartmentRequest | UpdateDepartmentRequest>();
  readonly cancelled = output<void>();

  protected readonly isCreate = computed(() => this.mode() === 'create');
  private hydrated = signal(false);

  protected readonly form: FormGroup = this.build();

  protected readonly codePreview = signal('');

  protected readonly roleOptions = computed<SelectOption[]>(() =>
    this.roles().filter((r) => r.status === 'ACTIVE').map((r) => ({ value: r.id, label: `${r.roleName} (${r.roleCode})` })));

  constructor() {
    effect(() => { const d = this.department(); if (d && this.mode() === 'edit') this.hydrate(d); });
    this.c('departmentCode').valueChanges.subscribe((v: string) => this.codePreview.set(this.normalise(v)));
  }

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  private normalise(v: string): string {
    return (v || '').trim().toUpperCase().replace(/\s+/g, '_');
  }

  private hydrate(d: Department): void {
    if (this.hydrated()) return;
    this.form.patchValue({
      departmentName: d.departmentName ?? '', description: d.description ?? '',
      roleIds: d.roles.map((r) => r.id)
    }, { emitEvent: false });
    this.form.markAsPristine();
    this.hydrated.set(true);
  }

  private build(): FormGroup {
    return this.fb.group({
      departmentCode: ['', [Validators.required, Validators.maxLength(50), Validators.pattern(CODE)]],
      departmentName: ['', [Validators.required, Validators.maxLength(100)]],
      description: ['', Validators.maxLength(255)],
      roleIds: [[] as string[]]
    });
  }

  protected submit(): void {
    if (this.isCreate()) this.c('departmentCode').markAsTouched();
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.getRawValue();
    const trim = (s: string) => (s && s.trim() ? s.trim() : null);

    if (this.isCreate()) {
      this.saved.emit({
        departmentCode: this.normalise(v.departmentCode), departmentName: v.departmentName.trim(),
        description: trim(v.description), roleIds: v.roleIds ?? []
      } as CreateDepartmentRequest);
    } else {
      this.saved.emit({
        departmentName: v.departmentName.trim(), description: trim(v.description),
        roleIds: v.roleIds ?? [], version: this.department()!.version
      } as UpdateDepartmentRequest);
    }
  }
}
