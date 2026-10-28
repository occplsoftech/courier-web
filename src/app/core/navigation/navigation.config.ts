import { NavNode } from './navigation.model';
import { AppRole } from '../models/role.model';

/**
 * The application navigation, authored as a nested tree. Every leaf declares the `permission`
 * code that governs its visibility (real `MODULE_ACTION` codes from the backend catalogue,
 * required to actually exist there — see PermissionService.canAccess) plus a `roles` bridge.
 * Both are checked: `roles` narrows to who could ever have the right, `permission` is the
 * per-user grant (role default, overridable per user via Menu + Permission Management) that
 * decides whether this user still does. A leaf whose module has no permission-catalogue rows
 * yet (Freight Factor, Vehicles, POD, Settlement, the "(Soon)" Pricing section, ...) omits
 * `permission` and is gated on `roles` alone — do not invent a code for one of these, it would
 * never be grantable and would permanently hide the leaf once AND-checked.
 *
 * Aspirational sections (Masters, Pricing, Operations, Finance, Reports) point at routes whose
 * feature modules are not built yet — the pages render an empty state, never mock data.
 */
const ADMINS = [AppRole.SUPER_ADMIN, AppRole.COMPANY_ADMIN];
/** The platform tier. Nothing under Platform is a company's to see. */
const PLATFORM = [AppRole.SUPER_ADMIN];
const MANAGERS = [...ADMINS, AppRole.BRANCH_MANAGER, AppRole.HUB_MANAGER];
/** Finance is company-side work — SUPER_ADMIN excluded, branch/finance roles unchanged. */
const FINANCE = [AppRole.COMPANY_ADMIN, AppRole.FINANCE_USER];
/** Every non-platform role — Customers is every company user's tool (counter desk
 * registers, back office edits), SUPER_ADMIN excluded. */
const COMPANY_ROLES = [
  AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER, AppRole.HUB_MANAGER, AppRole.BOOKING_OPERATOR,
  AppRole.DELIVERY_OPERATOR, AppRole.ACCOUNTS, AppRole.FINANCE_USER, AppRole.CUSTOMER_SERVICE, AppRole.VIEWER
];
/** The branch's money desk, alongside whoever runs the branch. */
const ACCOUNTS_DESK = [...FINANCE, AppRole.BRANCH_MANAGER, AppRole.ACCOUNTS];
/** Ticket Support: every company role raises/reads tickets, plus SUPER_ADMIN's own
 * cross-tenant view — the one nav section every signed-in role sees something of. */
const SUPPORT_READERS = [...COMPANY_ROLES, AppRole.SUPER_ADMIN];
/** Follow-up Management: branch operational tasks — every company role, no SUPER_ADMIN
 * (unlike Ticket Support, a follow-up has no cross-tenant view at all). */
const FOLLOW_UP_READERS = COMPANY_ROLES;
/** Communication Center: dashboard/logs are readable by whoever runs a branch; Channel
 * Settings/Templates are COMPANY_ADMIN's own call (mirrors backend @PreAuthorize —
 * no SUPER_ADMIN, this is company-owned config, not platform-owned). */
const COMMUNICATION_READERS = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER];
const COMMUNICATION_ADMIN = [AppRole.COMPANY_ADMIN];
/** Every branch role reads what it books, moves or is asked about. */
const SHIPMENT_READERS = [...MANAGERS, AppRole.BOOKING_OPERATOR, AppRole.DELIVERY_OPERATOR, AppRole.ACCOUNTS];
/** Every branch staff role reads its own reports. */
const BRANCH_REPORT_READERS = [...MANAGERS, AppRole.BOOKING_OPERATOR, AppRole.DELIVERY_OPERATOR, AppRole.ACCOUNTS];
/** Company Settings / Branches / the company's own six Masters catalogues: the back
 * office's own setup work — no platform operator, no branch role. */
const COMPANY_ONLY = [AppRole.COMPANY_ADMIN];
/** The shared geography (Country..Pincode): read by the platform and by the company that
 * looks it up while booking; written by the platform alone (see master.config's
 * `GLOBAL_MASTER_WRITERS`, which the create/edit screens gate on, not this nav bridge). */
const GLOBAL_MASTER_READERS = [AppRole.SUPER_ADMIN, AppRole.COMPANY_ADMIN];
/** Rate Master: company and branch price their own shipments; a platform operator prices
 * nothing. */
const COMPANY_AND_BRANCH = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER];
/** Operations tier, SUPER_ADMIN excluded — day-to-day shipment work is a company's own,
 * same reasoning as the Platform section's own comment above. */
