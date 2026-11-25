import { AppRole } from '@core/models/role.model';
import { CITY_TIERS, DISTANCE_UNITS, MasterRecord, WEIGHT_UNITS } from '@core/models/master.model';

/**
 * The twelve master lists, described as data.
 *
 * Every one of them is the same screen: a paged table with search, filters and lifecycle
 * actions, a create form, an edit form and a detail view. Writing that four times each
 * would be forty-eight components differing only in their field names — and the twelfth
 * would drift from the first within a release. So the screens are written once and the
 * differences live here.
 *
 * This file is the single place to change when the backend adds a field. It is also the
 * only place that knows a list's route segment, which is the same word the API uses, so a
 * URL and an endpoint can never disagree.
 */

export type MasterFieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'decimal'
  | 'boolean'
  | 'time'
  | 'select'
  | 'lookup';

export interface MasterFieldOption {
  value: string;
  label: string;
}

/** One editable field, and everything the shared form needs to render and validate it. */
export interface MasterField {
  key: string;
  label: string;
  kind: MasterFieldKind;
  /**
   * The value lives one level down in the record and the payload, as `record[parent][prop]`
   * (a pincode's document / surface / air coverage). `key` stays a flat form-control name.
   */
  nested?: { parent: string; prop: string };
  /**
   * `select` only: options are '', 'true' and 'false', sent as null / true / false. For a
   * yes / no that may also be "not set", which a toggle cannot show.
   */
  triState?: boolean;
  required?: boolean;
  /** Set once and never editable — the code, because operational data quotes it. */
  createOnly?: boolean;
  hint?: string;
  placeholder?: string;
  maxLength?: number;
  /** Mirrors the DTO's `@Pattern`, so the user is told before the round trip, not after. */
  pattern?: string;
  patternMessage?: string;
  min?: number;
  max?: number;
  /** `select` only. */
  options?: MasterFieldOption[];
  /**
   * Initial value on a create form. Only meaningful for `boolean`, where "unset" is not a
   * state a toggle can show: a pincode you bothered to add is one you serve, so the
   * availability switches start on. Everything else starts empty.
   */
  initial?: boolean;
  /**
   * `lookup` only: where the picker's options come from. Either another master's active
   * rows, or `'branches'` — the Route master's two ends are branches, which are a
   * different module, not a master list.
   */
  lookup?: LookupSource;
  /** Section heading in the form; fields with the same group are laid out together. */
  group?: string;
  /**
   * This `lookup` picker's options narrow to whatever `dependsOn` (another lookup field's
   * key in the same filter drawer, or — create mode only, see `transient` — the same form)
   * is currently set to, e.g. District narrows to the selected State. `dependsOnParam` is
   * the query param the parent's value is sent as (defaults to `dependsOn` itself).
   * Empty/cleared parent empties this field's options and resets its own value, since a
   * stale child selection could belong to the old parent. In a create form the field starts
   * disabled until its parent has a value; an edit form ignores `dependsOn` entirely and
   * loads the plain unscoped list, since only the deepest level is ever persisted on the
   * record and re-deriving its ancestors isn't worth the extra round trips.
   */
  dependsOn?: string;
  dependsOnParam?: string;
  /**
   * Marks a `lookup` field that exists only to narrow another field's options in a create
   * form (e.g. Country narrowing State, State narrowing District) — never sent in the
   * create/update payload, and hidden once editing (see `dependsOn`'s note on why an edit
   * form doesn't re-derive it).
   */
  transient?: boolean;
  /**
   * `lookup` field, create mode only: once this field's options load, preselect whichever
   * one's label starts with this text (case-insensitive) — e.g. Country defaulting to
   * India. Only applied while the control is still empty.
   */
  defaultOptionMatch?: string;
}

/** A column on the shared table. `value` renders the cell; `badge` styles it as a chip. */
export interface MasterColumn {
  key: string;
  header: string;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  width?: string;
  kind?: 'text' | 'boolean' | 'status' | 'number';
  value?: (row: MasterRecord) => string;
}

/** A picker's source: another master list, or the branch directory. */
export type LookupSource = MasterKey | 'branches';

export type MasterKey =
  | 'countries'
  | 'states'
  | 'districts'
  | 'cities'
  | 'areas'
  | 'pincodes'
  | 'regional-zones'
  | 'vehicle-types'
  | 'package-types'
  | 'service-types'
  | 'payment-modes'
  | 'weight-slabs'
  | 'routes';

