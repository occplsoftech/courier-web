import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { ActionState, MenuPermissionNode, flattenLeaves } from '@core/models/menu-permission.model';
import {
  MenuPermissionNodeComponent, PermissionToggle, PermissionToggleMany
} from './menu-permission-node';

/**
 * Root of the menu permission tree: expand/collapse all, select/deselect all (every
 * available action of every leaf), then the recursive node list. Same toolbar contract
 * as {@link PermissionTree}, over a real hierarchy instead of a flat module list — the
 * selection state itself (`pending`) is owned by the page, this only reflects and emits.
 */
@Component({
  selector: 'app-menu-permission-tree',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButton, MenuPermissionNodeComponent],
  template: `
    <div class="tree">
      <div class="tree__bar">
        <div class="tree__bar-l">
          <app-button variant="text" icon="unfold_more" (pressed)="expandAll()">Expand all</app-button>
          <app-button variant="text" icon="unfold_less" (pressed)="collapseAll()">Collapse all</app-button>
        </div>
        <div class="tree__bar-r">
          <app-button variant="text" icon="done_all" (pressed)="selectAll()">Select all</app-button>
          <app-button variant="text" icon="remove_done" (pressed)="deselectAll()">Deselect all</app-button>
        </div>
      </div>

      @if (nodes().length) {
        <ul class="tree__list">
          @for (node of nodes(); track node.id) {
            <app-menu-permission-node [node]="node" [pending]="pending()" [expanded]="open()"
                                       (toggle)="toggle.emit($event)" (toggleMany)="toggleMany.emit($event)"
                                       (expandToggle)="toggleOpen($event)" />
          }
        </ul>
      } @else {
        <p class="tree__empty">No menu items.</p>
      }
    </div>
  `,
  styles: [`
    .tree { display:flex; flex-direction:column; gap:10px; }
    .tree__bar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
    .tree__bar-l, .tree__bar-r { display:flex; align-items:center; gap:4px; }
    .tree__list { list-style:none; margin:0; padding:0; border:1px solid var(--surface-border);
      border-radius:var(--r-lg, 12px); background:var(--surface); padding:6px; }
    .tree__empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:32px; }
  `]
})
export class MenuPermissionTree {
  readonly nodes = input.required<MenuPermissionNode[]>();
  readonly pending = input.required<Map<string, ActionState>>();

  readonly toggle = output<PermissionToggle>();
  readonly toggleMany = output<PermissionToggleMany>();

  protected readonly open = signal<Set<string>>(new Set());

  private readonly allGroupIds = computed(() => {
    const ids = new Set<string>();
    const walk = (n: MenuPermissionNode) => { if (n.children.length) { ids.add(n.id); n.children.forEach(walk); } };
    this.nodes().forEach(walk);
    return ids;
  });

  private readonly allLeafIds = computed(() => this.nodes().flatMap((n) => flattenLeaves(n)).map((l) => l.id));

  toggleOpen(id: string): void {
    const next = new Set(this.open());
    next.has(id) ? next.delete(id) : next.add(id);
    this.open.set(next);
  }

  expandAll(): void { this.open.set(new Set(this.allGroupIds())); }
  collapseAll(): void { this.open.set(new Set()); }

  selectAll(): void { this.toggleMany.emit({ menuItemIds: this.allLeafIds(), checked: true }); }
  deselectAll(): void { this.toggleMany.emit({ menuItemIds: this.allLeafIds(), checked: false }); }
}
