import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import {
  ActionState, CRUD_ACTIONS, CrudAction, MenuPermissionNode, flattenLeaves, hasAction
} from '@core/models/menu-permission.model';

/** Bubbled up when a single leaf's single checkbox changes. */
export interface PermissionToggle { menuItemId: string; action: CrudAction; checked: boolean; }
/** Bubbled up by a "select all" checkbox — every available action of every leaf under it. */
export interface PermissionToggleMany { menuItemIds: string[]; checked: boolean; }

/**
 * One node of the menu tree, recursive — unlimited depth, same component renders every
 * level. A grouping node (no module) shows only its title, chevron and a "select all"
 * checkbox that cascades to every leaf beneath it; a leaf shows the four CRUD checkboxes,
 * each disabled/blank when its module has no such action, and marked "Custom" the moment
 * its live value differs from the role default — the parent owns all state, this only
 * reflects it and emits what changed.
 */
@Component({
  selector: 'app-menu-permission-node',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCheckboxModule, MatIconModule, MenuPermissionNodeComponent],
  template: `
    <li class="node" [style.--depth]="depth()">
      <div class="node__row" [class.node__row--group]="isGroup()">
        <mat-checkbox class="node__all" [checked]="allChecked()" [indeterminate]="someChecked()"
                      (change)="toggleMany.emit({ menuItemIds: leafIds(), checked: $event.checked })"
                      [attr.aria-label]="'Select all under ' + node().title" />

        @if (hasChildren()) {
          <button type="button" class="node__chevron" (click)="expandToggle.emit(node().id)"
                  [attr.aria-expanded]="isExpanded()">
            <mat-icon>{{ isExpanded() ? 'expand_more' : 'chevron_right' }}</mat-icon>
          </button>
        } @else {
          <span class="node__chevron node__chevron--spacer"></span>
        }

        <span class="node__title">{{ node().title }}</span>

        @if (!isGroup()) {
          <div class="node__actions">
            @for (action of actions; track action) {
              @if (available(action)) {
                <label class="node__action" [class.node__action--custom]="isCustom(action)">
                  <mat-checkbox [checked]="value(action)"
                                (change)="toggle.emit({ menuItemId: node().id, action, checked: $event.checked })" />
                  <span>{{ action }}</span>
                  @if (isCustom(action)) { <span class="node__custom-dot" title="Overrides the role default"></span> }
                </label>
              } @else {
                <span class="node__action node__action--na">{{ action }}</span>
              }
            }
          </div>
        }
      </div>

      @if (hasChildren() && isExpanded()) {
        <ul class="node__children">
          @for (child of node().children; track child.id) {
            <app-menu-permission-node [node]="child" [pending]="pending()" [expanded]="expanded()"
                                       [depth]="depth() + 1" (toggle)="toggle.emit($event)"
                                       (toggleMany)="toggleMany.emit($event)" (expandToggle)="expandToggle.emit($event)" />
          }
        </ul>
      }
    </li>
  `,
  styles: [`
    .node { list-style:none; }
    .node__row { display:flex; align-items:center; gap:6px; padding:6px 8px 6px calc(8px + var(--depth) * 22px);
      border-radius:8px; }
    .node__row:hover { background:var(--surface-muted); }
    .node__row--group { font-weight:600; }
    .node__all { flex:0 0 auto; }
    .node__chevron { flex:0 0 auto; width:24px; height:24px; border:0; background:transparent; cursor:pointer;
      display:grid; place-items:center; color:var(--content-muted); padding:0; }
    .node__chevron mat-icon { font-size:19px; width:19px; height:19px; }
    .node__chevron--spacer { visibility:hidden; }
    .node__title { flex:1; font:500 16px var(--font-sans); color:var(--content-fg); min-width:0;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .node__actions { display:flex; align-items:center; gap:14px; flex:0 0 auto; }
    .node__action { display:flex; align-items:center; gap:2px; font:600 14px var(--font-sans);
      color:var(--content-muted); min-width:70px; position:relative; }
    .node__action--custom { color:var(--brand-700); }
    .node__action--na { min-width:70px; text-align:left; color:var(--surface-border); font:600 14px var(--font-sans); padding-left:26px; }
    .node__custom-dot { width:6px; height:6px; border-radius:50%; background:var(--brand-500); margin-left:2px; }
    .node__children { list-style:none; margin:0; padding:0; }
  `]
})
export class MenuPermissionNodeComponent {
  readonly node = input.required<MenuPermissionNode>();
  readonly pending = input.required<Map<string, ActionState>>();
  readonly expanded = input.required<ReadonlySet<string>>();
  readonly depth = input(0);

  readonly toggle = output<PermissionToggle>();
  readonly toggleMany = output<PermissionToggleMany>();
  readonly expandToggle = output<string>();

  readonly actions = CRUD_ACTIONS;

  readonly isGroup = computed(() => !this.node().module);
  readonly hasChildren = computed(() => this.node().children.length > 0);
  readonly isExpanded = computed(() => this.expanded().has(this.node().id));

  readonly leaves = computed(() => flattenLeaves(this.node()));
  readonly leafIds = computed(() => this.leaves().map((l) => l.id));

  private state(): ActionState | undefined {
    const module = this.node().module;
    return module ? this.pending().get(module) : undefined;
  }

  available(action: CrudAction): boolean {
    return hasAction(this.node().roleDefault, action);
  }

  value(action: CrudAction): boolean {
    return this.state()?.[action] ?? false;
  }

  isCustom(action: CrudAction): boolean {
    const state = this.state();
    if (!state) return false;
    const roleDefault = this.node().roleDefault[action] === true;
    return state[action] !== roleDefault;
  }

  /** Across every leaf under this node, every available action currently checked. */
  readonly allChecked = computed(() => {
    const p = this.pending();
    const leaves = this.leaves();
    const cells = leaves.flatMap((leaf) =>
      this.actions.filter((a) => hasAction(leaf.roleDefault, a))
        .map((a) => (leaf.module ? p.get(leaf.module)?.[a] : false) === true));
    return cells.length > 0 && cells.every(Boolean);
  });

  readonly someChecked = computed(() => {
    const p = this.pending();
    const leaves = this.leaves();
    const cells = leaves.flatMap((leaf) =>
      this.actions.filter((a) => hasAction(leaf.roleDefault, a))
        .map((a) => (leaf.module ? p.get(leaf.module)?.[a] : false) === true));
    const checkedCount = cells.filter(Boolean).length;
    return checkedCount > 0 && checkedCount < cells.length;
  });
}
