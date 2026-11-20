import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ItemEntryGrid, ItemRow } from './item-entry-grid';

interface Internals {
  patch(index: number, changes: Partial<ItemRow>): void;
  add(): void;
}

/**
 * The client-side preview mirror of the Pricing Engine's own
 * VolumetricCalculator/ChargeableWeightCalculator: volumetric = l*w*h/5000 per item
 * (multiplied by quantity), chargeable = max(actual, volumetric). The figures that
 * actually book still come from the server — this only checks the wizard shows the
 * right preview before that round-trip.
 */
describe('ItemEntryGrid — weight preview', () => {
  let fixture: ComponentFixture<ItemEntryGrid>;
  let internals: Internals;
  let weight: { actual: number; volumetric: number; chargeable: number };
  let items: unknown[];

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ItemEntryGrid] });
    fixture = TestBed.createComponent(ItemEntryGrid);
    internals = fixture.componentInstance as unknown as Internals;
    // Subscribed before the first change detection so the initial emission (a blank
    // row) is captured too — `output()` does not replay past values to late subscribers.
    fixture.componentInstance.weightChange.subscribe((w) => (weight = w));
    fixture.componentInstance.itemsChange.subscribe((i) => (items = i));
    fixture.detectChanges();
  });

  it('an untouched starting row has no weight yet and is not booked until one is typed', () => {
    // Nothing is pre-filled: the desk types the real weight. itemName still defaults to
    // 'Package', so typing just a weight makes the row a real item.
    expect(weight).toEqual({ actual: 0, volumetric: 0, chargeable: 0 });
    expect(items).toEqual([]);
    internals.patch(0, { weight: 2 });
    fixture.detectChanges();
    expect(items).toEqual([{
      itemName: 'Package', quantity: 1, weight: 2,
      lengthCm: null, widthCm: null, heightCm: null,
      declaredValue: null, fragile: false, dangerousGoods: false
    }]);
  });

  it('actual weight sums each row\'s own weight as-is, never multiplied by quantity', () => {
    internals.patch(0, { itemName: 'Box', quantity: 2, weight: 3 });
    fixture.detectChanges();

    expect(weight.actual).toBeCloseTo(3, 3);
  });

  it('volumetric weight is l×w×h/5000, and chargeable picks whichever is larger', () => {
    // 40×30×20 / 5000 = 4.8kg volumetric, above a 2kg actual weight.
    internals.patch(0, { itemName: 'Box', quantity: 1, weight: 2, lengthCm: 40, widthCm: 30, heightCm: 20 });
    fixture.detectChanges();

    expect(weight.actual).toBeCloseTo(2, 3);
    expect(weight.volumetric).toBeCloseTo(4.8, 3);
    expect(weight.chargeable).toBeCloseTo(4.8, 3);
  });

  it('a row missing any one dimension contributes no volumetric weight, same as a single parcel', () => {
    internals.patch(0, { itemName: 'Box', quantity: 1, weight: 5, lengthCm: 40, widthCm: 30, heightCm: null });
    fixture.detectChanges();

    expect(weight.volumetric).toBe(0);
    expect(weight.chargeable).toBeCloseTo(5, 3);
  });

  it('a row explicitly cleared to a blank name is dropped from the emitted item list', () => {
    // A freshly added row is NOT blank by default (see the test above) — this covers a
    // user deliberately clearing a row's name, e.g. mid-edit before typing a new one.
    internals.patch(0, { itemName: 'Box', quantity: 1, weight: 2 });
    internals.add();
    internals.patch(1, { itemName: '' });
    fixture.detectChanges();

    expect(items.length).toBe(1);
  });

  it('a row with weight cleared to null is dropped from the emitted item list', () => {
    internals.patch(0, { itemName: 'Box', quantity: 1, weight: 2 });
    internals.add();
    internals.patch(1, { weight: null });
    fixture.detectChanges();

    expect(items.length).toBe(1);
  });

  it('starts with no weight pre-filled, so nothing is assumed', () => {
    const f = TestBed.createComponent(ItemEntryGrid);
    let emitted: unknown[] | null = null;
    f.componentInstance.itemsChange.subscribe((i) => (emitted = i));
    f.detectChanges();

    expect(emitted).toEqual([]); // a row without a weight is not a package yet
  });

  it('charges the higher of actual and volumetric weight, with no minimum', () => {
    let w: { actual: number; volumetric: number; chargeable: number } | null = null;
    fixture.componentInstance.weightChange.subscribe((x) => (w = x));
    internals.patch(0, { weight: 0.5 });
    fixture.detectChanges();
    expect(w).toEqual({ actual: 0.5, volumetric: 0, chargeable: 0.5 });

    internals.patch(0, { lengthCm: 30, widthCm: 20, heightCm: 15 }); // 9000 / 5000 = 1.8 kg
    fixture.detectChanges();
    expect(w).toEqual({ actual: 0.5, volumetric: 1.8, chargeable: 1.8 });
  });
});
