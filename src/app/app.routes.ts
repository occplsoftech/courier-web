import { Routes } from '@angular/router';
import { authGuard } from '@core/guards/auth.guard';
import { guestGuard } from '@core/guards/guest.guard';
import { roleGuard } from '@core/guards/role.guard';
import { hubLandingGuard } from '@core/guards/hub-landing.guard';
import { AppRole } from '@core/models/role.model';

const ADMINS = [AppRole.SUPER_ADMIN, AppRole.COMPANY_ADMIN];
const UPDATERS = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER];
// Finance is company-side work — SUPER_ADMIN excluded, branch/finance roles unchanged.
const WALLET_VIEWERS = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER, AppRole.FINANCE_USER];
const FINANCE_REPORT_READERS = [AppRole.COMPANY_ADMIN, AppRole.FINANCE_USER, AppRole.ACCOUNTS];
// Customer create/update: COMPANY_ADMIN, BRANCH_MANAGER or the counter desk — mirrors the
// backend CustomerService @PreAuthorize. Lifecycle (activate/deactivate) is narrower, same
// as branch lifecycle.
const CUSTOMER_WRITERS = [...UPDATERS, AppRole.BOOKING_OPERATOR, AppRole.CUSTOMER_SERVICE];
// Customer reads: every non-platform role — SUPER_ADMIN excluded, everyone else who signs
// into a company keeps exactly the access they had.
const CUSTOMER_READERS = [
  AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER, AppRole.HUB_MANAGER, AppRole.BOOKING_OPERATOR,
  AppRole.DELIVERY_OPERATOR, AppRole.ACCOUNTS, AppRole.FINANCE_USER, AppRole.CUSTOMER_SERVICE, AppRole.VIEWER
];
const WALLET_RECHARGERS = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER, AppRole.FINANCE_USER];
// Mirrors WalletServiceImpl.FINANCE_READERS on searchRecharges/companySummary — narrower
// than WALLET_VIEWERS, since this report spans every branch, not just the caller's own.
// Branch manager reads it too — the backend narrows their rows to their own branch.
const WALLET_RECHARGE_REPORT_READERS = [AppRole.COMPANY_ADMIN, AppRole.FINANCE_USER, AppRole.BRANCH_MANAGER];
// Shipment Booking: the counter desk's own job. Mirrors ShipmentServiceImpl's WRITERS
// gate (COMPANY_ADMIN, BRANCH_MANAGER, OPERATOR); BOOKING_OPERATOR is the company-role
// side of that same JWT-role gap the "authorise on permissions" capstone still owns.
const SHIPMENT_WRITERS = [...UPDATERS, AppRole.BOOKING_OPERATOR];
// Shipment reads: same tier as SHIPMENT_WRITERS plus the road (delivery desk reads what
// it's asked to move) and accounts — SUPER_ADMIN excluded, day-to-day operations are a
// company's own work, not the platform's.
const SHIPMENT_READERS = [...SHIPMENT_WRITERS, AppRole.DELIVERY_OPERATOR, AppRole.ACCOUNTS];
// Shipment Movement: the same desks as Shipment Booking, plus the delivery desk —
// Loading Sheet/Trip Hire Challan (THC) are typically the booking branch, In Scan/Out
// For Delivery/Deliver the
// delivery branch. Mirrors ShipmentServiceImpl's movement WRITERS (COMPANY_ADMIN,
// BRANCH_MANAGER, OPERATOR) the same way SHIPMENT_WRITERS does for booking.
// Hub Operations (2026-09-21): a hub-staffed user's own branch_id IS the hub — every
// screen below already defaults to "my own branch", so HUB_MANAGER only needed adding
// to the role gate, not a new component. Was missing before this change even though the
// backend role already held the underlying permissions (TRACKING_CREATE/READ etc).
const MOVEMENT_WRITERS = [...UPDATERS, AppRole.HUB_MANAGER, AppRole.BOOKING_OPERATOR, AppRole.DELIVERY_OPERATOR];
// Hub Operations' own screens (dashboard, shipments-at-hub, out-scan, exceptions) —
// COMPANY_ADMIN for oversight, HUB_MANAGER for the hub's own desk.
const HUB_WRITERS = [AppRole.COMPANY_ADMIN, AppRole.HUB_MANAGER];
// Hubs list — a filtered Branch list; BRANCH_MANAGER included too since a crossing hub
// is visible to any manager coordinating a lane through it, the same reach Branches'
// own nav entry intentionally does NOT have (COMPANY_ADMIN-only) but hubs benefits from.
const HUB_READERS = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER, AppRole.HUB_MANAGER];
// Rate Master: company and branch price their own shipments; a platform operator prices
// nothing.
const RATE_READERS = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER];
// Company Settings / Branches: the back office's own setup work — no platform operator,
// no branch role.
const COMPANY_ONLY = [AppRole.COMPANY_ADMIN];
// Masters route guard: the geography lists (SUPER_ADMIN + COMPANY_ADMIN) and a company's
// own six catalogues (COMPANY_ADMIN only) share this one `masters/:master` route, so the
// guard admits the union — MasterList/MasterView narrow per-list from MasterDefinition's
// own `global` flag via `readAccessFor`, the same source `writeAccessFor` already reads.
const MASTERS_READERS = ADMINS;
// User Management: a branch manager staffs their own branch (create/update/activate/
// deactivate/assign-role/remove-role, scoped server-side to their branch and to
// branch-assignable roles) — mirrors UserServiceImpl's own admission, not just COMPANY_ADMIN.
// Delete stays COMPANY_ADMIN-only; UserServiceImpl never grants it to BRANCH_MANAGER.
const USER_READERS = [...ADMINS, AppRole.BRANCH_MANAGER];
const USER_WRITERS = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER];
// Ticket Support (Phase 1): every company role raises/reads tickets, plus SUPER_ADMIN's
// own cross-tenant view. Categories are the global catalogue — SUPER_ADMIN only, mirrors
// TicketCategoryServiceImpl's own gate.
const SUPPORT_READERS = [
  AppRole.SUPER_ADMIN, AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER, AppRole.HUB_MANAGER,
  AppRole.BOOKING_OPERATOR, AppRole.DELIVERY_OPERATOR, AppRole.ACCOUNTS, AppRole.FINANCE_USER,
  AppRole.CUSTOMER_SERVICE, AppRole.VIEWER
];
const SUPPORT_ADMIN = [AppRole.SUPER_ADMIN];
// Follow-up Management: branch operational tasks — every company role (no SUPER_ADMIN,
// unlike Ticket Support: a follow-up has no cross-tenant view at all).
const FOLLOW_UP_READERS = [
  AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER, AppRole.HUB_MANAGER, AppRole.BOOKING_OPERATOR,
  AppRole.DELIVERY_OPERATOR, AppRole.ACCOUNTS, AppRole.FINANCE_USER, AppRole.CUSTOMER_SERVICE, AppRole.VIEWER
];
// Communication Center: dashboard/logs readable by whoever runs a branch; Channel
// Settings/Templates are COMPANY_ADMIN's own call — mirrors the backend's own
// @PreAuthorize split (no SUPER_ADMIN either way, this is company-owned config).
const COMMUNICATION_READERS = [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER];
const COMMUNICATION_ADMIN = [AppRole.COMPANY_ADMIN];

