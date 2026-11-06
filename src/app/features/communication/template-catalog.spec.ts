import { describe, expect, it } from 'vitest';
import { ALL_EVENTS, TemplateKey, channelLabel, channelsFor, eventLabel, eventNote, freeChannels, freeEvents } from './template-catalog';

/** A company seeded with the 18 stock templates plus the WhatsApp daily summary. */
const SEEDED: TemplateKey[] = [
  ...(['SHIPMENT_BOOKED', 'SHIPMENT_PICKED_UP', 'SHIPMENT_DISPATCHED', 'OUT_FOR_DELIVERY', 'SHIPMENT_DELIVERED', 'DELIVERY_FAILED'] as const).flatMap((eventType) =>
    (['WHATSAPP', 'SMS', 'EMAIL'] as const).map((channel) => ({ eventType, channel }))),
  { eventType: 'DAILY_BUSINESS_SUMMARY', channel: 'WHATSAPP' }
];

describe('template catalog', () => {
  it('lists all eleven events', () => {
    expect(ALL_EVENTS).toHaveLength(11);
  });

  it('the daily summary exists on WhatsApp only, every other event on all three channels', () => {
    expect(channelsFor('DAILY_BUSINESS_SUMMARY')).toEqual(['WHATSAPP']);
    expect(channelsFor('SHIPMENT_CANCELLED')).toEqual(['WHATSAPP', 'SMS', 'EMAIL']);
  });

  it('a fresh seeded company can still create the four unseeded events on every channel', () => {
    expect(freeEvents(SEEDED)).toEqual(['SHIPMENT_RECEIVED', 'SHIPMENT_CANCELLED', 'RTO_INITIATED', 'RTO_DELIVERED']);
    expect(freeChannels('SHIPMENT_CANCELLED', SEEDED)).toEqual(['WHATSAPP', 'SMS', 'EMAIL']);
  });

  it('a seeded event has nothing left to create', () => {
    expect(freeChannels('SHIPMENT_BOOKED', SEEDED)).toEqual([]);
    expect(freeChannels('DAILY_BUSINESS_SUMMARY', SEEDED)).toEqual([]);
  });

  it('removes only the channels already taken for that event', () => {
    const existing: TemplateKey[] = [...SEEDED, { eventType: 'SHIPMENT_CANCELLED', channel: 'SMS' }];
    expect(freeChannels('SHIPMENT_CANCELLED', existing)).toEqual(['WHATSAPP', 'EMAIL']);
    expect(freeChannels('SHIPMENT_RECEIVED', existing)).toEqual(['WHATSAPP', 'SMS', 'EMAIL']);
  });

  it('reports nothing free once every combination exists', () => {
    const all: TemplateKey[] = ALL_EVENTS.flatMap((eventType) => channelsFor(eventType).map((channel) => ({ eventType, channel })));
    expect(freeEvents(all)).toEqual([]);
  });

  it('warns about events that cannot fire yet', () => {
    expect(eventNote('RTO_INITIATED')).toContain('return-to-origin');
    expect(eventNote('RTO_DELIVERED')).not.toBeNull();
    expect(eventNote('DAILY_BUSINESS_SUMMARY')).toContain('9:00 AM');
    expect(eventNote('SHIPMENT_CANCELLED')).toBeNull();
  });

  it('writes readable labels', () => {
    expect(eventLabel('OUT_FOR_DELIVERY')).toBe('Out For Delivery');
    expect(channelLabel('WHATSAPP')).toBe('WhatsApp');
    expect(channelLabel('SMS')).toBe('SMS');
    expect(channelLabel('EMAIL')).toBe('Email');
  });
});
