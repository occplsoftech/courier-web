/** A plain printable sheet (Scan → DRS / Manifest tabs): title, key facts, and a table of AWBs. */
export function printSheet(title: string, facts: [string, string][], columns: string[], rows: string[][]): boolean {
  const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const win = window.open('', '_blank', 'width=900,height=900');
  if (!win) return false;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#111;font-size:12px} h1{font-size:18px;margin:0 0 10px}
    .facts{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 18px;margin-bottom:14px} .facts b{display:block;color:#555;font-size:10px;text-transform:uppercase}
    table{width:100%;border-collapse:collapse} th,td{border:1px solid #999;padding:5px 6px;text-align:left} th{background:#eee}
    .sign{margin-top:40px;display:flex;justify-content:space-between} @media print{.np{display:none}}</style></head><body>
    <button class="np" onclick="window.print()">Print</button><h1>${esc(title)}</h1>
    <div class="facts">${facts.map(([k, v]) => `<div><b>${esc(k)}</b>${esc(v)}</div>`).join('')}</div>
    <table><thead><tr><th>#</th>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <div class="sign"><span>Handed over by: ____________________</span><span>Received by: ____________________</span></div>
    </body></html>`);
  win.document.close();
  win.focus();
  return true;
}
