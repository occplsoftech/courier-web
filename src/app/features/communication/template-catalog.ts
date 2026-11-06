import { CommunicationChannel, CommunicationEventType } from '@core/models/communication.model';

/**
 * Which (event, channel) templates a company can still create. There is exactly one template per
 * event + channel, so "new" only ever means a combination that does not exist yet — and the daily
 * business summary has no SMS or Email form at all. Pure, so it is tested without Angular.
 */

export const ALL_EVENTS: CommunicationEventType[] = [
  'SHIPMENT_BOOKED', 'SHIPMENT_PICKED_UP', 'SHIPMENT_DISPATCHED', 'SHIPMENT_RECEIVED', 'OUT_FOR_DELIVERY',
  'SHIPMENT_DELIVERED', 'DELIVERY_FAILED', 'SHIPMENT_CANCELLED', 'RTO_INITIATED', 'RTO_DELIVERED', 'DAILY_BUSINESS_SUMMARY'
];

export const ALL_CHANNELS: CommunicationChannel[] = ['WHATSAPP', 'SMS', 'EMAIL'];

export interface TemplateKey { eventType: CommunicationEventType; channel: CommunicationChannel; }

export function channelsFor(event: CommunicationEventType): CommunicationChannel[] {
  return event === 'DAILY_BUSINESS_SUMMARY' ? ['WHATSAPP'] : ALL_CHANNELS;
}

/** Channels on which this event has no template yet. */
export function freeChannels(event: CommunicationEventType, existing: TemplateKey[]): CommunicationChannel[] {
  const taken = new Set(existing.filter((t) => t.eventType === event).map((t) => t.channel));
  return channelsFor(event).filter((c) => !taken.has(c));
}

/** Events that still have at least one channel to create. */
export function freeEvents(existing: TemplateKey[]): CommunicationEventType[] {
  return ALL_EVENTS.filter((e) => freeChannels(e, existing).length > 0);
}

/** A warning worth showing before creating — null when the event fires normally. */
export function eventNote(event: CommunicationEventType): string | null {
  if (event === 'RTO_INITIATED' || event === 'RTO_DELIVERED') {
    return 'Nothing sends this yet: the app has no return-to-origin flow. You can prepare the template now, and it starts working when that flow exists.';
  }
  if (event === 'DAILY_BUSINESS_SUMMARY') {
    return 'This is the owner’s 9:00 AM summary. It goes to the numbers in Channel Settings → WhatsApp → Daily report numbers.';
  }
  return null;
}

export function eventLabel(event: string): string {
  return event.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function channelLabel(channel: string): string {
  return channel === 'WHATSAPP' ? 'WhatsApp' : channel === 'SMS' ? 'SMS' : 'Email';
}
