import { ChangeDetectionStrategy, Component, OnChanges, inject, input, signal } from '@angular/core';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { CommunicationLog } from '@core/models/communication.model';
import { CommunicationService } from '../communication.service';

const EVENT_ORDER = ['SHIPMENT_BOOKED', 'SHIPMENT_PICKED_UP', 'SHIPMENT_DISPATCHED', 'SHIPMENT_RECEIVED', 'OUT_FOR_DELIVERY',
  'SHIPMENT_DELIVERED', 'DELIVERY_FAILED', 'SHIPMENT_CANCELLED', 'RTO_INITIATED', 'RTO_DELIVERED'];
const CHANNELS = ['WHATSAPP', 'SMS', 'EMAIL'] as const;

function label(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface EventRow {
  eventType: string;
  channels: { channel: string; log: CommunicationLog | null }[];
}

/** Shipment Details' "Communication" tab: one row per event, a checkmark/cross per channel
 *  — "SHIPMENT_BOOKED ✓ WhatsApp Sent ✓ SMS Sent ✓ Email Sent", with failures shown clearly
 *  (the brief's own wording). Only events actually attempted (or in progress) render a row —
 *  nothing to show yet for a freshly-booked shipment awaiting its first dispatch. */
@Component({
  selector: 'app-shipment-communication-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard],
  template: `
    <app-card title="Communication" subtitle="WhatsApp/SMS/Email notifications sent for this shipment.">
      @if (loading()) {
        <p class="text-caption">Loading…</p>
      } @else if (rows().length === 0) {
        <p class="text-caption">No notifications sent yet.</p>
      } @else {
        <div class="sc">
          @for (row of rows(); track row.eventType) {
            <div class="sc__row">
              <span class="sc__event">{{ eventLabel(row.eventType) }}</span>
              <div class="sc__channels">
                @for (c of row.channels; track c.channel) {
                  @if (c.log) {
                    <span class="sc__chip" [class.ok]="isOk(c.log)" [class.bad]="isBad(c.log)"
                          [title]="c.log.errorMessage || ''">
                      {{ isOk(c.log) ? '✓' : (isBad(c.log) ? '✗' : '…') }} {{ channelLabel(c.channel) }} {{ statusLabel(c.log) }}
                    </span>
                  }
                }
              </div>
            </div>
          }
        </div>
      }
    </app-card>
  `,
  styles: [`
    .sc { display:flex; flex-direction:column; gap:10px; }
    .sc__row { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
    .sc__event { font:600 13px var(--font-sans); color:var(--content-fg); min-width:150px; }
    .sc__channels { display:flex; flex-wrap:wrap; gap:8px; }
    .sc__chip { font:500 12px var(--font-sans); padding:4px 10px; border-radius:999px; border:1px solid var(--surface-border); }
    .sc__chip.ok { color:var(--success); border-color:var(--success); }
    .sc__chip.bad { color:var(--danger); border-color:var(--danger); }
  `]
})
export class ShipmentCommunicationCard implements OnChanges {
  private readonly service = inject(CommunicationService);

  readonly shipmentId = input.required<string>();

  readonly loading = signal(true);
  readonly rows = signal<EventRow[]>([]);

  ngOnChanges(): void {
    if (!this.shipmentId()) return;
    this.loading.set(true);
    this.service.logsForShipment(this.shipmentId()).subscribe({
      next: (logs) => { this.rows.set(this.group(logs)); this.loading.set(false); },
      error: () => { this.rows.set([]); this.loading.set(false); }
    });
  }

  eventLabel(e: string): string { return label(e); }
  channelLabel(c: string): string { return label(c); }
  statusLabel(l: CommunicationLog): string { return label(l.status); }
  isOk(l: CommunicationLog): boolean { return l.status === 'SENT' || l.status === 'DELIVERED'; }
  isBad(l: CommunicationLog): boolean { return l.status === 'FAILED'; }

  private group(logs: CommunicationLog[]): EventRow[] {
    const byEvent = new Map<string, CommunicationLog[]>();
    for (const l of logs) {
      const list = byEvent.get(l.eventType) ?? [];
      list.push(l);
      byEvent.set(l.eventType, list);
    }
    return EVENT_ORDER.filter((e) => byEvent.has(e)).map((eventType) => ({
      eventType,
      channels: CHANNELS.map((channel) => ({
        channel,
        log: byEvent.get(eventType)!.find((l) => l.channel === channel) ?? null
      }))
    }));
  }
}
