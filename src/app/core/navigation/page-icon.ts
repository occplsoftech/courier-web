import { NAVIGATION } from './navigation.config';
import { NavNode } from './navigation.model';

/** Every menu route with its icon (a leaf without one takes its group's). */
function routeIcons(nodes: NavNode[], parentIcon = 'description', out: { route: string; icon: string }[] = []) {
  for (const n of nodes) {
    const icon = n.icon || parentIcon;
    if (n.route) out.push({ route: n.route.split('?')[0], icon });
    if (n.children?.length) routeIcons(n.children, icon, out);
  }
  return out;
}
const ROUTES = routeIcons(NAVIGATION).sort((a, b) => b.route.length - a.route.length);

/**
 * The icon a page's header shows: its own menu item's icon, else the menu item its address sits under
 * (/shipments/123 → Shipments), else a plain page icon.
 */
export function pageIconFor(url: string): string {
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const hit = ROUTES.find((r) => path === r.route) ?? ROUTES.find((r) => r.route !== '/' && path.startsWith(r.route + '/'));
  return hit?.icon ?? 'description';
}
