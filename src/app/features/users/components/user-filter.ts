import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiAutocomplete } from '@shared/components/ui-autocomplete/ui-autocomplete';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UserSearchRequest, UserStatus } from '@core/models/user.model';
import { CompanyRole } from '@core/models/role.model';
import { Lookup } from '../user.service';

const STATUSES: SelectOption[] = [
  { value: 'ACTIVE', label: 'Active' }, { value: 'PENDING', label: 'Pending' },
  { value: 'LOCKED', label: 'Locked' }, { value: 'DISABLED', label: 'Disabled' }
];
const LOCKED: SelectOption[] = [{ value: 'true', label: 'Locked only' }, { value: 'false', label: 'Unlocked only' }];

/** Advanced filter for the user list. Emits a UserSearchRequest; parent merges into the query. */
@Component({
  selector: 'app-user-filter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiInput, UiSelect, UiAutocomplete, UiButton],
  template: `
    <form [formGroup]="form" (ngSubmit)="apply()" class="uf">
      <app-select [control]="c('status')" label="Status" [options]="statuses" [multiple]="true" placeholder="Any status" />
      <app-select [control]="c('locked')" label="Lock state" [options]="lockedOptions" [allowEmpty]="true" emptyLabel="Any" />
      <app-autocomplete [control]="c('branchId')" label="Branch" [options]="branchOptions()" placeholder="Any branch" />
      <app-select [control]="c('hubId')" label="Hub" [options]="hubOptions()" [allowEmpty]="true" emptyLabel="Any hub" />
      <app-select [control]="c('roleCode')" label="Role" [options]="roleOptions()" [allowEmpty]="true" emptyLabel="Any role" />
      <app-input [control]="c('department')" label="Department" placeholder="Operations" [maxLength]="100" />
      <app-input [control]="c('designation')" label="Designation" placeholder="Executive" [maxLength]="100" />
      <label class="dt"><span class="dt__l">Joined from</span><input class="dt__i" type="date" [formControl]="c('joinedFrom')" /></label>
      <label class="dt"><span class="dt__l">Joined to</span><input class="dt__i" type="date" [formControl]="c('joinedTo')" /></label>

      <div class="uf__bar">
        <app-button variant="text" (pressed)="clear()">Clear all</app-button>
        <app-button type="submit" icon="filter_list">Apply filters</app-button>
      </div>
    </form>
  `,
  styles: [`
    .uf { display:flex; flex-direction:column; gap:16px; }
    .dt { display:flex; flex-direction:column; gap:6px; }
    .dt__l { font:500 16px var(--font-sans); color:var(--content-fg); }
    .dt__i { height:42px; padding:0 12px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-field); font:400 17px var(--font-sans); color:var(--content-fg); }
    .dt__i:focus { outline:0; border-color:var(--brand-500); box-shadow:0 0 0 3px var(--brand-100); }
    .uf__bar { display:flex; justify-content:space-between; gap:10px; margin-top:8px; }
  `]
})
export class UserFilter {
  private readonly fb = inject(FormBuilder);

  readonly roles = input<CompanyRole[]>([]);
  readonly branches = input<Lookup[]>([]);
  readonly hubs = input<Lookup[]>([]);

  readonly changed = output<UserSearchRequest>();

  protected readonly statuses = STATUSES;
  protected readonly lockedOptions = LOCKED;

  protected readonly roleOptions = computed<SelectOption[]>(() =>
    this.roles().map((r) => ({ value: r.roleCode, label: r.roleName })));
  protected readonly branchOptions = computed<SelectOption[]>(() =>
    this.branches().map((b) => ({ value: b.id, label: b.label })));
  protected readonly hubOptions = computed<SelectOption[]>(() =>
    this.hubs().map((h) => ({ value: h.id, label: h.label })));

  protected readonly form: FormGroup = this.fb.group({
    status: [[] as string[]], locked: [null as string | null], branchId: [null as string | null],
    hubId: [null as string | null], roleCode: [null as string | null], department: [''],
    designation: [''], joinedFrom: [''], joinedTo: ['']
  });

  protected c(name: string): FormControl { return this.form.get(name) as FormControl; }

  protected apply(): void {
    const v = this.form.getRawValue();
    const s = (x: string) => (x && x.trim() ? x.trim() : undefined);
    this.changed.emit({
      status: v.status?.length ? (v.status as UserStatus[]) : undefined,
      locked: v.locked == null ? undefined : v.locked === 'true',
      branchId: v.branchId ?? undefined, hubId: v.hubId ?? undefined, roleCode: v.roleCode ?? undefined,
      department: s(v.department), designation: s(v.designation),
      joinedFrom: s(v.joinedFrom), joinedTo: s(v.joinedTo)
    });
  }

  protected clear(): void {
    this.form.reset({ status: [], locked: null, branchId: null, hubId: null, roleCode: null,
      department: '', designation: '', joinedFrom: '', joinedTo: '' });
    this.changed.emit({});
  }
}
