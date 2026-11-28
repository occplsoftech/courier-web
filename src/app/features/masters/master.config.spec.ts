import { describe, expect, it } from 'vitest';
import { AppRole } from '@core/models/role.model';
import {
  MASTER_DEFINITIONS, MASTER_KEYS, MasterKey, findMaster, readAccessFor, writeAccessFor
} from './master.config';

/**
 * The definitions are data, and data that twelve screens are generated from has to be
 * self-consistent — a typo here is twelve broken pages, not one.
 *
 * These are the invariants worth asserting rather than reviewing by eye each time
 * someone adds a field.
 */
describe('master definitions', () => {
  it('keys the registry by the definition’s own key', () => {
    // The route parameter is looked up in this map and then trusted as the definition, so
    // a mismatch would route to one list and call another's endpoint.
    for (const key of MASTER_KEYS) {
      expect(MASTER_DEFINITIONS[key].key).toBe(key);
    }
  });

  it('derives every API path from the route segment, on whichever tier the list is on', () => {
    // Same word on both sides means a URL and an endpoint cannot drift apart. The prefix
    // differs because the geography lists are global (V12): one catalogue shared by every
    // company, written only by a SUPER_ADMIN.
    for (const key of MASTER_KEYS) {
      const def = MASTER_DEFINITIONS[key];
      expect(def.apiPath).toBe(`${def.global ? '/global-masters' : '/master'}/${key}`);
    }
  });

  it('marks exactly the six geography lists and regional zones as global', () => {
    // A list that quietly flips tier changes who may write it for every company at once,
    // so the set is asserted rather than left to whoever edits the file next.
    const global = MASTER_KEYS.filter((key) => MASTER_DEFINITIONS[key].global);
    expect(global.sort()).toEqual(
      ['areas', 'cities', 'countries', 'districts', 'pincodes', 'regional-zones', 'states']
    );
  });

  it('covers all thirteen master lists', () => {
    expect(MASTER_KEYS).toHaveLength(13);
    expect(MASTER_KEYS).toEqual(
      expect.arrayContaining([
        'countries', 'states', 'districts', 'cities', 'areas', 'pincodes', 'regional-zones',
        'vehicle-types', 'package-types', 'service-types', 'payment-modes',
        'weight-slabs', 'routes'
      ])
    );
  });

  it('gives every list the shared head: a code, a name and a status column', () => {
    for (const key of MASTER_KEYS) {
      const columns = MASTER_DEFINITIONS[key].columns.map((c) => c.key);
      expect(columns, key).toContain('code');
      expect(columns, key).toContain('name');
      expect(columns, key).toContain('status');
    }
  });

  it('makes the code create-only everywhere', () => {
    // It is immutable in the backend because operational records quote it; a form that
    // let someone edit it would collect a change the API silently ignores.
    for (const key of MASTER_KEYS) {
      const code = MASTER_DEFINITIONS[key].fields.find((f) => f.key === 'code');
      expect(code, key).toBeDefined();
      expect(code!.createOnly, key).toBe(true);
      expect(code!.required, key).toBe(true);
    }
  });

  it('points every lookup field at a real source', () => {
    const sources = new Set<string>([...MASTER_KEYS, 'branches']);
    for (const key of MASTER_KEYS) {
      const def = MASTER_DEFINITIONS[key];
      for (const field of [...def.fields, ...(def.filters ?? [])]) {
        if (field.kind !== 'lookup') continue;
        expect(field.lookup, `${key}.${field.key}`).toBeDefined();
        expect(sources.has(field.lookup as string), `${key}.${field.key}`).toBe(true);
      }
    }
  });

  it('names the parent field consistently so the detail view can resolve its name', () => {
    // MasterView derives `countryName` from `countryId`. If a parent field were ever named
    // something else, the detail page would silently show a dash.
    for (const key of MASTER_KEYS) {
      const parent = MASTER_DEFINITIONS[key].parent;
      if (!parent) continue;
      expect(parent.field.endsWith('Id'), key).toBe(true);
      expect(parent.nameField, key).toBe(parent.field.replace(/Id$/, 'Name'));
    }
  });

  it('gives the geography hierarchy exactly one parent each, in order', () => {
    const chain: [MasterKey, MasterKey | undefined][] = [
      ['countries', undefined],
      ['states', 'countries'],
      ['districts', 'states'],
      ['cities', 'districts'],
      ['areas', 'cities'],
      ['pincodes', 'areas']
    ];
    for (const [key, parent] of chain) {
      expect(MASTER_DEFINITIONS[key].parent?.master, key).toBe(parent);
    }
  });

  it('exports only columns the row actually carries', () => {
    // A CSV header with no data under it is worse than a missing column.
    for (const key of MASTER_KEYS) {
      const def = MASTER_DEFINITIONS[key];
      const known = new Set([
        ...def.columns.map((c) => c.key),
        ...def.fields.map((f) => f.key),
        ...(def.parent ? [def.parent.nameField] : [])
      ]);
      for (const column of def.exportColumns) {
        expect(known.has(column), `${key}: ${column}`).toBe(true);
      }
    }
  });

  it('marks exactly the five catalogues the bootstrap endpoint seeds', () => {
    const seeded = MASTER_KEYS.filter((k) => MASTER_DEFINITIONS[k].seeded);
    expect(seeded.sort()).toEqual(
      ['package-types', 'payment-modes', 'service-types', 'vehicle-types', 'weight-slabs']
    );
  });

  it('resolves a known key and refuses an unknown one', () => {
    expect(findMaster('countries')?.singular).toBe('Country');
    expect(findMaster('not-a-master')).toBeNull();
    expect(findMaster(null)).toBeNull();
  });

  it('constrains the pincode code to digits, unlike every other list', () => {
    const pincode = MASTER_DEFINITIONS.pincodes.fields.find((f) => f.key === 'code');
    expect(pincode!.pattern).toBe('^[0-9]{4,10}$');

    const country = MASTER_DEFINITIONS.countries.fields.find((f) => f.key === 'code');
    expect(country!.pattern).not.toBe(pincode!.pattern);
  });

  it('edits a pincode\'s Premium, Air cargo and Surface cargo coverage like Document / Surface / Air', () => {
    const fields = MASTER_DEFINITIONS.pincodes.fields;
    for (const parent of ['premium', 'airCargo', 'surfaceCargo']) {
      expect(fields.filter((f) => f.nested?.parent === parent).map((f) => f.nested!.prop)).toEqual(['serviceable', 'oda', 'tatHours']);
    }
    expect(MASTER_DEFINITIONS.pincodes.columns.some((c) => c.key === 'premium')).toBe(true);
  });

  it('reads geography as SUPER_ADMIN + COMPANY_ADMIN, writes it as SUPER_ADMIN only', () => {
    for (const key of ['countries', 'states', 'districts', 'cities', 'areas', 'pincodes'] as MasterKey[]) {
      const def = MASTER_DEFINITIONS[key];
      expect(readAccessFor(def).roles, key).toEqual([AppRole.SUPER_ADMIN, AppRole.COMPANY_ADMIN]);
    }
    for (const key of ['countries', 'states', 'districts', 'cities', 'areas'] as MasterKey[]) {
      expect(writeAccessFor(MASTER_DEFINITIONS[key]).roles, key).toEqual([AppRole.SUPER_ADMIN]);
    }
  });

  it('pincodes overrides write access to also let COMPANY_ADMIN write (2026-08-01)', () => {
    expect(writeAccessFor(MASTER_DEFINITIONS.pincodes).roles)
      .toEqual([AppRole.SUPER_ADMIN, AppRole.COMPANY_ADMIN]);
  });

  it('reads and writes a company\'s own six catalogues as COMPANY_ADMIN only', () => {
    for (const key of ['vehicle-types', 'package-types', 'service-types', 'payment-modes', 'weight-slabs', 'routes'] as MasterKey[]) {
      const def = MASTER_DEFINITIONS[key];
      expect(readAccessFor(def).roles, key).toEqual([AppRole.COMPANY_ADMIN]);
      expect(writeAccessFor(def).roles, key).toEqual([AppRole.COMPANY_ADMIN]);
    }
  });
});