export interface MasterDefinition {
  key: MasterKey;
  /** Path segment on the API — deliberately the same word as the route segment. */
  apiPath: string;
  /**
   * True for the six geography lists, which are one catalogue shared by every company:
   * `SUPER_ADMIN` writes them, anyone signed in reads them. The company-owned lists
   * below keep `COMPANY_ADMIN` writes. The flag drives which role the screens gate on,
   * so the UI and the backend guard cannot disagree about who may press Save.
   */
  global?: boolean;
  /**
   * Override the write roles a `global` list would otherwise get (`SUPER_ADMIN` only).
   * Pincode is the one geography level `COMPANY_ADMIN` also writes — see `writeAccessFor`.
   * Absent for every other list; the `global` flag alone decides for those.
   */
  writeRoles?: AppRole[];
  singular: string;
  plural: string;
  icon: string;
  description: string;
  /** Where this list sits in the sidebar, for the breadcrumb. */
  group: 'Geography' | 'Operations';
  /** The parent list, when this one is a level of the geography hierarchy. */
  parent?: { field: string; nameField: string; master: MasterKey; label: string };
  columns: MasterColumn[];
  fields: MasterField[];
  /** Filters beyond status and free text. */
  filters?: MasterField[];
  /** Column keys included in a CSV export, in order. */
  exportColumns: string[];
  /** Whether `POST /master/bootstrap` seeds this list with a standard set. */
  seeded?: boolean;
  /** Sort the list opens on, before the operator clicks a column header. Most lists are
   *  fine reading in whatever order the backend returns; a few (Pincode) read oddly any
   *  other way. `field` must be one of the backend's own allowed sort keys. */
  defaultSort?: { field: string; direction: 'asc' | 'desc' };
}

const text = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const yesNo = (v: unknown) => (v ? 'Yes' : 'No');

/** Shared by every list: the code and name columns lead, the status closes. */
const CODE_COLUMN: MasterColumn = { key: 'code', header: 'Code', sortable: true, width: '150px' };
const NAME_COLUMN: MasterColumn = { key: 'name', header: 'Name', sortable: true };
const STATUS_COLUMN: MasterColumn = { key: 'status', header: 'Status', sortable: true, kind: 'status', width: '110px' };

/** Shared by every form. The code is create-only everywhere. */
const CODE_FIELD: MasterField = {
  key: 'code', label: 'Code', kind: 'text', required: true, createOnly: true, maxLength: 50,
  pattern: '^[A-Za-z0-9][A-Za-z0-9_ -]{0,48}[A-Za-z0-9]$',
  patternMessage: '2-50 characters: letters, digits, space, hyphen or underscore',
  hint: 'Uppercased on save, and permanent — operational records will quote it.',
  group: 'Identity'
};
const NAME_FIELD: MasterField = {
  key: 'name', label: 'Name', kind: 'text', required: true, maxLength: 150, group: 'Identity'
};
const DESCRIPTION_FIELD: MasterField = {
  key: 'description', label: 'Description', kind: 'textarea', maxLength: 500, group: 'Identity'
};
const ORDER_FIELD: MasterField = {
  key: 'displayOrder', label: 'Display order', kind: 'number', min: 0, group: 'Identity',
  hint: 'Lower numbers appear first in pickers.'
};

const HEAD_FIELDS = [CODE_FIELD, NAME_FIELD, DESCRIPTION_FIELD, ORDER_FIELD];

const option = (value: string) => ({ value, label: value.replace(/_/g, ' ') });

/** Tri-state yes / no for nullable flags: blank means "use the pincode's own flag". */
const TRI_STATE: MasterFieldOption[] = [
  { value: '', label: 'Not set' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }
];

/** One delivery network's coverage at a pincode (V171): delivers, ODA, promised hours. */
function coverageFields(parent: 'doc' | 'surface' | 'air', group: string): MasterField[] {
  return [
    { key: `${parent}Serviceable`, label: 'Delivers here', kind: 'select', options: TRI_STATE, triState: true,
      nested: { parent, prop: 'serviceable' }, group,
      hint: parent === 'doc' ? 'Not set: the pincode\'s own Serviceable switch decides.' : undefined },
    { key: `${parent}Oda`, label: 'ODA', kind: 'select', options: TRI_STATE, triState: true,
      nested: { parent, prop: 'oda' }, group },
    { key: `${parent}TatHours`, label: 'Delivery time (hours)', kind: 'number', min: 1, max: 2400,
      nested: { parent, prop: 'tatHours' }, group, placeholder: '48' }
  ];
}

/** "Yes · ODA · 48 h" for a list column; a dash when the network has no data. */
function coverageText(c: unknown): string {
  const v = (c ?? {}) as { serviceable?: boolean | null; oda?: boolean | null; tatHours?: number | null };
  if (v.serviceable == null && v.oda == null && v.tatHours == null) return '—';
  if (v.serviceable === false) return 'No service';
  return [v.oda ? 'ODA' : 'Yes', v.tatHours != null ? `${v.tatHours} h` : null].filter(Boolean).join(' · ');
}

