import qrcode from 'qrcode-generator';
import { CompanyLetterhead } from '@features/company/company-profile.service';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** One line under the title: a label and value, on the left or pushed to the right. */
export interface PrintFact { label: string; value: string; right?: boolean; }

export interface LetterheadSheet {
  /** "DELIVERY RUN SHEET", "MANIFEST". */
  title: string;
  company: CompanyLetterhead | null;
  /** Fallback when the company has no logo uploaded. */
  logo?: string | null;
  /** Lines of facts; facts on one line share it (left, then right-aligned ones). */
  lines: PrintFact[][];
  /** Encoded in a QR code beside the facts (the DRS ID / manifest number), so the sheet can be scanned. */
  qr?: string | null;
  /** nowrap: an AWB / forwarder number stays on one line. */
  columns: { label: string; width?: string; right?: boolean; nowrap?: boolean }[];
  rows: string[][];
  /** Minimum height of each table row, e.g. '35mm' on the DRS so a receiver's stamp fits inside its own row. */
  rowHeight?: string;
}

/**
 * The OCCPL letterhead print (DRS and manifest, as the company's own sample sheets): logo left, title centred,
 * registered office / phones / email right, a rule, the facts, then a grey-headed table.
 */
export function printLetterhead(d: LetterheadSheet): boolean {
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) return false;
  const c = d.company;
  const logo = c?.logo || d.logo;
  const office = [c?.addressLine1, c?.addressLine2, [c?.city, c?.postalCode].filter(Boolean).join(' - ')].filter(Boolean);
  const contact = [
    ...office.map((l) => esc(l)),
    c?.mobile ? `Mobile: ${esc(c.mobile)}` : '',
    c?.email ? `Email: ${esc(c.email)}` : '',
    c?.website ? esc(c.website) : ''
  ].filter(Boolean);
  const line = (facts: PrintFact[]) => {
    const left = facts.filter((f) => !f.right), right = facts.filter((f) => f.right);
    const fmt = (f: PrintFact) => `<span>${esc(f.label)}: ${esc(f.value)}</span>`;
    return `<div class="ln"><div>${left.map(fmt).join(' ')}</div><div>${right.map(fmt).join(' ')}</div></div>`;
  };
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.title)}</title><style>
    @page { size: A4; margin: 14mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #222; margin: 24px; font-size: 13px; }
    .hd { display: grid; grid-template-columns: 1fr auto 1fr; align-items: start; gap: 16px; }
    .hd img { max-height: 64px; max-width: 160px; } .word { font: 700 24px Arial; color: #c8102e; }
    .hd h1 { margin: 10px 0 0; font: 400 32px Arial; letter-spacing: .5px; text-align: center; white-space: nowrap; }
    .co { text-align: right; font-size: 10.5px; line-height: 1.5; }
    hr { border: 0; border-top: 3px solid #111; margin: 14px 0 18px; }
    .facts { display: flex; gap: 20px; align-items: center; } .facts > div:first-child { flex: 1; }
    .qr { text-align: center; font-size: 10px; } .qr svg { width: 92px; height: 92px; display: block; }
    .ln { display: flex; justify-content: space-between; gap: 16px; font-size: 15px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; box-shadow: 0 1px 2px rgb(0 0 0 / 25%); }
    th, td { border: 1px solid #555; padding: 10px 12px; text-align: left; vertical-align: middle; font-size: 13px; }
    th { background: #d4d4d4; font-weight: 700; } td.r, th.r { text-align: right; } td.nw { white-space: nowrap; }
    tbody tr { break-inside: avoid; page-break-inside: avoid; }
    ${d.rowHeight ? `tbody td { height: ${d.rowHeight}; }` : ''}
    .np { margin-bottom: 12px; } @media print { .np { display: none; } body { margin: 0; } }
  </style></head><body>
    <button class="np" onclick="window.print()">Print</button>
    <div class="hd"><div>${logo ? `<img src="${esc(logo)}" alt="${esc(c?.companyName ?? '')}">` : `<div class="word">${esc(c?.companyName ?? '')}</div>`}</div>
      <h1>${esc(d.title)}</h1><div class="co">${contact.join('<br>')}</div></div>
    <hr>
    <div class="facts"><div>${d.lines.map(line).join('')}</div>${d.qr ? `<div class="qr">${qrSvg(d.qr)}${esc(d.qr)}</div>` : ''}</div>
    <table><thead><tr>${d.columns.map((col) => `<th${col.right ? ' class="r"' : ''}${col.width ? ` style="width:${col.width}"` : ''}>${esc(col.label)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((v, i) => `<td class="${d.columns[i]?.right ? 'r' : ''} ${d.columns[i]?.nowrap ? 'nw' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>
  </body></html>`);
  win.document.close();
  win.focus();
  return true;
}

/** "26 November 2026" style, as the DRS sample prints it. */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** An amount for a print cell: blank when there is none. */
export function money(v: number | null | undefined): string {
  return v ? Number(v).toFixed(2) : '';
}

function qrSvg(value: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  return qr.createSvgTag({ cellSize: 3, margin: 0 });
}
