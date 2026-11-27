import qrcode from 'qrcode-generator';
import { CompanyLetterhead } from '@features/company/company-profile.service';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** One field in the details box; `big` prints the value bold and larger (the sheet's number, its person). */
export interface PrintField { label: string; value: string; big?: boolean; }

export interface LetterheadSheet {
  /** "DELIVERY RUN SHEET", "MANIFEST". */
  title: string;
  company: CompanyLetterhead | null;
  /** Fallback when the company has no logo uploaded. */
  logo?: string | null;
  /** Encoded in the QR code at the header's right (the DRS ID / manifest number), so the sheet can be scanned. */
  qr?: string | null;
  /** The details box under the header: one array per column, its fields top to bottom. */
  details: PrintField[][];
  /** nowrap: an AWB / forwarder number stays on one line. */
  columns: { label: string; width?: string; right?: boolean; nowrap?: boolean }[];
  rows: string[][];
  /** Minimum height of each table row, e.g. '38mm' on the DRS so a receiver's stamp fits inside its own row. */
  rowHeight?: string;
  /** A bold total row under the table, one cell per column ('' for none). */
  totals?: string[];
  /** Extra boxed sections under the table (THC expenses, terms): a title and label → value pairs, or plain lines. */
  sections?: { title: string; fields?: [string, string][]; lines?: string[] }[];
  /** Signature boxes at the foot, e.g. ['Handed over by', 'Received by']. */
  signatures?: string[];
  /** Wide sheets (THC) print landscape. */
  landscape?: boolean;
  /** Table text size in px (default 15; a 12-column THC needs less). */
  tableFontPx?: number;
}

/**
 * The company's print header ("C · Boxed form", the house format for every printed sheet from now on):
 * a bordered box with the logo, the title over the office address / mobile / email, and a QR code; under it a
 * bordered grid of the sheet's details; then the grey-headed table.
 */
export function printLetterhead(d: LetterheadSheet): boolean {
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) return false;
  const c = d.company;
  const logo = c?.logo || d.logo;
  const address = [c?.addressLine1, c?.addressLine2, [c?.city, c?.postalCode].filter(Boolean).join(' - ')].filter(Boolean).join(', ');
  const contact = [c?.mobile ? `Mobile: ${c.mobile}` : '', c?.email ? `Email: ${c.email}` : '', c?.gstNumber ? `GSTIN: ${c.gstNumber}` : '']
    .filter(Boolean).join(' · ');
  const field = (f: PrintField) => `<span>${esc(f.label)}</span>${f.big ? `<b>${esc(f.value || '—')}</b>` : `<i>${esc(f.value || '—')}</i>`}`;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.title)}</title><style>
    @page { size: A4 ${d.landscape ? 'landscape' : 'portrait'}; margin: 10mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 24px; }
    .hd { display: flex; align-items: center; gap: 18px; border: 2px solid #111; padding: 12px 16px; }
    .hd img { max-height: 64px; max-width: 170px; } .word { font: 700 22px Arial; color: #c8102e; }
    .mid { flex: 1; text-align: center; } .mid h1 { margin: 0; font: 700 26px Arial; letter-spacing: 1px; }
    .mid p { margin: 4px 0 0; font-size: 12px; line-height: 1.45; }
    .qr { text-align: center; font-size: 10px; } .qr svg { width: 88px; height: 88px; display: block; }
    .box { display: grid; grid-template-columns: ${d.details.map(() => '1fr').join(' ')}; border: 2px solid #111; border-top: 0; }
    .box > div { padding: 9px 14px; border-right: 1px solid #111; } .box > div:last-child { border-right: 0; }
    .box span { display: block; color: #555; font-size: 11px; text-transform: uppercase; letter-spacing: .3px; margin-top: 7px; }
    .box span:first-child { margin-top: 0; } .box b { font-size: 17px; } .box i { font-style: normal; font-size: 15px; }
    table { width: 100%; border-collapse: collapse; margin-top: 14px; }
    th, td { border: 1px solid #555; padding: 9px 11px; text-align: left; vertical-align: middle; font-size: ${d.tableFontPx ?? 15}px; }
    tfoot td { font-weight: 700; background: #f2f2f2; }
    .sec { border: 2px solid #111; margin-top: 14px; padding: 9px 14px; font-size: 14px; } .sec h3 { margin: 0 0 6px; font: 700 13px Arial; text-transform: uppercase; letter-spacing: .4px; }
    .sec .fl { display: flex; flex-wrap: wrap; gap: 6px 28px; } .sec .fl span { color: #555; font-size: 11px; text-transform: uppercase; display: block; } .sec ol { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.5; }
    .signs { display: flex; justify-content: space-between; gap: 24px; margin-top: 46px; font-size: 14px; } .signs div { flex: 1; border-top: 1px solid #111; padding-top: 6px; text-align: center; }
    th { background: #d4d4d4; font-weight: 700; } td.r, th.r { text-align: right; } td.nw { white-space: nowrap; }
    tbody tr { break-inside: avoid; page-break-inside: avoid; }
    ${d.rowHeight ? `tbody td { height: ${d.rowHeight}; }` : ''}
    .np { margin-bottom: 12px; } @media print { .np { display: none; } body { margin: 0; } }
  </style></head><body>
    <button class="np" onclick="window.print()">Print</button>
    <div class="hd"><div>${logo ? `<img src="${esc(logo)}" alt="${esc(c?.companyName ?? '')}">` : `<div class="word">${esc(c?.companyName ?? '')}</div>`}</div>
      <div class="mid"><h1>${esc(d.title)}</h1>${address ? `<p>${esc(address)}</p>` : ''}${contact ? `<p>${esc(contact)}</p>` : ''}</div>
      ${d.qr ? `<div class="qr">${qrSvg(d.qr)}${esc(d.qr)}</div>` : ''}</div>
    <div class="box">${d.details.map((col) => `<div>${col.map(field).join('')}</div>`).join('')}</div>
    <table><thead><tr>${d.columns.map((col) => `<th${col.right ? ' class="r"' : ''}${col.width ? ` style="width:${col.width}"` : ''}>${esc(col.label)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((v, i) => `<td class="${d.columns[i]?.right ? 'r' : ''} ${d.columns[i]?.nowrap ? 'nw' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')
      || `<tr><td colspan="${d.columns.length}" style="text-align:center">No shipments</td></tr>`}</tbody>
    ${d.totals ? `<tfoot><tr>${d.totals.map((v, i) => `<td class="${d.columns[i]?.right ? 'r' : ''}">${esc(v)}</td>`).join('')}</tr></tfoot>` : ''}</table>
    ${(d.sections ?? []).map((sec) => `<div class="sec"><h3>${esc(sec.title)}</h3>${sec.fields ? `<div class="fl">${sec.fields.map(([k, v]) => `<div><span>${esc(k)}</span>${esc(v)}</div>`).join('')}</div>` : ''}${sec.lines ? `<ol>${sec.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>` : ''}</div>`).join('')}
    ${d.signatures?.length ? `<div class="signs">${d.signatures.map((x) => `<div>${esc(x)}</div>`).join('')}</div>` : ''}
  </body></html>`);
  win.document.close();
  win.focus();
  return true;
}

function qrSvg(value: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  return qr.createSvgTag({ cellSize: 3, margin: 0 });
}

/** "27 Nov 2026". */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** An amount for a print cell: blank when there is none. */
export function money(v: number | null | undefined): string {
  return v ? Number(v).toFixed(2) : '';
}
