// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Build-time identifiers. In production Docker builds, these are overridden
 * via env vars baked in by the CI pipeline (GIT_SHA, BUILD_DATE). In dev,
 * they default to "dev" so the /version endpoint is still meaningful.
 */
export const VERSION = process.env.APP_VERSION ?? '0.0.0';
export const GIT_SHA = process.env.GIT_SHA ?? 'dev';
export const BUILD_DATE = process.env.BUILD_DATE ?? new Date().toISOString();
