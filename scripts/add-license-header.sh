#!/bin/bash
# Copyright 2026 Kisaes LLC
# Licensed under the PolyForm Internal Use License 1.0.0.
# You may not distribute this software. See LICENSE for terms.
# scripts/add-license-header.sh
# Adds the PolyForm Internal Use license header to source files that are missing it.
#
# Scans first-party source trees: shared/, backend/, frontend/, plus knex
# migration files under backend/migrations/. Skips node_modules/, dist/,
# build/, .vite/, coverage/.
#
# Usage: ./scripts/add-license-header.sh

HEADER_PATTERN="Licensed under the PolyForm Internal Use License"
HEADER_SLASH='// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
'
HEADER_DASH='-- Copyright 2026 Kisaes LLC
-- Licensed under the PolyForm Internal Use License 1.0.0.
-- You may not distribute this software. See LICENSE for terms.
'
HEADER_HASH='# Copyright 2026 Kisaes LLC
# Licensed under the PolyForm Internal Use License 1.0.0.
# You may not distribute this software. See LICENSE for terms.
'
# ext:comment-style pairs
declare -A EXT_STYLE=(
  [ts]="slash" [tsx]="slash" [js]="slash" [jsx]="slash" [mjs]="slash" [cjs]="slash"
  [sql]="dash"
  [sh]="hash" [py]="hash"
)
SEARCH_ROOTS=("shared" "backend" "frontend" "scripts")
EXCLUDE_DIRS=("node_modules" ".git" "dist" "build" ".next" "coverage" ".vite")
ADDED=0

EXCLUDE_ARGS=""
for dir in "${EXCLUDE_DIRS[@]}"; do
  EXCLUDE_ARGS="$EXCLUDE_ARGS -not -path '*/$dir/*'"
done

pick_header() {
  case "$1" in
    slash) printf '%s' "$HEADER_SLASH" ;;
    dash)  printf '%s' "$HEADER_DASH" ;;
    hash)  printf '%s' "$HEADER_HASH" ;;
  esac
}

for ext in "${!EXT_STYLE[@]}"; do
  style="${EXT_STYLE[$ext]}"
  HEADER=$(pick_header "$style")
  while IFS= read -r file; do
    if ! head -5 "$file" | grep -q "$HEADER_PATTERN"; then
      # Preserve any `#!` shebang on line 1 regardless of comment style —
      # .mjs / .cjs / .js can all have shebangs, not just .sh / .py.
      if head -1 "$file" | grep -q "^#!"; then
        shebang=$(head -1 "$file")
        rest=$(tail -n +2 "$file")
        { echo "$shebang"; echo "$HEADER"; echo "$rest"; } > "$file.tmp" && mv "$file.tmp" "$file"
      else
        { echo "$HEADER"; cat "$file"; } > "$file.tmp" && mv "$file.tmp" "$file"
      fi
      echo "Added header: $file"
      ADDED=$((ADDED + 1))
    fi
  done < <(eval "find ${SEARCH_ROOTS[*]} -name '*.$ext' $EXCLUDE_ARGS -type f")
done

if [ $ADDED -eq 0 ]; then
  echo "All source files already have license headers."
else
  echo ""
  echo "Added headers to $ADDED file(s)."
fi
