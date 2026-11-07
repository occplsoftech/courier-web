import { describe, expect, it } from 'vitest';
import { RateSlab } from '@core/models/pricing-zone.model';
import { previewFreight } from './customer-rate-edit';

const slabs: RateSlab[] = [
  { minWeight: 0, maxWeight: 5, ratePerKg: 40 },
  { minWeight: 5, maxWeight: 10, ratePerKg: 30 },
  { minWeight: 10, maxWeight: null, ratePerKg: 20 }
];

describe('previewFreight (same rules as the backend)', () => {
  it('whole weight: the slab the weight falls in prices every kg', () => {
    expect(previewFreight(slabs, 7, 'WHOLE', 0, 0)!.freight).toBe(210);
    expect(previewFreight(slabs, 5, 'WHOLE', 0, 0)!.freight).toBe(200);
  });

  it('tiered: each slab prices its own kilos', () => {
    const seven = previewFreight(slabs, 7, 'TIERED', 0, 0)!;
    expect(seven.freight).toBe(260);
    expect(seven.parts).toEqual(['5 kg × ₹40', '2 kg × ₹30']);
    expect(previewFreight(slabs, 12, 'TIERED', 0, 0)!.freight).toBe(390);
    expect(previewFreight(slabs, 0.5, 'TIERED', 0, 0)!.freight).toBe(20);
  });

  it('tiered with a fixed first slab adds its flat price once', () => {
    const fixed: RateSlab[] = [{ minWeight: 0, maxWeight: 10, ratePerKg: 100, fixedRate: true }, { minWeight: 10, maxWeight: null, ratePerKg: 9 }];
    expect(previewFreight(fixed, 3, 'TIERED', 0, 0)!.freight).toBe(100);
    expect(previewFreight(fixed, 12, 'TIERED', 0, 0)!.freight).toBe(118);
  });

  it('minimum freight lifts a light parcel, and the min chargeable weight is used first', () => {
    const light = previewFreight(slabs, 0.5, 'WHOLE', 60, 0)!;
    expect(light.freight).toBe(60);
    expect(light.minApplied).toBe(true);
    expect(previewFreight(slabs, 3, 'WHOLE', 60, 0)!.minApplied).toBe(false);
    expect(previewFreight(slabs, 1, 'WHOLE', 0, 7)!.freight).toBe(210);
  });

  it('a weight no slab covers has no preview', () => {
    expect(previewFreight([{ minWeight: 0, maxWeight: 5, ratePerKg: 40 }], 8, 'WHOLE', 0, 0)).toBeNull();
  });
});
