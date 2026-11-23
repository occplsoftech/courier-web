import { ConsignmentPrintData, qrSvg } from './consignment-print.util';

/** "Print 2" — an alternate consignment-note layout matching a specific 12in × 6in
 *  physical stationery template (`ambox-consignment-note.html`, supplied as a design
 *  reference) rather than `consignment-print.util.ts`'s A4-landscape SmartPost-style
 *  layout. Same `ConsignmentPrintData` the primary "Print LR" button uses — this is a
 *  second static rendering of the same booking, not a second data shape. Every field
 *  the reference template collected by hand (dimensions, insurance policy no., vehicle
 *  no., invoice no., CST/LST no.) has no equivalent in the booking data and prints "—",
 *  same convention `consignment-print.util.ts` already uses for its own untracked
 *  fields. Unlike the reference file, there is nothing left to type in by hand and
 *  nothing to recalculate — one page per copy is auto-printed, same as
 *  `printConsignmentCopies`. */

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** Splits a rupee amount into the template's separate Rs./Paise columns — mirrors the
 *  reference file's own `set()` helper, just against static data instead of a live input. */
function rsPaise(value: number): [string, string] {
  if (!value) return ['', ''];
  const rs = Math.floor(value);
  const paise = Math.round((value - rs) * 100);
  return [String(rs), String(paise).padStart(2, '0')];
}

// Four copies, matching `consignment-print.util.ts`'s own Customer/Office/Driver/Delivery
// set (Consignor Copy here is that same customer-facing copy) — no separate Consignee
// Copy, since the consignee only ever sees the goods plus the P.O.D. copy at delivery.
type CopyLabel = 'CONSIGNOR COPY' | 'OFFICE COPY' | 'DRIVER COPY' | 'P.O.D. COPY';
const COPY_LABELS: CopyLabel[] = ['CONSIGNOR COPY', 'P.O.D. COPY', 'DRIVER COPY', 'OFFICE COPY'];

