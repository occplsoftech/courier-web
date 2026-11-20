import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { Permission, PermissionGroup, prettyToken } from '@core/models/permission.model';

/** What the parent tree needs back when a permission or a whole module is toggled. */
export interface PermissionToggle { codes: string[]; checked: boolean; }

/**
 * One module and its permissions, as an expandable card. Presentational: it holds no
 * selection state of its own — the parent owns the selected `Set` and this reflects it,
 * emitting `toggle` for a single row and `toggleModule` for the header checkbox.
 *
 * In `readonly` mode (no `selectable`) it drops the checkboxes and just lists the rights,
 * used for the catalogue's grouped view. Plan-gated rows carry a lock; inactive rows are
 * dimmed and never selectable (the backend would reject them anyway).
 */
@Component({
  selector: 'app-module-permission-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCheckboxModule, MatIconModule],
  template: `
    <section class="mpc app-card" [class.mpc--open]="expanded()">
      <header class="mpc__head">
        @if (selectable()) {
          <mat-checkbox class="mpc__all" [checked]="allSelected()" [indeterminate]="someSelected()"
                        (change)="toggleModule.emit({ codes: selectableCodes(), checked: $event.checked })"
                        (click)="$event.stopPropagation()" [attr.aria-label]="'Select all in ' + name()" />
        }
        <button type="button" class="mpc__toggle" (click)="expandedChange.emit(!expanded())"
                [attr.aria-expanded]="expanded()">
          <mat-icon class="mpc__chev">{{ expanded() ? 'expand_more' : 'chevron_right' }}</mat-icon>
          <span class="mpc__icon"><mat-icon>{{ icon() }}</mat-icon></span>
          <span class="mpc__title">{{ name() }}</span>
          <span class="mpc__count">
            @if (selectable()) { {{ selectedCount() }}/{{ group().permissions.length }} }
            @else { {{ group().permissions.length }} }
          </span>
        </button>
      </header>

      @if (expanded()) {
        <ul class="mpc__list">
          @for (p of group().permissions; track p.id) {
            <li class="mpc__row" [class.mpc__row--off]="p.status === 'INACTIVE'">
              @if (selectable()) {
                <mat-checkbox [checked]="isSelected(p.permissionCode)" [disabled]="!grantable(p)"
                              (change)="toggle.emit({ codes: [p.permissionCode], checked: $event.checked })"
                              [attr.aria-label]="p.permissionCode" />
              }
              <span class="tag tag--action">{{ prettyToken(p.action) }}</span>
              <div class="mpc__meta">
                <span class="mpc__name">{{ p.permissionName }}</span>
                <code class="mpc__code">{{ p.permissionCode }}</code>
              </div>
              <div class="mpc__flags">
                @if (p.requiredFeatureFlag) {
                  <span class="lock" [title]="'Requires plan feature: ' + p.requiredFeatureFlag"><mat-icon>lock</mat-icon></span>
                }
                @if (p.status === 'INACTIVE') { <span class="tag tag--off">Inactive</span> }
                @if (p.isSystemPermission) { <span class="tag">System</span> }
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [`
    .mpc { padding:0; overflow:hidden; }
    .mpc__head { display:flex; align-items:center; gap:10px; padding:4px 14px 4px 16px; }
    .mpc__all { flex:0 0 auto; }
    .mpc__toggle { flex:1; display:flex; align-items:center; gap:10px; border:0; background:transparent;
      cursor:pointer; padding:12px 0; text-align:left; color:var(--content-fg); min-width:0; }
    .mpc__chev { color:var(--content-muted); flex:0 0 auto; }
    .mpc__icon { width:32px; height:32px; border-radius:9px; background:var(--brand-50); color:var(--brand-700);
      display:grid; place-items:center; flex:0 0 auto; }
    .mpc__icon mat-icon { font-size:19px; width:19px; height:19px; }
    .mpc__title { font:600 17px var(--font-sans); flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .mpc__count { font:600 15px var(--font-sans); color:var(--content-muted); background:var(--surface-muted);
      border:1px solid var(--surface-border); border-radius:999px; padding:2px 10px; flex:0 0 auto; }
    .mpc__list { list-style:none; margin:0; padding:4px 0 8px; border-top:1px solid var(--surface-border); }
    .mpc__row { display:flex; align-items:center; gap:12px; padding:8px 16px 8px 20px; }
    .mpc__row:hover { background:var(--surface-muted); }
    .mpc__row--off { opacity:.6; }
    .mpc__meta { display:flex; flex-direction:column; gap:1px; min-width:0; flex:1; }
    .mpc__name { font:500 16px var(--font-sans); color:var(--content-fg); }
    .mpc__code { font:600 14px var(--font-mono, ui-monospace); color:var(--content-muted); }
    .mpc__flags { display:flex; align-items:center; gap:6px; flex:0 0 auto; }
    .lock { color:var(--warning); display:inline-flex; }
    .lock mat-icon { font-size:16px; width:16px; height:16px; }
    .tag { display:inline-block; background:var(--surface-muted); border:1px solid var(--surface-border);
      color:var(--content-muted); font:600 13px var(--font-sans); padding:2px 7px; border-radius:6px; white-space:nowrap; }
    .tag--action { background:var(--brand-50); color:var(--brand-700); border-color:var(--brand-100); min-width:64px; text-align:center; }
    .tag--off { color:var(--danger); background:var(--danger-bg); border-color:transparent; }
  `]
})
export class ModulePermissionCard {
  readonly group = input.required<PermissionGroup>();
  readonly expanded = input(false);
  readonly selectable = input(false);
  /** Codes currently selected (owned by the parent). */
  readonly selected = input<ReadonlySet<string>>(new Set());
  /** Codes that cannot be granted for this company (plan-gated out / inactive). Disabled. */
  readonly blocked = input<ReadonlySet<string>>(new Set());

  readonly toggle = output<PermissionToggle>();
  readonly toggleModule = output<PermissionToggle>();
  readonly expandedChange = output<boolean>();

  readonly prettyToken = prettyToken;

  readonly name = computed(() => prettyToken(this.group().module));
  readonly icon = computed(() => MODULE_ICONS[this.group().module] ?? 'folder');

  /** Codes in this module the caller may actually pick (grantable + not blocked). */
  readonly selectableCodes = computed(() =>
    this.group().permissions.filter((p) => this.grantable(p)).map((p) => p.permissionCode));

  readonly selectedCount = computed(() =>
    this.group().permissions.filter((p) => this.selected().has(p.permissionCode)).length);

  readonly allSelected = computed(() => {
    const codes = this.selectableCodes();
    return codes.length > 0 && codes.every((c) => this.selected().has(c));
  });
  readonly someSelected = computed(() => this.selectedCount() > 0 && !this.allSelected());

  isSelected(code: string): boolean { return this.selected().has(code); }
  grantable(p: Permission): boolean { return p.status === 'ACTIVE' && !this.blocked().has(p.permissionCode); }
}

/** A recognisable icon per module — cosmetic, defaults to a folder for anything unmapped. */
const MODULE_ICONS: Record<string, string> = {
  AUTH: 'vpn_key', COMPANY: 'business', USER: 'group', ROLE: 'badge', PERMISSION: 'lock',
  BRANCH: 'store', HUB: 'hub', CUSTOMER: 'person', ADDRESS: 'place', PINCODE: 'pin_drop',
  RATE_MASTER: 'payments', ROUTE_MASTER: 'route', SHIPMENT: 'local_shipping', TRACKING: 'my_location',
  MANIFEST: 'receipt_long', PICKUP: 'inventory_2', DELIVERY: 'moving', DRIVER: 'directions_car',
  VEHICLE: 'directions_bus', VENDOR: 'handshake', PDP: 'handshake', PDP_RATE: 'request_quote', PDP_BILLING: 'receipt_long', WALLET: 'account_balance_wallet', PAYMENT: 'credit_card',
  INVOICE: 'description', REPORT: 'assessment', DASHBOARD: 'dashboard', SETTINGS: 'settings',
  NOTIFICATION: 'notifications', AUDIT: 'fact_check'
};