function transitLabel(days: number, hours: number): string {
  const h = hours || 0;
  if (days === 0 && h === 0) return 'Same day';
  const parts = [days ? `${days} d` : null, h ? `${h} h` : null].filter(Boolean);
  return parts.join(' ');
}

export const MASTER_DEFINITIONS: Record<MasterKey, MasterDefinition> = {
  countries: {
    key: 'countries', global: true, apiPath: '/global-masters/countries', singular: 'Country', plural: 'Countries',
    icon: 'public', group: 'Geography',
    description: 'The root of the geography hierarchy. A country holds states.',
    columns: [
      CODE_COLUMN, NAME_COLUMN,
      { key: 'isoCode2', header: 'ISO-2', width: '90px', value: (r) => text(r['isoCode2']) },
      { key: 'currencyCode', header: 'Currency', width: '110px', value: (r) => text(r['currencyCode']) },
      { key: 'dialCode', header: 'Dial', width: '90px', value: (r) => text(r['dialCode']) },
      STATUS_COLUMN
    ],
    fields: [
      ...HEAD_FIELDS,
      { key: 'isoCode2', label: 'ISO alpha-2', kind: 'text', maxLength: 2, pattern: '^[A-Za-z]{2}$',
        patternMessage: 'Exactly two letters, e.g. IN', placeholder: 'IN', group: 'Codes' },
      { key: 'isoCode3', label: 'ISO alpha-3', kind: 'text', maxLength: 3, pattern: '^[A-Za-z]{3}$',
        patternMessage: 'Exactly three letters, e.g. IND', placeholder: 'IND', group: 'Codes' },
      { key: 'dialCode', label: 'Dial code', kind: 'text', maxLength: 8, placeholder: '+91', group: 'Codes' },
      { key: 'currencyCode', label: 'Currency', kind: 'text', maxLength: 3, pattern: '^[A-Za-z]{3}$',
        patternMessage: 'An ISO 4217 code, e.g. INR', placeholder: 'INR', group: 'Codes' }
    ],
    exportColumns: ['code', 'name', 'isoCode2', 'isoCode3', 'dialCode', 'currencyCode', 'status']
  },

  states: {
    key: 'states', global: true, apiPath: '/global-masters/states', singular: 'State', plural: 'States',
    icon: 'flag', group: 'Geography',
    description: 'States and provinces, each within one country.',
    parent: { field: 'countryId', nameField: 'countryName', master: 'countries', label: 'Country' },
    columns: [
      CODE_COLUMN, NAME_COLUMN,
      { key: 'countryName', header: 'Country', value: (r) => text(r['countryName']) },
      { key: 'gstStateCode', header: 'GST code', width: '100px', value: (r) => text(r['gstStateCode']) },
      STATUS_COLUMN
    ],
    fields: [
      ...HEAD_FIELDS,
      { key: 'countryId', label: 'Country', kind: 'lookup', lookup: 'countries', required: true,
        group: 'Placement', hint: 'Must be an active country of this company.' },
      { key: 'gstStateCode', label: 'GST state code', kind: 'text', maxLength: 4, placeholder: '27',
        group: 'Codes', hint: 'Text, so a leading zero survives.' }
    ],
    filters: [{ key: 'countryId', label: 'Country', kind: 'lookup', lookup: 'countries' }],
    exportColumns: ['code', 'name', 'countryName', 'gstStateCode', 'status']
  },

  districts: {
    key: 'districts', global: true, apiPath: '/global-masters/districts', singular: 'District', plural: 'Districts',
    icon: 'map', group: 'Geography',
    description: 'Districts, each within one state.',
    parent: { field: 'stateId', nameField: 'stateName', master: 'states', label: 'State' },
    columns: [
      CODE_COLUMN, NAME_COLUMN,
      { key: 'stateName', header: 'State', value: (r) => text(r['stateName']) },
      STATUS_COLUMN
    ],
    fields: [
      ...HEAD_FIELDS,
      { key: 'stateId', label: 'State', kind: 'lookup', lookup: 'states', required: true, group: 'Placement' }
    ],
    filters: [{ key: 'stateId', label: 'State', kind: 'lookup', lookup: 'states' }],
    exportColumns: ['code', 'name', 'stateName', 'status']
  },

  cities: {
    key: 'cities', global: true, apiPath: '/global-masters/cities', singular: 'City', plural: 'Cities',
    icon: 'location_city', group: 'Geography',
    description: 'Cities, each within one district. Metro and tier are commercial gradings.',
    parent: { field: 'districtId', nameField: 'districtName', master: 'districts', label: 'District' },
    columns: [
      CODE_COLUMN, NAME_COLUMN,
      { key: 'districtName', header: 'District', value: (r) => text(r['districtName']) },
      { key: 'metro', header: 'Metro', kind: 'boolean', width: '90px', value: (r) => yesNo(r['metro']) },
      { key: 'cityTier', header: 'Tier', width: '100px', value: (r) => text(r['cityTier']) },
      STATUS_COLUMN
    ],
    fields: [
      ...HEAD_FIELDS,
      { key: 'countryId', label: 'Country', kind: 'lookup', lookup: 'countries', required: true,
        group: 'Placement', transient: true, defaultOptionMatch: 'India',
        hint: 'Narrows State and District below — not stored on the city itself.' },
      { key: 'stateId', label: 'State', kind: 'lookup', lookup: 'states', required: true,
        group: 'Placement', transient: true, dependsOn: 'countryId', defaultOptionMatch: 'Maharashtra' },
      { key: 'districtId', label: 'District', kind: 'lookup', lookup: 'districts', required: true,
        group: 'Placement', dependsOn: 'stateId' },
      { key: 'metro', label: 'Metro city', kind: 'boolean', group: 'Commercial' },
      { key: 'cityTier', label: 'Tier', kind: 'select', group: 'Commercial',
        options: CITY_TIERS.map(option), hint: 'Used by the rate master later.' }
    ],
    filters: [
      { key: 'stateId', label: 'State', kind: 'lookup', lookup: 'states' },
      { key: 'districtId', label: 'District', kind: 'lookup', lookup: 'districts', dependsOn: 'stateId' },
      { key: 'metro', label: 'Metro only', kind: 'boolean' }
    ],
    exportColumns: ['code', 'name', 'districtName', 'metro', 'cityTier', 'status']
  },

  areas: {
    key: 'areas', global: true, apiPath: '/global-masters/areas', singular: 'Area', plural: 'Areas',
    icon: 'pin_drop', group: 'Geography',
    description: 'Localities, each within one city — the level a delivery run is assigned to.',
    parent: { field: 'cityId', nameField: 'cityName', master: 'cities', label: 'City' },
    columns: [
      CODE_COLUMN, NAME_COLUMN,
      { key: 'cityName', header: 'City', value: (r) => text(r['cityName']) },
      STATUS_COLUMN
    ],
    fields: [
      ...HEAD_FIELDS,
      { key: 'cityId', label: 'City', kind: 'lookup', lookup: 'cities', required: true, group: 'Placement' }
    ],
    filters: [{ key: 'cityId', label: 'City', kind: 'lookup', lookup: 'cities' }],
    exportColumns: ['code', 'name', 'cityName', 'status']
  },

  pincodes: {
    key: 'pincodes', global: true, writeRoles: [AppRole.SUPER_ADMIN, AppRole.COMPANY_ADMIN],
    apiPath: '/global-masters/pincodes', singular: 'Pincode', plural: 'Pincodes',
    icon: 'markunread_mailbox', group: 'Geography',
    description: 'Postal codes, each belonging to one area. The code is the pincode itself.',
    defaultSort: { field: 'code', direction: 'asc' },
    parent: { field: 'areaId', nameField: 'areaName', master: 'areas', label: 'Area' },
    columns: [
      { key: 'code', header: 'Pincode', sortable: true, width: '120px' },
      { key: 'name', header: 'Post office', sortable: true },
      { key: 'districtName', header: 'District', value: (r) => text(r['districtName']) },
      { key: 'stateName', header: 'State', value: (r) => text(r['stateName']) },
      { key: 'zone', header: 'Zone', width: '140px', value: (r) => text(r['zone']) },
      { key: 'regionalZoneName', header: 'Regional zone', width: '120px', value: (r) => text(r['regionalZoneName']) },
      { key: 'doc', header: 'Document', width: '120px', value: (r) => coverageText(r['doc']) },
      { key: 'surface', header: 'Surface', width: '120px', value: (r) => coverageText(r['surface']) },
      { key: 'air', header: 'Air', width: '120px', value: (r) => coverageText(r['air']) },
      STATUS_COLUMN
    ],
    fields: [
      { ...CODE_FIELD, label: 'Pincode', pattern: '^[0-9]{4,10}$',
        patternMessage: '4 to 10 digits', placeholder: '411038',
        hint: 'The postal code itself. Permanent once saved.' },
      { ...NAME_FIELD, label: 'Post office / locality' },
      DESCRIPTION_FIELD, ORDER_FIELD,
      { key: 'areaId', label: 'Area', kind: 'lookup', lookup: 'areas', required: true, group: 'Placement' },
      { key: 'serviceable', label: 'Serviceable', kind: 'boolean', initial: true, group: 'Availability',
        hint: 'Turning this off clears the three below — a pincode nobody delivers to cannot offer COD.' },
      { key: 'codAvailable', label: 'Cash on delivery', kind: 'boolean', initial: true, group: 'Availability' },
      { key: 'prepaidAvailable', label: 'Prepaid', kind: 'boolean', initial: true, group: 'Availability' },
      { key: 'pickupAvailable', label: 'Pickup', kind: 'boolean', initial: true, group: 'Availability' },
      { key: 'odaApplicable', label: 'ODA applicable', kind: 'boolean', initial: false, group: 'Availability',
        hint: 'Out-of-Delivery-Area — still served, just not on the standard network.' },
      { key: 'zone', label: 'Zone', kind: 'text', maxLength: 20, placeholder: 'PUNE', group: 'Zones',
        hint: 'As in the pincode master: PUNE, X - PUNE, MAHARASHTRA, X - MAHARASHTRA, VIDHARBHA, REST OF INDIA or NORTH EAST.' },
      { key: 'regionalZoneId', label: 'Regional zone', kind: 'lookup', lookup: 'regional-zones', group: 'Zones',
        hint: 'NORTH, SOUTH, EAST, WEST or CENTRAL. A Zone Tariff zone can take a whole regional zone.' },
      ...coverageFields('doc', 'Document service'),
      ...coverageFields('surface', 'Surface service'),
      ...coverageFields('air', 'Air service')
    ],
    filters: [
      { key: 'stateId', label: 'State', kind: 'lookup', lookup: 'states' },
      { key: 'districtId', label: 'District', kind: 'lookup', lookup: 'districts', dependsOn: 'stateId' },
      { key: 'areaId', label: 'Area', kind: 'lookup', lookup: 'areas' },
      { key: 'serviceable', label: 'Serviceable only', kind: 'boolean' },
      { key: 'odaApplicable', label: 'ODA only', kind: 'boolean' },
      { key: 'zone', label: 'Zone', kind: 'text', maxLength: 20, placeholder: 'PUNE' }
    ],
    exportColumns: ['code', 'name', 'areaName', 'districtName', 'stateName', 'zone', 'regionalZoneName', 'serviceable', 'doc', 'surface', 'air', 'codAvailable', 'prepaidAvailable', 'odaApplicable', 'status']
  },

  'regional-zones': {
    key: 'regional-zones', global: true, writeRoles: [AppRole.SUPER_ADMIN, AppRole.COMPANY_ADMIN],
    apiPath: '/global-masters/regional-zones', singular: 'Regional zone', plural: 'Regional Zones',
    icon: 'travel_explore', group: 'Geography',
    description: 'Regions pincodes are grouped into: NORTH, SOUTH, EAST, WEST and CENTRAL. Each pincode names its regional zone; a Zone Tariff zone can take a whole regional zone.',
    defaultSort: { field: 'displayOrder', direction: 'asc' },
    columns: [CODE_COLUMN, NAME_COLUMN, STATUS_COLUMN],
    fields: [...HEAD_FIELDS],
    exportColumns: ['code', 'name', 'status']
  },

  'vehicle-types': {
    key: 'vehicle-types', apiPath: '/master/vehicle-types', singular: 'Vehicle type', plural: 'Vehicle Types',
    icon: 'local_shipping', group: 'Operations', seeded: true,
    description: 'The classes of vehicle the fleet runs, and what each can carry.',
    columns: [
      CODE_COLUMN, NAME_COLUMN,
      { key: 'capacityKg', header: 'Capacity (kg)', align: 'right', width: '140px', value: (r) => text(r['capacityKg']) },
      { key: 'capacityCft', header: 'Volume (cft)', align: 'right', width: '140px', value: (r) => text(r['capacityCft']) },
      { key: 'wheelCount', header: 'Wheels', align: 'right', width: '90px', value: (r) => text(r['wheelCount']) },
      { key: 'requiresPermit', header: 'Permit', kind: 'boolean', width: '90px', value: (r) => yesNo(r['requiresPermit']) },
      STATUS_COLUMN
    ],
    fields: [
      ...HEAD_FIELDS,
      { key: 'capacityKg', label: 'Payload capacity (kg)', kind: 'decimal', min: 0, group: 'Capacity' },
      { key: 'capacityCft', label: 'Load volume (cft)', kind: 'decimal', min: 0, group: 'Capacity' },
      { key: 'wheelCount', label: 'Wheels', kind: 'number', min: 1, group: 'Capacity' },
      { key: 'requiresPermit', label: 'Needs a commercial permit', kind: 'boolean', group: 'Capacity' }
    ],
    filters: [{ key: 'requiresPermit', label: 'Permit required only', kind: 'boolean' }],
    exportColumns: ['code', 'name', 'capacityKg', 'capacityCft', 'wheelCount', 'requiresPermit', 'status']
  },

  'package-types': {
    key: 'package-types', apiPath: '/master/package-types', singular: 'Package type', plural: 'Package Types',
    icon: 'inventory_2', group: 'Operations', seeded: true,
    description: 'What is being carried. Documents are rated on a flat slab, not by weight.',
    columns: [
      CODE_COLUMN, NAME_COLUMN,
      { key: 'documentType', header: 'Document', kind: 'boolean', width: '110px', value: (r) => yesNo(r['documentType']) },
      { key: 'fragileByDefault', header: 'Fragile', kind: 'boolean', width: '100px', value: (r) => yesNo(r['fragileByDefault']) },
      { key: 'maxWeightKg', header: 'Max (kg)', align: 'right', width: '110px', value: (r) => text(r['maxWeightKg']) },
      STATUS_COLUMN
    ],
    fields: [
      ...HEAD_FIELDS,
      { key: 'documentType', label: 'Is a document', kind: 'boolean', group: 'Handling',
        hint: 'Documents skip dimension capture and are rated on a flat slab.' },
      { key: 'fragileByDefault', label: 'Fragile by default', kind: 'boolean', group: 'Handling' },
      { key: 'maxWeightKg', label: 'Maximum weight (kg)', kind: 'decimal', min: 0, group: 'Handling' },
      { key: 'defaultLengthCm', label: 'Default length (cm)', kind: 'decimal', min: 0, group: 'Dimensions' },
      { key: 'defaultWidthCm', label: 'Default width (cm)', kind: 'decimal', min: 0, group: 'Dimensions' },
      { key: 'defaultHeightCm', label: 'Default height (cm)', kind: 'decimal', min: 0, group: 'Dimensions' }
    ],
    filters: [{ key: 'documentType', label: 'Documents only', kind: 'boolean' }],
    exportColumns: ['code', 'name', 'documentType', 'fragileByDefault', 'maxWeightKg', 'status']
  },

  'service-types': {
    key: 'service-types', apiPath: '/master/service-types', singular: 'Service type', plural: 'Service Types',
    icon: 'bolt', group: 'Operations', seeded: true,
    description: 'The service levels sold, and the transit each one promises.',
    columns: [
      CODE_COLUMN, NAME_COLUMN,
      { key: 'deliveryDays', header: 'Days', align: 'right', width: '80px',
        value: (r) => (r['deliveryDays'] === 0 ? 'Same day' : text(r['deliveryDays'])) },
      { key: 'express', header: 'Express', kind: 'boolean', width: '100px', value: (r) => yesNo(r['express']) },
      { key: 'cutoffTime', header: 'Cut-off', width: '100px', value: (r) => text(r['cutoffTime']) },
      { key: 'priority', header: 'Priority', align: 'right', width: '100px', value: (r) => text(r['priority']) },
      { key: 'volumetricDivisor', header: 'Vol. divisor', align: 'right', width: '120px',
        value: (r) => text(r['volumetricDivisor'] ?? 5000) },
      { key: 'network', header: 'Network', width: '100px', value: (r) => r['network'] === 'AIR' ? 'Air' : 'Surface' },
      STATUS_COLUMN
    ],
    fields: [
      ...HEAD_FIELDS,
      { key: 'deliveryDays', label: 'Delivery days', kind: 'number', min: 0, group: 'Promise',
        hint: 'Zero means same day.' },
      { key: 'express', label: 'Express service', kind: 'boolean', group: 'Promise' },
      { key: 'cutoffTime', label: 'Booking cut-off', kind: 'time', group: 'Promise',
        hint: 'The last booking time that still makes today’s promise.' },
      { key: 'priority', label: 'Priority', kind: 'number', min: 0, group: 'Promise',
        hint: 'Higher wins when more than one service can carry a shipment.' },
      { key: 'volumetricDivisor', label: 'Volumetric divisor', kind: 'number', min: 1, group: 'Weight',
        hint: 'Volumetric weight = L×W×H (cm) ÷ this. Air is usually 5000, Surface 4000. Empty uses 5000.' },
      { key: 'network', label: 'Network', kind: 'select', group: 'Weight',
        options: [{ value: 'SURFACE', label: 'Surface' }, { value: 'AIR', label: 'Air' }],
        hint: 'Which pincode coverage parcels on this service are checked against. Documents always use Document coverage. Empty is Surface.' }
    ],
    filters: [{ key: 'express', label: 'Express only', kind: 'boolean' }],
    exportColumns: ['code', 'name', 'deliveryDays', 'express', 'cutoffTime', 'priority', 'volumetricDivisor', 'network', 'status']
  },

  'payment-modes': {
    key: 'payment-modes', apiPath: '/master/payment-modes', singular: 'Payment mode', plural: 'Payment Modes',
    icon: 'payments', group: 'Operations', seeded: true,
    description: 'How a shipment is paid for. The flags, not the code, are what booking branches on.',
    columns: [
      CODE_COLUMN, NAME_COLUMN,
      { key: 'collectAtBooking', header: 'At booking', kind: 'boolean', width: '110px', value: (r) => yesNo(r['collectAtBooking']) },
      { key: 'collectAtDelivery', header: 'At delivery', kind: 'boolean', width: '110px', value: (r) => yesNo(r['collectAtDelivery']) },
      { key: 'requiresCreditAccount', header: 'Billed', kind: 'boolean', width: '90px', value: (r) => yesNo(r['requiresCreditAccount']) },
      { key: 'cashOnDelivery', header: 'COD', kind: 'boolean', width: '80px', value: (r) => yesNo(r['cashOnDelivery']) },
      STATUS_COLUMN
    ],
    fields: [
      ...HEAD_FIELDS,
      { key: 'collectAtBooking', label: 'Collect at booking', kind: 'boolean', group: 'Behaviour' },
      { key: 'collectAtDelivery', label: 'Collect at delivery', kind: 'boolean', group: 'Behaviour' },
      { key: 'requiresCreditAccount', label: 'Billed to a credit account', kind: 'boolean', group: 'Behaviour',
        hint: 'A billed mode settles on an invoice, so it cannot also take cash.' },
      { key: 'cashOnDelivery', label: 'Cash on delivery', kind: 'boolean', group: 'Behaviour',
        hint: 'Collects the consignee’s amount on behalf of the shipper. Must collect at delivery.' }
    ],
    filters: [{ key: 'cashOnDelivery', label: 'Cash on delivery only', kind: 'boolean' }],
    exportColumns: ['code', 'name', 'collectAtBooking', 'collectAtDelivery', 'requiresCreditAccount', 'cashOnDelivery', 'status']
  },

  'weight-slabs': {
    key: 'weight-slabs', apiPath: '/master/weight-slabs', singular: 'Weight slab', plural: 'Weight Slabs',
    icon: 'scale', group: 'Operations', seeded: true,
    description: 'The bands the rate master prices against. Each is [min, max) — they may touch, never overlap.',
    columns: [
      CODE_COLUMN, NAME_COLUMN,
      { key: 'minWeight', header: 'From', align: 'right', width: '110px', value: (r) => text(r['minWeight']) },
      { key: 'maxWeight', header: 'Below', align: 'right', width: '110px', value: (r) => text(r['maxWeight']) },
      { key: 'weightUnit', header: 'Unit', width: '90px', value: (r) => text(r['weightUnit']) },
      STATUS_COLUMN
    ],
    fields: [
      ...HEAD_FIELDS,
      { key: 'minWeight', label: 'From (inclusive)', kind: 'decimal', required: true, min: 0, group: 'Band' },
      { key: 'maxWeight', label: 'Below (exclusive)', kind: 'decimal', required: true, min: 0, group: 'Band',
        hint: 'A parcel of exactly this weight falls in the next slab, not this one.' },
      { key: 'weightUnit', label: 'Unit', kind: 'select', group: 'Band',
        options: WEIGHT_UNITS.map(option) }
    ],
    filters: [{ key: 'weightUnit', label: 'Unit', kind: 'select', options: WEIGHT_UNITS.map(option) }],
    exportColumns: ['code', 'name', 'minWeight', 'maxWeight', 'weightUnit', 'status']
  },

  routes: {
    key: 'routes', apiPath: '/master/routes', singular: 'Route', plural: 'Routes',
    icon: 'route', group: 'Operations',
    description: 'Lanes between two branches. Direction matters: A to B and B to A are separate routes.',
    columns: [
      CODE_COLUMN, NAME_COLUMN,
      { key: 'bookingBranchName', header: 'From', value: (r) => text(r['bookingBranchName']) },
      { key: 'deliveryBranchName', header: 'To', value: (r) => text(r['deliveryBranchName']) },
      { key: 'distanceKm', header: 'Distance (km)', align: 'right', width: '140px', value: (r) => text(r['distanceKm']) },
      { key: 'transitDays', header: 'Transit', align: 'right', width: '110px',
        value: (r) => transitLabel(r['transitDays'] as number, r['transitHours'] as number) },
      STATUS_COLUMN
    ],
    fields: [
      ...HEAD_FIELDS,
      { key: 'bookingBranchId', label: 'Booking branch', kind: 'lookup', lookup: 'branches', required: true, group: 'Lane',
        hint: 'Must be an active branch of this company.' },
      { key: 'deliveryBranchId', label: 'Delivery branch', kind: 'lookup', lookup: 'branches', required: true, group: 'Lane',
        hint: 'Must differ from the booking branch.' },
      { key: 'distanceKm', label: 'Distance (km)', kind: 'decimal', min: 0, group: 'Lane' },
      { key: 'distanceUnit', label: 'Distance unit', kind: 'select', group: 'Lane',
        options: DISTANCE_UNITS.map(option) },
      { key: 'transitDays', label: 'Transit days', kind: 'number', min: 0, group: 'Lane',
        hint: 'Zero means same day.' },
      { key: 'transitHours', label: 'Transit hours', kind: 'number', min: 0, max: 23, group: 'Lane',
        hint: 'Remainder hours on top of transit days, 0-23.' },
      { key: 'via', label: 'Via', kind: 'text', maxLength: 255, placeholder: 'Lonavala', group: 'Lane' }
    ],
    filters: [
      { key: 'bookingBranchId', label: 'From branch', kind: 'lookup', lookup: 'branches' },
      { key: 'deliveryBranchId', label: 'To branch', kind: 'lookup', lookup: 'branches' }
    ],
    exportColumns: ['code', 'name', 'bookingBranchName', 'deliveryBranchName', 'distanceKm', 'distanceUnit', 'transitDays', 'transitHours', 'status']
  }
};

