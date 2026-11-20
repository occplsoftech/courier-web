import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { catchError, distinctUntilChanged, switchMap, tap } from 'rxjs/operators';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { UserService } from '@features/users/user.service';
import { AppUser } from '@core/models/user.model';
import {
  ActionState, CRUD_ACTIONS, MenuPermissionNode, flattenLeaves, hasAction
} from '@core/models/menu-permission.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiAutocomplete } from '@shared/components/ui-autocomplete/ui-autocomplete';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { MenuPermissionTree } from './components/menu-permission-tree';
import { PermissionToggle, PermissionToggleMany } from './components/menu-permission-node';
import { UserPermissionService } from './user-permission.service';

const EMPTY_ROOT: MenuPermissionNode = {
  id: '', code: 'root', title: 'Menu', icon: null, route: null, module: null, displayOrder: 0,
  roleDefault: {}, effective: {}, overridden: {}, children: []
};

/**
 * User Permissions — pick a user, see their complete menu hierarchy with the role's
 * default CRUD per leaf, override anything without touching the role, save. Selection
 * is held here as one `Map<permissionModule, ActionState>` — keyed by module, not by
 * menu item: several leaves can name the same module (e.g. Shipment Booking/List/
 * Tracking all govern `SHIPMENT_*`), and they are the *same underlying right* shown on
 * different screens, not independent ones — keying by leaf id would let two sibling
 * checkboxes disagree about one right and silently race on save. Save submits the whole
 * matrix; the backend persists only what actually differs from the role's own default
 * (see {@code UserPermissionService.updateUserPermissions}).
 */
