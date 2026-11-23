/** FOV (risk cover): 0.2% of the value, never less than ₹100. Mirrors `ShipmentServiceImpl.fov` on the server. */
export const FOV_PERCENT = 0.2;
export const FOV_MINIMUM = 100;

export function fovCharge(value: number | null | undefined): number {
  return Math.max(Math.round((Number(value) || 0) * FOV_PERCENT) / 100, FOV_MINIMUM);
}
