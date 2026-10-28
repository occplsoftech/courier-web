/** Central registry of backend endpoints, so a path change is one edit. Base is prefixed
 *  by ApiService from environment.apiBaseUrl. */
export const API = {
  auth: {
    login: '/auth/login',
    refresh: '/auth/refresh',
    logout: '/auth/logout',
    me: '/auth/me',
    changePassword: '/auth/change-password',
    platformConfig: '/auth/platform/config',
    platformExchange: '/auth/platform/exchange',
    forgotPassword: '/auth/forgot-password',
    resetPassword: '/auth/reset-password',
    impersonate: (companyId: string) => `/auth/impersonate/${companyId}`,
    impersonateBranch: (branchId: string) => `/auth/impersonate/branch/${branchId}`
  },
  companies: '/companies',
  users: '/users',
  roles: '/roles',
  departments: '/departments',
  permissions: '/permissions',
  /** The menu/submenu hierarchy — GET .../tree feeds the User Permissions screen's tree UI. */
  menuItems: '/menu-items',
  /** One user's menu permissions (role defaults + overrides). See
   *  MEMORY/modules/permission.md. */
  userMenuPermissions: (userId: string) => `/users/${userId}/menu-permissions`,
  branches: '/branches',
  customers: '/customers',
  /** Business Customer pricing: a customer's zones (districts/cities) and per-zone rate cards. */
  pricingZones: '/pricing-zones',
  /** MSRTC bus depot / station master. */
  busDepots: '/bus-depots',
  busCrossings: '/bus-crossings',
  busDivisions: '/bus-divisions',
  customerRates: '/customer-rates',
  tariffZones: '/tariff-zones',
  tariffRateCards: '/tariff-rate-cards',
  pdpRates: '/pdp-rates',
  pickups: '/pickups',
  pdpEarnings: '/pdp-earnings',
  pdpStatements: '/pdp-statements',
  businessDashboard: '/business-customers/dashboard',
  customerInvoices: '/customer-invoices',
  rates: '/rates',
  /** Charge & Charge Settings — standalone pricing/commission configuration, scoped to
   *  one Service Type per charge. Not yet wired into Shipment Booking. */
  charges: '/charges',
  chargeSettings: (chargeId: string) => `/charges/${chargeId}/settings`,
  shipments: '/shipments',
  /** Public (no-login) Track Shipment — reached from the login screen. Redacted
   *  projection, matched against either tracking or shipment number. */
  publicTrack: (number: string) => `/track/${number}`,
  /** POD Auto Verification — verify/{id}, verification/{id}, review/{id}. See
   *  MEMORY/modules/pod-verification.md. */
  pod: (shipmentId: string) => `/shipments/${shipmentId}/pod`,
  /** Company-level POD upload — no branch/delivery-assignment context, COMPANY_ADMIN only. */
  podCompanyUpload: (shipmentId: string) => `/pod/company-upload/${shipmentId}`,
  /** Bulk POD Upload — auto-detect/match/score many PODs at once, COMPANY_ADMIN only. */
  podBulkUpload: '/pod/bulk-upload',
  /** The Pricing Engine's one endpoint — no frontend module of its own, called here for
   *  the booking wizard's live preview. See core/models/shipment.model.ts. */
  pricing: '/pricing',
  /** Shipment Movement's minimal prerequisite (see MEMORY/modules/shipment-movement.md) —
   *  not part of the movement brief's own REST list, which assumes a manifest exists. */
  manifests: '/manifests',
  vehicles: '/vehicles',
  /** Loading Sheet, Trip Hire Challan (THC), In Scan, Out For Delivery, Deliver. */
  shipmentMovement: '/shipment-movement',
  branchWallet: '/branch-wallet',
  /** A business customer's own prepaid wallet (staff side): `${customers}/{id}/wallet`, `/transactions`, `/credit`, `/debit`. */
  customerWallet: (customerId: string) => `/customers/${encodeURIComponent(customerId)}/wallet`,
  /** Hub Operations — out-scan and exceptions (the genuinely new surface). A hub itself
   *  is a `Branch` row with `branchType: 'HUB'`, so Hub listing reuses `API.branches`
   *  with that filter, not its own endpoint; in-scan/Load Sheet/dispatch reuse
   *  `shipmentMovement`/`manifests`/`vehicles`. See MEMORY/modules/hub-operations.md. */
  hubOperations: '/hub-operations',
  companySettings: '/company-settings',
  /** Own-company letterhead (name/address/GST/contact/website) for printed documents —
   *  any authenticated company user reads, unlike `/companies/**` (SUPER_ADMIN only). */
  companyProfile: '/company-profile',
  companyRazorpayConfig: '/company-razorpay-config',
  /** The company's own courier accounts for the customer shipping portal (COMPANY_ADMIN). */
  courierIntegrations: '/courier-integrations',
  kyc: '/kyc',
  subscriptionPlans: '/subscription-plans',
  /** The platform console: platform dashboard and platform-operator accounts. */
  superAdmin: '/super-admin',
  /** The geography every company shares. SUPER_ADMIN writes, anyone signed in reads. */
  globalMasters: '/global-masters',
  dashboard: '/dashboard/summary',
  distances: '/distances',
  freightFactors: '/freight-factors',
  /** District Level Freight — rate setup by From Station + District + weight slab, and
   *  Shipment Booking's own live freight-preview call (`.../calculate`) — the same
   *  calculation the backend re-verifies authoritatively at Confirm Booking. */
  districtLevelFreight: '/district-level-freight',
  districtLevelFreightImportPreview: '/district-level-freight/import/preview',
  districtLevelFreightImport: '/district-level-freight/import',
  districtLevelFreightCalculate: '/district-level-freight/calculate',
  /** Ticket Support — lifecycle, conversation, categories, SLA rules. See MEMORY. */
  supportTickets: '/support/tickets',
  supportCategories: '/support/categories',
  supportSlaRules: '/support/sla-rules',
  notifications: '/notifications',
  /** Follow-up Management — branch operational tasks. See MEMORY/modules/follow-up.md. */
  followUps: '/follow-ups',
  /** E-Way Bill Management — standalone CRUD/lifecycle. Shipment Booking itself carries
   *  E-Way Bill data inline (see shipments); this is for managing one afterward. See
   *  MEMORY/modules/eway-bill.md. */
  ewayBills: '/eway-bills',
  /** Communication Center — WhatsApp/SMS/Email, event-driven. See
   *  MEMORY/modules/communication.md. */
  communicationTemplates: '/communication/templates',
  communicationSettings: '/communication/settings',
  communicationLogs: '/communication/logs',
  communicationDashboard: '/communication/dashboard',
  /** User Activity & Audit Logging — the automatic activity trail plus per-user
   *  login/session history. See MEMORY/modules/activity-log.md. */
  activityLogs: '/activity-logs',
  activityLogExport: '/activity-logs/export',
  activityLogFilterOptions: '/activity-logs/filter-options',
  userActivity: (userId: string) => `/users/${userId}/activity`
} as const;
