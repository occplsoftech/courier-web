import { ChargeBreakup, DeliveryType } from '@core/models/shipment.model';
import { CompanyLetterhead } from '@features/company/company-profile.service';
import JsBarcode from 'jsbarcode';
import qrcode from 'qrcode-generator';

/** Formats `CompanyProfileService`'s address fields into the single line the receipt
 *  header prints — null when the company has none set, rather than a line of commas. */
export function companyAddressLine(c: CompanyLetterhead | null | undefined): string | null {
  if (!c) return null;
  const parts = [c.addressLine1, c.addressLine2, c.city, c.state, c.postalCode].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Everything the consignment note needs — nothing invented, every value comes off the
 *  real booking form and the price it was actually booked at (same `PricingResponse` the
 *  live preview showed, since the server prices what it books). Laid out to match a real
 *  courier LR template (SmartPost-style) row for row — see `copy()` below for which of its
 *  fields (Parcel Received, Consignee GST) this system doesn't track and prints as "—". */
export interface ConsignmentPrintData {
  companyName: string;
  /** Company branding, `AuthService.companyLogo()` — absent falls back to the text wordmark. */
  companyLogo: string | null;
  /** Single-line letterhead address — `CompanyProfileService`, formatted by the caller. Null
   *  omits the line rather than printing an empty one. */
  companyAddress: string | null;
  companyGst: string | null;
  companyContact: string | null;
  companyWebsite: string | null;
  shipmentNumber: string;
  trackingNumber: string;
  bookingDate: string;
  /** Backend only returns this once pricing/route resolves a transit time — absent on some bookings. */
  expectedDeliveryDate: string | null;
  bookingBranchLabel: string;
  deliveryBranchLabel: string;
  /** Postal directory lookup (`MasterDataService.lookupPincodeArea`) off the booking side's
   *  own pincode — null when unmatched, same meaning as `PincodeAreaLookup.matched: false`. */
  bookingPincode: string | null;
  bookingDistrict: string | null;
  bookingArea: string | null;
  deliveryPincode: string | null;
  deliveryDistrict: string | null;
  deliveryArea: string | null;
  senderName: string;
  senderAddress: string;
  senderContact: string;
  receiverName: string;
  receiverAddress: string;
  receiverContact: string;
  serviceTypeLabel: string;
  packageTypeLabel: string;
  paymentModeLabel: string;
  deliveryType: DeliveryType;
  numberOfPackages: number;
  chargeableWeight: number;
  declaredValue: number | null;
  charges: ChargeBreakup;
  /** Manual, typed at booking time — not part of the Pricing Engine's own `ChargeBreakup`. */
  otherCharges: number;
  /** Manual, typed at booking time when Appointment Delivery is checked — deliberately
   *  GST-free, unlike {@link otherCharges}. Zero/absent when not an appointment booking. */
  appointmentDeliveryCharge?: number;
  /** Booking form's Appointment Date/Time Slot fields — set together with
   *  {@link appointmentDeliveryCharge} when Appointment Delivery is checked, absent otherwise. */
  appointmentDate?: string | null;
  appointmentTimeSlot?: string | null;
  /** Manual, typed at booking time when Delivery Type is DOOR — taxed with GST (folded
   *  into `charges.gstAmount`), unlike {@link appointmentDeliveryCharge}. Zero/absent when
   *  Office Delivery. */
  doorDeliveryCharge?: number;
  /** Company To-Pay charge (backend-added on To-Pay bookings, taxed with GST) — absent/0 on any
   *  other payment mode. Printed totals add it back like the other raw charge lines. */
  toPayCharge?: number;
  /** Cash on Delivery: the COD charge (2% of the collection amount, at least ₹100). */
  codCharge?: number;
  /** Booking form's remarks field — printed as the LR's "Special Instruction" line. */
  remarks: string | null;
  /** Booked-by user's name — `ShipmentResponse.createdByName`, absent if the booking user
   *  no longer resolves (deleted, cross-tenant). */
  createdByName: string | null;
  /** `ShipmentResponse.invoiceValue` / the booking form's Invoice Value field — the
   *  E-Way Bill threshold figure, distinct from `declaredValue` (insurance). Used by
   *  `ambox-consignment-print.util.ts`'s "Invoice Value" field. */
  invoiceValue: number | null;
  /** Packed items — carries only what `ambox-consignment-print.util.ts` needs to derive
   *  actual (non-chargeable) weight and box dimensions, neither tracked as a single
   *  shipment-level field. */
  items: Array<{ weight: number; lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null }>;
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** Letterhead fields the shared print header needs — a subset of {@link ConsignmentPrintData},
 *  so THC/DRS (which don't book a shipment) can pass just their `CompanyProfileService` data. */
export interface PrintHeaderCompany {
  companyName: string;
  companyLogo: string | null;
  companyAddress: string | null;
  companyGst: string | null;
  companyContact: string | null;
  companyWebsite: string | null;
}

/** The right-hand identity box (LR No / THC No / DRS No, plus an optional barcode and/or QR
 *  of the same or a related value). */
export interface PrintHeaderBox {
  label: string;
  value: string;
  barcodeValue?: string;
  qrValue?: string;
}

/** The consignment note's own header (logo, letterhead, identity box) — shared verbatim by
 *  the THC (`trip-hire-challan.ts`) and DRS (`out-for-delivery.ts`) prints so every document
 *  this system prints carries the same masthead. Pair with {@link PRINT_HEADER_CSS}. */
export function renderPrintHeader(d: PrintHeaderCompany, box: PrintHeaderBox): string {
  return `<div class="head">
        <div class="brand">
          <div class="logo">
            ${d.companyLogo ? `<img class="mark" src="${esc(d.companyLogo)}" alt="${esc(d.companyName)}">` : `
            <div class="word">${esc(d.companyName)}</div>
            <svg class="swoosh" width="140" height="10" viewBox="0 0 150 12" aria-hidden="true">
              <path d="M2 9 Q75 -4 148 6" fill="none" stroke="#f7941d" stroke-width="3" stroke-linecap="round"/>
            </svg>
            <div class="tag">Courier &amp; Logistics</div>`}
          </div>
        </div>
        <div class="co co--company">
          <h2>${esc(d.companyName)}</h2>
          ${d.companyAddress ? `<p>${esc(d.companyAddress)}</p>` : ''}
          <p>
            ${d.companyGst ? `GSTIN: ${esc(d.companyGst)}` : ''}
            ${d.companyGst && d.companyContact ? ' &nbsp;|&nbsp; ' : ''}
            ${d.companyContact ? `Ph: ${esc(d.companyContact)}` : ''}
          </p>
          ${d.companyWebsite ? `<p>${esc(d.companyWebsite)}</p>` : ''}
        </div>
        <div class="lrbox">
          <span class="lrbox-label">${esc(box.label)}</span>
          <span class="lrbox-no">${esc(box.value)}</span>
          ${box.barcodeValue ? `<div class="lrbox-barcode">${barcodeSvg(box.barcodeValue)}</div>` : ''}
          ${box.qrValue ? `<div class="lrbox-qr">${qrSvg(box.qrValue)}</div>` : ''}
        </div>
      </div>`;
}

/** CSS for {@link renderPrintHeader} — colors inlined (not `var(--line)` etc.) so it drops
 *  into any print document's own `<style>` without that document also defining the LR
 *  template's root palette. */
export const PRINT_HEADER_CSS = `
  .head{display:grid;grid-template-columns:220px 1fr 180px;border-bottom:2px solid #000}
  .head > div{padding:7px 10px}
  .head .brand{display:flex;align-items:center;justify-content:center}
  .logo{line-height:1;text-align:center}
  .logo .mark{max-width:100%;max-height:60px;object-fit:contain}
  .logo .word{font-size:22px;font-weight:800;letter-spacing:-.3px}
  .logo .swoosh{display:block;margin:2px auto 0}
  .logo .tag{font-size:10px;color:#f7941d;font-weight:600;margin-top:2px}
  .co{font-size:13px;line-height:1.3;border-left:2px solid #000}
  .co h2{margin:0 0 2px;font-size:15px;font-weight:700;text-align:center}
  .co p{margin:0;color:#333;text-align:center}
  .co--company{display:flex;flex-direction:column;justify-content:center}
  .co--company h2{font-size:17px}
  .co--company p{font-size:12px;line-height:1.5}
  .lrbox{border-left:2px solid #000;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:2px}
  .lrbox-label{font-size:11px;font-weight:700;color:#333}
  .lrbox-no{font-size:16px;font-weight:800}
  .lrbox-barcode{line-height:0}
  .lrbox-barcode svg{width:150px;height:34px}
  .lrbox-qr{line-height:0}
  .lrbox-qr svg{width:52px;height:52px}
`;

/** Renders `value` (the LR/tracking number) to a barcode as a static inline SVG string —
 *  built off-DOM and serialized, so the printed page needs no script of its own to draw it
 *  (`printConsignmentCopies` writes plain HTML into a fresh iframe document). CODE128
 *  handles the tracking number's full alnum/digit range with no character-set gate. */
export function barcodeSvg(value: string): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(svg, value, {
    format: 'CODE128', displayValue: false, margin: 0, height: 34, width: 1.6
  });
  return svg.outerHTML;
}

/** Renders `value` (the LR/tracking number, same value the barcode above already encodes) as
 *  a QR code — this is the value the POD Auto Verification module's QR cross-check scans off
 *  the physical label, either live during delivery capture or decoded server-side out of the
 *  POD photo itself; see `HeuristicPodVerificationProvider`'s `qrScanValue` check. Type 0 lets
 *  the library auto-pick the smallest QR version that fits `value`; 'M' error correction
 *  tolerates real-world print/photo degradation without bloating the module count. */
export function qrSvg(value: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  return qr.createSvgTag({ cellSize: 3, margin: 0 });
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitWords(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
}
function threeDigitWords(n: number): string {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  return [hundred ? `${ONES[hundred]} Hundred` : '', rest ? twoDigitWords(rest) : ''].filter(Boolean).join(' ');
}
/** Indian numbering (Lakh/Crore) — this LR template prints the payable amount in words
 *  the way physical courier receipts traditionally do, e.g. "Two Hundred Fifteen Only". */
export function amountInWords(amount: number): string {
  let n = Math.round(amount);
  if (n === 0) return 'Zero Only';
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  const parts = [
    crore ? `${threeDigitWords(crore)} Crore` : '',
    lakh ? `${threeDigitWords(lakh)} Lakh` : '',
    thousand ? `${threeDigitWords(thousand)} Thousand` : '',
    n ? threeDigitWords(n) : ''
  ].filter(Boolean);
  return `${parts.join(' ')} Only`;
}

type CopyLabel = 'Customer Copy' | 'Office Copy' | 'Driver Copy' | 'Delivery Copy';

function copy(d: ConsignmentPrintData, label: CopyLabel): string {
  const weight = d.chargeableWeight % 1 === 0 ? d.chargeableWeight.toFixed(0) : d.chargeableWeight.toFixed(3);
  const total = d.charges.netAmount + d.otherCharges + (d.appointmentDeliveryCharge ?? 0) + (d.doorDeliveryCharge ?? 0) + (d.toPayCharge ?? 0) + (d.codCharge ?? 0);
  const taxableAmount = total - d.charges.gstAmount;
  const detailRows: Array<[string, string]> = [
    ['From', d.bookingPincode ? `${d.bookingBranchLabel} - ${d.bookingPincode}` : d.bookingBranchLabel],
    ['To', d.deliveryPincode ? `${d.deliveryBranchLabel} - ${d.deliveryPincode}` : d.deliveryBranchLabel],
    ['No Of Parcel / Weight', `${d.numberOfPackages} / ${weight}`],
    ['Booking Date', d.bookingDate],
    ['Delivery Date', d.expectedDeliveryDate ?? '—'],
    ['Booking LR No', d.trackingNumber],
    ['Goods contain', d.packageTypeLabel]
  ];
  const chargeRows: Array<[string, number]> = [
    ['Booking Side Total', total],
    ['Unloading Delivery Charges', 0],
    ['GST On Hamali', 0],
    ['Demurrage Charge', 0],
    ['Reschedule Fine', 0]
  ];

  // Already-Paid orders carry no money left to collect — Customer & Office copies show the
  // amount as already Paid (not a "ToPay" figure), the Driver copy drops the amount block
  // entirely (nothing to collect), and the Delivery copy always shows the ToPay-to-collect
  // figure, which is 0 once the order was Paid at booking.
  //
  // ToPay orders print this document at booking time, before delivery — the collectible
  // amount isn't disclosed on any copy yet, only at actual delivery, so every copy omits
  // the amount block for ToPay regardless of label.
  const isPaid = d.paymentModeLabel.includes('(PAID)');
  const isToPay = d.paymentModeLabel.includes('(TO_PAY)');
  // Paid: amount only on the Customer copy. ToPay: amount on the Customer and Delivery (POD) copies.
  const amountMode: 'normal' | 'paid' | 'omitted' | 'collect' =
    isPaid ? (label === 'Customer Copy' ? 'paid' : 'omitted') :
    isToPay ? (label === 'Delivery Copy' || label === 'Customer Copy' ? 'collect' : 'omitted') :
    label === 'Delivery Copy' ? 'collect' :
    'normal';
  const collectTotal = isPaid ? 0 : total;
  const taxRowsHtml = `<tr><td>Taxable Amount</td><td>${taxableAmount.toFixed(2)}</td></tr>` +
    `<tr><td>GST</td><td>${d.charges.gstAmount.toFixed(2)}</td></tr>`;
  const amountSection = amountMode === 'omitted' ? '' : amountMode === 'paid' ? `
          <table class="charges">
            <tr><th style="text-align:left">Description</th><th style="text-align:right">Amount(Rs.)</th></tr>
            ${taxRowsHtml}
            <tr class="total"><td>Total Paid</td><td>${total.toFixed(2)}</td></tr>
          </table>
          <div class="zero">${esc(amountInWords(total))} (Paid)</div>
          <div class="note">
            Note : Terms And Conditions Applied<br>
            All articles are received in good condition
          </div>` : `
          <table class="charges">
            <tr><th style="text-align:left">Description</th><th style="text-align:right">Amount(Rs.)</th></tr>
            ${amountMode === 'collect'
              ? `<tr><td>ToPay</td><td>${collectTotal.toFixed(2)}</td></tr>`
              : taxRowsHtml +
                `<tr class="total"><td>Total Receivable</td><td>${total.toFixed(2)}</td></tr>` +
                chargeRows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.toFixed(2)}</td></tr>`).join('')}
          </table>
          <div class="zero">${esc(amountInWords(amountMode === 'collect' ? collectTotal : total))}</div>
          <div class="note">
            Note : Terms And Conditions Applied<br>
            All articles are received in good condition
          </div>`;

  return `
    <section class="copy">
     <div class="receipt-inner">

      <!-- HEADER -->
      ${renderPrintHeader(d, { label: 'LR No', value: d.trackingNumber, barcodeValue: d.trackingNumber, qrValue: d.shipmentNumber })}

      <!-- TITLE STRIP -->
      <div class="title">
        <div class="route">
          ${esc(d.bookingBranchLabel)} to ${esc(d.deliveryBranchLabel)}<br>
          (${esc(d.bookingDate)})
        </div>
        <div class="stamp">
          <div class="copy-label">${label}</div>
          <div class="ship-no">${esc(d.shipmentNumber)}</div>
        </div>
      </div>

      <!-- PARTY BLOCK -->
      <table class="party">
        <tr>
          <td class="lbl">Receiver Name :&nbsp; ${esc(d.receiverName)}</td>
          <td class="lbl">Receiver Mobile :&nbsp;&nbsp; ${esc(d.receiverContact)}</td>
          <td rowspan="2" class="tax">Tax Invoice : Consignment Note</td>
        </tr>
        <tr>
          <td class="lbl">Consignor Name :&nbsp; ${esc(d.senderName)}</td>
          <td class="lbl">Consignor Mobile :&nbsp; ${esc(d.senderContact)}</td>
        </tr>
      </table>

      <!-- MAIN BODY -->
      <div class="body">
        <div class="left">
          <table class="details">
            <tr><td class="lbl">Type :</td><td>${esc(d.serviceTypeLabel)} - <strong>${esc(d.paymentModeLabel)}</strong></td></tr>
            ${detailRows.map(([k, v]) => `<tr><td class="lbl">${esc(k)} :</td><td>${esc(v)}</td></tr>`).join('')}
          </table>
          <table class="small">
            <tr><td colspan="2">Special Instruction :&nbsp; ${esc(d.remarks ?? '—')}</td></tr>
            <tr><td colspan="2">Consignee GST Number :&nbsp; —</td></tr>
            <tr><td colspan="2">Delivery Type :&nbsp; ${d.deliveryType === 'DOOR' ? 'Door Delivery' : 'Office Delivery'}</td></tr>
          </table>
        </div>
        <div class="right">${amountSection}
        </div>
      </div>

      <!-- TERMS & CONDITIONS -->
      <div class="terms">
        <div class="t-title">Terms &amp; Conditions</div>
        1. The Company acts only as a carrier; its liability is limited to the declared value of the
        shipment or the freight charges paid, whichever is lower.
        2. All shipments are carried entirely at the consignor's risk.
        3. Claims for loss, damage or shortage must be lodged in writing within 7 days of delivery
        (or of the expected delivery date, if undelivered) — no claim is entertained thereafter.
        4. The Company is not liable for any delay caused by circumstances beyond its control, including
        natural calamity, strike, riot or government action.
        5. Prohibited, hazardous, fragile, or valuable articles (cash, jewellery, negotiable instruments)
        are not covered unless separately declared and accepted in writing at booking.
        6. Any dispute is subject to the exclusive jurisdiction of the courts at the booking branch's
        location only.
      </div>

      <!-- FOOTER -->
      <div class="footer">
        <div class="createdby">Created By :&nbsp; ${esc(d.createdByName ?? '—')}</div>
        <div class="gen">* This is a computer-generated receipt, printed ${esc(new Date().toLocaleString('en-IN'))}. No signature or stamp is required.</div>
        <div class="sign">
          <span>Representative Signature</span>
          <span>Customer Signature</span>
        </div>
      </div>

     </div>
    </section>`;
}

/**
 * Builds the full printable document (both copies) as a plain HTML string — pulled out of
 * `printConsignmentCopies` so it can be rendered and inspected (e.g. for a visual check
 * against real booking data) without touching the DOM or triggering `window.print()`.
 */
export function renderConsignmentHtml(data: ConsignmentPrintData, autoPrint = true): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.shipmentNumber)}</title>
<style>
  :root{ --ink:#000; --line:#000; --orange:#f7941d; --muted:#333; }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{font-family:"Segoe UI",Calibri,Arial,Helvetica,sans-serif;color:var(--ink);background:#e9e9e9}

  .copy{width:1100px;max-width:100%;margin:0 auto;background:#fff;border:3px solid var(--line);padding:10px;page-break-after:always}
  .copy:last-child{page-break-after:auto}
  .receipt-inner{border:2px solid var(--line)}

  /* header */
  ${PRINT_HEADER_CSS}

  /* title strip */
  .title{display:grid;grid-template-columns:1fr auto;align-items:start;gap:16px;padding:8px 14px 10px;border-bottom:2px solid var(--line)}
  .title .route{font-size:20px;font-weight:700;line-height:1.25}
  .title .stamp{text-align:right;line-height:1.25}
  .title .copy-label{font-size:16px;font-weight:700}
  .title .ship-no{font-size:16px;font-weight:700}

  /* shared table look */
  table{width:100%;border-collapse:collapse}
  td,th{border:1px solid var(--line);padding:4px 8px;font-size:12px;vertical-align:middle}
  .lbl{font-weight:700;white-space:nowrap}

  .party{border-top:0}
  .party td{height:26px}
  .party td.tax{width:26%;font-weight:700;text-align:center;vertical-align:middle}

  /* body grid */
  .body{display:grid;grid-template-columns:1fr 1fr}
  .body .right{border-left:0}
  .details td:first-child{width:42%}
  .charges td:last-child{text-align:right;width:32%}
  .charges .total td{font-size:15px;font-weight:700}
  .zero{border:1px solid var(--line);border-top:0;text-align:right;padding:6px 8px;font-size:14px;font-weight:700}
  .note{border:1px solid var(--line);border-top:0;padding:8px;font-size:11px;font-weight:700;line-height:1.5}
  .small td{font-size:11px;padding:2px 8px}

  /* terms & conditions */
  .terms{border-top:2px solid var(--line);padding:4px 10px;font-size:9px;line-height:1.3;color:var(--muted);text-align:justify}
  .terms .t-title{font-weight:700;font-size:10px;color:var(--ink);margin-bottom:2px}

  /* footer */
  .footer{padding:4px 10px 6px;font-size:11px;line-height:1.4}
  .footer .createdby{font-weight:700;font-size:12px;margin-bottom:4px}
  .footer .gen{font-weight:700}
  .sign{display:flex;justify-content:space-between;font-weight:700;font-size:12px;margin-top:10px}

  @media print{
    body{background:#fff}
    .copy{border:2px solid #000;width:100%;padding:6px}
    @page{size:A4 landscape;margin:8mm}
  }
</style></head><body>
  ${copy(data, 'Customer Copy')}
  ${copy(data, 'Delivery Copy')}
  ${copy(data, 'Driver Copy')}
  ${copy(data, 'Office Copy')}
  ${autoPrint ? '<script>window.onload = () => setTimeout(() => window.print(), 50);</script>' : ''}
</body></html>`;
}

/**
 * Opens a hidden iframe (not a new tab/window — avoids popup-blocker issues when called
 * from an async success callback rather than directly from a click) holding both copies,
 * one per printed page, and triggers the browser print dialog once it has rendered. The
 * iframe is removed shortly after `afterprint` fires (or a fallback timeout, since some
 * browsers don't fire it for iframe-hosted print jobs).
 */
export function printConsignmentCopies(data: ConsignmentPrintData): void {
  const html = renderConsignmentHtml(data);

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const cleanup = () => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); };
  iframe.contentWindow?.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 15_000);

  const doc = iframe.contentWindow?.document;
  if (!doc) { cleanup(); return; }
  doc.open();
  doc.write(html);
  doc.close();
}