export const MASTER_KEYS = Object.keys(MASTER_DEFINITIONS) as MasterKey[];

export function findMaster(key: string | null | undefined): MasterDefinition | null {
  if (!key) return null;
  return MASTER_DEFINITIONS[key as MasterKey] ?? null;
}

/**
 * Who may do what.
 *
 * A company's own six catalogues are `COMPANY_ADMIN`'s alone, both to read and to write
 * — branch/booking roles no longer reach Masters at all (2026-07-31 decision). The
 * shared geography is read by both `SUPER_ADMIN` and `COMPANY_ADMIN`, but written only
 * by a platform operator — except Pincode, whose `writeRoles` override lets
 * `COMPANY_ADMIN` write it too (2026-08-01 decision): onboarding a company routinely
 * needs a pincode the platform catalogue does not have yet. Country/State/District/
 * City/Area have no such override and stay platform-only. The permission codes are the
 * real answer once the backend authorises on permissions; the roles are the interim
 * bridge, exactly as in every other feature.
 */
export const MASTER_READERS = [AppRole.COMPANY_ADMIN];
export const MASTER_WRITERS = [AppRole.COMPANY_ADMIN];

/** The shared geography is read by the platform and by the company that looks it up. */
export const GLOBAL_MASTER_READERS = [AppRole.SUPER_ADMIN, AppRole.COMPANY_ADMIN];
/** ...but written by a platform operator and by nobody else. */
export const GLOBAL_MASTER_WRITERS = [AppRole.SUPER_ADMIN];