/**
 * Lazy, guarded routes. The admin shell wraps every authenticated feature; each feature
 * is code-split. `data.roles` drives permission-based routing via roleGuard.
 */
export const routes: Routes = [
  // Public (no-login) info/policy pages linked from the login screen — reachable without
  // authentication so business/policy info can be reviewed without an account (Razorpay
  // business verification and general visitors alike). One shared PublicPage component,
  // content keyed by pageKey — see features/public/public-page.content.ts.
  ...(['home', 'services', 'pricing', 'about', 'contact', 'terms', 'privacy',
       'refund-policy', 'shipping-policy', 'payment-policy'] as const).map((pageKey) => ({
    path: pageKey,
    title: `Amazing Logistics — ${pageKey}`,
    data: { pageKey },
    loadComponent: () => import('@features/public/public-page').then((m) => m.PublicPage)
  })),
  {
    path: 'track-shipment',
    title: 'Track Shipment — Amazing Logistics',
    loadComponent: () => import('@features/public/track-shipment').then((m) => m.TrackShipment)
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('@layouts/auth-layout/auth-layout').then((m) => m.AuthLayout),
    children: [
      { path: '', loadComponent: () => import('@features/auth/login').then((m) => m.Login) }
    ]
  },
  {
    // "Sign in with OCCPL": opened from the platform, and where the platform sends people back to.
    path: 'sso',
    canActivate: [guestGuard],
    loadComponent: () => import('@layouts/auth-layout/auth-layout').then((m) => m.AuthLayout),
    children: [
      { path: '', loadComponent: () => import('@features/auth/platform-sign-in').then((m) => m.PlatformSignIn) },
      // The platform's launch path allows no query string, so it opens `/sso/<company id>`; the sign-in then returns to `/sso`.
      { path: ':company', loadComponent: () => import('@features/auth/platform-sign-in').then((m) => m.PlatformSignIn) }
    ]
  },
  {
    path: 'forgot-password',
    canActivate: [guestGuard],
    loadComponent: () => import('@layouts/auth-layout/auth-layout').then((m) => m.AuthLayout),
    children: [
      { path: '', loadComponent: () => import('@features/auth/forgot-password').then((m) => m.ForgotPassword) }
    ]
  },
  {
    path: 'reset-password',
    canActivate: [guestGuard],
    loadComponent: () => import('@layouts/auth-layout/auth-layout').then((m) => m.AuthLayout),
    children: [
      { path: '', loadComponent: () => import('@features/auth/reset-password').then((m) => m.ResetPassword) }
    ]
  },
  {
    path: 'unauthorized',
    loadComponent: () => import('@layouts/auth-layout/auth-layout').then((m) => m.AuthLayout),
    children: [
      { path: '', loadComponent: () => import('@features/auth/unauthorized').then((m) => m.Unauthorized) }
    ]
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('@layouts/admin-layout/admin-layout').then((m) => m.AdminLayout),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard', title: 'Dashboard', canActivate: [hubLandingGuard],
        loadComponent: () => import('@features/dashboard/dashboard').then((m) => m.Dashboard)
      },
      // The platform console. Everything here is SUPER_ADMIN's; nothing here is a
      // company's own operational work.
      {
        path: 'platform/dashboard', title: 'Platform Dashboard', canActivate: [roleGuard],
        data: { roles: [AppRole.SUPER_ADMIN] },
        loadComponent: () => import('@features/platform/platform-dashboard').then((m) => m.PlatformDashboardPage)
      },
      {
        path: 'platform/users', title: 'Platform Operators', canActivate: [roleGuard],
        data: { roles: [AppRole.SUPER_ADMIN] },
        loadComponent: () => import('@features/platform/super-admin-list').then((m) => m.SuperAdminListPage)
      },
      {
        path: 'companies', title: 'Companies', canActivate: [roleGuard],
        data: { roles: [AppRole.SUPER_ADMIN] },
        loadComponent: () => import('@features/company/company-list').then((m) => m.CompanyList)
      },
      {
        // Before ':id', or the literal is swallowed by the parameter — the same ordering
        // the permissions and masters routes needed.
        path: 'companies/new', title: 'New Company', canActivate: [roleGuard],
        data: { roles: [AppRole.SUPER_ADMIN] },
        loadComponent: () => import('@features/company/company-create').then((m) => m.CompanyCreatePage)
      },
      {
        path: 'companies/:id', title: 'Company Profile', canActivate: [roleGuard],
        data: { roles: [AppRole.SUPER_ADMIN] },
        loadComponent: () => import('@features/company/company-profile').then((m) => m.CompanyProfilePage)
      },
      {
        path: 'companies/:id/edit', title: 'Edit Company', canActivate: [roleGuard],
        data: { roles: [AppRole.SUPER_ADMIN] },
        loadComponent: () => import('@features/company/company-profile-edit').then((m) => m.CompanyProfileEditPage)
      },
      {
        path: 'subscription-plans', title: 'Subscription Plans', canActivate: [roleGuard],
        data: { roles: [AppRole.SUPER_ADMIN] },
        loadComponent: () => import('@features/subscription-plans/plan-list').then((m) => m.PlanList)
      },
      {
        // Before ':id', or the literal is swallowed by the parameter.
        path: 'subscription-plans/new', title: 'New Plan', canActivate: [roleGuard],
        data: { roles: [AppRole.SUPER_ADMIN] },
        loadComponent: () => import('@features/subscription-plans/plan-create').then((m) => m.PlanCreate)
      },
      {
        path: 'subscription-plans/:id', title: 'Subscription Plan', canActivate: [roleGuard],
        data: { roles: [AppRole.SUPER_ADMIN] },
        loadComponent: () => import('@features/subscription-plans/plan-view').then((m) => m.PlanView)
      },
      {
        path: 'subscription-plans/:id/edit', title: 'Edit Plan', canActivate: [roleGuard],
        data: { roles: [AppRole.SUPER_ADMIN] },
        loadComponent: () => import('@features/subscription-plans/plan-edit').then((m) => m.PlanEdit)
      },
      {
        path: 'branches', title: 'Branches', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/branch/branch-list').then((m) => m.BranchList)
      },
      {
        path: 'branches/new', title: 'New Branch', canActivate: [roleGuard], data: { roles: [AppRole.COMPANY_ADMIN] },
        loadComponent: () => import('@features/branch/branch-create').then((m) => m.BranchCreate)
      },
      {
        path: 'branches/:id', title: 'Branch', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/branch/branch-view').then((m) => m.BranchView)
      },
      {
        path: 'branches/:id/edit', title: 'Edit Branch', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/branch/branch-edit').then((m) => m.BranchEdit)
      },
      // Declared before 'masters/:master' (below) so the literal segment is not swallowed
      // by that generic route's parameter.
      {
        path: 'masters/pincode-branch-mapping', title: 'Pincode Branch Mapping',
        canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () =>
          import('@features/branch/branch-pincode-mapping').then((m) => m.BranchPincodeMapping)
      },
      {
        path: 'masters/branch-hub-assignment', title: 'Assign Hub to Branch',
        canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () =>
          import('@features/branch/branch-hub-assignment').then((m) => m.BranchHubAssignment)
      },
      // Customers — reusable master data, independent of Shipment Order. Any
      // authenticated company user reads (no roles restriction admits everyone signed
      // in, same as the backend's isAuthenticated() read policy); 'new'/'edit' are
      // declared before ':id' so the literal segment is not swallowed by the parameter.
      {
        path: 'customers', title: 'Customers', canActivate: [roleGuard], data: { roles: CUSTOMER_READERS },
        loadComponent: () => import('@features/customer/customer-list').then((m) => m.CustomerList)
      },
      {
        path: 'customers/new', title: 'New Customer', canActivate: [roleGuard], data: { roles: CUSTOMER_WRITERS },
        loadComponent: () => import('@features/customer/customer-create').then((m) => m.CustomerCreate)
      },
      {
        path: 'customers/:id', title: 'Customer', canActivate: [roleGuard], data: { roles: CUSTOMER_READERS },
        loadComponent: () => import('@features/customer/customer-view').then((m) => m.CustomerView)
      },
      {
        path: 'customers/:id/edit', title: 'Edit Customer', canActivate: [roleGuard], data: { roles: CUSTOMER_WRITERS },
        loadComponent: () => import('@features/customer/customer-edit').then((m) => m.CustomerEdit)
      },
      // Business Customer — COMPANY_ADMIN-only back-office setup: the customer list (the
      // same CustomerList pinned to BUSINESS customers), each customer's pricing zones, and
      // the per-zone rate cards. Literal segments ('new') before the ':id' parameters.
      {
        path: 'business-customer/dashboard', title: 'Business Customer Dashboard', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/business-customer/business-dashboard').then((m) => m.BusinessDashboardPage)
      },
      {
        path: 'business-customer/billing', title: 'Business Customer Billing', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/business-billing/billing-list').then((m) => m.BillingList)
      },
      {
        path: 'business-customer/billing/:id', title: 'Customer Invoice', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/business-billing/billing-invoice').then((m) => m.BillingInvoice)
      },
      {
        path: 'business-customer/customers', title: 'Business Customers', canActivate: [roleGuard],
        data: { roles: COMPANY_ONLY, businessOnly: true },
        loadComponent: () => import('@features/customer/customer-list').then((m) => m.CustomerList)
      },
      // Zone Tariff: company zones, rate cards (slabs + charges) and the calculator. Writes are
      // COMPANY_ADMIN on the server; the calculator is a read any booking user may run.
      {
        path: 'zone-tariff/zones', title: 'Tariff Zones', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/zone-tariff/tariff-zone-list').then((m) => m.TariffZoneList)
      },
      {
        path: 'zone-tariff/zones/new', title: 'New Tariff Zone', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/zone-tariff/tariff-zone-form').then((m) => m.TariffZoneForm)
      },
      {
        path: 'zone-tariff/zones/:id', title: 'Tariff Zone', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/zone-tariff/tariff-zone-form').then((m) => m.TariffZoneForm)
      },
      {
        path: 'zone-tariff/rate-cards', title: 'Rate Cards', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/zone-tariff/rate-card-list').then((m) => m.RateCardList)
      },
      {
        path: 'zone-tariff/rate-cards/new', title: 'New Rate Card', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/zone-tariff/rate-card-form').then((m) => m.RateCardForm)
      },
      {
        path: 'zone-tariff/rate-cards/:id', title: 'Rate Card', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/zone-tariff/rate-card-form').then((m) => m.RateCardForm)
      },
      {
        path: 'zone-tariff/calculator', title: 'Tariff Calculator', canActivate: [roleGuard], data: { roles: RATE_READERS },
        loadComponent: () => import('@features/zone-tariff/tariff-quote').then((m) => m.TariffQuote)
      },
      {
        path: 'business-customer/pricing-zones', title: 'Pricing Zones', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/business-customer/pricing-zone-list').then((m) => m.PricingZoneList)
      },
      {
        path: 'business-customer/pricing-zones/new', title: 'New Pricing Zone', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/business-customer/pricing-zone-form').then((m) => m.PricingZoneForm)
      },
      {
        path: 'business-customer/pricing-zones/:id', title: 'Pricing Zone', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/business-customer/pricing-zone-form').then((m) => m.PricingZoneForm)
      },
      {
        path: 'pdp/partners', title: 'Pickup Delivery Partners', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/pdp/partner-list').then((m) => m.PartnerList)
      },
      {
        path: 'pdp/pickups', title: 'Pickup Requests', canActivate: [roleGuard], data: { roles: [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER] },
        loadComponent: () => import('@features/pdp/pickup-list').then((m) => m.PickupList)
      },
      {
        path: 'pdp/pickups/new', title: 'New Pickup Request', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/pdp/pickup-form').then((m) => m.PickupForm)
      },
      {
        path: 'pdp/pickups/:id', title: 'Edit Pickup Request', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/pdp/pickup-form').then((m) => m.PickupForm)
      },
      {
        path: 'pdp/deliveries', title: 'Partner Deliveries', canActivate: [roleGuard], data: { roles: [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER] },
        loadComponent: () => import('@features/pdp/partner-deliveries').then((m) => m.PartnerDeliveries)
      },
      {
        path: 'pdp/earnings', title: 'Partner Earnings', canActivate: [roleGuard], data: { roles: [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER] },
        loadComponent: () => import('@features/pdp/partner-earnings').then((m) => m.PartnerEarnings)
      },
      {
        path: 'pdp/billing', title: 'Partner Billing', canActivate: [roleGuard], data: { roles: [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER] },
        loadComponent: () => import('@features/pdp/partner-billing-list').then((m) => m.PartnerBillingList)
      },
      {
        path: 'pdp/billing/:id', title: 'Partner Statement', canActivate: [roleGuard], data: { roles: [AppRole.COMPANY_ADMIN, AppRole.BRANCH_MANAGER] },
        loadComponent: () => import('@features/pdp/partner-statement').then((m) => m.PartnerStatement)
      },
      {
        path: 'pdp/rates', title: 'Partner Rates', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/pdp/partner-rate-list').then((m) => m.PartnerRateList)
      },
      {
        path: 'pdp/my-rates', title: 'My Rates', canActivate: [roleGuard], data: { roles: [AppRole.BRANCH_MANAGER] },
        loadComponent: () => import('@features/pdp/partner-rate-edit').then((m) => m.PartnerRateEdit)
      },
      {
        path: 'pdp/rates/:branchId', title: 'Partner Rate Cards', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/pdp/partner-rate-edit').then((m) => m.PartnerRateEdit)
      },
      {
        path: 'business-customer/rates', title: 'Customer Rates', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/business-customer/customer-rate-list').then((m) => m.CustomerRateList)
      },
      {
        path: 'business-customer/rates/:zoneId', title: 'Customer Rate', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/business-customer/customer-rate-edit').then((m) => m.CustomerRateEdit)
      },
      // Rate Master — company rate cards. Reads (list/view/calculator) are
      // isAuthenticated() on the backend, so no roles restriction admits every signed-in
      // company user, same as Customers; create/update is COMPANY_ADMIN only, mirroring
      // RateServiceImpl's WRITE gate. 'new' and 'calculator' are declared before ':id' so
      // neither literal segment is swallowed by the parameter. The Calculator page now
      // hosts both the Rate and Freight Factor calculators as tabs (the rate list's own
      // quick-lookup dialog, RateCalculatorDialog, is a separate, untouched entry point).
      {
        path: 'rates', title: 'Rate Master', canActivate: [roleGuard], data: { roles: RATE_READERS },
        loadComponent: () => import('@features/rate-master/rate-list').then((m) => m.RateList)
      },
      {
        path: 'rates/new', title: 'New Rate', canActivate: [roleGuard], data: { roles: [AppRole.COMPANY_ADMIN] },
        loadComponent: () => import('@features/rate-master/rate-create').then((m) => m.RateCreate)
      },
      {
        path: 'rates/calculator', title: 'Calculator', canActivate: [roleGuard], data: { roles: RATE_READERS },
        loadComponent: () => import('@features/rate-master/rate-calculator').then((m) => m.RateCalculator)
      },
      {
        path: 'rates/:id', title: 'Rate', canActivate: [roleGuard], data: { roles: RATE_READERS },
        loadComponent: () => import('@features/rate-master/rate-view').then((m) => m.RateView)
      },
      {
        path: 'rates/:id/edit', title: 'Edit Rate', canActivate: [roleGuard], data: { roles: [AppRole.COMPANY_ADMIN] },
        loadComponent: () => import('@features/rate-master/rate-edit').then((m) => m.RateEdit)
      },
      // Charges — Charge & Charge Settings configuration, independent of Rate Master and
      // not yet wired into Shipment Booking. COMPANY_ADMIN-only throughout (reads and
      // writes), mirroring ChargeServiceImpl/ChargeSettingServiceImpl's single ADMIN gate
      // — unlike Rate Master, no other role needs to read a company's own pricing
      // configuration today. 'new' declared before ':id' so the literal is not swallowed.
      {
        path: 'charges', title: 'Charges', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/charges/charge-list').then((m) => m.ChargeList)
      },
      {
        path: 'charges/new', title: 'New Charge', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/charges/charge-create').then((m) => m.ChargeCreate)
      },
      {
        path: 'charges/:id', title: 'Charge', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/charges/charge-view').then((m) => m.ChargeView)
      },
      {
        path: 'charges/:id/edit', title: 'Edit Charge', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/charges/charge-edit').then((m) => m.ChargeEdit)
      },
      // Address Distance — resolve/list the road distance between two branches.
      // isAuthenticated() on the backend, same posture as Rate Master's reads/calculator.
      {
        path: 'distances', title: 'Address Distance', canActivate: [roleGuard], data: { roles: RATE_READERS },
        loadComponent: () => import('@features/address-distance/address-distance').then((m) => m.AddressDistance)
      },
      // Freight Factor — standalone distance x weight pricing grid, independent of Rate
      // Master. isAuthenticated() reads/calculate on the backend (RATE_READERS reused,
      // same audience); COMPANY_ADMIN-only writes are hidden in-page, not route-guarded,
      // since Add/Edit/Activate live on the same page as the read-only grid.
      {
        path: 'freight-factors', title: 'Freight Factor', canActivate: [roleGuard], data: { roles: RATE_READERS },
        loadComponent: () => import('@features/freight-factor/freight-factor').then((m) => m.FreightFactorPage)
      },
      // District Level Freight — rate setup by From Station + District + weight slab.
      // Rate setup only; reuses RATE_READERS (COMPANY_ADMIN/BRANCH_MANAGER, isAuthenticated()
      // on the backend) for reads, COMPANY_ADMIN-only for writes, mirroring Rate Master's
      // own split. 'new' declared before ':id' so it isn't swallowed by the parameter.
      {
        path: 'district-level-freight', title: 'District Level Freight', canActivate: [roleGuard], data: { roles: RATE_READERS },
        loadComponent: () => import('@features/district-level-freight/district-freight-list').then((m) => m.DistrictFreightList)
      },
      {
        path: 'district-level-freight/new', title: 'New District Level Freight Rate', canActivate: [roleGuard], data: { roles: [AppRole.COMPANY_ADMIN] },
        loadComponent: () => import('@features/district-level-freight/district-freight-create').then((m) => m.DistrictFreightCreate)
      },
      {
        path: 'district-level-freight/:id', title: 'District Level Freight Rate', canActivate: [roleGuard], data: { roles: RATE_READERS },
        loadComponent: () => import('@features/district-level-freight/district-freight-view').then((m) => m.DistrictFreightView)
      },
      {
        path: 'district-level-freight/:id/edit', title: 'Edit District Level Freight Rate', canActivate: [roleGuard], data: { roles: [AppRole.COMPANY_ADMIN] },
        loadComponent: () => import('@features/district-level-freight/district-freight-edit').then((m) => m.DistrictFreightEdit)
      },
      // Vehicles (fleet) — bespoke module, not one of the generic master-data lists;
      // COMPANY_ADMIN/BRANCH_MANAGER, matching VehicleServiceImpl's own gate. Routed
      // create/edit pages, not a dialog — seventeen fields read poorly in a modal
      // (direct user feedback, 0.25.2). 'new' declared before ':id/edit' so the
      // literal segment isn't swallowed by the parameter, same convention Shipment
      // Booking's own routes already use.
      {
        path: 'masters/vehicles', title: 'Vehicles', canActivate: [roleGuard], data: { roles: UPDATERS },
        loadComponent: () => import('@features/manifest/vehicle-list').then((m) => m.VehicleList)
      },
      {
        path: 'masters/vehicles/new', title: 'New Vehicle', canActivate: [roleGuard], data: { roles: UPDATERS },
        loadComponent: () => import('@features/manifest/vehicle-create').then((m) => m.VehicleCreate)
      },
      {
        path: 'masters/vehicles/:id/edit', title: 'Edit Vehicle', canActivate: [roleGuard], data: { roles: UPDATERS },
        loadComponent: () => import('@features/manifest/vehicle-edit').then((m) => m.VehicleEdit)
      },
      // Shipment Booking — the core transaction. Reads (list/view/charges/history/
      // documents) are isAuthenticated() on the backend, so no roles restriction admits
      // every signed-in company user, same as Customers/Rate Master; create/update/
      // cancel/document-upload mirror ShipmentServiceImpl's WRITERS gate. 'new' is
      // declared before ':id' so the literal segment is not swallowed by the parameter.
      {
        path: 'track', title: 'Track', canActivate: [roleGuard], data: { roles: SHIPMENT_READERS },
        loadComponent: () => import('@features/shipment-movement/track').then((m) => m.Track)
      },
      {
        path: 'shipments', title: 'Shipments', canActivate: [roleGuard], data: { roles: SHIPMENT_READERS },
        loadComponent: () => import('@features/shipment/shipment-list').then((m) => m.ShipmentList)
      },
      {
        path: 'reports/bookings', title: 'Booking Report', canActivate: [roleGuard], data: { roles: SHIPMENT_READERS },
        loadComponent: () => import('@features/reports/booking-report').then((m) => m.BookingReport)
      },
      {
        path: 'reports/deliveries', title: 'Delivery Report', canActivate: [roleGuard], data: { roles: SHIPMENT_READERS },
        loadComponent: () => import('@features/reports/delivery-report').then((m) => m.DeliveryReport)
      },
      {
        path: 'reports/commissions', title: 'Commission Report', canActivate: [roleGuard], data: { roles: SHIPMENT_READERS },
        loadComponent: () => import('@features/reports/commission-report').then((m) => m.CommissionReport)
      },
      {
        path: 'reports/commissions/:branchId', title: 'Branch Commission', canActivate: [roleGuard], data: { roles: SHIPMENT_READERS },
        loadComponent: () => import('@features/reports/commission-branch-detail').then((m) => m.CommissionBranchDetail)
      },
      {
        path: 'reports/drs', title: 'DRS Report', canActivate: [roleGuard], data: { roles: SHIPMENT_READERS },
        loadComponent: () => import('@features/reports/drs-report').then((m) => m.DrsReport)
      },
      {
        path: 'reports/drs/:deliveryUserId/:deliveryBranchId/:runDate', title: 'DRS Detail',
        canActivate: [roleGuard], data: { roles: SHIPMENT_READERS },
        loadComponent: () => import('@features/reports/drs-detail').then((m) => m.DrsDetailPage)
      },
      {
        path: 'reports/thc', title: 'Trip Hire Challan Report', canActivate: [roleGuard], data: { roles: SHIPMENT_READERS },
        loadComponent: () => import('@features/reports/thc-report').then((m) => m.ThcReport)
      },
      {
        path: 'reports/branches', title: 'Branch Performance Report', canActivate: [roleGuard], data: { roles: SHIPMENT_READERS },
        loadComponent: () => import('@features/reports/branch-report').then((m) => m.BranchReport)
      },
      {
        path: 'reports/finance', title: 'Finance Report', canActivate: [roleGuard], data: { roles: FINANCE_REPORT_READERS },
        loadComponent: () => import('@features/reports/finance-report').then((m) => m.FinanceReport)
      },
      {
        path: 'reports/vendor-audit', title: 'Vendor Audit Report', canActivate: [roleGuard], data: { roles: FINANCE_REPORT_READERS },
        loadComponent: () => import('@features/reports/vendor-audit-report').then((m) => m.VendorAuditReport)
      },
      {
        path: 'reports/customers', title: 'Customer Report', canActivate: [roleGuard], data: { roles: CUSTOMER_READERS },
        loadComponent: () => import('@features/reports/customer-report').then((m) => m.CustomerReport)
      },
      {
        path: 'reports/exceptions', title: 'Shipment Exception Report', canActivate: [roleGuard], data: { roles: SHIPMENT_READERS },
        loadComponent: () => import('@features/reports/shipment-exception-report').then((m) => m.ShipmentExceptionReport)
      },
      {
        path: 'reports/cancelled-orders', title: 'Cancelled Orders Report', canActivate: [roleGuard], data: { roles: SHIPMENT_READERS },
        loadComponent: () => import('@features/reports/cancelled-orders-report').then((m) => m.CancelledOrdersReport)
      },
      {
        path: 'reports/bulk-tracking', title: 'Bulk Shipment Tracking', canActivate: [roleGuard], data: { roles: SHIPMENT_READERS },
        loadComponent: () => import('@features/reports/bulk-tracking-report').then((m) => m.BulkTrackingReport)
      },
      {
        path: 'shipments/new', title: 'New Shipment', canActivate: [roleGuard], data: { roles: SHIPMENT_WRITERS },
        loadComponent: () => import('@features/shipment/shipment-create').then((m) => m.ShipmentCreate)
      },
      // Business Customer Booking: the same booking screen, but the customer is chosen first
      // (route data businessBooking) and fills the consignor + payment mode.
      {
        path: 'business-customer/booking', title: 'Business Customer Booking', canActivate: [roleGuard], data: { roles: SHIPMENT_WRITERS, businessBooking: true },
        loadComponent: () => import('@features/shipment/shipment-create').then((m) => m.ShipmentCreate)
      },
      // MSRTC (V104): same booking / Trip Hire Challan screens, flowType MSRTC via route data;
      // Create Manifest is its own branch-to-branch screen.
      {
        path: 'msrtc/shipments/new', title: 'MSRTC Shipment Booking', canActivate: [roleGuard], data: { roles: SHIPMENT_WRITERS, flowType: 'MSRTC' },
        loadComponent: () => import('@features/shipment/shipment-create').then((m) => m.ShipmentCreate)
      },
      {
        path: 'msrtc/divisions', title: 'Divisions', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/bus-depot/bus-division-list').then((m) => m.BusDivisionList)
      },
      {
        path: 'msrtc/divisions/new', title: 'New Division', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/bus-depot/bus-division-form').then((m) => m.BusDivisionForm)
      },
      {
        path: 'msrtc/divisions/:id', title: 'Division', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/bus-depot/bus-division-form').then((m) => m.BusDivisionForm)
      },
      {
        path: 'msrtc/bus-depots', title: 'Bus Depot / Station', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/bus-depot/bus-depot-list').then((m) => m.BusDepotList)
      },
      {
        path: 'msrtc/bus-depots/new', title: 'New Bus Depot / Station', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/bus-depot/bus-depot-form').then((m) => m.BusDepotForm)
      },
      {
        path: 'msrtc/bus-depots/:id', title: 'Bus Depot / Station', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/bus-depot/bus-depot-form').then((m) => m.BusDepotForm)
      },
      {
        path: 'msrtc/crossings', title: 'Crossings', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/bus-depot/bus-crossing-list').then((m) => m.BusCrossingList)
      },
      {
        path: 'msrtc/crossings/new', title: 'New Crossing', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/bus-depot/bus-crossing-form').then((m) => m.BusCrossingForm)
      },
      {
        path: 'msrtc/crossings/:id', title: 'Crossing', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/bus-depot/bus-crossing-form').then((m) => m.BusCrossingForm)
      },
      {
        path: 'msrtc/create-manifest', title: 'Create Manifest', canActivate: [roleGuard], data: { roles: MOVEMENT_WRITERS },
        loadComponent: () => import('@features/msrtc/msrtc-create-manifest').then((m) => m.MsrtcCreateManifest)
      },
      {
        path: 'msrtc/in-scan', title: 'In Scan Manifest', canActivate: [roleGuard], data: { roles: MOVEMENT_WRITERS, flowType: 'MSRTC' },
        loadComponent: () => import('@features/shipment-movement/in-scan').then((m) => m.InScan)
      },
      {
        path: 'msrtc/finalize-manifest', title: 'Finalize Manifest', canActivate: [roleGuard], data: { roles: MOVEMENT_WRITERS, flowType: 'MSRTC' },
        loadComponent: () => import('@features/shipment-movement/trip-hire-challan').then((m) => m.TripHireChallan)
      },
      {
        path: 'shipments/:id', title: 'Shipment', canActivate: [roleGuard], data: { roles: SHIPMENT_READERS },
        loadComponent: () => import('@features/shipment/shipment-view').then((m) => m.ShipmentView)
      },
      {
        path: 'shipments/:id/edit', title: 'Edit Shipment', canActivate: [roleGuard], data: { roles: SHIPMENT_WRITERS },
        loadComponent: () => import('@features/shipment/shipment-edit').then((m) => m.ShipmentEdit)
      },
      {
        path: 'shipments/:id/charges', title: 'Shipment Charges', canActivate: [roleGuard], data: { roles: SHIPMENT_READERS },
        loadComponent: () => import('@features/shipment/shipment-charges').then((m) => m.ShipmentCharges)
      },
      {
        path: 'shipments/:id/history', title: 'Shipment History', canActivate: [roleGuard], data: { roles: SHIPMENT_READERS },
        loadComponent: () => import('@features/shipment/shipment-history').then((m) => m.ShipmentHistory)
      },
      {
        path: 'shipments/:id/documents', title: 'Shipment Documents', canActivate: [roleGuard], data: { roles: SHIPMENT_READERS },
        loadComponent: () => import('@features/shipment/shipment-documents').then((m) => m.ShipmentDocuments)
      },
      {
        path: 'shipments/:id/timeline', title: 'Shipment Timeline', canActivate: [roleGuard], data: { roles: SHIPMENT_READERS },
        loadComponent: () => import('@features/shipment-movement/timeline').then((m) => m.ShipmentTimeline)
      },
      // Shipment Movement — the minimal Manifest module (see MEMORY/modules/shipment-movement.md)
      // plus the five movement steps the brief's own REST API list names.
      {
        path: 'movement/loading-sheet', title: 'Loading Sheet', canActivate: [roleGuard], data: { roles: MOVEMENT_WRITERS },
        loadComponent: () => import('@features/shipment-movement/loading-sheet').then((m) => m.LoadingSheet)
      },
      {
        path: 'movement/trip-hire-challan', title: 'Trip Hire Challan (THC)', canActivate: [roleGuard], data: { roles: MOVEMENT_WRITERS },
        loadComponent: () => import('@features/shipment-movement/trip-hire-challan').then((m) => m.TripHireChallan)
      },
      {
        path: 'movement/in-scan', title: 'In Scan', canActivate: [roleGuard], data: { roles: MOVEMENT_WRITERS },
        loadComponent: () => import('@features/shipment-movement/in-scan').then((m) => m.InScan)
      },
      {
        path: 'movement/pending-delivery', title: 'Pending Delivery', canActivate: [roleGuard], data: { roles: MOVEMENT_WRITERS },
        loadComponent: () => import('@features/shipment-movement/pending-delivery').then((m) => m.PendingDelivery)
      },
      {
        path: 'movement/out-for-delivery', title: 'DRS', canActivate: [roleGuard], data: { roles: MOVEMENT_WRITERS },
        loadComponent: () => import('@features/shipment-movement/out-for-delivery').then((m) => m.OutForDelivery)
      },
      {
        path: 'movement/delivery', title: 'Delivery', canActivate: [roleGuard], data: { roles: MOVEMENT_WRITERS },
        loadComponent: () => import('@features/shipment-movement/delivery').then((m) => m.Delivery)
      },
      // POD Auto Verification's Manual Review screen — reviewer tier only (COMPANY_ADMIN/
      // BRANCH_MANAGER), mirrors PodVerificationServiceImpl's REVIEWERS @PreAuthorize
      // exactly (narrower than MOVEMENT_WRITERS, which also admits the booking/delivery
      // desks who may capture a POD but not decide one).
      {
        path: 'movement/pod-review', title: 'POD Review', canActivate: [roleGuard], data: { roles: UPDATERS },
        loadComponent: () => import('@features/shipment-movement/pod-review').then((m) => m.PodReview)
      },
      // Company-level POD upload — no branch login required, always auto-approved. Mirrors
      // PodVerificationServiceImpl.uploadByCompany's own hasRole('COMPANY_ADMIN') gate.
      {
        path: 'movement/pod-company-upload', title: 'Upload POD (Company)', canActivate: [roleGuard],
        data: { roles: [AppRole.COMPANY_ADMIN] },
        loadComponent: () => import('@features/shipment-movement/pod-company-upload').then((m) => m.PodCompanyUpload)
      },
      // Bulk POD Upload — auto-detect/match/score many PODs at once. Mirrors
      // PodVerificationServiceImpl.bulkUpload's own hasRole('COMPANY_ADMIN') gate (same
      // REVIEWERS tier uploadByCompany/pod-review's decision form use).
      {
        path: 'movement/pod-bulk-upload', title: 'Bulk POD Upload', canActivate: [roleGuard],
        data: { roles: [AppRole.COMPANY_ADMIN] },
        loadComponent: () => import('@features/shipment-movement/pod-bulk-upload').then((m) => m.PodBulkUpload)
      },
      // Master data — one set of screens for all twelve lists, selected by :master.
      // 'new' is declared before ':id' so the literal segment is not swallowed by the
      // parameter, the same ordering the permissions module needed for 'assign'.
      {
        path: 'masters', pathMatch: 'full', redirectTo: 'masters/countries'
      },
      {
        path: 'masters/:master', title: 'Master Data', canActivate: [roleGuard], data: { roles: MASTERS_READERS },
        loadComponent: () => import('@features/masters/master-list').then((m) => m.MasterList)
      },
      {
        // Union at the route: SUPER_ADMIN writes the geography lists, COMPANY_ADMIN
        // writes its own six catalogues (plus Pincode). Same split as the list/view
        // routes above — MasterFormPage has no per-definition narrowing of its own, so
        // hardcoding COMPANY_ADMIN here locked SUPER_ADMIN out of District/State edits;
        // the backend's per-service @PreAuthorize is still the real enforcement.
        path: 'masters/:master/new', title: 'New Master Record', canActivate: [roleGuard],
        data: { roles: MASTERS_READERS },
        loadComponent: () => import('@features/masters/master-form-page').then((m) => m.MasterFormPage)
      },
      {
        path: 'masters/:master/:id', title: 'Master Record', canActivate: [roleGuard], data: { roles: MASTERS_READERS },
        loadComponent: () => import('@features/masters/master-view').then((m) => m.MasterView)
      },
      {
        path: 'masters/:master/:id/edit', title: 'Edit Master Record', canActivate: [roleGuard],
        data: { roles: MASTERS_READERS },
        loadComponent: () => import('@features/masters/master-form-page').then((m) => m.MasterFormPage)
      },
      // Hubs — a filtered Branch list (branchType: 'HUB'), not a separate module. See
      // MEMORY/modules/hub-operations.md decision 1.
      {
        path: 'hubs', title: 'Hubs', canActivate: [roleGuard], data: { roles: HUB_READERS },
        loadComponent: () => import('@features/hub/hub-list').then((m) => m.HubList)
      },
      // Hub Operations — In Scan/Load Sheet/Sorting/Dispatch reuse the existing Shipment
      // Movement/Manifest screens wholesale (routed again here under their own path, same
      // component); Dashboard/Shipments At Hub/Out Scan/Exceptions are the genuinely new
      // screens. See MEMORY/modules/hub-operations.md.
      {
        path: 'hub-operations/dashboard', title: 'Hub Dashboard', canActivate: [roleGuard], data: { roles: HUB_WRITERS },
        loadComponent: () => import('@features/hub-operations/hub-dashboard').then((m) => m.HubDashboard)
      },
      {
        path: 'hub-operations/in-scan', title: 'Hub In Scan', canActivate: [roleGuard], data: { roles: HUB_WRITERS },
        loadComponent: () => import('@features/shipment-movement/in-scan').then((m) => m.InScan)
      },
      {
        path: 'hub-operations/shipments', title: 'Shipments At Hub', canActivate: [roleGuard], data: { roles: HUB_WRITERS },
        loadComponent: () => import('@features/hub-operations/shipments-at-hub').then((m) => m.ShipmentsAtHub)
      },
      {
        path: 'hub-operations/sorting', title: 'Sorting', canActivate: [roleGuard], data: { roles: HUB_WRITERS },
        loadComponent: () => import('@features/shipment-movement/loading-sheet').then((m) => m.LoadingSheet)
      },
      {
        path: 'hub-operations/load-sheet', title: 'Hub Load Sheet', canActivate: [roleGuard], data: { roles: HUB_WRITERS },
        loadComponent: () => import('@features/shipment-movement/loading-sheet').then((m) => m.LoadingSheet)
      },
      {
        path: 'hub-operations/out-scan', title: 'Out Scan', canActivate: [roleGuard], data: { roles: HUB_WRITERS },
        loadComponent: () => import('@features/hub-operations/out-scan').then((m) => m.HubOutScan)
      },
      {
        path: 'hub-operations/dispatch', title: 'Hub Dispatch', canActivate: [roleGuard], data: { roles: HUB_WRITERS },
        loadComponent: () => import('@features/shipment-movement/trip-hire-challan').then((m) => m.TripHireChallan)
      },
      {
        path: 'hub-operations/exceptions', title: 'Hub Exceptions', canActivate: [roleGuard], data: { roles: HUB_WRITERS },
        loadComponent: () => import('@features/hub-operations/exceptions').then((m) => m.HubExceptions)
      },
      // Reports: reuses the Booking Report as-is (it already scopes to the caller's own
      // branch, and a hub is a branch) rather than building a parallel report screen.
      {
        path: 'hub-operations/reports', title: 'Hub Reports', canActivate: [roleGuard], data: { roles: HUB_WRITERS },
        loadComponent: () => import('@features/reports/booking-report').then((m) => m.BookingReport)
      },
      {
        path: 'finance/branch-wallet', title: 'Branch Wallet', canActivate: [roleGuard], data: { roles: WALLET_VIEWERS },
        loadComponent: () => import('@features/branch-wallet/wallet-dashboard').then((m) => m.WalletDashboard)
      },
      {
        path: 'finance/branch-wallet/transactions', title: 'Wallet Transactions', canActivate: [roleGuard], data: { roles: WALLET_VIEWERS },
        loadComponent: () => import('@features/branch-wallet/wallet-transactions').then((m) => m.WalletTransactions)
      },
      {
        path: 'finance/branch-wallet/recharge', title: 'Recharge Wallet', canActivate: [roleGuard], data: { roles: WALLET_RECHARGERS },
        loadComponent: () => import('@features/branch-wallet/wallet-recharge').then((m) => m.WalletRecharge)
      },
      {
        path: 'finance/branch-wallet/topup-requests', title: 'Top-up Requests', canActivate: [roleGuard], data: { roles: WALLET_VIEWERS },
        loadComponent: () => import('@features/branch-wallet/topup-requests').then((m) => m.TopupRequests)
      },
      {
        path: 'finance/branch-wallet/recharge-report', title: 'Wallet Recharge Report',
        canActivate: [roleGuard], data: { roles: WALLET_RECHARGE_REPORT_READERS },
        loadComponent: () => import('@features/branch-wallet/wallet-recharge-report').then((m) => m.WalletRechargeReport)
      },
      { path: 'finance/branch-wallet/recharge-attempts', redirectTo: 'finance/branch-wallet/recharge-report', pathMatch: 'full' },
      // Follow-up Management. 'new' before ':id', and ':id/edit' before the bare ':id'
      // detail route is unaffected since it's a distinct trailing segment — same
      // convention every other module here uses.
      {
        path: 'follow-ups', title: 'Follow-ups', canActivate: [roleGuard], data: { roles: FOLLOW_UP_READERS },
        loadComponent: () => import('@features/follow-up/follow-up-list').then((m) => m.FollowUpList)
      },
      {
        path: 'follow-ups/new', title: 'Create Follow-up', canActivate: [roleGuard], data: { roles: FOLLOW_UP_READERS },
        loadComponent: () => import('@features/follow-up/follow-up-create').then((m) => m.FollowUpCreate)
      },
      {
        path: 'follow-ups/:id/edit', title: 'Edit Follow-up', canActivate: [roleGuard], data: { roles: FOLLOW_UP_READERS },
        loadComponent: () => import('@features/follow-up/follow-up-edit').then((m) => m.FollowUpEdit)
      },
      {
        path: 'follow-ups/:id', title: 'Follow-up', canActivate: [roleGuard], data: { roles: FOLLOW_UP_READERS },
        loadComponent: () => import('@features/follow-up/follow-up-detail').then((m) => m.FollowUpDetailPage)
      },
      // Ticket Support (Phase 1). 'new' before ':id' so the literal segment is not
      // swallowed by the parameter, same convention every other module here uses.
      {
        path: 'support/tickets', title: 'Tickets', canActivate: [roleGuard], data: { roles: SUPPORT_READERS },
        loadComponent: () => import('@features/support/ticket-list').then((m) => m.TicketList)
      },
      {
        path: 'support/tickets/new', title: 'Raise Ticket', canActivate: [roleGuard], data: { roles: SUPPORT_READERS },
        loadComponent: () => import('@features/support/ticket-create').then((m) => m.TicketCreate)
      },
      {
        path: 'support/tickets/:id', title: 'Ticket', canActivate: [roleGuard], data: { roles: SUPPORT_READERS },
        loadComponent: () => import('@features/support/ticket-detail').then((m) => m.TicketDetailPage)
      },
      {
        path: 'support/dashboard', title: 'Support Dashboard', canActivate: [roleGuard], data: { roles: ADMINS },
        loadComponent: () => import('@features/support/support-dashboard').then((m) => m.SupportDashboard)
      },
      {
        path: 'support/categories', title: 'Ticket Categories', canActivate: [roleGuard], data: { roles: SUPPORT_ADMIN },
        loadComponent: () => import('@features/support/ticket-categories').then((m) => m.TicketCategories)
      },
      {
        path: 'support/sla-rules', title: 'SLA Rules', canActivate: [roleGuard], data: { roles: ADMINS },
        loadComponent: () => import('@features/support/ticket-sla-rules').then((m) => m.TicketSlaRules)
      },
      // Communication Center.
      {
        path: 'communication/dashboard', title: 'Communication Dashboard', canActivate: [roleGuard],
        data: { roles: COMMUNICATION_READERS },
        loadComponent: () => import('@features/communication/communication-dashboard').then((m) => m.CommunicationDashboardPage)
      },
      {
        path: 'communication/settings', title: 'Channel Settings', canActivate: [roleGuard],
        data: { roles: COMMUNICATION_ADMIN },
        loadComponent: () => import('@features/communication/channel-settings').then((m) => m.ChannelSettings)
      },
      {
        path: 'communication/templates', title: 'Notification Templates', canActivate: [roleGuard],
        data: { roles: COMMUNICATION_ADMIN },
        loadComponent: () => import('@features/communication/communication-templates').then((m) => m.CommunicationTemplates)
      },
      {
        path: 'communication/templates/new', title: 'New Template', canActivate: [roleGuard],
        data: { roles: COMMUNICATION_ADMIN },
        loadComponent: () => import('@features/communication/template-new').then((m) => m.TemplateNew)
      },
      {
        path: 'communication/templates/:id', title: 'Edit Template', canActivate: [roleGuard],
        data: { roles: COMMUNICATION_ADMIN },
        loadComponent: () => import('@features/communication/template-detail').then((m) => m.TemplateDetail)
      },
      {
        path: 'communication/logs', title: 'Communication Logs', canActivate: [roleGuard],
        data: { roles: COMMUNICATION_READERS },
        loadComponent: () => import('@features/communication/communication-logs').then((m) => m.CommunicationLogs)
      },
      {
        path: 'users', title: 'Users', canActivate: [roleGuard], data: { roles: USER_READERS },
        loadComponent: () => import('@features/users/user-list').then((m) => m.UserList)
      },
      {
        path: 'users/new', title: 'New User', canActivate: [roleGuard], data: { roles: USER_WRITERS },
        loadComponent: () => import('@features/users/user-create').then((m) => m.UserCreate)
      },
      {
        path: 'users/:id', title: 'User', canActivate: [roleGuard], data: { roles: USER_READERS },
        loadComponent: () => import('@features/users/user-view').then((m) => m.UserView)
      },
      {
        path: 'users/:id/edit', title: 'Edit User', canActivate: [roleGuard], data: { roles: USER_WRITERS },
        loadComponent: () => import('@features/users/user-edit').then((m) => m.UserEdit)
      },
      {
        path: 'departments', title: 'Departments', canActivate: [roleGuard], data: { roles: ADMINS },
        loadComponent: () => import('@features/departments/department-list').then((m) => m.DepartmentList)
      },
      {
        path: 'roles', title: 'Roles', canActivate: [roleGuard], data: { roles: ADMINS },
        loadComponent: () => import('@features/roles/role-list').then((m) => m.RoleList)
      },
      {
        path: 'roles/new', title: 'New Role', canActivate: [roleGuard], data: { roles: [AppRole.COMPANY_ADMIN] },
        loadComponent: () => import('@features/roles/role-create').then((m) => m.RoleCreate)
      },
      {
        path: 'roles/:id', title: 'Role', canActivate: [roleGuard], data: { roles: ADMINS },
        loadComponent: () => import('@features/roles/role-view').then((m) => m.RoleView)
      },
      {
        path: 'roles/:id/edit', title: 'Edit Role', canActivate: [roleGuard], data: { roles: [AppRole.COMPANY_ADMIN] },
        loadComponent: () => import('@features/roles/role-edit').then((m) => m.RoleEdit)
      },
      {
        path: 'permissions', title: 'Permissions', canActivate: [roleGuard], data: { roles: ADMINS },
        loadComponent: () => import('@features/permissions/permission-list').then((m) => m.PermissionList)
      },
      {
        path: 'permissions/assign', title: 'Assign Permissions', canActivate: [roleGuard], data: { roles: [AppRole.COMPANY_ADMIN] },
        loadComponent: () => import('@features/permissions/permission-assign').then((m) => m.PermissionAssign)
      },
      {
        // Menu + Permission Management: one user's menu tree, on top of their role's
        // defaults. BRANCH_MANAGER included — "assign menus" is their own responsibility
        // #2, gated on MENU_ASSIGN, the same as UserServiceImpl's own role-assignment
        // endpoints (see DefaultRoleCatalog).
        path: 'permissions/users', title: 'User Permissions', canActivate: [roleGuard],
        data: { roles: [...ADMINS, AppRole.BRANCH_MANAGER] },
        loadComponent: () => import('@features/user-permissions/user-permissions').then((m) => m.UserPermissions)
      },
      {
        path: 'permissions/:id', title: 'Permission', canActivate: [roleGuard], data: { roles: ADMINS },
        loadComponent: () => import('@features/permissions/permission-view').then((m) => m.PermissionView)
      },
      {
        path: 'kyc', title: 'KYC',
        loadComponent: () => import('@features/kyc/my-kyc').then((m) => m.MyKyc)
      },
      {
        path: 'kyc/review', title: 'KYC Review', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/kyc/kyc-review').then((m) => m.KycReview)
      },
      {
        path: 'kyc/review/:type/:id', title: 'KYC', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/kyc/kyc-review-detail').then((m) => m.KycReviewDetail)
      },
      {
        path: 'courier-integrations', title: 'Courier Integrations', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/courier-integrations/courier-integrations').then((m) => m.CourierIntegrations)
      },
      {
        path: 'settings', title: 'Settings', canActivate: [roleGuard], data: { roles: COMPANY_ONLY },
        loadComponent: () => import('@features/settings/settings-page').then((m) => m.SettingsPage)
      },
      {
        // Gated on AUDIT_READ/SEARCH/EXPORT (seeded since V6, unused until this module —
        // see MEMORY/modules/activity-log.md), so ADMINS is the role bridge same as every
        // other permission-gated leaf.
        path: 'activity-logs', title: 'Activity Log', canActivate: [roleGuard], data: { roles: ADMINS },
        loadComponent: () => import('@features/activity-log/activity-log-list').then((m) => m.ActivityLogList)
      },
      {
        path: 'activity-logs/users', title: 'User Activity', canActivate: [roleGuard], data: { roles: ADMINS },
        loadComponent: () => import('@features/activity-log/user-activity').then((m) => m.UserActivity)
      }
    ]
  },
  { path: '**', redirectTo: '' }
];