function sheet(d: ConsignmentPrintData, label: CopyLabel): string {
  const weight = d.chargeableWeight % 1 === 0 ? d.chargeableWeight.toFixed(0) : d.chargeableWeight.toFixed(3);
  const total = d.charges.netAmount + d.otherCharges + (d.appointmentDeliveryCharge ?? 0) + (d.doorDeliveryCharge ?? 0) + (d.toPayCharge ?? 0) + (d.codCharge ?? 0);
  const tax = d.charges.gstAmount;
  const subtotal = total - tax;

  const actualWeight = d.items.length ? d.items.reduce((sum, i) => sum + i.weight, 0) : null;
  // Multiple packed items rarely share one box's dimensions — only shown when there's
  // exactly one item to attribute them to, same "don't invent data" rule as everything
  // else this system doesn't track per-shipment.
  const dims = d.items.length === 1 ? d.items[0] : null;
  const volumetricWeight = dims?.lengthCm && dims?.widthCm && dims?.heightCm
    ? (dims.lengthCm * dims.widthCm * dims.heightCm) / 5000
    : null;

  const isPaid = d.paymentModeLabel.includes('(PAID)');
  const isToPay = d.paymentModeLabel.includes('(TO_PAY)');
  // Paid: amounts only on the Consignor (customer) copy. ToPay: on the Consignor and P.O.D. copies.
  const showAmount = isPaid ? label === 'CONSIGNOR COPY' : isToPay ? label === 'P.O.D. COPY' || label === 'CONSIGNOR COPY' : true;

  const rows: Array<[string, number]> = [
    ['FREIGHT', d.charges.freight],
    ['DOOR DELIVERY', d.doorDeliveryCharge ?? 0],
    ['DOOR COLLECTION', 0],
    ['WBC', 0],
    ['HANDLING CHARGES', d.charges.handlingCharge],
    ['D.O.D / C.O.D SERVICE CHARGES', d.charges.odaCharge],
    ['OSC', d.otherCharges + (d.appointmentDeliveryCharge ?? 0) + (d.toPayCharge ?? 0) + (d.codCharge ?? 0)],
    ['HAMALI', d.charges.fuelCharge + d.charges.insuranceCharge + d.charges.applicableCharges]
  ];

  const amtRow = (v: number) => {
    if (!showAmount) return `<div class="rp"><div class="rs pad"></div><div class="ps pad"></div></div>`;
    const [rs, ps] = rsPaise(v);
    return `<div class="rp"><div class="rs pad">${rs}</div><div class="ps pad">${ps}</div></div>`;
  };
  const [totRs, totPs] = showAmount ? rsPaise(subtotal) : ['', ''];
  const [taxRs, taxPs] = showAmount ? rsPaise(tax) : ['', ''];
  const [grdRs, grdPs] = showAmount ? rsPaise(total) : ['', ''];

  return `
  <div class="sheet">

    <!-- MASTHEAD -->
    <div class="row masthead">
      <div class="brand">
        <div class="mark">${esc(d.companyName || 'AMBOX')}</div>
        <div class="sub">PREMIUM LOGISTICS PVT.LTD.</div>
        <div class="tri">INTEGRITY | REABILITY | TRUST</div>
        <div class="tag">We are Amazing!!!</div>
      </div>
      <div class="addr">
        <p>${esc(d.companyAddress ?? 'Behind Hans Travels, Opp. Sangam Dhaba, Parking No. 3, Sangamwadi, Pune - 411003.')}</p>
        <p>Mobile : ${esc(d.companyContact ?? '8956286242 / 8956065218')}</p>
        ${d.companyWebsite ? `<p>Web : ${esc(d.companyWebsite)}</p>` : ''}
        <div class="gst">GST NO :- ${esc(d.companyGst ?? '27ABACA1918P1ZG')}</div>
      </div>
      <div class="meta">
        <div class="fields">
          <div class="r"><div class="k lbl pad">DATE</div><div class="v pad">${esc(d.bookingDate)}</div></div>
          <div class="r"><div class="k lbl pad">FROM</div><div class="v pad">${esc(d.bookingBranchLabel)}</div></div>
          <div class="r"><div class="k lbl pad">DESTINATION</div><div class="v pad">${esc(d.deliveryBranchLabel)}${d.deliveryArea ? ` (${esc(d.deliveryArea)})` : ''}</div></div>
          <div class="r"><div class="k lbl pad">CONSIGNEE</div><div class="v pad">${esc(d.receiverName)}</div></div>
        </div>
        <div class="docno">
          <div class="docno-qr">${qrSvg(d.shipmentNumber)}</div>
          <span>${esc(d.shipmentNumber)}</span>
        </div>
      </div>
    </div>

    <!-- BODY -->
    <div class="body">
      <div class="left">
        <div class="row consignor">
          <div class="k cell lbl pad">CONSIGNOR</div>
          <div class="v cell pad">${esc(d.senderName)}, ${esc(d.senderAddress)}</div>
        </div>
        <div class="row cstrow">
          <div class="k cell lbl pad">C.S.T. / L.S.T. NO</div>
          <div class="v cell pad">—</div>
        </div>
        <div class="pieces">
          <div class="row hdr">
            <div class="cell fill lbl ctr c1">NO. OF PIECE</div>
            <div class="cell fill lbl ctr c2">ACTUAL WEIGHT</div>
            <div class="cell fill lbl ctr c3">CHARGEABLE WEIGHT</div>
          </div>
          <div class="row vals">
            <div class="cell c1 pad ctr">${d.numberOfPackages}</div>
            <div class="cell c2 pad ctr">${actualWeight != null ? (actualWeight % 1 === 0 ? actualWeight.toFixed(0) : actualWeight.toFixed(3)) : '—'}</div>
            <div class="cell c3 pad ctr">${weight}</div>
          </div>
        </div>
        <div class="midblock">
          <div class="labels">
            <div class="lc"><div class="lbl">INVOICE VALUE</div><div class="pad">${d.invoiceValue != null ? d.invoiceValue.toFixed(2) : '—'}</div></div>
            <div class="lc"><div class="lbl">INVOICE NO.</div><div class="pad">—</div></div>
            <div class="lc"><div class="lbl">VEHICLE NO.</div><div class="pad">—</div></div>
          </div>
          <div class="detail">
            <div class="risk">
              <div class="t1">AT OWNER'S RISK / CARRIER'S RISK</div>
              <div class="t2">If Insured Details of Insurance Policy</div>
            </div>
            <div class="insline"><span class="t">POLICY NO.</span><span class="u">—</span><span class="t">DATE</span><span class="u">—</span></div>
            <div class="insline"><span class="t">INSURANCE COMPANY</span><span class="u">—</span></div>
            <div class="insline"><span class="t">INSURANCE VALUE</span><span class="u">${d.charges.insuranceCharge ? d.charges.insuranceCharge.toFixed(2) : '—'}</span></div>
            <div class="mop lbl">MODE OF PAYMENT — ${esc(d.paymentModeLabel)}</div>
            <div class="payrow">
              <div class="paid">
                <div class="h">PAID</div>
                <div class="payline"><span class="t">CASH / CHEQUE NO.</span><span class="u">—</span></div>
                <div class="payline"><span class="t">DATED</span><span class="u">${esc(d.bookingDate)}</span></div>
                <div class="payline"><span class="t">FOR Rs.</span><span class="u">${isPaid && showAmount ? total.toFixed(2) : '—'}</span></div>
              </div>
              <div class="credit">
                <div class="h">CREDIT</div>
                <div class="payline"><span class="t">CUSTOMER CODE NO.</span></div>
                <div class="payline"><span class="u">—</span></div>
              </div>
            </div>
          </div>
        </div>
        <div class="footblock">
          <div class="docs">
            <div class="d"><span class="n">INVOICE</span><span class="yn">Y <span class="box"></span> N <span class="box"></span></span></div>
            <div class="d"><span class="n">PACKING LIST</span><span class="yn">Y <span class="box"></span> N <span class="box"></span></span></div>
            <div class="d"><span class="n">PERMIT / FORM</span><span class="yn">Y <span class="box"></span> N <span class="box"></span></span></div>
          </div>
          <div class="terms">
            <div class="tx">
              I / We hereby agree to the terms &amp; conditions set out on the reverse of this Consignor's copy
              &amp; declare that contents on this way bill are true and correct. The To-pay Freight has now / our
              consent and will be paid by the Consignee along with Service Charges as applicable.
            </div>
            <div class="signline"><span class="t">NAME</span><span class="u">${esc(d.senderName)}</span><span class="t">SENDER SIGNATURE</span><span class="u"></span></div>
            <div class="recv">RECEIVED BY ${esc(d.companyName || 'AMBOX PREMIUM LOGISTICS PVT. LTD.')}</div>
            <div class="recvline"><span class="t lbl sm">NAME</span><span class="u"></span></div>
            <div class="recvline">
              <span class="t lbl sm">DATE</span><span class="u"></span>
              <span class="t lbl sm">TIME</span><span class="u"></span>
              <span class="t lbl sm">BOOKING INCHARGE</span><span class="u">${esc(d.createdByName ?? '—')}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="right">
        <div class="charges">
          <div class="volcol">
            <div class="hd h1">VOLUMETRIC CHARGE WEIGHT</div>
            <div class="lbh hdr"><div>Length</div><div>Breadth</div><div>Height</div></div>
            <div class="lbh val"><div>${dims?.lengthCm ?? '—'}</div><div>${dims?.widthCm ?? '—'}</div><div>${dims?.heightCm ?? '—'}</div></div>
            <div class="awv hdr"><div>ACTUAL WEIGHT</div><div>VOLUMETRIC</div></div>
            <div class="awv val"><div>${actualWeight != null ? (actualWeight % 1 === 0 ? actualWeight.toFixed(0) : actualWeight.toFixed(3)) : '—'}</div><div>${volumetricWeight != null ? volumetricWeight.toFixed(2) : '—'}</div></div>
            <div class="dod"><div>D.O.D.</div><div>C.O.D.</div></div>
            <div class="dodv"><div>—</div><div>—</div></div>
            <div class="topay"><span class="t">TO PAY</span><span class="b pad">${isToPay && showAmount ? subtotal.toFixed(2) : ''}</span></div>
            <div class="amtline"><span class="t">AMOUNT</span><span class="u">${isPaid && showAmount ? total.toFixed(2) : ''}</span></div>
            <div class="tpsc">TO PAY SERVICE CHARGES<br>AS APPLICABLE</div>
          </div>
          <div class="chgcol">
            <div class="hd h2">CHARGES</div>
            ${rows.map(([name]) => `<div class="crow"><div class="name${name.length > 20 ? ' two' : ''}">${esc(name)}</div></div>`).join('')}
            <div class="crow"><div class="name">TOTAL</div></div>
            <div class="crow"><div class="name two">SERVICE TAX</div></div>
            <div class="crow"><div class="name">GRAND TOTAL</div></div>
          </div>
          <div class="amtcol">
            <div class="hd h2">FREIGHT<div class="subhdr"><div>Rs.</div><div>P.</div></div></div>
            ${rows.map(([, v]) => amtRow(v)).join('')}
            <div class="rp"><div class="rs pad">${totRs}</div><div class="ps pad">${totPs}</div></div>
            <div class="rp"><div class="rs pad">${taxRs}</div><div class="ps pad">${taxPs}</div></div>
            <div class="rp"><div class="rs pad">${grdRs}</div><div class="ps pad">${grdPs}</div></div>
          </div>
          <div class="sicol">
            <div class="hd h2">SPECIAL<br>INSTRUCTIONS</div>
            <div class="area pad">${esc(d.remarks ?? '—')}</div>
          </div>
        </div>
        <div class="podarea">
          <div class="legal">
            <div class="l"><span class="box"></span><span>THIS IS A NON-NEGOTIABLE WAY BILL</span></div>
            <div class="l"><span class="box"></span><span>STANDARD CONDITIONS OF CARRIAGE ARE GIVEN ON REVERSE OF THE CONSIGNOR'S COPY</span></div>
            <div class="l"><span class="box"></span><span>LIABILITY LIMITED TO Rs. 1,000/- ONLY</span></div>
            <div class="l"><span class="box"></span><span>WE CARRY UNDER THE CARRIER'S ACT</span></div>
            <div class="office">FOR OFFICE USE ONLY</div>
          </div>
          <div class="podbox">
            <div class="head">RECEIVED ABOVE SHIPMENT IN ORDER AND IN GOOD CONDITION.</div>
            <div class="dt"><span class="t">Date :</span><span class="u"></span></div>
            <div class="dt"><span class="t">Time :</span><span class="u"></span></div>
            <div class="sign">Receiver's Name, Sign &amp; Stamp</div>
            <div class="copytag">${label}</div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function renderAmboxHtml(data: ConsignmentPrintData): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.shipmentNumber)}</title>
<style>
  :root{ --ink:#1462a8; --ink-dark:#0d4c85; --rule:#7fadd4; --rule-strong:#1462a8; --fill:#dcebf7; --fill-strong:#1a76c4; --paper:#fff; --text:#0f2233; }
  *{box-sizing:border-box}
  html,body{margin:0}
  body{background:#e9edf2;font-family:"Arial Narrow",Arial,Helvetica,sans-serif;color:var(--text);-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:20px 14px 48px}
  .sheet{width:12in;height:6in;margin:0 auto;background:var(--paper);border:1px solid var(--rule-strong);display:flex;flex-direction:column;overflow:hidden;zoom:0.62}
  /* Half of A4 portrait's usable height (297mm page, 10mm margin top+bottom) — each
     copy is centered inside its own half so a physical fold down the page's middle
     lands in the blank space between copies, not across printed content. */
  .slot{height:138.5mm;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .slot:nth-child(2n){page-break-after:always}
  .slot:last-child{page-break-after:auto}
  .row{display:flex}
  .cell{border-right:1px solid var(--rule);border-bottom:1px solid var(--rule)}
  .cell:last-child{border-right:none}
  .lbl{color:var(--ink);font-weight:700;font-size:11.5px;letter-spacing:.02em;line-height:1.15;padding:3px 5px}
  .lbl.sm{font-size:10px}
  .fill{background:var(--fill)}
  .ctr{text-align:center}
  .pad{padding:3px 5px}
  .u{display:inline-block;border-bottom:1px dotted #7ea4c6;color:#11305a;font-size:13px;padding:2px 4px;min-width:20px}
  .box{display:inline-block;width:15px;height:12px;border:1px solid var(--ink);vertical-align:middle;background:#fff}
  .masthead{height:1.08in;align-items:stretch;border-bottom:1px solid var(--rule)}
  .brand{width:2.7in;border-right:1px solid var(--rule);padding:6px 8px 0;display:flex;flex-direction:column}
  .brand .mark{align-self:flex-start;border:1.6px solid var(--ink);padding:0 9px 1px;font-weight:700;font-size:28px;color:var(--ink);line-height:1.1}
  .brand .sub{color:var(--ink);font-size:9.5px;letter-spacing:.16em;margin:3px 0 3px 2px}
  .brand .tri{color:var(--ink);font-size:8.6px;letter-spacing:.1em;border-top:1px solid var(--rule);padding-top:3px}
  .brand .tag{background:var(--fill-strong);color:#fff;font-size:11px;font-style:italic;font-weight:700;padding:2px 8px;margin:auto -8px 0}
  .addr{width:3.5in;border-right:1px solid var(--rule);padding:7px 10px 0;display:flex;flex-direction:column}
  .addr p{margin:0;color:var(--ink);font-size:12px;line-height:1.42}
  .gst{background:var(--fill-strong);color:#fff;font-size:11.5px;font-weight:700;padding:2px 9px;margin:auto -10px 0}
  .meta{flex:1;display:flex}
  .meta .fields{flex:1;display:flex;flex-direction:column}
  .meta .fields .r{display:flex;flex:1;border-bottom:1px solid var(--rule);align-items:stretch}
  .meta .fields .r:last-child{border-bottom:none}
  .meta .fields .r .k{width:1in;border-right:1px solid var(--rule);display:flex;align-items:center}
  .meta .fields .r .v{flex:1;display:flex;align-items:center;font-size:13px}
  .docno{width:2in;border-left:1px solid var(--rule);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px}
  .docno span{font-size:17px;font-weight:700;color:#111;letter-spacing:.04em}
  .docno-qr{line-height:0}
  .docno-qr svg{width:48px;height:48px}
  .body{flex:1;display:flex;min-height:0}
  .left{width:5.7in;border-right:1.4px solid var(--rule-strong);display:flex;flex-direction:column;min-height:0}
  .right{flex:1;display:flex;flex-direction:column;min-height:0}
  .consignor{height:.82in}
  .consignor .k{width:1.3in;border-right:1px solid var(--rule)}
  .consignor .v{flex:1;font-size:13px}
  .cstrow{height:.25in}
  .cstrow .k{width:1.3in;border-right:1px solid var(--rule);background:var(--fill);display:flex;align-items:center}
  .cstrow .v{flex:1;display:flex;align-items:center;font-size:13px}
  .pieces .hdr{height:.25in}
  .pieces .hdr>div{display:flex;align-items:center;justify-content:center}
  .pieces .vals{height:.35in}
  .pieces .vals>div{display:flex;align-items:center;font-size:13px}
  .pieces .c1{width:1.3in}
  .pieces .c2{width:1.6in}
  .pieces .c3{flex:1}
  .midblock{display:flex;height:1.92in}
  .midblock .labels{width:1.3in;border-right:1px solid var(--rule);display:flex;flex-direction:column}
  .midblock .labels .lc{flex:1;border-bottom:1px solid var(--rule);display:flex;flex-direction:column}
  .midblock .labels .lc:last-child{border-bottom:none}
  .midblock .lc .pad{font-size:13px}
  .midblock .detail{flex:1;display:flex;flex-direction:column}
  .risk{height:.34in;border-bottom:1px solid var(--rule);padding:3px 6px;text-align:center}
  .risk .t1{color:var(--ink);font-weight:700;font-size:11.5px}
  .risk .t2{color:var(--ink);font-size:9px}
  .insline{display:flex;align-items:center;border-bottom:1px solid var(--rule);height:.25in;padding:0 6px;gap:6px}
  .insline .t{color:var(--ink);font-size:10px;font-weight:700;white-space:nowrap}
  .mop{height:.21in;background:var(--fill);text-align:center;border-bottom:1px solid var(--rule);display:flex;align-items:center;justify-content:center;font-size:10px}
  .payrow{display:flex;flex:1}
  .payrow .paid{width:56%;border-right:1px solid var(--rule);padding:2px 6px 3px}
  .payrow .credit{flex:1;padding:2px 6px 3px}
  .payrow .h{color:var(--ink);font-weight:700;font-size:12px}
  .payline{display:flex;align-items:center;gap:4px;margin-top:2px}
  .payline .t{color:var(--ink);font-size:9.5px;font-weight:700;white-space:nowrap}
  .footblock{display:flex;flex:1;border-top:1px solid var(--rule);min-height:0}
  .docs{width:1.55in;border-right:1px solid var(--rule);display:flex;flex-direction:column}
  .docs .d{flex:1;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--rule);padding:0 6px;gap:4px}
  .docs .d:last-child{border-bottom:none}
  .docs .d .n{color:var(--ink);font-weight:700;font-size:11px}
  .yn{display:flex;gap:5px;align-items:center;color:var(--ink);font-size:10px;font-weight:700}
  .terms{flex:1;display:flex;flex-direction:column;min-width:0}
  .terms .tx{flex:1;font-size:7px;line-height:1.15;color:#2c4a68;padding:3px 6px;text-align:justify}
  .signline{display:flex;border-top:1px solid var(--rule);height:.23in;align-items:center;padding:0 6px;gap:6px}
  .signline .t{color:var(--ink);font-size:9.5px;font-weight:700;white-space:nowrap}
  .recv{border-top:1px solid var(--rule);text-align:center;color:var(--ink);font-size:9px;font-weight:700;padding:2px}
  .recvline{display:flex;border-top:1px solid var(--rule);height:.23in;align-items:center;padding:0 6px;gap:5px}
  .charges{display:flex;height:3.12in;border-bottom:1px solid var(--rule)}
  .volcol{width:2.15in;border-right:1px solid var(--rule);display:flex;flex-direction:column}
  .chgcol{width:1.35in;border-right:1px solid var(--rule);display:flex;flex-direction:column}
  .amtcol{width:1.4in;border-right:1px solid var(--rule);display:flex;flex-direction:column}
  .sicol{flex:1;display:flex;flex-direction:column}
  .hd{background:var(--fill);color:var(--ink);font-weight:700;font-size:11px;text-align:center;border-bottom:1px solid var(--rule);display:flex;align-items:center;justify-content:center;flex-direction:column}
  .hd.h1{height:.21in}
  .hd.h2{height:.375in}
  .lbh{display:flex;border-bottom:1px solid var(--rule)}
  .lbh>div{flex:1;border-right:1px solid var(--rule);text-align:center;display:flex;align-items:center;justify-content:center}
  .lbh>div:last-child{border-right:none}
  .lbh.hdr{height:.18in}
  .lbh.hdr>div{background:var(--fill);color:var(--ink);font-weight:700;font-size:10.5px}
  .lbh.val{height:.33in;font-size:12px}
  .awv{display:flex;border-bottom:1px solid var(--rule)}
  .awv>div{flex:1;border-right:1px solid var(--rule);display:flex;align-items:center;justify-content:center}
  .awv>div:last-child{border-right:none}
  .awv.hdr{height:.18in}
  .awv.hdr>div{background:var(--fill);color:var(--ink);font-weight:700;font-size:10.5px}
  .awv.val{height:.33in;font-size:12px}
  .dod{display:flex;height:.18in;border-bottom:1px solid var(--rule)}
  .dod>div{flex:1;border-right:1px solid var(--rule);background:var(--fill-strong);color:#fff;font-weight:700;font-size:11px;display:flex;align-items:center;justify-content:center}
  .dod>div:last-child{border-right:none}
  .dodv{display:flex;height:.42in;border-bottom:1px solid var(--rule)}
  .dodv>div{flex:1;border-right:1px solid var(--rule);display:flex;align-items:center;justify-content:center;font-size:12px}
  .dodv>div:last-child{border-right:none}
  .topay{display:flex;align-items:center;gap:6px;padding:0 6px;height:.27in;border-bottom:1px solid var(--rule)}
  .topay .t{color:var(--ink);font-weight:700;font-size:12px}
  .topay .b{flex:1;max-width:.9in;border:1px solid var(--rule);height:.17in;display:flex;align-items:center;font-size:12px}
  .amtline{display:flex;align-items:center;gap:6px;padding:0 6px;border-bottom:1px solid var(--rule);height:.3in}
  .amtline .t{color:var(--ink);font-weight:700;font-size:11px;white-space:nowrap}
  .tpsc{color:var(--ink);font-weight:700;font-size:10px;padding:4px 6px;flex:1}
  .crow{display:flex;flex:1;border-bottom:1px solid var(--rule);align-items:center;justify-content:flex-end}
  .crow:last-child{border-bottom:none}
  .crow .name{color:var(--ink);font-weight:700;font-size:9.6px;line-height:1.05;padding:0 5px;text-align:right}
  .crow .name.two{font-size:8.4px}
  .rp{display:flex;flex:1;border-bottom:1px solid var(--rule)}
  .rp:last-child{border-bottom:none}
  .rp .rs{flex:2;border-right:1px solid var(--rule);text-align:right;font-size:12px}
  .rp .ps{flex:1;text-align:right;font-size:12px}
  .subhdr{display:flex;width:100%;margin-top:2px}
  .subhdr div{flex:1;text-align:center;color:var(--ink);font-weight:700;font-size:10.5px}
  .subhdr div:first-child{flex:2;border-right:1px solid var(--rule)}
  .sicol .area{flex:1;font-size:12px}
  .podarea{display:flex;flex:1;min-height:0}
  .legal{width:2.15in;border-right:1px solid var(--rule);display:flex;flex-direction:column}
  .legal .l{display:flex;gap:5px;align-items:center;padding:2px 5px;border-bottom:1px solid var(--rule);flex:1}
  .legal .l span:last-child{color:var(--ink);font-size:7.8px;font-weight:700;line-height:1.2}
  .office{height:.22in;background:var(--fill);text-align:center;color:var(--ink);font-weight:700;font-size:10px;display:flex;align-items:center;justify-content:center}
  .podbox{flex:1;display:flex;flex-direction:column}
  .podbox .head{color:var(--ink);font-weight:700;font-size:10.5px;padding:4px 6px;border-bottom:1px solid var(--rule)}
  .podbox .dt{display:flex;gap:6px;align-items:center;padding:0 6px;height:.24in;border-bottom:1px solid var(--rule)}
  .podbox .dt .t{color:var(--ink);font-weight:700;font-size:10.5px}
  .podbox .sign{flex:1;color:var(--ink);font-weight:700;font-size:10.5px;padding:4px 6px}
  .copytag{text-align:right;color:var(--ink);font-weight:700;font-size:13px;padding:2px 8px 4px}
  @page{size:A4 portrait;margin:10mm}
  @media print{ body{background:#fff;padding:0} .sheet{box-shadow:none} }
</style></head><body>
  ${COPY_LABELS.map((label) => `<div class="slot">${sheet(data, label)}</div>`).join('')}
  <script>window.onload = () => setTimeout(() => window.print(), 50);</script>
</body></html>`;
}

/** Opens a hidden iframe and prints the AMBOX-layout copies — same popup-blocker-safe
 *  mechanism as `printConsignmentCopies`. */
export function printAmboxCopies(data: ConsignmentPrintData): void {
  const html = renderAmboxHtml(data);

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
