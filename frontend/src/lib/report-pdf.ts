// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import type { ReportColumn, ReportResult } from '@vibept/shared';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * Report PDFs, built in the browser with jsPDF + jspdf-autotable (the
 * same pair Vibe MyBooks uses for its register). Nothing is rendered on
 * the server: the appliance carries no headless Chromium.
 *
 * Layout follows the MyBooks report PDFs: Letter, company name, report
 * title, then a grey line with the period and filters; a ruled table
 * with a light-grey uppercase header; TOTAL rows in bold. Landscape once
 * a report has more than six columns. Every page carries the report
 * name, "generated" time and page number in the footer.
 */

export interface ReportPdfInput {
  companyName: string;
  title: string;
  /** Period and filters, e.g. "10/01/2026 to 10/31/2026 · Employee: Ana Alberto". */
  meta: string;
  result: ReportResult;
  /** Columns to print (the ones visible on screen). */
  columns: ReportColumn[];
  formatCell: (value: unknown, column: ReportColumn) => string;
}

const MARGIN = 36; // 0.5in in points
const isNumeric = (c: ReportColumn) => c.type === 'hours' || c.type === 'number';

/** A summary row a report appends (e.g. the time card's TOTAL lines). */
function isTotalRow(row: Record<string, unknown>): boolean {
  return Object.values(row).some((v) => typeof v === 'string' && /^(TOTAL|TIME OFF ·)/.test(v));
}

export function buildReportPdf(input: ReportPdfInput): jsPDF {
  const { columns, result } = input;
  const landscape = columns.length > 6;
  const doc = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'pt',
    format: 'letter',
  });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const generated = new Date(result.generatedAt).toLocaleString();

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(17, 24, 39);
  doc.text(input.companyName, MARGIN, MARGIN + 6);
  doc.setFontSize(12);
  doc.text(input.title, MARGIN, MARGIN + 24);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  const metaLines = doc.splitTextToSize(input.meta, pageW - MARGIN * 2) as string[];
  doc.text(metaLines, MARGIN, MARGIN + 38);
  const startY = MARGIN + 38 + metaLines.length * 11 + 6;

  // Wide reports get a smaller type size so columns fit the page.
  const fontSize = columns.length > 10 ? 7 : columns.length > 7 ? 8 : 9;

  autoTable(doc, {
    startY,
    head: [columns.map((c) => c.label.toUpperCase())],
    body: result.rows.map((row) => columns.map((c) => input.formatCell(row[c.key], c))),
    theme: 'plain',
    margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN + 14 },
    styles: {
      font: 'helvetica',
      fontSize,
      cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
      textColor: [31, 41, 55],
      lineColor: [229, 231, 235],
      lineWidth: { bottom: 0.5 },
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [243, 244, 246],
      textColor: [55, 65, 81],
      fontStyle: 'bold',
      fontSize: fontSize - 1,
      lineColor: [209, 213, 219],
      lineWidth: { bottom: 1.5 },
    },
    columnStyles: Object.fromEntries(
      columns.map((c, i) => [i, isNumeric(c) ? { halign: 'right' as const } : {}]),
    ),
    didParseCell: (data) => {
      const column = columns[data.column.index];
      if (data.section === 'head' && column && isNumeric(column)) {
        data.cell.styles.halign = 'right';
      }
      if (data.section !== 'body') return;
      const row = result.rows[data.row.index];
      if (row && isTotalRow(row)) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [250, 250, 250];
      }
    },
  });

  if (result.rows.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(107, 114, 128);
    doc.text('No rows for this period.', MARGIN, startY + 40);
  }

  // Footer on every page.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(156, 163, 175);
    doc.text(`${input.title} · generated ${generated}`, MARGIN, pageH - MARGIN / 2);
    doc.text(`Page ${p} of ${pages}`, pageW - MARGIN, pageH - MARGIN / 2, { align: 'right' });
  }
  return doc;
}

/** "Hours by pay period" → "Hours_by_pay_period_2026-10-01.pdf". */
export function reportPdfFilename(title: string, periodStart?: string): string {
  const base =
    title
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_') || 'report';
  return `${base}${periodStart ? `_${periodStart}` : ''}.pdf`;
}

/**
 * Show the PDF in a tab the caller opened synchronously in the click
 * handler (so pop-up blockers see the user's click), the way MyBooks
 * opens report PDFs. Without a tab, download it instead.
 */
export function showPdf(tab: Window | null, doc: jsPDF, filename: string): void {
  const url = URL.createObjectURL(doc.output('blob'));
  if (tab) {
    tab.location.href = url;
  } else {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  // Long enough for the new tab to load it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
