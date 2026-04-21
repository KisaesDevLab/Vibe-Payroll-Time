// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import QRCode from 'qrcode';

/**
 * Render a printable badge sheet as a standalone HTML document. Matches
 * the v1 "no puppeteer / no headless chromium" decision from CLAUDE.md —
 * the admin uses the browser's Save-as-PDF dialog on this page, same as
 * the timesheet PDF export.
 *
 * Sheet geometry targets Avery 5392 (4" × 3" name badge stock, 2-up).
 * Each badge shows the employee's name, employee number, the QR code,
 * the company name, and a small `vN` watermark so two versions don't
 * get confused in a stack.
 */

export interface BadgeSheetEntry {
  employeeId: number;
  firstName: string;
  lastName: string;
  employeeNumber: string | null;
  payload: string;
  version: number;
}

export interface RenderBadgeSheetArgs {
  companyName: string;
  entries: BadgeSheetEntry[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function renderOneBadge(entry: BadgeSheetEntry, companyName: string): Promise<string> {
  const qr = await QRCode.toDataURL(entry.payload, {
    errorCorrectionLevel: 'H',
    margin: 1,
    scale: 6,
  });
  const fullName = `${entry.firstName} ${entry.lastName}`.trim();
  const number = entry.employeeNumber ? `#${entry.employeeNumber}` : '';
  return `
    <div class="badge">
      <div class="badge__company">${escapeHtml(companyName)}</div>
      <div class="badge__body">
        <div class="badge__text">
          <div class="badge__name">${escapeHtml(fullName)}</div>
          <div class="badge__num">${escapeHtml(number)}</div>
        </div>
        <div class="badge__qr">
          <img src="${qr}" alt="QR code for ${escapeHtml(fullName)}" />
        </div>
      </div>
      <div class="badge__footer">
        <span class="badge__ver">v${entry.version}</span>
        <span class="badge__legal">Return if found</span>
      </div>
    </div>
  `;
}

export async function renderBadgeSheet(args: RenderBadgeSheetArgs): Promise<string> {
  const fragments = await Promise.all(args.entries.map((e) => renderOneBadge(e, args.companyName)));

  const company = escapeHtml(args.companyName);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Badge sheet — ${company}</title>
  <style>
    :root { color-scheme: light; }
    html, body {
      margin: 0;
      padding: 0;
      background: #f3f4f6;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
      color: #0f172a;
    }
    .toolbar {
      padding: 16px 24px;
      background: #1f2937;
      color: #f9fafb;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .toolbar button {
      background: #f59e0b;
      color: #0f172a;
      border: 0;
      padding: 8px 16px;
      border-radius: 4px;
      font-weight: 600;
      cursor: pointer;
    }
    .sheet {
      padding: 24px;
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
      max-width: 8.5in;
      margin: 0 auto;
    }
    .badge {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      background: #ffffff;
      padding: 12px 16px;
      height: 3in;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      break-inside: avoid;
    }
    .badge__company {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #64748b;
      font-weight: 600;
    }
    .badge__body {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 8px;
    }
    .badge__name {
      font-size: 20px;
      font-weight: 700;
      line-height: 1.1;
    }
    .badge__num {
      margin-top: 4px;
      font-size: 13px;
      color: #475569;
      font-variant-numeric: tabular-nums;
    }
    .badge__qr img {
      width: 1.6in;
      height: 1.6in;
      display: block;
    }
    .badge__footer {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: #94a3b8;
      font-family: "SF Mono", Menlo, Consolas, monospace;
      margin-top: 6px;
    }
    @media print {
      .toolbar { display: none; }
      html, body { background: #ffffff; }
      .sheet {
        padding: 0.25in;
        gap: 0.25in;
        max-width: none;
      }
      .badge { border: 1px dashed #cbd5e1; box-shadow: none; }
    }
    @page { size: Letter; margin: 0.25in; }
  </style>
</head>
<body>
  <div class="toolbar">
    <div>
      <strong>${company}</strong> · ${args.entries.length} badge${args.entries.length === 1 ? '' : 's'}
    </div>
    <button type="button" onclick="window.print()">Print / Save as PDF</button>
  </div>
  <div class="sheet">${fragments.join('')}</div>
</body>
</html>`;
}
