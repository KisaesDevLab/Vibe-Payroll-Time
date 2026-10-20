// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT

/**
 * Compose a printable badge card as a PNG: company name, employee name and
 * the QR code. Drawn client-side on a canvas because the raw badge payload
 * only exists in the issue response (see CLAUDE.md: never stored server-side).
 *
 * Size is the standard CR80 card (3.375" x 2.125") at 300 dpi, so it prints
 * at true size on PVC card printers and fits a standard name-badge holder.
 */

const WIDTH = 1013;
const HEIGHT = 638;

export interface BadgeCardArgs {
  companyName: string;
  employeeName: string;
  employeeNumber?: string | null;
  qrDataUrl: string;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load QR image.'));
    img.src = src;
  });
}

/** Shrink the font until `text` fits `maxWidth`, then return the fitted size. */
function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: string,
  startPx: number,
  minPx: number,
  maxWidth: number,
): number {
  let size = startPx;
  while (size > minPx) {
    ctx.font = `${weight} ${size}px system-ui, "Segoe UI", Roboto, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

export async function renderBadgeCardPng(args: BadgeCardArgs): Promise<string> {
  const qr = await loadImage(args.qrDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Company band across the top.
  const bandH = 110;
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, WIDTH, bandH);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  const company = args.companyName.toUpperCase();
  fitFont(ctx, company, '700', 46, 24, WIDTH - 80);
  ctx.fillText(company, 40, bandH / 2);

  // QR on the right, with a quiet zone from the white card around it.
  const qrSize = 400;
  const qrX = WIDTH - qrSize - 40;
  const qrY = bandH + (HEIGHT - bandH - qrSize) / 2;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qr, qrX, qrY, qrSize, qrSize);

  // Name on the left, wrapped onto two lines at the first space past the middle
  // when it won't fit at a readable size on one.
  const textW = qrX - 40 - 30;
  const lines = splitName(ctx, args.employeeName, textW);
  ctx.fillStyle = '#0f172a';
  ctx.textBaseline = 'alphabetic';
  const size = Math.min(...lines.map((l) => fitFont(ctx, l, '700', 76, 36, textW)));
  ctx.font = `700 ${size}px system-ui, "Segoe UI", Roboto, sans-serif`;
  const lineH = size * 1.15;
  const blockH = lineH * lines.length;
  const startY = bandH + (HEIGHT - bandH) / 2 - blockH / 2 + size * 0.85;
  lines.forEach((l, i) => ctx.fillText(l, 40, startY + i * lineH));

  if (args.employeeNumber) {
    ctx.fillStyle = '#475569';
    ctx.font = '500 34px system-ui, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(`#${args.employeeNumber}`, 40, startY + blockH + 24);
  }

  return canvas.toDataURL('image/png');
}

function splitName(ctx: CanvasRenderingContext2D, name: string, maxWidth: number): string[] {
  const trimmed = name.trim();
  ctx.font = '700 76px system-ui, "Segoe UI", Roboto, sans-serif';
  if (ctx.measureText(trimmed).width <= maxWidth) return [trimmed];
  const words = trimmed.split(/\s+/);
  if (words.length < 2) return [trimmed];
  // Break before the last word: "First Middle" / "Last".
  return [words.slice(0, -1).join(' '), words[words.length - 1]!];
}
