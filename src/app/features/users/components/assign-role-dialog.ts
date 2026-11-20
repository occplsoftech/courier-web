import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { NotificationService } from '@core/services/notification.service';
import { CompanyRole } from '@core/models/role.model';
import { UserService } from '../user.service';

export interface AssignRoleData {
  userId: string;
  displayName: string;
  current: string[];      // role codes the user already holds
  roles: CompanyRole[];   // company role catalogue
}

/**
 * Manage a user's company roles. Add via the dropdown, remove via the chip ✕. Each action
 * hits the API immediately (idempotent on the backend); the dialog closes returning the
 * final role-code list so the caller can refresh without a second fetch.
 */
@Component({
  selector: 'app-assign-role-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatIconModule, UiSelect, UiButton],
  template: `
    <div class="rd">
      <h2 class="text-h2">Assign roles</h2>
      <p class="text-caption">{{ data.displayName }}</p>

      <div class="rd__chips">
        @for (code of held(); track code) {
          <span class="chip">{{ nameOf(code) }}
            <button class="chip__x" (click)="remove(code)" [disabled]="busy()"><mat-icon>close</mat-icon></button>
          </span>
        } @empty { <span class="text-caption">No roles yet — the company default applies.</span> }
      </div>

      <div class="rd__add">
        <app-select [control]="picker" [options]="addable()" placeholder="Add a role…" />
        <app-button icon="add" [loading]="busy()" [disabled]="!picker.value" (pressed)="add()">Add</app-button>
      </div>

      <div class="rd__actions">
        <app-button variant="stroked" (pressed)="ref.close(held())">Done</app-button>
      </div>
    </div>
  `,
  styles: [`
    .rd { padding:24px; width:440px; max-width:92vw; }
    .rd__chips { display:flex; flex-wrap:wrap; gap:8px; margin:16px 0; min-height:32px; }
    .chip { display:inline-flex; align-items:center; gap:4px; background:var(--brand-50); color:var(--brand-700);
      border:1px solid var(--brand-100); font:600 15px var(--font-sans); padding:4px 6px 4px 10px; border-radius:999px; }
    .chip__x { border:0; background:transparent; cursor:pointer; color:var(--brand-700); display:flex; padding:0; }
    .chip__x mat-icon { font-size:16px; width:16px; height:16px; }
    .rd__add { display:flex; gap:10px; align-items:flex-end; }
    .rd__add app-select { flex:1; }
    .rd__actions { display:flex; justify-content:flex-end; margin-top:20px; }
  `]
})
export class AssignRoleDialog {
  readonly ref = inject(MatDialogRef<AssignRoleDialog>);
  readonly data = inject<AssignRoleData>(MAT_DIALOG_DATA);
  private readonly service = inject(UserService);
  private readonly notify = inject(NotificationService);

  readonly picker = new FormControl<string | null>(null);
  readonly held = signal<string[]>([...this.data.current]);
  readonly busy = signal(false);

  readonly addable = computed<SelectOption[]>(() => this.data.roles
    .filter((r) => r.status === 'ACTIVE' && !this.held().includes(r.roleCode))
    .map((r) => ({ value: r.id, label: `${r.roleName} (${r.roleCode})` })));

  nameOf(code: string): string { return this.data.roles.find((r) => r.roleCode === code)?.roleName ?? code; }

  add(): void {
    const roleId = this.picker.value;
    if (!roleId || this.busy()) return;
    this.busy.set(true);
    this.service.assignRole(this.data.userId, roleId).subscribe({
      next: (codes) => { this.held.set(codes); this.picker.reset(); this.busy.set(false); this.notify.success('Role assigned.'); },
      error: () => { this.busy.set(false); this.notify.error('Could not assign the role.'); }
    });
  }

  remove(code: string): void {
    const role = this.data.roles.find((r) => r.roleCode === code);
    if (!role || this.busy()) return;
    this.busy.set(true);
    this.service.removeRole(this.data.userId, role.id).subscribe({
      next: () => { this.held.set(this.held().filter((c) => c !== code)); this.busy.set(false); this.notify.success('Role removed.'); },
      error: () => { this.busy.set(false); this.notify.error('Could not remove the role.'); }
    });
  }
}