export const MASTER_PERMISSIONS = {
  view: ['MASTER_DATA_READ'],
  create: ['MASTER_DATA_CREATE'],
  update: ['MASTER_DATA_UPDATE'],
  delete: ['MASTER_DATA_DELETE'],
  activate: ['MASTER_DATA_ACTIVATE', 'MASTER_DATA_DEACTIVATE']
};

export const GLOBAL_MASTER_PERMISSIONS = {
  // Read is role-gated only: COMPANY_ADMIN never holds GLOBAL_MASTER_READ (a platform-only
  // module), and the backend's geography reads are `isAuthenticated()` anyway.
  view: [] as string[],
  create: ['GLOBAL_MASTER_CREATE'],
  update: ['GLOBAL_MASTER_UPDATE'],
  delete: ['GLOBAL_MASTER_DELETE'],
  activate: ['GLOBAL_MASTER_ACTIVATE', 'GLOBAL_MASTER_DEACTIVATE']
};

/**
 * The writer roles and permission codes for one list. Reading the definition rather than
 * hard-coding either means a list that flips tier changes in one place — the same reason
 * `apiPath` lives there and not in the screens.
 */
export function writeAccessFor(def: MasterDefinition): {
  roles: AppRole[];
  permissions: typeof MASTER_PERMISSIONS;
} {
  if (def.global) {
    return { roles: def.writeRoles ?? GLOBAL_MASTER_WRITERS, permissions: GLOBAL_MASTER_PERMISSIONS };
  }
  return { roles: MASTER_WRITERS, permissions: MASTER_PERMISSIONS };
}

/** The reader roles and permission codes for one list — same per-definition split as
 * {@link writeAccessFor}, since the shared `masters/:master` route cannot itself tell
 * a geography list from a company catalogue. */
export function readAccessFor(def: MasterDefinition): {
  roles: AppRole[];
  permissions: typeof MASTER_PERMISSIONS;
} {
  return def.global
    ? { roles: GLOBAL_MASTER_READERS, permissions: GLOBAL_MASTER_PERMISSIONS }
    : { roles: MASTER_READERS, permissions: MASTER_PERMISSIONS };
}
