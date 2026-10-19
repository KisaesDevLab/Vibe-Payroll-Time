#!/bin/bash
# Copyright 2026 Kisaes LLC
# SPDX-License-Identifier: MIT
# scripts/check-license-headers.sh [file1 file2 ...]
# Fails if any source file is missing the MIT license header.
# Without arguments: scans every source file under shared/, backend/, frontend/
# (full audit mode). With arguments: scans only the supplied files
# (lint-staged / CI diff mode).

HEADER_PATTERN="SPDX-License-Identifier: MIT"
EXTENSIONS=("ts" "tsx" "js" "jsx" "mjs" "cjs" "sql" "sh" "py")
SEARCH_ROOTS=("shared" "backend" "frontend" "scripts")
EXCLUDE_DIRS=("node_modules" ".git" "dist" "build" ".next" "coverage" ".vite")
MISSING=0

is_tracked_ext() {
  local f="$1"
  for ext in "${EXTENSIONS[@]}"; do
    [[ "$f" == *.$ext ]] && return 0
  done
  return 1
}

check_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  if ! head -5 "$file" | grep -q "$HEADER_PATTERN"; then
    echo "MISSING HEADER: $file"
    MISSING=$((MISSING + 1))
  fi
}

if [ $# -gt 0 ]; then
  # Argument mode: check only the files provided (filtered by extension).
  for file in "$@"; do
    is_tracked_ext "$file" || continue
    check_file "$file"
  done
else
  # Full-audit mode.
  EXCLUDE_ARGS=""
  for dir in "${EXCLUDE_DIRS[@]}"; do
    EXCLUDE_ARGS="$EXCLUDE_ARGS -not -path '*/$dir/*'"
  done
  for ext in "${EXTENSIONS[@]}"; do
    while IFS= read -r file; do
      check_file "$file"
    done < <(eval "find ${SEARCH_ROOTS[*]} -name '*.$ext' $EXCLUDE_ARGS -type f")
  done
fi

if [ $MISSING -gt 0 ]; then
  echo ""
  echo "ERROR: $MISSING file(s) missing the MIT license header."
  echo "Run: npm run license:headers:fix"
  exit 1
fi

echo "All source files have license headers."
exit 0
