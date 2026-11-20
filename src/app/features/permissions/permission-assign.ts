import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { RoleService } from '@features/roles/role.service';
import { CompanyRole } from '@core/models/role.model';
import {
  Permission, PermissionGroup, RolePermissionResult, groupByModule, prettyToken
} from '@core/models/permission.model';
import {
  ActionState, CRUD_ACTIONS, CrudAction, MenuItemNode, MenuPermissionNode,
  buildRoleMenuTree, flattenLeaves, hasAction
} from '@core/models/menu-permission.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiSearch } from '@shared/components/ui-search/ui-search';
import { MenuPermissionTree } from '@features/user-permissions/components/menu-permission-tree';
import {
  PermissionToggle as MenuToggle, PermissionToggleMany as MenuToggleMany
} from '@features/user-permissions/components/menu-permission-node';
import { PermissionMatrix } from './components/permission-matrix';
import { PermissionToggle } from './components/module-permission-card';
import { PermissionService } from './permission.service';

type ViewMode = 'tree' | 'matrix';

/**
 * Role → Permission assignment. Pick a role, then grant permissions as a tree or a matrix.
 * Selection is held here as one `Set` of codes; save submits the whole set in one bulk
 * call with `replaceExisting=true` (what "Save" means), and the backend's granted / revoked
 * / skipped / **rejected** result is surfaced — a plan-gated right silently useless is the
 * exact thing the four-list response exists to prevent. No mock data.
 */
