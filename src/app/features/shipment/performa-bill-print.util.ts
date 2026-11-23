import { ConsignmentPrintData, amountInWords, qrSvg } from './consignment-print.util';

/** "Print 3" — a third consignment-note layout matching a real courier's "Performa
 *  Invoice - Consignment Note" bill (`Bill_26091054986.pdf`, supplied as a design
 *  reference: SmartPost, booking PUNE SWARGATE to Chhatrapati Sambhajinagar). Same
 *  `ConsignmentPrintData` the primary "Print LR" and "Print 2" buttons use — this is a
 *  third static rendering of the same booking, not a third data shape. The reference's
 *  two-block masthead (a courier network's own logo on the left, the printing
 *  company's letterhead in the middle) doesn't map to this app's data model one-for-one
 *  — the left block is decorative brand furniture the reference itself hardcodes, so it
 *  stays hardcoded here too, same convention `ambox-consignment-print.util.ts` already
 *  uses for its own "AMBOX" wordmark. Route distance ("Km") isn't tracked anywhere in
 *  this system and prints "—", same "don't invent data" rule as every other util here. */

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

type CopyLabel = 'Customer Copy' | 'Office Copy' | 'Driver Copy' | 'Delivery Copy';
const COPY_LABELS: CopyLabel[] = ['Customer Copy', 'Delivery Copy', 'Driver Copy', 'Office Copy'];

