#!/bin/sh
# Copyright 2026 Kisaes LLC
# Licensed under the PolyForm Internal Use License 1.0.0.
# You may not distribute this software. See LICENSE for terms.
#
# Phase 14.3 — substitute the build-version sentinel in the service
# worker so each release uses a unique cache name and the activate
# handler purges previous caches.
#
# The SW (frontend/public/sw.js) embeds `__VIBE_BUILD_VERSION__` in
# every cache name. APP_VERSION is the canonical build identifier
# (semver tag in tagged builds, git SHA otherwise) — passed to the
# Dockerfile build via build-args and propagated here as a runtime
# env so the same image can be re-tagged at deploy time without a
# rebuild. Falls back to a stable string for dev so the SW still
# registers and exercises the cache code paths during testing.

set -eu

version="${APP_VERSION:-${VIBE_BUILD_VERSION:-dev}}"

# Sanitize: cache names must be safe in Cache Storage's key space.
# Strip anything outside [A-Za-z0-9._-] so a stray slash from an env
# typo doesn't create a malformed cache name.
sanitized=$(printf '%s' "$version" | tr -c 'A-Za-z0-9._-' '_')

echo "[web-entrypoint] applying VIBE_BUILD_VERSION=$sanitized"

# Restrict to sw.js — no other file embeds this sentinel today, and a
# blanket sed across .js would force a re-substitution on every image
# restart even though only the SW cares.
find /usr/share/nginx/html -maxdepth 1 -type f -name 'sw.js' \
  -exec sed -i "s|__VIBE_BUILD_VERSION__|${sanitized}|g" {} +
