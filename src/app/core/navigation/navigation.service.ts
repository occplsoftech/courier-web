import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { PermissionService } from '../auth/permission.service';
import { PartnerContextService } from '../auth/partner-context.service';
import { storage } from '../utils/storage.util';
import { NAVIGATION } from './navigation.config';
import { NavNode } from './navigation.model';

const COLLAPSE_KEY = 'cs.sidebar.collapsed';
const EXPAND_KEY = 'cs.sidebar.expanded';

/** A Pickup-Delivery Partner only collects and delivers: these top-level groups, and inside
 *  Operations only the booking + delivery-desk leaves, are all its sidebar shows. */
const PARTNER_GROUPS = new Set(['dashboard', 'pdp-management', 'operations', 'finance', 'reports']);
const PARTNER_OPERATIONS = new Set([
  'booking', 'shipment-search', 'track', 'receive', 'pending-delivery', 'out-for-delivery', 'delivery',
  'delivery-updation'
]);

/**
 * The dynamic navigation. Filters the authored (or API-supplied) tree by permission, prunes
 * empty parents, and owns the sidebar's collapse + per-group expand state (both persisted).
 * No component makes a role decision — visibility flows through {@link PermissionService}.
 */
@Injectable({ providedIn: 'root' })
export class NavigationService {
  private readonly perm = inject(PermissionService);
  private readonly router = inject(Router);
  private readonly partner = inject(PartnerContextService);

  /** Desktop rail collapsed to icons — remembered across sessions. */
  readonly collapsed = signal<boolean>(storage.get(COLLAPSE_KEY) === '1');
  /** Explicit per-group open/closed choices (id → state); absent = follow the active route. */
  private readonly manualExpand = signal<Record<string, boolean>>(readJson(EXPAND_KEY));
  /** Optional API-supplied menu (flat rows assembled into a tree); falls back to the static config. */
  private readonly override = signal<NavNode[] | null>(null);

  /** Current URL, reactive, for active-route + auto-expand. */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url)
    ),
    { initialValue: this.router.url }
  );

  /** The visible, permission-filtered, order-sorted menu tree. */
  readonly menu = computed<NavNode[]>(() => this.filter(this.override() ?? NAVIGATION));

  // ── collapse ──────────────────────────────────────────────────────────────
  toggleCollapsed(): void { this.setCollapsed(!this.collapsed()); }
  setCollapsed(v: boolean): void { this.collapsed.set(v); storage.set(COLLAPSE_KEY, v ? '1' : '0'); }

  // ── expand ────────────────────────────────────────────────────────────────
  /** A group is open when explicitly opened, or (by default) when it holds the active route. */
  isExpanded(node: NavNode): boolean {
    const manual = this.manualExpand()[node.id];
    return manual ?? this.isGroupActive(node);
  }
  toggle(node: NavNode): void {
    const next = { ...this.manualExpand(), [node.id]: !this.isExpanded(node) };
    this.manualExpand.set(next);
    storage.set(EXPAND_KEY, JSON.stringify(next));
  }
  /** Does any descendant route match the current URL? Drives active highlight + auto-expand. */
  isGroupActive(node: NavNode): boolean {
    return (node.children ?? []).some((c) =>
      c.children ? this.isGroupActive(c) : !!c.route && this.matches(c.route));
  }
  /** Exact match only — a sibling leaf's route (e.g. '/rates') must not "contain" another
   * leaf whose route happens to share that prefix (e.g. '/rates/calculator'), the same
   * pitfall Angular's own non-exact `routerLinkActive` has by default. */
  private matches(route: string): boolean {
    return this.url() === route;
  }

  // ── API seam ──────────────────────────────────────────────────────────────
  /** Replace the menu from a flat, API-supplied list (assembled by parentId + order). */
  setMenuFromApi(flat: NavNode[]): void { this.override.set(buildTree(flat)); }
  /** Revert to the built-in configuration. */
  resetMenu(): void { this.override.set(null); }

  // ── filtering ─────────────────────────────────────────────────────────────
  private filter(nodes: NavNode[], parentId?: string): NavNode[] {
    const partner = this.partner.isPartner();
    return [...nodes]
      .filter((n) => !partner || (parentId === undefined ? PARTNER_GROUPS.has(n.id)
        : parentId !== 'operations' || PARTNER_OPERATIONS.has(n.id)))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((n): NavNode | null => {
        if (n.children?.length) {
          const kids = this.filter(n.children, n.id);
          return kids.length ? { ...n, children: kids, visible: true } : null; // prune empty parent
        }
        return this.canSee(n) ? { ...n, visible: true } : null;
      })
      .filter((n): n is NavNode => n !== null);
  }

  /** Public/structural nodes are always visible; the rest go through the permission service. */
  private canSee(node: NavNode): boolean {
    if (!node.permission && !node.roles?.length) return true;
    return this.perm.canAccess({
      permissions: node.permission ? [node.permission] : [],
      roles: node.roles ?? []
    });
  }
}

function readJson(key: string): Record<string, boolean> {
  try { return JSON.parse(storage.get(key) ?? '{}') as Record<string, boolean>; } catch { return {}; }
}

/** Assemble a flat, `parentId`-linked list into a nested, order-sorted tree. */
function buildTree(flat: NavNode[]): NavNode[] {
  const byId = new Map<string, NavNode>(flat.map((n) => [n.id, { ...n, children: [] as NavNode[] }]));
  const roots: NavNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    (parent ? parent.children! : roots).push(node);
  }
  const sort = (list: NavNode[]): NavNode[] => {
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const n of list) if (n.children?.length) sort(n.children); else delete n.children;
    return list;
  };
  return sort(roots);
}
