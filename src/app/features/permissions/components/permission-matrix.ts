import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import {
  Permission, PermissionGroup, PermissionAction, PERMISSION_ACTIONS, prettyToken
} from '@core/models/permission.model';
import { PermissionToggle } from './module-permission-card';

/**
 * Permission matrix — modules down the rows, actions across the columns, a checkbox at
 * each intersection that a permission exists for (an em-dash where it does not: not every
 * module has every action). The whole grid scrolls horizontally inside its own container
 * so the page body never does. Same selection contract as the tree: parent owns the Set.
 */
@Component({
  selector: 'app-permission-matrix',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCheckboxModule, MatIconModule],
  template: `
    @if (groups().length) {
      <div class="mx">
        <table class="mx__table">
          <thead>
            <tr>
              <th class="mx__sno">#</th>
              <th class="mx__corner">Module</th>
              @for (a of columns(); track a) { <th class="mx__col" [title]="prettyToken(a)">{{ prettyToken(a) }}</th> }
            </tr>
          </thead>
          <tbody>
            @for (g of groups(); track g.module; let i = $index) {
              <tr>
                <td class="mx__sno">{{ i + 1 }}</td>
                <th class="mx__row" scope="row">
                  <span class="mx__mod">{{ prettyToken(g.module) }}</span>
                  <span class="mx__sub">{{ count(g) }}/{{ g.permissions.length }}</span>
                </th>
                @for (a of columns(); track a) {
                  <td class="mx__cell">
                    @if (cell(g, a); as p) {
                      @if (selectable()) {
                        <mat-checkbox [checked]="selected().has(p.permissionCode)" [disabled]="!grantable(p)"
                                      (change)="toggle.emit({ codes: [p.permissionCode], checked: $event.checked })"
                                      [attr.aria-label]="p.permissionCode" [title]="p.permissionCode" />
                      } @else if (p.status === 'ACTIVE') {
                        <mat-icon class="mx__ok" [title]="p.permissionCode">check_circle</mat-icon>
                      } @else {
                        <mat-icon class="mx__off" [title]="p.permissionCode + ' (inactive)'">block</mat-icon>
                      }
                    } @else {
                      <span class="mx__na">—</span>
                    }
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <p class="mx__empty">No permissions match.</p>
    }
  `,
  styles: [`
    .mx { overflow-x:auto; border:1px solid var(--surface-border); border-radius:var(--r-lg, 12px); background:var(--surface); }
    .mx__table { border-collapse:collapse; width:100%; font:500 16px var(--font-sans); }
    .mx__table th, .mx__table td { border-bottom:1px solid var(--surface-border); }
    thead th { position:sticky; top:0; background:var(--surface-muted); z-index:1; }
    .mx__sno { position:sticky; left:0; z-index:2; background:var(--surface-muted); text-align:center;
      padding:10px 8px; color:var(--content-muted); font:600 15px var(--font-sans); width:40px; }
    .mx__corner { position:sticky; left:40px; z-index:2; background:var(--surface-muted); text-align:left;
      padding:10px 14px; font:600 15px var(--font-sans); color:var(--content-muted); min-width:150px; }
    .mx__col { padding:10px 8px; font:600 14px var(--font-sans); color:var(--content-muted); text-align:center;
      white-space:nowrap; min-width:74px; }
    .mx__row { position:sticky; left:40px; background:var(--surface); text-align:left; padding:8px 14px;
      display:flex; flex-direction:column; gap:1px; z-index:1; }
    .mx__mod { font:600 16px var(--font-sans); color:var(--content-fg); white-space:nowrap; }
    .mx__sub { font:600 14px var(--font-sans); color:var(--content-muted); }
    tbody .mx__sno { background:var(--surface); }
    tbody tr:hover .mx__row, tbody tr:hover .mx__cell, tbody tr:hover .mx__sno { background:var(--surface-muted); }
    .mx__cell { text-align:center; padding:4px; }
    .mx__na { color:var(--surface-border); }
    .mx__ok { color:var(--success); font-size:20px; width:20px; height:20px; }
    .mx__off { color:var(--danger); font-size:20px; width:20px; height:20px; }
    .mx__empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:32px; }
  `]
})
export class PermissionMatrix {
  readonly groups = input.required<PermissionGroup[]>();
  readonly selectable = input(false);
  readonly selected = input<ReadonlySet<string>>(new Set());
  readonly blocked = input<ReadonlySet<string>>(new Set());

  readonly toggle = output<PermissionToggle>();

  readonly prettyToken = prettyToken;

  /** Only the action columns that actually appear in the current groups, in canonical order. */
  readonly columns = computed<PermissionAction[]>(() => {
    const present = new Set(this.groups().flatMap((g) => g.permissions.map((p) => p.action)));
    return PERMISSION_ACTIONS.filter((a) => present.has(a));
  });

  private readonly index = computed(() => {
    const map = new Map<string, Permission>();
    for (const g of this.groups()) for (const p of g.permissions) map.set(`${g.module}|${p.action}`, p);
    return map;
  });

  cell(g: PermissionGroup, a: PermissionAction): Permission | undefined { return this.index().get(`${g.module}|${a}`); }
  count(g: PermissionGroup): number { return g.permissions.filter((p) => this.selected().has(p.permissionCode)).length; }
  grantable(p: Permission): boolean { return p.status === 'ACTIVE' && !this.blocked().has(p.permissionCode); }
}