function sheet(d: ConsignmentPrintData, label: CopyLabel): string {
  const weight = d.chargeableWeight % 1 === 0 ? d.chargeableWeight.toFixed(0) : d.chargeableWeight.toFixed(3);
  const total = d.charges.netAmount + d.otherCharges + (d.doorDeliveryCharge ?? 0) + (d.toPayCharge ?? 0) + (d.codCharge ?? 0);
  const taxableAmount = total - d.charges.gstAmount;
  const isPaid = d.paymentModeLabel.includes('(PAID)');
  const isToPay = d.paymentModeLabel.includes('(TO_PAY)');
  const statusTag = isPaid ? 'Paid' : isToPay ? 'To Pay' : d.paymentModeLabel;
  const goodsValue = d.declaredValue ?? d.invoiceValue;
  const deliveryTypeLabel = d.deliveryType === 'DOOR' ? 'Door Delivery' : 'Office Delivery';

  // Same amount-display logic as `consignment-print.util.ts`'s `copy()` — Print 1's
  // rule, reused verbatim per direct request ("amount show logic should be same as
  // print 1 on print 3"). Already-Paid orders show the amount as Paid (not a "ToPay"
  // figure), the Driver copy drops the amount block entirely once Paid (nothing left
  // to collect), the Delivery copy always shows the ToPay-to-collect figure (0 once
  // Paid), and ToPay orders skip the ToPay/Paid collection row on every copy (undisclosed
  // until actual delivery) but still show Taxable Amount / GST Applied / Net Total — the
  // tax breakdown and net figure aren't the collectible amount, so ToPay's non-disclosure
  // doesn't apply to them.
  // Net Total = total, which already bakes in charges.roundOff via netAmount.
  const taxRowsHtml = `<tr><td>Taxable Amount</td><td>&#8377; ${taxableAmount.toFixed(2)}</td></tr>` +
    `<tr><td>GST Applied</td><td>&#8377; ${d.charges.gstAmount.toFixed(2)}</td></tr>`;
  const chargeRows: Array<[string, number]> = [
    ['Unloading Delivery Charges', 0],
    ['Reschedule Fine', 0]
  ];
  // Paid: amount only on the Customer copy. ToPay: amount on the Customer and Delivery (POD) copies.
  const amountMode: 'normal' | 'paid' | 'collect' | 'hidden' =
    isPaid ? (label === 'Customer Copy' ? 'paid' : 'hidden') :
    isToPay ? (label === 'Delivery Copy' || label === 'Customer Copy' ? 'collect' : 'hidden') :
    label === 'Driver Copy' ? 'normal' :
    label === 'Delivery Copy' ? 'collect' :
    'normal';
  const collectTotal = isPaid ? 0 : total;

  const amountSection = amountMode === 'hidden' ? '' : amountMode === 'paid' ? `
        <table class="desc">
          <tr><th>Description</th><th>Amount</th></tr>
          ${taxRowsHtml}
          <tr class="total"><td>Total Paid</td><td>&#8377; ${total.toFixed(2)}</td></tr>
        </table>
        <div class="words">Rs. ${esc(amountInWords(total))} (Paid)</div>` : `
        <table class="desc">
          <tr><th>Description</th><th>Amount</th></tr>
          ${taxRowsHtml}
          ${amountMode === 'collect'
            ? `<tr><td>ToPay</td><td>&#8377; ${collectTotal.toFixed(2)}</td></tr>`
            : chargeRows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.toFixed(2)}</td></tr>`).join('') +
              `<tr class="total"><td>Total Receivable</td><td>&#8377; ${total.toFixed(2)}</td></tr>`}
        </table>
        <div class="words">Rs. ${esc(amountInWords(amountMode === 'collect' ? collectTotal : total))}</div>`;

  return `
  <div class="sheet">

    <!-- MASTHEAD (same header as Print 1's consignment-print.util.ts) -->
    <div class="row masthead">
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
      <div class="co">
        <div class="name">${esc(d.companyName)}</div>
        ${d.companyAddress ? `<div class="addr">${esc(d.companyAddress)}</div>` : ''}
        <div class="addr">
          ${d.companyGst ? `GSTIN: ${esc(d.companyGst)}` : ''}
          ${d.companyGst && d.companyContact ? ' &nbsp;|&nbsp; ' : ''}
          ${d.companyContact ? `Ph: ${esc(d.companyContact)}` : ''}
        </div>
        ${d.companyWebsite ? `<div class="addr">${esc(d.companyWebsite)}</div>` : ''}
      </div>
      <div class="lrbox">
        <span class="lrbox-label">Shipment No</span>
        <span class="lrbox-no">${esc(d.shipmentNumber)}</span>
        <div class="lrbox-qr">${qrSvg(d.shipmentNumber)}</div>
      </div>
    </div>

    <!-- ROUTE BAR -->
    <div class="row routebar">
      <div class="route">${esc(d.bookingBranchLabel)} To ${esc(d.deliveryBranchLabel)}</div>
      <div class="track">${esc(d.trackingNumber)} (${esc(statusTag)})</div>
    </div>

    <!-- FROM / TO / KM / DATE -->
    <div class="row fields">
      <div class="cell f1"><span class="k">From :</span> ${esc(d.bookingBranchLabel)}${d.bookingPincode ? ` - ${esc(d.bookingPincode)}` : ''}</div>
      <div class="cell f2"><span class="k">To :</span> ${esc(d.deliveryBranchLabel)}${d.deliveryPincode ? ` - ${esc(d.deliveryPincode)}` : ''}</div>
      <div class="cell f3"><span class="k">Km :</span> —</div>
      <div class="cell f4"><span class="k">Date :</span> ${esc(d.bookingDate)}</div>
      <div class="cell f5 doctype">Performa Invoice - Consignment Note<div class="copytag">(${label})</div></div>
    </div>

    <!-- CONTACTS / ARTICLE / WEIGHT -->
    <div class="row fields">
      <div class="cell g1">${esc(d.senderContact)}</div>
      <div class="cell g2">${esc(d.receiverContact)}</div>
      <div class="cell g3"><span class="k">Article :</span> ${d.numberOfPackages}</div>
      <div class="cell g4"><span class="k">Weight :</span> ${weight}</div>
    </div>

    <!-- SERVICE TYPE / DELIVERY TYPE / EXPECTED DELIVERY / INVOICE NO -->
    <div class="row fields">
      <div class="cell h1"><span class="k">Service Type :</span> ${esc(d.serviceTypeLabel)}</div>
      <div class="cell h2"><span class="k">Delivery Type :</span> ${esc(deliveryTypeLabel)}</div>
      <div class="cell h3"><span class="k">Expected Delivery :</span> ${esc(d.expectedDeliveryDate ?? '—')}</div>
      <div class="cell h3"><span class="k">Invoice No :</span> —</div>
    </div>

    <!-- APPOINTMENT DELIVERY -->
    ${d.appointmentDate || d.appointmentTimeSlot
      ? `<div class="row appt">
      <div class="appt-badge">Appointment Delivery</div>
      <div class="appt-info">
        ${d.appointmentDate ? `<span class="k">Date :</span> ${esc(d.appointmentDate)}` : ''}
        ${d.appointmentDate && d.appointmentTimeSlot ? ' &nbsp;|&nbsp; ' : ''}
        ${d.appointmentTimeSlot ? `<span class="k">Time Slot :</span> ${esc(d.appointmentTimeSlot)}` : ''}
      </div>
    </div>`
      : ''}

    <!-- SPECIAL INSTRUCTION -->
    <div class="row fields">
      <div class="cell h5"><span class="k">Special Instruction :</span> ${esc(d.remarks ?? '—')}</div>
    </div>

    <!-- ITEM TABLE -->
    <table class="items">
      <tr><th>No</th><th>Qty</th><th>Weight</th><th>Content</th><th>Goods Value</th></tr>
      <tr>
        <td>1</td><td>${d.numberOfPackages}</td><td>${weight}</td>
        <td>${esc(d.packageTypeLabel)}</td><td>${goodsValue != null ? goodsValue.toFixed(2) : '—'}</td>
      </tr>
    </table>

    <!-- PARTIES + AMOUNT -->
    <div class="row parties">
      <div class="party">
        <div class="hd">CONSIGNOR</div>
        <div class="line"><span class="k">Name :</span> ${esc(d.senderName)}</div>
        <div class="line"><span class="k">Contact No :</span> ${esc(d.senderContact)}</div>
        <div class="line"><span class="k">Address :</span> ${esc(d.senderAddress)}</div>
      </div>
      <div class="party">
        <div class="hd">CONSIGNEE</div>
        <div class="line"><span class="k">Name :</span> ${esc(d.receiverName)}</div>
        <div class="line"><span class="k">Contact No :</span> ${esc(d.receiverContact)}</div>
        <div class="line"><span class="k">Address :</span> ${esc(d.receiverAddress)}</div>
      </div>
      <div class="amount">${amountSection}
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
      6. In case of any dispute, legal proceedings, or police complaint arising in connection with
      this shipment, the matter shall be subject to the jurisdiction of Pune District, Maharashtra,
      in accordance with applicable law.
    </div>

    <!-- FOOTER -->
    <div class="row foot">
      <div class="foottext">
        <div class="createdby">Created By :&nbsp; ${esc(d.createdByName ?? '—')}</div>
        <div class="disclaimer">* This is a computer-generated receipt. No signature or stamp is required.</div>
      </div>
      ${d.deliveryType === 'DOOR' ? '<div class="doorbox">Door Delivery</div>' : ''}
    </div>
    <div class="row sign">
      <span>Consignor Signature</span>
      <span>Representative Signature</span>
    </div>

  </div>`;
}

export function renderPerformaHtml(data: ConsignmentPrintData): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.shipmentNumber)}</title>
<style>
  *{box-sizing:border-box}
  html,body{margin:0}
  body{background:#e9e9e9;font-family:"Segoe UI",Calibri,Arial,Helvetica,sans-serif;color:#000;padding:10px}
  .sheet{width:1100px;max-width:100%;margin:0 auto;background:#fff;border:2px solid #000;zoom:0.65}
  /* Half of A4 portrait's usable height (297mm page, 10mm margin top+bottom) — each
     copy is centered inside its own half so a physical fold down the page's middle
     lands in the blank space between copies, not across printed content. */
  .slot{height:138.5mm;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .slot:nth-child(2n){page-break-after:always}
  .slot:last-child{page-break-after:auto}
  .row{display:flex;border-bottom:1px solid #000}
  .row:last-child{border-bottom:none}

  .masthead{align-items:stretch}
  .masthead>div{padding:5px 8px;border-right:1px solid #000}
  .masthead>div:last-child{border-right:none}
  .brand{width:1.9in;display:flex;align-items:center;justify-content:center}
  .logo{line-height:1;text-align:center}
  .logo .mark{max-width:100%;max-height:50px;object-fit:contain}
  .logo .word{font-size:18px;font-weight:800;letter-spacing:-.3px}
  .logo .swoosh{display:block;margin:2px auto 0}
  .logo .tag{font-size:10px;color:#e67e22;font-weight:600;margin-top:2px}
  .co{flex:1;display:flex;flex-direction:column;justify-content:center;font-size:13px;text-align:center}
  .co .name{font-weight:700;font-size:14px;margin-bottom:1px}
  .co .addr{color:#333;line-height:1.35}
  .lrbox{width:1.9in;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:2px}
  .lrbox-label{font-size:11px;font-weight:700;color:#333}
  .lrbox-no{font-size:15px;font-weight:800}
  .lrbox-qr{line-height:0}
  .lrbox-qr svg{width:64px;height:64px}

  .routebar{justify-content:space-between;align-items:center;padding:4px 8px;font-weight:700;font-size:15px}

  .fields{align-items:stretch}
  .cell{padding:4px 8px;border-right:1px solid #000;font-size:13px;display:flex;align-items:center}
  .cell:last-child{border-right:none}
  .k{font-weight:700;margin-right:4px}
  .f1,.f2{flex:1.3}
  .f3{width:1in}
  .f4{width:1.7in}
  .f5.doctype{width:2in;flex-direction:column;align-items:flex-start;justify-content:center;font-weight:700;font-size:12px;text-align:center}
  .doctype{text-align:center}
  .copytag{font-weight:700;font-size:13px;align-self:center}
  .g1,.g2{flex:1}
  .g3,.g4{width:1.6in}
  .appt{align-items:center;background:#fff3cd;border-top:1px solid #000}
  .appt-badge{background:#e67e22;color:#fff;font-weight:700;font-size:13px;letter-spacing:.04em;padding:4px 10px;border-right:1px solid #000}
  .appt-info{flex:1;padding:4px 8px;font-weight:700;font-size:13px}
  .h1,.h2,.h3{flex:1}
  .h4{flex:1}
  .h5{flex:1}

  table.items{width:100%;border-collapse:collapse;border-bottom:1px solid #000}
  table.items th,table.items td{border:1px solid #000;border-top:none;border-bottom:none;padding:4px 8px;font-size:13px;text-align:left}
  table.items th{background:#f2f2f2;font-weight:700}
  table.items tr:first-child th{border-top:none}
  table.items tr:last-child td{border-bottom:none}

  .parties{align-items:stretch}
  .party{flex:1;padding:4px 8px;border-right:1px solid #000}
  .party .hd{font-weight:700;letter-spacing:.08em;margin-bottom:4px}
  .party .line{font-size:13px;margin-top:2px}
  .amount{width:2.6in;padding:4px 8px;display:flex;flex-direction:column;align-items:center}
  table.desc{width:100%;border-collapse:collapse}
  table.desc th,table.desc td{border:1px solid #000;padding:4px 8px;font-size:13px}
  table.desc th:last-child,table.desc td:last-child{text-align:right}
  table.desc .total td{font-weight:700}
  .words{font-size:12px;font-style:italic;margin-top:4px;text-align:center}

  .terms{border-top:1px solid #000;padding:4px 8px;font-size:10px;line-height:1.3;color:#333;text-align:justify}
  .terms .t-title{font-weight:700;font-size:11px;color:#000;margin-bottom:2px}

  .foot{justify-content:space-between;align-items:center;padding:4px 8px;font-size:12px}
  .foottext{line-height:1.4}
  .createdby{font-weight:700;font-size:13px}
  .doorbox{border:1px solid #000;font-weight:700;padding:3px 10px}
  .sign{justify-content:space-between;padding:10px 8px 4px;font-size:13px;font-weight:700;border-bottom:none}

  @page{size:A4 portrait;margin:10mm}
  @media print{ body{background:#fff;padding:0} }
</style></head><body>
  ${COPY_LABELS.map((label) => `<div class="slot">${sheet(data, label)}</div>`).join('')}
  <script>window.onload = () => setTimeout(() => window.print(), 50);</script>
</body></html>`;
}

/** Opens a hidden iframe and prints the Performa-Invoice-layout copies — same
 *  popup-blocker-safe mechanism as `printConsignmentCopies`/`printAmboxCopies`. */
export function printPerformaBillCopies(data: ConsignmentPrintData): void {
  const html = renderPerformaHtml(data);

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
