import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it } from 'vitest';
import { MasterRecord } from '@core/models/master.model';
import { MasterForm } from './master-form';
import { MASTER_DEFINITIONS } from '../master.config';

const countries = MASTER_DEFINITIONS.countries;
const weightSlabs = MASTER_DEFINITIONS['weight-slabs'];
const cities = MASTER_DEFINITIONS.cities;

const pagePayload = (content: unknown[]) => ({
  success: true,
  data: { content, page: 0, size: 200, totalElements: content.length, totalPages: 1, first: true, last: true, hasNext: false }
});

const record = (over: Partial<MasterRecord> = {}): MasterRecord => ({
  id: 'id-1', companyId: 't-1', code: 'INDIA', name: 'India', description: 'Domestic',
  status: 'ACTIVE', displayOrder: 10, createdBy: null, createdDate: null,
  updatedBy: null, updatedDate: null, version: 7,
  isoCode2: 'IN', isoCode3: 'IND', dialCode: '+91', currencyCode: 'INR', ...over
});

describe('MasterForm', () => {
  let fixture: ComponentFixture<MasterForm>;
  let component: MasterForm;
  let http: HttpTestingController;

  const build = (def = countries, existing: MasterRecord | null = null) => {
    fixture = TestBed.createComponent(MasterForm);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('def', def);
    fixture.componentRef.setInput('record', existing);
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MasterForm],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()]
    });
    http = TestBed.inject(HttpTestingController);
  });

  it('builds a control for every declared field', () => {
    build();
    for (const field of countries.fields) {
      expect(component.form.get(field.key), field.key).toBeTruthy();
    }
  });

  it('mirrors the DTO’s validators, so a bad code is caught before the round trip', () => {
    build();
    const code = component.controlFor('code');

    code.setValue('');
    expect(code.hasError('required')).toBe(true);

    code.setValue('!!');
    expect(code.hasError('pattern')).toBe(true);

    code.setValue('INDIA');
    expect(code.valid).toBe(true);
  });

  it('refuses to emit while the form is invalid, and marks the fields so errors show', () => {
    build();
    let emitted = false;
    component.saved.subscribe(() => (emitted = true));

    component.submit();

    expect(emitted).toBe(false);
    expect(component.controlFor('name').touched).toBe(true);
  });

  it('emits a create payload with no version', () => {
    build();
    component.controlFor('code').setValue('nepal');
    component.controlFor('name').setValue('Nepal');

    let payload: Record<string, unknown> | undefined;
    component.saved.subscribe((p) => (payload = p));
    component.submit();

    expect(payload).toBeDefined();
    expect(payload!['code']).toBe('nepal');
    expect(payload!['version']).toBeUndefined();
  });

  it('disables the code in edit mode rather than hiding it', () => {
    // Hiding it would leave the user wondering where it went; greyed out says "permanent",
    // which is the actual rule.
    build(countries, record());

    expect(component.controlFor('code').disabled).toBe(true);
    expect(component.controlFor('name').disabled).toBe(false);
  });

  it('omits the code from an edit payload and carries the version', () => {
    build(countries, record({ version: 7 }));
    component.controlFor('name').setValue('Republic of India');

    let payload: Record<string, unknown> | undefined;
    component.saved.subscribe((p) => (payload = p));
    component.submit();

    expect(payload!['code']).toBeUndefined();
    expect(payload!['name']).toBe('Republic of India');
    expect(payload!['version']).toBe(7);
  });

  it('sends null for an emptied optional field, not an empty string', () => {
    // So "cleared" and "never set" are the same value in the database.
    build(countries, record({ dialCode: '+91' }));
    component.controlFor('dialCode').setValue('');

    let payload: Record<string, unknown> | undefined;
    component.saved.subscribe((p) => (payload = p));
    component.submit();

    expect(payload!['dialCode']).toBeNull();
  });

  it('starts a pincode’s availability toggles on, and always sends real booleans', () => {
    // A toggle has no "unset" state to show. Starting them off would mean every pincode
    // created through the UI arrives unserviceable — the opposite of why it was added.
    build(MASTER_DEFINITIONS.pincodes);
    component.controlFor('code').setValue('411038');
    component.controlFor('name').setValue('Kothrud H.O.');
    component.controlFor('areaId').setValue('area-1');

    let payload: Record<string, unknown> | undefined;
    component.saved.subscribe((p) => (payload = p));
    component.submit();

    expect(payload!['serviceable']).toBe(true);
    expect(payload!['codAvailable']).toBe(true);
    expect(typeof payload!['pickupAvailable']).toBe('boolean');

    // The area picker was requested when the form opened.
    http.match((r) => r.url.includes('/master/areas')).forEach((r) =>
      r.flush({ success: true, data: { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0, first: true, last: true, hasNext: false } })
    );
  });

  it('groups fields the way the definition declares them', () => {
    build(weightSlabs);
    const groups = component.groups().map((g) => g.name);

    expect(groups).toEqual(['Identity', 'Band']);
    expect(component.groups()[1].fields.map((f) => f.key))
      .toEqual(['minWeight', 'maxWeight', 'weightUnit']);
  });

  it('requires both ends of a weight band', () => {
    build(weightSlabs);
    expect(component.controlFor('minWeight').hasError('required')).toBe(true);
    expect(component.controlFor('maxWeight').hasError('required')).toBe(true);
  });

  describe('City create form: Country/State/District cascade', () => {
    it('defaults Country to India, cascades scoped State/District fetches, and defaults State to Maharashtra', () => {
      build(cities);

      // District starts disabled: it depends on State, which has no value yet.
      expect(component.controlFor('districtId').disabled).toBe(true);

      http.expectOne((r) => r.url.includes('/global-masters/countries')).flush(pagePayload([
        { id: 'c-other', code: 'US', name: 'United States' },
        { id: 'c-india', code: 'IN', name: 'India' }
      ]));

      // The India default selects itself, which enables and scopes the State fetch.
      expect(component.controlFor('countryId').value).toBe('c-india');
      const stateReq = http.expectOne((r) => r.url.includes('/global-masters/states'));
      expect(stateReq.request.params.get('countryId')).toBe('c-india');
      expect(component.controlFor('stateId').disabled).toBe(false);

      stateReq.flush(pagePayload([
        { id: 's-other', code: 'KA', name: 'Karnataka' },
        { id: 's-mh', code: 'MH', name: 'Maharashtra' }
      ]));

      // The Maharashtra default selects itself, which enables and scopes the District fetch.
      expect(component.controlFor('stateId').value).toBe('s-mh');
      const districtReq = http.expectOne((r) => r.url.includes('/global-masters/districts'));
      expect(districtReq.request.params.get('stateId')).toBe('s-mh');
      expect(component.controlFor('districtId').disabled).toBe(false);

      districtReq.flush(pagePayload([{ id: 'd-pune', code: 'PUNE', name: 'Pune' }]));
      expect(component.optionsFor(component.def().fields.find((f) => f.key === 'districtId')!))
        .toEqual([{ value: 'd-pune', label: 'Pune (PUNE)' }]);
    });

    it('excludes the transient Country/State fields from the create payload', () => {
      build(cities);
      http.expectOne((r) => r.url.includes('/global-masters/countries'))
        .flush(pagePayload([{ id: 'c-india', code: 'IN', name: 'India' }]));
      http.expectOne((r) => r.url.includes('/global-masters/states'))
        .flush(pagePayload([{ id: 's-mh', code: 'MH', name: 'Maharashtra' }]));
      http.expectOne((r) => r.url.includes('/global-masters/districts'))
        .flush(pagePayload([{ id: 'd-pune', code: 'PUNE', name: 'Pune' }]));

      component.controlFor('code').setValue('pune');
      component.controlFor('name').setValue('Pune');
      component.controlFor('districtId').setValue('d-pune');

      let payload: Record<string, unknown> | undefined;
      component.saved.subscribe((p) => (payload = p));
      component.submit();

      expect(payload).toBeDefined();
      expect(payload!['districtId']).toBe('d-pune');
      expect('countryId' in payload!).toBe(false);
      expect('stateId' in payload!).toBe(false);
    });
  });

  it('reads and writes a nested tri-state coverage field one level down', () => {
    const def = {
      ...countries,
      fields: [
        ...countries.fields,
        { key: 'airServiceable', label: 'Delivers here', kind: 'select' as const, triState: true,
          options: [{ value: '', label: 'Not set' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }],
          nested: { parent: 'air', prop: 'serviceable' } },
        { key: 'airTatHours', label: 'Hours', kind: 'number' as const, nested: { parent: 'air', prop: 'tatHours' } },
        { key: 'docOda', label: 'ODA', kind: 'select' as const, triState: true,
          options: [{ value: '', label: 'Not set' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }],
          nested: { parent: 'doc', prop: 'oda' } }
      ]
    };
    build(def, record({ air: { serviceable: false, oda: null, tatHours: 48 }, doc: null }));
    expect(component.controlFor('airServiceable').value).toBe('false');
    expect(component.controlFor('airTatHours').value).toBe(48);
    expect(component.controlFor('docOda').value).toBe('');

    let payload: Record<string, unknown> | undefined;
    component.saved.subscribe((p) => (payload = p));
    component.controlFor('airServiceable').setValue('true');
    component.submit();

    expect(payload!['air']).toEqual({ serviceable: true, tatHours: 48 });
    expect(payload!['doc']).toEqual({ oda: null });
    expect(payload!['airServiceable']).toBeUndefined();
  });
});
