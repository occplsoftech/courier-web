import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { ShipmentStatus } from '@core/models/shipment.model';

const TONE: Record<ShipmentStatus, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  BOOKED: 'info',
  READY_FOR_MANIFEST: 'info',
  MANIFEST_CREATED: 'info',
  DISPATCHED: 'warning',
  IN_SCAN: 'warning',
  OUT_FOR_DELIVERY: 'warning',
  DELIVERED: 'success',
  RETURNED: 'danger',
  CANCELLED: 'danger',
  FORWARDED: 'info'
};

/** Overrides the default word-split label — MANIFEST_CREATED doubles as "loading sheet
 *  created" (V20, on direct request: adding a shipment to a manifest already is the
 *  loading sheet milestone, no separate scan step). Every other status keeps its plain
 *  word-split label. */
const LABEL: Partial<Record<ShipmentStatus, string>> = {
  MANIFEST_CREATED: 'Loading Sheet Created',
  OUT_FOR_DELIVERY: 'DRS',
  FORWARDED: 'Forwarded to courier'
};

/** Shipment lifecycle pill — the full nine-state vocabulary. Shipment Booking only ever
 *  writes BOOKED/CANCELLED; Shipment Movement writes everything from MANIFEST_CREATED
 *  through DELIVERED (see ShipmentStatus.canTransitionTo on the backend). */
@Component({
  selector: 'app-shipment-status-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusBadge],
  template: `<app-status-badge [value]="status()" [label]="pretty()" [tone]="tone()" />`
})
export class ShipmentStatusBadge {
  readonly status = input.required<ShipmentStatus>();
  protected readonly tone = computed(() => TONE[this.status()]);
  protected pretty(): string {
    return LABEL[this.status()]
      ?? this.status().split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
  }
}