@Component({
  selector: 'app-permission-assign',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule, MatIconModule, UiCard, UiLoader, UiButton, UiSelect, UiSearch,
    MenuPermissionTree, PermissionMatrix
  ],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Assign Permissions</h1><p class="text-caption">Grant a role exactly what its holders may do.</p></div>
      </header>

      <app-card>
        <div class="asg__pick">
          <div class="asg__pick-f">
            <app-select [control]="roleCtrl" label="Role" [options]="roleOptions()" placeholder="Select a role to configure…" />
          </div>
          @if (currentRole(); as r) {
            <div class="asg__pick-meta">
              <span class="tag mono">{{ r.roleCode }}</span>
              @if (r.isSystemRole) { <span class="tag">System</span> }
              @if (r.isDefault) { <span class="tag tag--brand">Default</span> }
            </div>
          }
        </div>
      </app-card>

      @if (loadingCatalogue()) {
        <app-loader [minHeight]="280" caption="Loading catalogue…" />
      } @else if (!currentRole()) {
        <app-card><p class="empty"><mat-icon>rule</mat-icon>Choose a role above to begin assigning permissions.</p></app-card>
      } @else {
        <app-card [title]="'Permissions for ' + currentRole()!.roleName"
                  [subtitle]="selected().size + ' of ' + grantable().length + ' granted' + (dirty() ? ' · unsaved changes' : '')">
          <div class="asg__toolbar">
            @if (view() === 'matrix') { <app-search placeholder="Filter permissions…" (changed)="onSearch($event)" /> }
            <div class="asg__spacer"></div>
            <div class="asg__seg" role="tablist" aria-label="View">
              <button type="button" [class.on]="view()==='tree'" (click)="view.set('tree')" role="tab" [attr.aria-selected]="view()==='tree'">
                <mat-icon>account_tree</mat-icon>Tree</button>
              <button type="button" [class.on]="view()==='matrix'" (click)="view.set('matrix')" role="tab" [attr.aria-selected]="view()==='matrix'">
                <mat-icon>grid_on</mat-icon>Matrix</button>
            </div>
          </div>

          @if (loadingGrants() || loadingMenuTree()) {
            <app-loader [minHeight]="200" caption="Loading role permissions…" />
          } @else if (view() === 'tree') {
            <app-menu-permission-tree [nodes]="permissionNodes()" [pending]="pending()"
                                       (toggle)="onMenuToggle($event)" (toggleMany)="onMenuToggleMany($event)" />
          } @else {
            <div class="asg__matrix-bar">
              <span class="asg__count">{{ selected().size }} selected</span>
              <app-button variant="text" icon="done_all" (pressed)="selectAll()">Select all</app-button>
              <app-button variant="text" icon="remove_done" (pressed)="deselectAll()">Deselect all</app-button>
            </div>
            <app-permission-matrix [groups]="filteredGroups()" [selectable]="true" [selected]="selected()" (toggle)="onToggle($event)" />
          }
        </app-card>

        <footer class="asg__foot">
          <div class="asg__foot-info">
            @if (dirty()) { <mat-icon class="warn">edit</mat-icon><span>Unsaved changes — {{ delta() }}</span> }
            @else { <mat-icon>check_circle</mat-icon><span>All changes saved.</span> }
          </div>
          <div class="asg__foot-actions">
            <app-button variant="stroked" [disabled]="!dirty() || saving()" (pressed)="reset()">Reset</app-button>
            <app-button icon="save" [loading]="saving()" [disabled]="!dirty()" (pressed)="save()">Save permissions</app-button>
          </div>
        </footer>
      }
    </div>
  `,
  styles: [`
    .asg__pick { display:flex; align-items:flex-end; gap:16px; flex-wrap:wrap; }
    .asg__pick-f { flex:1; min-width:280px; max-width:460px; }
    .asg__pick-meta { display:flex; gap:6px; padding-bottom:8px; }
    .asg__toolbar { display:flex; align-items:center; gap:12px; margin-bottom:16px; flex-wrap:wrap; }
    .asg__spacer { flex:1; }
    .asg__seg { display:inline-flex; border:1px solid var(--surface-border); border-radius:9px; overflow:hidden; }
    .asg__seg button { display:inline-flex; align-items:center; gap:6px; border:0; background:var(--surface); cursor:pointer;
      padding:8px 14px; font:600 16px var(--font-sans); color:var(--content-muted); }
    .asg__seg button.on { background:var(--brand-50); color:var(--brand-700); }
    .asg__seg button mat-icon { font-size:17px; width:17px; height:17px; }
    .asg__matrix-bar { display:flex; align-items:center; gap:4px; margin-bottom:12px; }
    .asg__count { font:600 15px var(--font-sans); color:var(--content-muted); margin-right:auto; }
    .asg__foot { position:sticky; bottom:0; display:flex; align-items:center; justify-content:space-between; gap:16px;
      margin-top:16px; padding:14px 20px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-lg, 12px); box-shadow:var(--shadow-md, 0 -2px 12px rgba(0,0,0,.06)); flex-wrap:wrap; }
    .asg__foot-info { display:flex; align-items:center; gap:8px; font:500 16px var(--font-sans); color:var(--content-muted); }
    .asg__foot-info mat-icon { font-size:18px; width:18px; height:18px; }
    .asg__foot-info .warn { color:var(--warning); }
    .asg__foot-actions { display:flex; gap:10px; }
    .tag { display:inline-block; background:var(--surface-muted); border:1px solid var(--surface-border); color:var(--content-muted);
      font:600 14px var(--font-sans); padding:2px 8px; border-radius:6px; }
    .tag--brand { background:var(--brand-50); color:var(--brand-700); border-color:var(--brand-100); }
    .mono { font-family:var(--font-mono, ui-monospace); }
    .empty { display:flex; align-items:center; justify-content:center; gap:8px; font:400 17px var(--font-sans);
      color:var(--content-muted); padding:32px; }
  `]
})
export class PermissionAssign implements OnInit {
  private readonly service = inject(PermissionService);
  private readonly roleService = inject(RoleService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);

  readonly roleCtrl = new FormControl<string | null>(null);
  readonly roles = signal<CompanyRole[]>([]);
  readonly grantable = signal<Permission[]>([]);
  readonly selected = signal<Set<string>>(new Set());
  private original = signal<Set<string>>(new Set());

  readonly loadingCatalogue = signal(true);
  readonly loadingGrants = signal(false);
  readonly loadingMenuTree = signal(true);
  readonly saving = signal(false);
  readonly view = signal<ViewMode>('tree');
  private readonly term = signal('');
  private readonly menuItems = signal<MenuItemNode[]>([]);

  readonly roleOptions = computed<SelectOption[]>(() =>
    this.roles().map((r) => ({ value: r.id, label: `${r.roleName} (${r.roleCode})` })));

  // A FormControl's `.value` is a plain property, not a signal — reading it inside a
  // `computed()` would never mark that computed dirty when the control changes, so it
  // would memoize whatever it saw on its first read and never update again (same gotcha
  // documented in UserPermissions.currentUser). Bridging through `toSignal` on
  // `valueChanges` is what makes `currentRole` actually reactive to picking a role.
  private readonly roleId = toSignal(this.roleCtrl.valueChanges, { initialValue: this.roleCtrl.value });
  readonly currentRole = computed(() => this.roles().find((r) => r.id === this.roleId()) ?? null);

  private readonly allGroups = computed<PermissionGroup[]>(() => groupByModule(this.grantable()));

  readonly filteredGroups = computed<PermissionGroup[]>(() => {
    const t = this.term().trim().toLowerCase();
    if (!t) return this.allGroups();
    return this.allGroups()
      .map((g) => ({
        module: g.module,
        permissions: g.permissions.filter((p) =>
          p.permissionCode.toLowerCase().includes(t) ||
          p.permissionName.toLowerCase().includes(t) ||
          g.module.toLowerCase().includes(t))
      }))
      .filter((g) => g.permissions.length);
  });

  readonly dirty = computed(() => !sameSet(this.selected(), this.original()));

  readonly delta = computed(() => {
    const [sel, orig] = [this.selected(), this.original()];
    const added = [...sel].filter((c) => !orig.has(c)).length;
    const removed = [...orig].filter((c) => !sel.has(c)).length;
    return `${added} to add, ${removed} to remove`;
  });

  // ── Tree view — reuses User Permissions' own checkbox tree over a role instead of a
  // user (see buildRoleMenuTree). `selected`/`original` (flat codes) stay the single
  // source of truth; the tree is just another read of the same state.
  private readonly moduleActions = computed<Map<string, CrudAction[]>>(() => {
    const map = new Map<string, CrudAction[]>();
    for (const p of this.grantable()) {
      if (!(CRUD_ACTIONS as readonly string[]).includes(p.action)) continue;
      const list = map.get(p.module) ?? [];
      list.push(p.action as CrudAction);
      map.set(p.module, list);
    }
    return map;
  });

  /** `roleDefault` here is the role's *saved* grants, so the tree's built-in "differs
   *  from default" dot reads as "differs from what was last saved". */
  readonly permissionNodes = computed<MenuPermissionNode[]>(() =>
    buildRoleMenuTree(this.menuItems(), this.moduleActions(), this.original()));

  /** Live checkbox state, derived straight from `selected` — no separate signal to
   *  keep in sync. */
  readonly pending = computed<Map<string, ActionState>>(() => {
    const map = new Map<string, ActionState>();
    for (const [module, actions] of this.moduleActions()) {
      const state: ActionState = { CREATE: false, READ: false, UPDATE: false, DELETE: false };
      for (const a of actions) state[a] = this.selected().has(`${module}_${a}`);
      map.set(module, state);
    }
    return map;
  });

  private readonly leafById = computed(() =>
    new Map(this.permissionNodes().flatMap((n) => flattenLeaves(n)).map((l) => [l.id, l])));

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Access Control' }, { label: 'Permissions', route: '/permissions' }, { label: 'Assign' }]);

    // Roles for the picker + the full grantable catalogue, in parallel.
    this.roleService.assignable().subscribe({
      next: (rs) => {
        this.roles.set(rs);
        const pre = this.route.snapshot.queryParamMap.get('roleId');
        if (pre && rs.some((r) => r.id === pre)) { this.roleCtrl.setValue(pre); this.loadGrants(pre); }
      }
    });
    this.service.grantable().subscribe({
      next: (ps) => { this.grantable.set(ps); this.loadingCatalogue.set(false); },
      error: () => this.loadingCatalogue.set(false)
    });
    this.service.menuTree().subscribe({
      next: (items) => { this.menuItems.set(items); this.loadingMenuTree.set(false); },
      error: () => this.loadingMenuTree.set(false)
    });

    this.roleCtrl.valueChanges.subscribe((id) => { if (id) this.loadGrants(id); else this.clearSelection(); });
  }

  private loadGrants(roleId: string): void {
    this.loadingGrants.set(true);
    this.service.rolePermissions(roleId).subscribe({
      next: (perms) => {
        const codes = new Set((perms as Permission[]).map((p) => p.permissionCode));
        this.selected.set(new Set(codes));
        this.original.set(new Set(codes));
        this.loadingGrants.set(false);
      },
      error: () => { this.clearSelection(); this.loadingGrants.set(false); this.notify.error('Could not load the role permissions.'); }
    });
  }

  private clearSelection(): void { this.selected.set(new Set()); this.original.set(new Set()); }

  onSearch(t: string): void { this.term.set(t ?? ''); }

  /** Menu tree's per-leaf toggle — resolve leaf → module, then reuse the same flat-code
   *  path as the matrix view. */
  onMenuToggle({ menuItemId, action, checked }: MenuToggle): void {
    const leaf = this.leafById().get(menuItemId);
    if (!leaf?.module) return;
    this.onToggle({ codes: [`${leaf.module}_${action}`], checked });
  }

  /** Menu tree's cascading "select all under this node" — every available action of
   *  every leaf underneath. */
  onMenuToggleMany({ menuItemIds, checked }: MenuToggleMany): void {
    const byId = this.leafById();
    const codes: string[] = [];
    for (const id of menuItemIds) {
      const leaf = byId.get(id);
      if (!leaf?.module) continue;
      for (const a of CRUD_ACTIONS) if (hasAction(leaf.roleDefault, a)) codes.push(`${leaf.module}_${a}`);
    }
    this.onToggle({ codes, checked });
  }

  onToggle({ codes, checked }: PermissionToggle): void {
    const next = new Set(this.selected());
    for (const c of codes) checked ? next.add(c) : next.delete(c);
    this.selected.set(next);
  }

  selectAll(): void {
    const next = new Set(this.selected());
    for (const g of this.filteredGroups())
      for (const p of g.permissions) if (p.status === 'ACTIVE') next.add(p.permissionCode);
    this.selected.set(next);
  }

  deselectAll(): void {
    const next = new Set(this.selected());
    for (const g of this.filteredGroups()) for (const p of g.permissions) next.delete(p.permissionCode);
    this.selected.set(next);
  }

  reset(): void { this.selected.set(new Set(this.original())); this.notify.info('Reverted to the saved set.'); }

  save(): void {
    const role = this.currentRole();
    if (!role || this.saving()) return;
    const codes = [...this.selected()];
    if (!codes.length) { this.notify.error('Select at least one permission, or the request is rejected.'); return; }

    this.saving.set(true);
    this.service.assign(role.id, { permissionCodes: codes, replaceExisting: true }).subscribe({
      next: (res) => { this.saving.set(false); this.applyResult(res); },
      error: (e) => { this.saving.set(false); this.notify.error(e?.error?.message ?? 'Could not save permissions.'); }
    });
  }

  /** Trust the server's effective set — a rejected code never actually stuck. */
  private applyResult(res: RolePermissionResult): void {
    const effective = new Set(res.effectivePermissions);
    this.selected.set(new Set(effective));
    this.original.set(new Set(effective));

    const parts: string[] = [];
    if (res.granted.length) parts.push(`${res.granted.length} granted`);
    if (res.revoked.length) parts.push(`${res.revoked.length} revoked`);
    if (res.skipped.length) parts.push(`${res.skipped.length} unchanged`);
    this.notify.success(`Saved — ${parts.join(', ') || 'no changes'}.`);

    if (res.rejected.length) {
      this.notify.error(`${res.rejected.length} rejected (inactive or outside your plan): ${res.rejected.slice(0, 6).map(prettyToken).join(', ')}${res.rejected.length > 6 ? '…' : ''}`);
    }
  }
}

/** Order-independent set equality on codes. */
function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
