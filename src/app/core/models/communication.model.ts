/**
 * Communication Center models — mirror the backend `com.courier.modules.communication`
 * module one-to-one (see MEMORY/modules/communication.md). No mock shapes: every field is
 * returned by, or accepted by, an endpoint.
 */

export type CommunicationChannel = 'WHATSAPP' | 'SMS' | 'EMAIL';
export const COMMUNICATION_CHANNELS: CommunicationChannel[] = ['WHATSAPP', 'SMS', 'EMAIL'];

export type CommunicationEventType =
  | 'SHIPMENT_BOOKED' | 'SHIPMENT_PICKED_UP' | 'SHIPMENT_DISPATCHED' | 'SHIPMENT_RECEIVED' | 'OUT_FOR_DELIVERY'
  | 'SHIPMENT_DELIVERED' | 'SHIPMENT_CANCELLED' | 'RTO_INITIATED' | 'RTO_DELIVERED'
  | 'DAILY_BUSINESS_SUMMARY';

export const COMMUNICATION_EVENT_TYPES: CommunicationEventType[] = [
  'SHIPMENT_BOOKED', 'SHIPMENT_PICKED_UP', 'SHIPMENT_DISPATCHED', 'SHIPMENT_RECEIVED', 'OUT_FOR_DELIVERY',
  'SHIPMENT_DELIVERED', 'SHIPMENT_CANCELLED', 'RTO_INITIATED', 'RTO_DELIVERED'
];

export type TemplateStatus = 'ACTIVE' | 'INACTIVE';

/** A call-to-action button under a WhatsApp message. Link or Call only (quick replies need an
 *  inbound webhook the app does not have). A link may end in one `{{variable}}`. */
export type TemplateButtonType = 'URL' | 'PHONE_NUMBER';
export interface TemplateButton {
  type: TemplateButtonType;
  text: string;
  url?: string | null;
  phoneNumber?: string | null;
}

export type TemplateCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';

/** Where Meta says a WhatsApp template stands; null on the template = never submitted via the app. */
export type MetaTemplateStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED' | 'IN_APPEAL';

export type CommunicationStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'CANCELLED';

/** Mirrors backend `CommunicationTemplateResponse`. */
export interface CommunicationTemplate {
  id: string;
  eventType: CommunicationEventType;
  channel: CommunicationChannel;
  templateName: string;
  subject?: string | null;
  content: string;
  status: TemplateStatus;
  createdAt?: string | null;
  updatedAt?: string | null;
  version: number;
  metaTemplateId?: string | null;
  metaStatus?: MetaTemplateStatus | string | null;
  metaStatusDetail?: string | null;
  metaCategory?: string | null;
  metaLanguage?: string | null;
  metaSubmittedAt?: string | null;
  category: TemplateCategory | string;
  language: string;
  headerText?: string | null;
  footerText?: string | null;
  buttons: TemplateButton[];
  variableSamples: Record<string, string>;
}

/** Mirrors backend `SubmitTemplateToMetaRequest` — both fields optional. */
export interface SubmitTemplateToMetaRequest {
  category?: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
  language?: string;
}

/** Mirrors backend `TemplateStarterResponse` — what a new template for an event + channel starts as. */
export interface TemplateStarter {
  templateName: string;
  subject?: string | null;
  content: string;
  seeded: boolean;
}

/** Mirrors backend `CreateCommunicationTemplateRequest`. */
export interface CreateCommunicationTemplateRequest {
  eventType: CommunicationEventType;
  channel: CommunicationChannel;
  templateName: string;
  subject?: string | null;
  content: string;
}

/** Mirrors backend `UpdateCommunicationTemplateRequest`. */
export interface UpdateCommunicationTemplateRequest {
  templateName: string;
  subject?: string | null;
  content: string;
  status: TemplateStatus;
  version: number;
  /** The WhatsApp parts: omitted = unchanged, blank / empty = clear. */
  category?: TemplateCategory | string;
  language?: string;
  headerText?: string | null;
  footerText?: string | null;
  buttons?: TemplateButton[];
  variableSamples?: Record<string, string>;
}

/** Mirrors backend `CommunicationTemplatePreviewResponse`. */
export interface CommunicationTemplatePreview {
  subject?: string | null;
  content: string;
}

