/**
 * Delivery days for a booking: the delivery pincode's own delivery time for the booking's service (the pincode master
 * keeps it in hours, per document / surface / air network), rounded up to whole days, when it has one; otherwise the
 * service type's promised days. The server's expected delivery date follows the same rule.
 */
export function daysFor(tatHours: number | null | undefined, serviceDays: number | null): number | null {
  return tatHours != null && tatHours > 0 ? Math.ceil(tatHours / 24) : serviceDays;
}
