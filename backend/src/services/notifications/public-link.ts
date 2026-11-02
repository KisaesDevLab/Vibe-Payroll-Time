// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { env } from '../../config/env.js';

/**
 * Fully-qualified URL for links in emails and texts. Relative paths
 * (like '/my-punch') become broken anchors when an email client renders
 * the HTML, so prepend PUBLIC_URL when set; falling back to the first
 * ALLOWED_ORIGIN entry preserves pre-Phase-14 behavior for standalone
 * customers who haven't set PUBLIC_URL yet.
 */
export function publicUrl(relativePath: string): string {
  const base = (env.PUBLIC_URL ?? env.ALLOWED_ORIGIN.split(',')[0] ?? '')
    .trim()
    .replace(/\/+$/, '');
  if (!base) return relativePath;
  const path = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  return `${base}${path}`;
}