/** Mirrors backend `CommunicationSettingResponse`. Never carries a secret — only whether
 *  one is set. */
export interface CommunicationSetting {
  id: string;
  channel: CommunicationChannel;
  enabled: boolean;
  provider?: string | null;
  config: Record<string, string>;
  secretConfigured: boolean;
  updatedAt?: string | null;
}

/** Mirrors backend `UpsertCommunicationSettingRequest`. `secret` blank/omitted keeps the
 *  one already stored. */
export interface UpsertCommunicationSettingRequest {
  enabled: boolean;
  provider?: string | null;
  config: Record<string, string>;
  secret?: string | null;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

/** Mirrors backend `CommunicationLogResponse`. */
export interface CommunicationLog {
  id: string;
  shipmentId: string;
  customerId?: string | null;
  eventType: CommunicationEventType;
  channel: CommunicationChannel;
  recipient: string;
  templateId?: string | null;
  status: CommunicationStatus;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  attemptCount: number;
  lastAttemptAt?: string | null;
  nextRetryAt?: string | null;
  sentAt?: string | null;
  createdAt?: string | null;
}

/** Advanced-filter criteria for GET /communication/logs. All optional. */
export interface CommunicationLogSearchRequest {
  shipmentId?: string;
  customerId?: string;
  eventType?: CommunicationEventType;
  channel?: CommunicationChannel;
  status?: CommunicationStatus;
}

export interface CommunicationChannelStats {
  sent: number;
  delivered: number;
  failed: number;
  pending: number;
  cancelled: number;
}

export type DashboardPeriod = 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS';

export interface CommunicationDayPoint { date: string; sent: number; delivered: number; failed: number; }

export interface CommunicationFailureRow {
  id: string;
  shipmentId: string;
  eventType: CommunicationEventType;
  channel: CommunicationChannel;
  recipient: string;
  errorMessage?: string | null;
  attemptCount: number;
  at?: string | null;
}

export interface CommunicationDailyReportStatus {
  configured: boolean;
  recipients: number;
  lastDate?: string | null;
  lastStatus?: string | null;
  lastSentAt?: string | null;
  lastDeliveredAt?: string | null;
  lastReadAt?: string | null;
  lastError?: string | null;
}

export interface CommunicationTemplateHealth {
  approved: number; pending: number; rejected: number; notSubmitted: number; switchedOff: number; total: number;
}

export interface CommunicationCostLine {
  category: string;
  messages: number;
  /** The company's own rate for this category; null when none was entered. */
  rate?: number | null;
  amount?: number | null;
}

/** An estimate from the company's own Meta rates — never a bill. */
export interface CommunicationWhatsAppCost {
  /** DELIVERED once the webhook is live (Meta bills delivered messages), else SENT (an upper bound). */
  basis: 'DELIVERED' | 'SENT';
  anyRateSet: boolean;
  ratesComplete: boolean;
  lines: CommunicationCostLine[];
  total: number;
  /** The currency the company's rates are in (Channel Settings), INR by default. */
  currency: string;
}

/** Mirrors backend `FetchedRatesResponse` — rates worked out from what Meta actually billed. */
export interface FetchedRate { category: string; volume: number; cost: number; rate: number; }
export interface FetchedRates {
  currency?: string | null;
  days: number;
  rates: FetchedRate[];
  /** Categories whose rate was written to Channel Settings. */
  saved: string[];
  billedTotal: number;
  note: string;
}

/** Mirrors backend `CommunicationDashboardResponse`. */
export interface CommunicationDashboard {
  totalSent: number;
  totalDelivered: number;
  totalFailed: number;
  totalPending: number;
  channels: Partial<Record<CommunicationChannel, CommunicationChannelStats>>;
  period: DashboardPeriod;
  from?: string | null;
  to?: string | null;
  /** Messages the recipient opened — only real once Meta's webhook is connected. */
  totalRead: number;
  deliveryRatePercent?: number | null;
  readRatePercent?: number | null;
  daily: CommunicationDayPoint[];
  recentFailures: CommunicationFailureRow[];
  dailyReport?: CommunicationDailyReportStatus | null;
  templates?: CommunicationTemplateHealth | null;
  /** Newest delivery receipt recorded; null = the webhook has never reached this deployment. */
  lastReceiptAt?: string | null;
  whatsAppCost?: CommunicationWhatsAppCost | null;
}
