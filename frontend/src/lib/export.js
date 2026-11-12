/** Client-side exports: CSV download and printable report. */
const esc = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCSV = (rows, columns) =>
  [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(c.get(r))).join(','))].join('\r\n');

export function downloadCSV(filename, rows, columns) {
  const blob = new Blob(['﻿' + toCSV(rows, columns)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Print the current page using the @media print layout (see components/tools/print.css). */
export function printReport() {
  const prev = document.title;
  document.documentElement.setAttribute('data-printing', '1');
  const done = () => { document.documentElement.removeAttribute('data-printing'); document.title = prev; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1500);
}

export const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
