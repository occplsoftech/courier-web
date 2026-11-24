/** FOV (risk cover): 0.2% of the value, never less than ₹100. Mirrors `ShipmentServiceImpl.fov` on the server. */
export const FOV_PERCENT = 0.2;
export const FOV_MINIMUM = 100;

export function fovCharge(value: number | null | undefined): number {
  return Math.max(Math.round((Number(value) || 0) * FOV_PERCENT) / 100, FOV_MINIMUM);
}

/** COD charge: 2% of the amount the rider collects, never less than ₹100. Mirrors `ShipmentServiceImpl.codCharge`. */
export const COD_PERCENT = 2;
export const COD_MINIMUM = 100;

export function codCharge(amount: number | null | undefined): number {
  const a = Number(amount) || 0;
  return a > 0 ? Math.max(Math.round(a * COD_PERCENT) / 100, COD_MINIMUM) : 0;
}

/** Whether a payment-mode option is Cash on Delivery ("Cash on Delivery (COD)"). */
export function isCodOption(label: string | null | undefined): boolean {
  return !!label && (/\(COD\)\s*$/i.test(label) || /cash on delivery/i.test(label));
}
