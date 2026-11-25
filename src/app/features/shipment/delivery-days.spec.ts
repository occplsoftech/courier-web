import { describe, expect, it } from 'vitest';
import { daysFor } from './delivery-days';

describe('daysFor', () => {
  it('rounds the pincode delivery time up to whole days', () => {
    expect(daysFor(24, 5)).toBe(1);
    expect(daysFor(48, 5)).toBe(2);
    expect(daysFor(60, 5)).toBe(3);
  });

  it('falls back to the service type days without a delivery time', () => {
    expect(daysFor(null, 4)).toBe(4);
    expect(daysFor(undefined, null)).toBeNull();
    expect(daysFor(0, 3)).toBe(3);
  });
});
