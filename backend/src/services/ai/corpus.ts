// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../config/logger.js';

/**
 * RAG corpus for the support chat. Phase 11 uses a simple "stuff every
 * bundled doc into the system prompt" approach — the docs/ tree is
 * small enough (a handful of markdown files under 40 KB total) that
 * proper vector search adds complexity without meaningful benefit.
 *
 * When the corpus grows, swap this module for an embedding-backed
 * retriever (pgvector is already available via the existing Postgres
 * container) without changing the caller API.
 */

const DOCS_ROOT = path.resolve(process.cwd(), '../docs');
const MAX_CORPUS_CHARS = 80_000;

let cached: string | null = null;

async function walk(dir: string, files: string[] = []): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }> = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else if (entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

export async function loadCorpus(): Promise<string> {
  if (cached) return cached;
  const files = await walk(DOCS_ROOT);
  const chunks: string[] = [];
  let totalChars = 0;

  for (const file of files.sort()) {
    try {
      const content = await fs.readFile(file, 'utf8');
      const relative = path.relative(DOCS_ROOT, file);
      const chunk = `### ${relative}\n${content.trim()}\n`;
      if (totalChars + chunk.length > MAX_CORPUS_CHARS) break;
      chunks.push(chunk);
      totalChars += chunk.length;
    } catch (err) {
      logger.warn({ err, file }, 'skipping unreadable doc');
    }
  }

  cached = chunks.join('\n');
  if (chunks.length === 0) {
    cached = '(no documentation bundled)';
  }
  return cached;
}

/** For tests: reset the memoized corpus so a temp-dir override takes effect. */
export function _resetCorpus(): void {
  cached = null;
}