@Component({
  selector: 'app-user-permissions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatIconModule, UiCard, UiLoader, UiButton, UiAutocomplete, MenuPermissionTree],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">User Permissions</h1>
          <p class="text-caption">Every user starts with their role's own defaults — override one user here without changing the role.</p></div>
      </header>

      <app-card>
        <div class="up__pick">
          <div class="up__pick-f">
            <app-autocomplete [control]="userCtrl" label="User" [options]="userOptions()" placeholder="Search a user…" />
          </div>
          @if (currentUser(); as u) {
            <div class="up__pick-meta">
              <span class="tag mono">{{ u.email }}</span>
              @if (u.employeeCode) { <span class="tag">{{ u.employeeCode }}</span> }
            </div>
          }
        </div>
      </app-card>

      @if (loadingUsers()) {
        <app-loader [minHeight]="280" caption="Loading users…" />
      } @else if (!currentUser()) {
        <app-card><p class="empty"><mat-icon>rule</mat-icon>Choose a user above to see and edit their menu permissions.</p></app-card>
      } @else if (loadingTree()) {
        <app-loader [minHeight]="280" caption="Loading permissions…" />
      } @else {
        <app-card [title]="'Menu Permissions for ' + currentUser()!.displayName"
                  [subtitle]="customCount() + ' overridden from the role default' + (dirty() ? ' · unsaved changes' : '')">
          <app-menu-permission-tree [nodes]="root().children" [pending]="pending()"
                                     (toggle)="onToggle($event)" (toggleMany)="onToggleMany($event)" />
        </app-card>

        <footer class="up__foot">
          <div class="up__foot-info">
            @if (dirty()) { <mat-icon class="warn">edit</mat-icon><span>Unsaved changes</span> }
            @else { <mat-icon>check_circle</mat-icon><span>All changes saved.</span> }
          </div>
          <div class="up__foot-actions">
            <app-button variant="stroked" [disabled]="!dirty() || saving()" (pressed)="reset()">Reset</app-button>
            <app-button icon="save" [loading]="saving()" [disabled]="!dirty()" (pressed)="save()">Save permissions</app-button>
          </div>
        </footer>
      }
    </div>
  `,
  styles: [`
    .up__pick { display:flex; align-items:flex-end; gap:16px; flex-wrap:wrap; }
    .up__pick-f { flex:1; min-width:280px; max-width:460px; }
    .up__pick-meta { display:flex; gap:6px; padding-bottom:8px; }
    .up__foot { position:sticky; bottom:0; display:flex; align-items:center; justify-content:space-between; gap:16px;
      margin-top:16px; padding:14px 20px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-lg, 12px); box-shadow:var(--shadow-md, 0 -2px 12px rgba(0,0,0,.06)); flex-wrap:wrap; }
    .up__foot-info { display:flex; align-items:center; gap:8px; font:500 16px var(--font-sans); color:var(--content-muted); }
    .up__foot-info mat-icon { font-size:18px; width:18px; height:18px; }
    .up__foot-info .warn { color:var(--warning); }
    .up__foot-actions { display:flex; gap:10px; }
    .tag { display:inline-block; background:var(--surface-muted); border:1px solid var(--surface-border); color:var(--content-muted);
      font:600 14px var(--font-sans); padding:2px 8px; border-radius:6px; }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .empty { display:flex; align-items:center; justify-content:center; gap:8px; font:400 17px var(--font-sans);
      color:var(--content-muted); padding:32px; }
  `]
})
export class UserPermissions implements OnInit {
  private readonly service = inject(UserPermissionService);
  private readonly userService = inject(UserService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);

  readonly userCtrl = new FormControl<string | null>(null);
  readonly users = signal<AppUser[]>([]);
  readonly loadingUsers = signal(true);
  readonly loadingTree = signal(false);
  readonly saving = signal(false);

  readonly root = signal<MenuPermissionNode>(EMPTY_ROOT);
  readonly pending = signal<Map<string, ActionState>>(new Map());
  private original = signal<Map<string, ActionState>>(new Map());

  readonly userOptions = computed<SelectOption[]>(() =>
    this.users().map((u) => ({ value: u.id, label: `${u.displayName} (${u.email})` })));

  // A FormControl's `.value` is a plain property, not a signal — reading it inside a
  // `computed()` would never mark that computed dirty when the control changes, so it
  // would memoize whatever it saw on its first read and never update again. Bridging
  // through `toSignal` on `valueChanges` is what makes `currentUser` actually reactive.
  private readonly userId = toSignal(this.userCtrl.valueChanges, { initialValue: this.userCtrl.value });
  readonly currentUser = computed(() => this.users().find((u) => u.id === this.userId()) ?? null);

  private readonly leaves = computed(() => flattenLeaves(this.root()));
  private readonly leafById = computed(() => new Map(this.leaves().map((l) => [l.id, l])));

  readonly dirty = computed(() => !sameMatrix(this.pending(), this.original()));

  readonly customCount = computed(() => {
    const seen = new Set<string>();
    let n = 0;
    for (const leaf of this.leaves()) {
      if (!leaf.module || seen.has(leaf.module)) continue;
      seen.add(leaf.module);
      const state = this.pending().get(leaf.module);
      if (!state) continue;
      for (const a of CRUD_ACTIONS) {
        if (hasAction(leaf.roleDefault, a) && state[a] !== (leaf.roleDefault[a] === true)) n++;
      }
    }
    return n;
  });

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Access Control' }, { label: 'User Permissions' }]);

    this.userService.list({ size: 200 }).subscribe({
      next: (page) => {
        this.users.set(page.content);
        this.loadingUsers.set(false);
        const pre = this.route.snapshot.queryParamMap.get('userId');
        if (pre && page.content.some((u) => u.id === pre)) this.userCtrl.setValue(pre);
      },
      error: () => this.loadingUsers.set(false)
    });

    // UiAutocomplete's control tracks every keystroke, not just a real selection (see its
    // own template: the input is bound straight to the FormControl) — so `valueChanges`
    // fires once per character typed, each a candidate id. Filtering to only values that
    // already match a known user means a mid-typing fragment never reaches the API at
    // all, and `switchMap` cancels any in-flight request a later keystroke supersedes —
    // without it, an out-of-order response for an earlier fragment could land after the
    // real selection's response and stomp the correct tree with the "not found" error.
    this.userCtrl.valueChanges.pipe(
      distinctUntilChanged(),
      tap(() => this.loadingTree.set(true)),
      switchMap((id) => {
        const known = !!id && this.users().some((u) => u.id === id);
        if (!known) return of(null);
        return this.service.menuPermissions(id!).pipe(
          catchError(() => { this.notify.error('Could not load this user’s menu permissions.'); return of(null); })
        );
      })
    ).subscribe((root) => {
      this.loadingTree.set(false);
      if (root) this.applyRoot(root); else this.clear();
    });
  }

  private applyRoot(root: MenuPermissionNode): void {
    this.root.set(root);
    const state = new Map<string, ActionState>();
    for (const leaf of flattenLeaves(root)) if (leaf.module) state.set(leaf.module, effectiveState(leaf));
    this.pending.set(state);
    this.original.set(new Map(state));
  }

  private clear(): void {
    this.root.set(EMPTY_ROOT);
    this.pending.set(new Map());
    this.original.set(new Map());
  }

  onToggle({ menuItemId, action, checked }: PermissionToggle): void {
    const leaf = this.leafById().get(menuItemId);
    if (!leaf?.module) return;
    const next = new Map(this.pending());
    const current = next.get(leaf.module) ?? { CREATE: false, READ: false, UPDATE: false, DELETE: false };
    next.set(leaf.module, { ...current, [action]: checked });
    this.pending.set(next);
  }

  onToggleMany({ menuItemIds, checked }: PermissionToggleMany): void {
    const next = new Map(this.pending());
    const byId = this.leafById();
    for (const id of menuItemIds) {
      const leaf = byId.get(id);
      if (!leaf?.module) continue;
      const current = next.get(leaf.module) ?? { CREATE: false, READ: false, UPDATE: false, DELETE: false };
      const updated = { ...current };
      for (const a of CRUD_ACTIONS) if (hasAction(leaf.roleDefault, a)) updated[a] = checked;
      next.set(leaf.module, updated);
    }
    this.pending.set(next);
  }

  reset(): void { this.pending.set(new Map(this.original())); this.notify.info('Reverted to the saved set.'); }

  save(): void {
    const userId = this.userCtrl.value;
    if (!userId || this.saving()) return;

    const pending = this.pending();
    const items = this.leaves().map((leaf) => {
      const s = (leaf.module ? pending.get(leaf.module) : undefined)
        ?? { CREATE: false, READ: false, UPDATE: false, DELETE: false };
      return { menuItemId: leaf.id, create: s.CREATE, read: s.READ, update: s.UPDATE, delete: s.DELETE };
    });

    this.saving.set(true);
    this.service.save(userId, { items }).subscribe({
      next: (res) => {
        this.saving.set(false);
        const parts: string[] = [];
        if (res.granted.length) parts.push(`${res.granted.length} granted`);
        if (res.revoked.length) parts.push(`${res.revoked.length} revoked`);
        this.notify.success(`Saved — ${parts.join(', ') || 'no changes'}.`);
        // Reload so roleDefault/effective/overridden reflect what actually stuck.
        this.service.menuPermissions(userId).subscribe((root) => this.applyRoot(root));
      },
      error: (e) => { this.saving.set(false); this.notify.error(e?.error?.message ?? 'Could not save permissions.'); }
    });
  }
}

/** A leaf's starting checkbox state — its current effective value per available action. */
function effectiveState(leaf: MenuPermissionNode): ActionState {
  return {
    CREATE: leaf.effective.CREATE === true,
    READ: leaf.effective.READ === true,
    UPDATE: leaf.effective.UPDATE === true,
    DELETE: leaf.effective.DELETE === true
  };
}

function sameMatrix(a: ReadonlyMap<string, ActionState>, b: ReadonlyMap<string, ActionState>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, state] of a) {
    const other = b.get(id);
    if (!other) return false;
    for (const action of CRUD_ACTIONS) if (state[action] !== other[action]) return false;
  }
  return true;
}