const OPS_MANAGERS = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER, AppRole.HUB_MANAGER];
/** The branch's own counter desk: finds/registers the customer, then books. */
const OPS_BOOKING = [...OPS_MANAGERS, AppRole.BOOKING_OPERATOR];
/** The road: takes the inbound manifest in, runs deliveries out, closes them. */
const OPS_DELIVERY_DESK = [...OPS_MANAGERS, AppRole.DELIVERY_OPERATOR];
const OPS_SHIPMENT_READERS = [...OPS_MANAGERS, AppRole.BOOKING_OPERATOR, AppRole.DELIVERY_OPERATOR, AppRole.ACCOUNTS];

// Hub Operations' own screens — COMPANY_ADMIN for oversight, HUB_MANAGER for the hub's
// own desk. In Scan/Load Sheet/Dispatch under this section reuse the Shipment Movement
// screens above wholesale (same component, a second route); see app.routes.ts.
const HUB_OPS = [AppRole.COMPANY_ADMIN, AppRole.HUB_MANAGER];

export const NAVIGATION: NavNode[] = [
  { id: 'dashboard', title: 'Dashboard', icon: 'dashboard', route: '/dashboard', order: 1 },
  // KYC: every company user does their own (a branch manager also their branch's) — see MEMORY/modules/kyc.md.
  { id: 'my-kyc', title: 'My KYC', icon: 'verified_user', route: '/kyc', order: 1.2, roles: COMPANY_ROLES },

  // The platform console. A super admin manages companies, their subscriptions and other
  // platform operators — and nothing operational. There is deliberately no branch,
  // shipment, customer, manifest or wallet entry here: those are a company's own work,
  // and a record a platform operator created would be indistinguishable from one the
  // company created itself. The shared geography used to live here too; it moved to
  // Masters (below) once COMPANY_ADMIN needed to read it as well, not just SUPER_ADMIN.
  {
    id: 'platform', title: 'Platform', icon: 'travel_explore', order: 1.5, roles: PLATFORM,
    children: [
      { id: 'platform-dashboard', title: 'Platform Dashboard', icon: 'monitoring', route: '/platform/dashboard', permission: 'DASHBOARD_READ', roles: PLATFORM },
      { id: 'companies', title: 'Companies', icon: 'domain', route: '/companies', permission: 'COMPANY_READ', roles: PLATFORM },
      { id: 'subscription-plans', title: 'Subscription Plans', icon: 'workspace_premium', route: '/subscription-plans', permission: 'SUBSCRIPTION_READ', roles: PLATFORM },
      { id: 'super-admins', title: 'Platform Operators', icon: 'shield_person', route: '/platform/users', permission: 'SUPER_ADMIN_USER_READ', roles: PLATFORM }
    ]
  },

  {
    id: 'administration', title: 'Administration', icon: 'admin_panel_settings', order: 2,
    children: [
      { id: 'users', title: 'Users', icon: 'group', route: '/users', permission: 'USER_READ', roles: [...ADMINS, AppRole.BRANCH_MANAGER] },
      { id: 'departments', title: 'Departments', icon: 'apartment', route: '/departments', permission: 'DEPARTMENT_READ', roles: ADMINS },
      { id: 'roles', title: 'Roles', icon: 'badge', route: '/roles', permission: 'ROLE_READ', roles: ADMINS },
      { id: 'permissions', title: 'Permissions', icon: 'key', route: '/permissions', permission: 'PERMISSION_READ', roles: ADMINS },
      { id: 'permission-assign', title: 'Assign Permissions', icon: 'rule', route: '/permissions/assign', permission: 'PERMISSION_ASSIGN', roles: [AppRole.COMPANY_ADMIN] },
      // Menu + Permission Management: one user's menu tree on top of their role's
      // defaults. MENU_ASSIGN, never PERMISSION_ASSIGN — see permission-assign's own
      // leaf above and DefaultRoleCatalog's BRANCH_MANAGER definition.
      { id: 'user-permissions', title: 'User Permissions', icon: 'checklist', route: '/permissions/users', permission: 'MENU_ASSIGN', roles: [...ADMINS, AppRole.BRANCH_MANAGER] },
      { id: 'branches', title: 'Branches', icon: 'store', route: '/branches', permission: 'BRANCH_READ', roles: COMPANY_ONLY },
      // A Hub is a Branch with branchType HUB (V61), not a separate module — see
      // MEMORY/modules/hub-operations.md decision 1. HUB_VIEW is the catalogue's own
      // legacy alias for HUB_READ (never a "_VIEW" suffix code otherwise).
      { id: 'hubs', title: 'Hubs', icon: 'hub', route: '/hubs', permission: 'HUB_VIEW', roles: MANAGERS },
      { id: 'kyc-review', title: 'KYC Review', icon: 'fact_check', route: '/kyc/review', roles: COMPANY_ONLY },
      { id: 'courier-integrations', title: 'Courier Integrations', icon: 'local_shipping', route: '/courier-integrations', roles: COMPANY_ONLY },
      { id: 'company-settings', title: 'Company Settings', icon: 'tune', route: '/settings', permission: 'SETTINGS_READ', roles: COMPANY_ONLY },
      // User Activity & Audit Logging: reuses AUDIT_READ/SEARCH/EXPORT, seeded since V6
      // and unused until this module (MEMORY/modules/activity-log.md) — no new
      // ACTIVITY_LOG_VIEW/EXPORT codes, same reasoning RATE_MASTER_CALCULATE's neighbours
      // avoid inventing a parallel right for something the catalogue already names.
      { id: 'activity-log', title: 'Activity Log', icon: 'history', route: '/activity-logs', permission: 'AUDIT_SEARCH', roles: ADMINS },
      { id: 'user-activity', title: 'User Activity', icon: 'person_search', route: '/activity-logs/users', permission: 'AUDIT_READ', roles: ADMINS }
    ]
  },

  {
    id: 'customers', title: 'Customers', icon: 'contacts', route: '/customers', order: 2.5,
    permission: 'CUSTOMER_READ', roles: COMPANY_ROLES.filter((r) => r !== AppRole.BRANCH_MANAGER)
    // Every company-side role, SUPER_ADMIN excluded — the backend itself reads with
    // isAuthenticated() (any signed-in company user), see CustomerService. BRANCH_MANAGER
    // dropped by direct request: a branch manager's own nav leads to Users (staffing their
    // branch), not Customers.
  },

  // Pickup Delivery Partner Management: partners who only collect (pickup) and deliver, each paid
  // from its own pickup / delivery rate cards. COMPANY_ADMIN-only back-office setup, a separate
  // top-level group (not part of Branches). A partner is a Branch of type PICKUP_DELIVERY_PARTNER.
  {
    id: 'pdp-management', title: 'Pickup Delivery Partner Management', icon: 'handshake', order: 2.7,
    children: [
      { id: 'pdp-partners', title: 'Partners', icon: 'groups', route: '/pdp/partners', permission: 'PDP_READ', roles: COMPANY_ONLY },
      { id: 'pdp-rates', title: 'Partner Rates', icon: 'request_quote', route: '/pdp/rates', permission: 'PDP_RATE_READ', roles: COMPANY_ONLY },
      { id: 'pdp-pickups', title: 'Pickup Requests', icon: 'inventory_2', route: '/pdp/pickups', permission: 'PICKUP_READ', roles: [...COMPANY_ONLY, AppRole.BRANCH_MANAGER] },
      // Deliveries, earnings and statements also serve a partner's own login (BRANCH_MANAGER): the
      // server scopes them to the caller's own branch, so these carry no permission gate.
      { id: 'pdp-my-rates', title: 'My Rates', icon: 'request_quote', route: '/pdp/my-rates', roles: [AppRole.BRANCH_MANAGER] },
      { id: 'pdp-deliveries', title: 'Partner Deliveries', icon: 'moving', route: '/pdp/deliveries', roles: [...COMPANY_ONLY, AppRole.BRANCH_MANAGER] },
      { id: 'pdp-earnings', title: 'Partner Earnings', icon: 'payments', route: '/pdp/earnings', roles: [...COMPANY_ONLY, AppRole.BRANCH_MANAGER] },
      { id: 'pdp-billing', title: 'Partner Billing', icon: 'receipt_long', route: '/pdp/billing', roles: [...COMPANY_ONLY, AppRole.BRANCH_MANAGER] }
    ]
  },

  // Business Customer: business accounts, the pricing zones (district/city groups) each is
  // priced by, and the per-zone rate cards. COMPANY_ADMIN-only back-office setup, same tier
  // as Masters/Charges. Separate from Rate Master, which is the company-wide route rate card.
  {
    id: 'business-customer', title: 'Business Customer', icon: 'business_center', order: 2.6,
    children: [
      { id: 'business-dashboard', title: 'Dashboard', icon: 'dashboard', route: '/business-customer/dashboard', permission: 'CUSTOMER_READ', roles: COMPANY_ONLY },
      { id: 'business-customers', title: 'Customer', icon: 'contacts', route: '/business-customer/customers', permission: 'CUSTOMER_READ', roles: COMPANY_ONLY },
      { id: 'pricing-zones', title: 'Pricing Zone', icon: 'map', route: '/business-customer/pricing-zones', permission: 'PRICING_ZONE_READ', roles: COMPANY_ONLY },
      { id: 'customer-rates', title: 'Rate', icon: 'request_quote', route: '/business-customer/rates', permission: 'CUSTOMER_RATE_READ', roles: COMPANY_ONLY },
      { id: 'business-billing', title: 'Billing', icon: 'receipt_long', route: '/business-customer/billing', permission: 'CUSTOMER_BILLING_READ', roles: COMPANY_ONLY }
    ]
  },

  // Zone Tariff: the company's own cash rates — zones (state/district/city/pincode groups), rate
  // cards per from zone with weight slabs and charges, and a calculator. Counter booking and the
  // customer portal price from it when the booking branch's pincode is in a from zone.
  {
    id: 'zone-tariff', title: 'Zone Tariff', icon: 'travel_explore', order: 2.65,
    children: [
      { id: 'tariff-zones', title: 'Zones', icon: 'map', route: '/zone-tariff/zones', permission: 'TARIFF_READ', roles: COMPANY_ONLY },
      { id: 'tariff-rate-cards', title: 'Rate Cards', icon: 'request_quote', route: '/zone-tariff/rate-cards', permission: 'TARIFF_READ', roles: COMPANY_ONLY },
      { id: 'tariff-calculator', title: 'Calculator', icon: 'calculate', route: '/zone-tariff/calculator', roles: COMPANY_AND_BRANCH }
    ]
  },

  {
    id: 'rate-master', title: 'Rate Master', icon: 'price_change', order: 2.7,
    children: [
      { id: 'rates', title: 'Rate Cards', icon: 'request_quote', route: '/rates', permission: 'RATE_MASTER_READ', roles: COMPANY_AND_BRANCH },
      // Calculator page hosts both the Rate and Freight Factor calculators as tabs —
      // one calculator entry point for both pricing mechanisms, by direct request.
      { id: 'rate-calculator', title: 'Calculator', icon: 'calculate', route: '/rates/calculator', permission: 'RATE_MASTER_CALCULATE', roles: COMPANY_AND_BRANCH },
      // Standalone distance x weight pricing grid, independent of Rate Master's own
      // Route-based rates above — grouped here as a submenu for nav convenience only.
      // No `permission` key: backend has no permission codes for this module, writes
      // are COMPANY_ADMIN-only in-page. Its own Calculate card moved to the Calculator
      // page above as a tab — this leaf is the grid itself now.
      { id: 'freight-factor', title: 'Freight Factor', icon: 'grid_on', route: '/freight-factors', roles: COMPANY_AND_BRANCH },
      // District Level Freight — rate setup by From Station + District + weight slab,
      // grouped here alongside the other rate-setup leaves. No `permission` key: this
      // module has no permission-catalogue rows yet, same as Freight Factor above.
      { id: 'district-level-freight', title: 'District Level Freight', icon: 'map', route: '/district-level-freight', roles: COMPANY_AND_BRANCH }
    ]
  },

  // Resolve/list the road distance between two branches — groundwork for distance/freight-
  // factor pricing, not itself a pricing feature. Same isAuthenticated() posture as Rate
  // Master, so the same role tier (company + branch) is reused.
  { id: 'address-distance', title: 'Address Distance', icon: 'social_distance', route: '/distances', order: 2.8, roles: COMPANY_AND_BRANCH },

  // Charge & Charge Settings: a standalone pricing/commission configuration module,
  // independent of Rate Master and not yet consumed by Shipment Booking. COMPANY_ADMIN
  // only, the same "own back-office setup" tier Masters/Branches/Settings/Pricing use —
  // unlike Rate Master, no branch role reads it today.
  { id: 'charges', title: 'Charges', icon: 'toll', route: '/charges', permission: 'CHARGE_READ', roles: COMPANY_ONLY, order: 2.9 },

  {
    id: 'masters', title: 'Masters', icon: 'inventory_2', order: 3,
    children: [
      // The six geography lists: one catalogue shared by every company. SUPER_ADMIN and
      // COMPANY_ADMIN both read (a company looks up its own pincodes); only SUPER_ADMIN
      // writes — MasterList/MasterView enforce that per-list split themselves
      // (`readAccessFor`/`writeAccessFor` keyed on MasterDefinition.global), since this
      // nav bridge and the shared `masters/:master` route can't tell geography from a
      // company's own catalogue on their own.
      // For now only Pincode is shown to COMPANY_ADMIN; the other five geography lists stay
      // SUPER_ADMIN-only in the menu (their routes/screens are unchanged).
      { id: 'global-countries', title: 'Country', icon: 'public', route: '/masters/countries', roles: PLATFORM },
      { id: 'global-states', title: 'State', icon: 'flag', route: '/masters/states', roles: PLATFORM },
      { id: 'global-districts', title: 'District', icon: 'map', route: '/masters/districts', roles: PLATFORM },
      { id: 'global-cities', title: 'City', icon: 'location_city', route: '/masters/cities', roles: PLATFORM },
      { id: 'global-areas', title: 'Area', icon: 'pin_drop', route: '/masters/areas', roles: PLATFORM },
      { id: 'global-pincodes', title: 'Pincode', icon: 'markunread_mailbox', route: '/masters/pincodes', roles: GLOBAL_MASTER_READERS },
      // Which branch serves which pincode — company-owned (a branch is the company's own),
      // unlike the shared geography list above it. COMPANY_ADMIN only, same tier as the
      // company's own six catalogues below.
      { id: 'branch-pincode-mapping', title: 'Pincode Branch Mapping', icon: 'pin_drop', route: '/masters/pincode-branch-mapping', roles: COMPANY_ONLY },
      { id: 'branch-hub-assignment', title: 'Assign Hub to Branch', icon: 'hub', route: '/masters/branch-hub-assignment', roles: COMPANY_ONLY },
      // The company's own six catalogues — COMPANY_ADMIN only, both read and write.
      { id: 'vehicle-types', title: 'Vehicle Type', icon: 'local_shipping', route: '/masters/vehicle-types', permission: 'MASTER_DATA_READ', roles: COMPANY_ONLY },
      // The fleet itself (registration, class, ownership dates, statutory document
      // expiries) — a separate, bespoke module (com.courier.modules.manifest.Vehicle),
      // not one of the twelve generic master-data catalogues above; COMPANY_ADMIN and
      // BRANCH_MANAGER both write, matching VehicleServiceImpl's own gate (no
      // permission code exists for it yet, same as Freight Factor/Address Distance).
      { id: 'vehicles', title: 'Vehicles', icon: 'local_shipping', route: '/masters/vehicles', roles: COMPANY_AND_BRANCH },
      { id: 'package-types', title: 'Package Type', icon: 'inventory_2', route: '/masters/package-types', permission: 'MASTER_DATA_READ', roles: COMPANY_ONLY },
      { id: 'service-types', title: 'Service Type', icon: 'bolt', route: '/masters/service-types', permission: 'MASTER_DATA_READ', roles: COMPANY_ONLY },
      { id: 'payment-modes', title: 'Payment Mode', icon: 'payments', route: '/masters/payment-modes', permission: 'MASTER_DATA_READ', roles: COMPANY_ONLY },
      { id: 'weight-slabs', title: 'Weight Slab', icon: 'scale', route: '/masters/weight-slabs', permission: 'MASTER_DATA_READ', roles: COMPANY_ONLY },
      { id: 'routes', title: 'Route', icon: 'route', route: '/masters/routes', permission: 'ROUTE_MASTER_READ', roles: COMPANY_ONLY }
    ]
  },

  {
    id: 'pricing', title: 'Pricing (Soon)', icon: 'sell', order: 4,
    children: [
      // No `permission` key: aspirational, unbuilt feature — no RATE module exists in
      // the catalogue (Rate Master's own rights are RATE_MASTER_*, a different module).
      { id: 'rate-cards', title: 'Rate Cards (Soon)', icon: 'payments', route: '/pricing/rate-cards', roles: COMPANY_ONLY },
      { id: 'zone-pricing', title: 'Zone Pricing (Soon)', icon: 'grid_on', route: '/pricing/zones', roles: COMPANY_ONLY },
      { id: 'surcharges', title: 'Surcharges (Soon)', icon: 'local_gas_station', route: '/pricing/surcharges', roles: COMPANY_ONLY }
    ]
  },

  {
    id: 'operations', title: 'Operations', icon: 'local_shipping', order: 5,
    children: [
      // Booking is the counter desk's job (SHIPMENT_CREATE); manifest through delivery is
      // the road (MANIFEST_DISPATCH, MANIFEST_RECEIVE, DELIVERY_DISPATCH, DELIVERY_DELIVER)
      // — see DefaultRoleCatalog's BOOKING_OPERATOR / DELIVERY_OPERATOR definitions.
      // Shipment Movement (V19) shipped these five: Loading Sheet/Trip Hire Challan (THC) happen at the
      // booking branch (OPS_BOOKING), In Scan/Out For Delivery/Deliver at the delivery
      // branch (OPS_DELIVERY_DESK) — see MEMORY/modules/shipment-movement.md.
      // 'sorting' has no module behind it yet and stays aspirational.
      { id: 'booking', title: 'Shipment Booking', icon: 'add_box', route: '/shipments/new', permission: 'SHIPMENT_CREATE', roles: OPS_BOOKING },
      // Same booking screen, customer picked first — see ShipmentCreate.isBusinessBooking.
      { id: 'business-booking', title: 'Business Customer Booking', icon: 'business_center', route: '/business-customer/booking', permission: 'SHIPMENT_CREATE', roles: OPS_BOOKING },
      { id: 'shipment-search', title: 'Shipment Search', icon: 'search', route: '/shipments', permission: 'SHIPMENT_READ', roles: OPS_SHIPMENT_READERS },
      { id: 'track', title: 'Track Shipment', icon: 'my_location', route: '/track', permission: 'SHIPMENT_READ', roles: OPS_SHIPMENT_READERS },
      { id: 'manifest', title: 'Loading Sheet', icon: 'qr_code_scanner', route: '/movement/loading-sheet', permission: 'TRACKING_CREATE', roles: OPS_BOOKING },
      { id: 'dispatch', title: 'Trip Hire Challan (THC)', icon: 'outbound', route: '/movement/trip-hire-challan', permission: 'MANIFEST_DISPATCH', roles: OPS_BOOKING },
      { id: 'receive', title: 'In Scan', icon: 'move_to_inbox', route: '/movement/in-scan', permission: 'MANIFEST_RECEIVE', roles: OPS_DELIVERY_DESK },
      { id: 'pending-delivery', title: 'Pending Delivery', icon: 'pending_actions', route: '/movement/pending-delivery', permission: 'DELIVERY_ASSIGN', roles: OPS_DELIVERY_DESK },
      { id: 'out-for-delivery', title: 'Generate DRS', icon: 'directions_run', route: '/movement/out-for-delivery', permission: 'DELIVERY_ASSIGN', roles: OPS_DELIVERY_DESK },
      { id: 'delivery', title: 'Delivery', icon: 'task_alt', route: '/movement/delivery', permission: 'DELIVERY_DELIVER', roles: OPS_DELIVERY_DESK },
      // POD Auto Verification's Manual Review screen — reviewer tier only, narrower than
      // OPS_DELIVERY_DESK (which also admits the delivery operator who captures a POD but
      // must not decide their own submission). See MEMORY/modules/pod-verification.md.
      // No `permission` key on either POD leaf below: no POD module exists in the
      // catalogue (POD Review/Upload predate Menu + Permission Management and were never
      // added to it).
      { id: 'pod-review', title: 'POD Review', icon: 'fact_check', route: '/movement/pod-review', roles: COMPANY_AND_BRANCH },
      // Company-level upload, no branch login required — always auto-approved. Narrower
      // than pod-review's own COMPANY_AND_BRANCH: mirrors uploadByCompany's
      // hasRole('COMPANY_ADMIN') gate exactly.
      { id: 'pod-company-upload', title: 'Upload POD (Company)', icon: 'cloud_upload', route: '/movement/pod-company-upload', roles: COMPANY_ONLY },
      // Bulk POD Upload — auto-detect/match/score many PODs at once. Same COMPANY_ONLY
      // tier as pod-company-upload: mirrors bulkUpload's hasRole('COMPANY_ADMIN') gate.
      { id: 'pod-bulk-upload', title: 'Bulk POD Upload', icon: 'upload_file', route: '/movement/pod-bulk-upload', roles: COMPANY_ONLY }
    ]
  },

  // Hub Operations (2026-09-21) — receive/sort/load-sheet/out-scan/dispatch/exceptions
  // at a hub. In Scan, Load Sheet and Dispatch reuse the Shipment Movement screens above
  // wholesale, routed again under their own path; Dashboard, Shipments At Hub, Out Scan
  // and Exceptions are the genuinely new screens. See MEMORY/modules/hub-operations.md.
  // MSRTC: the same shipment/manifest tables as Operations, flagged flowType MSRTC. Books
  // straight to a delivery branch (picked directly, or resolved from the pincode) and only
  // ever moves branch to branch. Reuses Operations' permission codes, so no new grants.
  {
    id: 'msrtc', title: 'MSRTC', icon: 'directions_bus', order: 5.2, roles: [...OPS_BOOKING, AppRole.DELIVERY_OPERATOR],
    children: [
      { id: 'msrtc-divisions', title: 'Divisions', icon: 'account_tree', route: '/msrtc/divisions', roles: COMPANY_ONLY },
      { id: 'msrtc-bus-depots', title: 'Bus Depot / Station', icon: 'warehouse', route: '/msrtc/bus-depots', roles: COMPANY_ONLY },
      { id: 'msrtc-crossings', title: 'Crossings', icon: 'alt_route', route: '/msrtc/crossings', roles: COMPANY_ONLY },
      { id: 'msrtc-booking', title: 'MSRTC Shipment Booking', icon: 'add_box', route: '/msrtc/shipments/new', permission: 'SHIPMENT_CREATE', roles: OPS_BOOKING },
      { id: 'msrtc-create-manifest', title: 'Create Manifest', icon: 'qr_code_scanner', route: '/msrtc/create-manifest', permission: 'MANIFEST_CREATE', roles: OPS_BOOKING },
      { id: 'msrtc-finalize-manifest', title: 'Finalize Manifest', icon: 'outbound', route: '/msrtc/finalize-manifest', permission: 'MANIFEST_DISPATCH', roles: OPS_BOOKING },
      // Branch B receives what branch A dispatched; in-scanned shipments then show up in
      // Pending Delivery / Generate DRS / Delivery like any other.
      { id: 'msrtc-in-scan', title: 'In Scan Manifest', icon: 'move_to_inbox', route: '/msrtc/in-scan', permission: 'MANIFEST_RECEIVE', roles: OPS_DELIVERY_DESK }
    ]
  },

  {
    id: 'hub-operations', title: 'Hub Operations', icon: 'hub', order: 5.5, roles: HUB_OPS,
    children: [
      { id: 'hub-dashboard', title: 'Dashboard', icon: 'dashboard', route: '/hub-operations/dashboard', permission: 'HUB_READ', roles: HUB_OPS },
      { id: 'hub-in-scan', title: 'In Scan', icon: 'move_to_inbox', route: '/hub-operations/in-scan', permission: 'HUB_IN_SCAN', roles: HUB_OPS },
      { id: 'hub-shipments', title: 'Shipments At Hub', icon: 'inventory_2', route: '/hub-operations/shipments', permission: 'HUB_READ', roles: HUB_OPS },
      { id: 'hub-sorting', title: 'Sorting', icon: 'sort', route: '/hub-operations/sorting', permission: 'HUB_SORT', roles: HUB_OPS },
      { id: 'hub-load-sheet', title: 'Load Sheets', icon: 'qr_code_scanner', route: '/hub-operations/load-sheet', permission: 'MANIFEST_CREATE', roles: HUB_OPS },
      { id: 'hub-out-scan', title: 'Out Scan', icon: 'outbox', route: '/hub-operations/out-scan', permission: 'HUB_OUT_SCAN', roles: HUB_OPS },
      { id: 'hub-dispatch', title: 'Dispatch', icon: 'outbound', route: '/hub-operations/dispatch', permission: 'HUB_DISPATCH', roles: HUB_OPS },
      { id: 'hub-exceptions', title: 'Exceptions', icon: 'report_problem', route: '/hub-operations/exceptions', permission: 'HUB_EXCEPTION_MANAGE', roles: HUB_OPS },
      { id: 'hub-reports', title: 'Reports', icon: 'summarize', route: '/hub-operations/reports', permission: 'REPORT_READ', roles: HUB_OPS }
    ]
  },

  {
    id: 'finance', title: 'Finance', icon: 'account_balance', order: 6,
    children: [
      // Recharging its own wallet is a branch responsibility; ACCOUNTS is the branch's
      // money desk and holds WALLET_RECHARGE alongside BRANCH_MANAGER.
      { id: 'branch-wallet', title: 'Branch Wallet', icon: 'account_balance_wallet', route: '/finance/branch-wallet', permission: 'WALLET_READ', roles: ACCOUNTS_DESK },
      { id: 'hub-wallet', title: 'Hub Wallet (Soon)', icon: 'savings', route: '/finance/hub-wallet', permission: 'WALLET_READ', roles: FINANCE },
      { id: 'wallet-transactions', title: 'Wallet Transactions', icon: 'receipt', route: '/finance/branch-wallet/transactions', permission: 'WALLET_READ', roles: ACCOUNTS_DESK },
      { id: 'topup-requests', title: 'Top-up Requests', icon: 'fact_check', route: '/finance/branch-wallet/topup-requests', permission: 'WALLET_READ', roles: ACCOUNTS_DESK },
      // Company admin / finance see every branch; a branch manager sees only their own branch's
      // recharges (WalletServiceImpl.searchRechargeAttempts scopes the rows server-side).
      { id: 'wallet-recharge-report', title: 'Recharge Report', icon: 'account_balance_wallet', route: '/finance/branch-wallet/recharge-report', permission: 'WALLET_READ', roles: [...FINANCE, AppRole.BRANCH_MANAGER] },
      // No `permission` key: aspirational, unbuilt feature — no SETTLEMENT module
      // exists in the catalogue.
      { id: 'settlement', title: 'Settlement (Soon)', icon: 'paid', route: '/finance/settlement', roles: FINANCE },
      { id: 'payment', title: 'Payment (Soon)', icon: 'credit_card', route: '/finance/payment', permission: 'PAYMENT_READ', roles: [...FINANCE, AppRole.ACCOUNTS] },
      { id: 'invoice', title: 'Invoice (Soon)', icon: 'description', route: '/finance/invoice', permission: 'INVOICE_READ', roles: [...FINANCE, AppRole.ACCOUNTS] }
    ]
  },

  {
    id: 'follow-up', title: 'Follow-ups', icon: 'event_repeat', order: 6.4,
    children: [
      { id: 'follow-up-list', title: 'Follow-ups', icon: 'checklist', route: '/follow-ups', roles: FOLLOW_UP_READERS },
      { id: 'follow-up-new', title: 'Create Follow-up', icon: 'add_box', route: '/follow-ups/new', roles: FOLLOW_UP_READERS }
    ]
  },

  {
    id: 'support', title: 'Ticket Support', icon: 'support_agent', order: 6.5,
    children: [
      { id: 'support-tickets', title: 'Tickets', icon: 'confirmation_number', route: '/support/tickets', roles: SUPPORT_READERS },
      { id: 'support-new-ticket', title: 'Raise Ticket', icon: 'add_box', route: '/support/tickets/new', roles: SUPPORT_READERS },
      // Company-wide view, not branch-scoped — COMPANY_ADMIN and SUPER_ADMIN only.
      { id: 'support-dashboard', title: 'Support Dashboard', icon: 'dashboard', route: '/support/dashboard', roles: ADMINS },
      // Global category catalogue — SUPER_ADMIN only, same tier as Subscription Plans.
      { id: 'support-categories', title: 'Categories', icon: 'category', route: '/support/categories', roles: PLATFORM },
      // Per-priority first-response/resolution targets — company-scoped, COMPANY_ADMIN's own call.
      { id: 'support-sla-rules', title: 'SLA Rules', icon: 'schedule', route: '/support/sla-rules', roles: ADMINS }
    ]
  },

  {
    id: 'communication', title: 'Communication Center', icon: 'forum', order: 6.6,
    children: [
      { id: 'communication-dashboard', title: 'Dashboard', icon: 'dashboard', route: '/communication/dashboard', roles: COMMUNICATION_READERS },
      { id: 'communication-settings', title: 'Channel Settings', icon: 'tune', route: '/communication/settings', roles: COMMUNICATION_ADMIN },
      { id: 'communication-templates', title: 'Templates', icon: 'description', route: '/communication/templates', roles: COMMUNICATION_ADMIN },
      { id: 'communication-logs', title: 'Logs', icon: 'history', route: '/communication/logs', roles: COMMUNICATION_READERS }
    ]
  },

  {
    id: 'reports', title: 'Reports', icon: 'insights', order: 7,
    children: [
      { id: 'booking-report', title: 'Booking Report', icon: 'summarize', route: '/reports/bookings', permission: 'REPORT_READ', roles: SHIPMENT_READERS },
      { id: 'delivery-report', title: 'Delivery Report', icon: 'local_shipping', route: '/reports/deliveries', permission: 'REPORT_READ', roles: SHIPMENT_READERS },
      { id: 'commission-report', title: 'Commission Report', icon: 'payments', route: '/reports/commissions', permission: 'REPORT_READ', roles: SHIPMENT_READERS },
      { id: 'drs-report', title: 'DRS Report', icon: 'directions_run', route: '/reports/drs', permission: 'REPORT_READ', roles: SHIPMENT_READERS },
      { id: 'thc-report', title: 'Trip Hire Challan Report', icon: 'outbound', route: '/reports/thc', permission: 'REPORT_READ', roles: SHIPMENT_READERS },
      { id: 'branch-reports', title: 'Branch Reports', icon: 'bar_chart', route: '/reports/branches', permission: 'REPORT_READ', roles: BRANCH_REPORT_READERS },
      // Branch responsibility #11 — every branch staff role reads reports on the work it did.
      { id: 'finance-reports', title: 'Finance Reports', icon: 'analytics', route: '/reports/finance', permission: 'REPORT_READ', roles: [...FINANCE, AppRole.ACCOUNTS] },
      // Company-level audit — every branch side by side, so gated same as Finance Reports, not per-branch reports.
      { id: 'vendor-audit-report', title: 'Vendor Audit Report', icon: 'fact_check', route: '/reports/vendor-audit', permission: 'REPORT_READ', roles: [...FINANCE, AppRole.ACCOUNTS] },
      { id: 'customer-report', title: 'Customer Report', icon: 'groups', route: '/reports/customers', permission: 'REPORT_READ', roles: COMPANY_ROLES.filter((r) => r !== AppRole.BRANCH_MANAGER) },
      { id: 'exception-report', title: 'Shipment Exceptions', icon: 'report_problem', route: '/reports/exceptions', permission: 'REPORT_READ', roles: SHIPMENT_READERS },
      { id: 'cancelled-orders-report', title: 'Cancelled Orders', icon: 'cancel', route: '/reports/cancelled-orders', permission: 'REPORT_READ', roles: SHIPMENT_READERS },
      { id: 'bulk-tracking-report', title: 'Bulk Shipment Tracking', icon: 'checklist', route: '/reports/bulk-tracking', permission: 'REPORT_READ', roles: SHIPMENT_READERS }
    ]
  },

  { id: 'settings', title: 'Settings', icon: 'settings', route: '/settings', permission: 'SETTINGS_READ', roles: COMPANY_ONLY, order: 8 }
];
