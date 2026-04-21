#!/usr/bin/env bash
# Copyright 2026 Kisaes LLC
# Licensed under the PolyForm Internal Use License 1.0.0.
# You may not distribute this software. See LICENSE for terms.
# =============================================================================
# license-audit.sh — Automated license compliance audit for Vibe Payroll Time
# License: PolyForm Internal Use 1.0.0 (SEE LICENSE IN LICENSE)
#
# Usage:  ./scripts/license-audit.sh [--quiet] [--json]
#   --quiet   Suppress passing checks; show only warnings and failures
#   --json    Write machine-readable results to scripts/license-audit-result.json
#
# Requires: node, npm, npx
# On first run installs license-checker via npx (cached automatically).
#
# Mirrors the TB / MB audit pass. Run before major releases, when accepting
# external contributions, or after adding multiple dependencies.
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POLICY="$ROOT/scripts/license-policy.json"
REPORT="$ROOT/scripts/license-audit-result.txt"
QUIET=false
EMIT_JSON=false

for arg in "$@"; do
  case $arg in
    --quiet) QUIET=true ;;
    --json)  EMIT_JSON=true ;;
  esac
done

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[0;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

pass()  { $QUIET || echo -e "${GREEN}  ✔ $*${RESET}"; }
warn()  { echo -e "${YELLOW}  ⚠  $*${RESET}"; }
fail()  { echo -e "${RED}  ✘ $*${RESET}"; }
info()  { echo -e "${CYAN}  ▶ $*${RESET}"; }
header(){ echo -e "\n${BOLD}${CYAN}══ $* ══${RESET}"; }

FAILURES=0
WARNINGS=0

bump_fail() { FAILURES=$((FAILURES+1)); }
bump_warn() { WARNINGS=$((WARNINGS+1)); }

# ── 1. Required project files ─────────────────────────────────────────────────
header "1. Required project files"

if [[ -f "$ROOT/LICENSE" ]]; then
  pass "LICENSE file present"
else
  fail "LICENSE file MISSING — required for PolyForm Internal Use compliance"
  bump_fail
fi

if [[ -f "$ROOT/LICENSE-COMMERCIAL.md" ]]; then
  pass "LICENSE-COMMERCIAL.md present (reseller / client-portal tier)"
else
  warn "LICENSE-COMMERCIAL.md missing — required for commercial-tier deployments"
  bump_warn
fi

if [[ -f "$ROOT/NOTICE" ]]; then
  pass "NOTICE file present"
else
  warn "NOTICE file missing — recommended for attribution"
  bump_warn
fi

if [[ -f "$ROOT/README.md" ]] || [[ -f "$ROOT/README" ]]; then
  pass "README present"
else
  warn "No README found"
  bump_warn
fi

# ── 2. Licensor preamble on LICENSE ──────────────────────────────────────────
header "2. LICENSE preamble"

if head -4 "$ROOT/LICENSE" 2>/dev/null | grep -q "Licensor:.*Kisaes LLC"; then
  pass "LICENSE carries the Kisaes LLC licensor preamble"
else
  fail "LICENSE is missing the licensor preamble"
  fail "Expected first line: Licensor:  Kisaes LLC"
  bump_fail
fi

# ── 3. PolyForm source file headers ──────────────────────────────────────────
header "3. Source file headers"

HEADER_PATTERN="Licensed under the PolyForm Internal Use License|Copyright.*Kisaes"

# Scan first-party source trees only. Exclude build output, caches,
# node_modules. Using a function + array here rather than an `eval`-ed
# string so shell globbing never expands the exclusion patterns against
# the cwd (a `frontend/dist/` present on disk breaks the `eval` form
# with `find: paths must precede expression`).
collect_source_files() {
  find "$ROOT/shared" "$ROOT/backend" "$ROOT/frontend" "$ROOT/scripts" \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.sh' \) \
    -not -path '*/node_modules/*' \
    -not -path '*/dist/*' \
    -not -path '*/build/*' \
    -not -path '*/.next/*' \
    -not -path '*/coverage/*' \
    -not -path '*/.vite/*' \
    -type f 2>/dev/null
}
TS_FILES=$(collect_source_files | wc -l | tr -d ' ' || true)
HEADERS_FOUND=$(collect_source_files | { xargs grep -l -E "$HEADER_PATTERN" 2>/dev/null || true; } | wc -l | tr -d ' ' || true)
TS_FILES=${TS_FILES:-0}
HEADERS_FOUND=${HEADERS_FOUND:-0}

info "$HEADERS_FOUND / $TS_FILES source files have license headers"

if [[ "$HEADERS_FOUND" -eq 0 ]]; then
  fail "No source files contain license headers"
  fail "Required header:  // Licensed under the PolyForm Internal Use License 1.0.0"
  fail "Run: bash scripts/add-license-header.sh"
  bump_fail
elif [[ "$HEADERS_FOUND" -lt "$TS_FILES" ]]; then
  fail "$(( TS_FILES - HEADERS_FOUND )) source files missing license headers"
  fail "Run: bash scripts/add-license-header.sh"
  bump_fail
else
  pass "All source files have license headers"
fi

# ── 4. Source code visibility ────────────────────────────────────────────────
header "4. Source code visibility"

S13_PATTERN="source|Source|github|GitHub|repository|git\.io"
S13_HITS=$(grep -r -l -E "$S13_PATTERN" \
  "$ROOT/frontend/src" 2>/dev/null | wc -l | tr -d ' ')

if [[ "$S13_HITS" -gt 0 ]]; then
  pass "Found source-code link in client source ($S13_HITS file(s))"
  info "Verify a visible link to the source repo exists in the UI (footer, About page, etc.)"
else
  warn "No source-code link detected in UI source"
  warn "Recommended: add a link to the source repository in the app footer"
  bump_warn
fi

# ── 5. Vendored / embedded third-party code ──────────────────────────────────
header "5. Vendored / embedded third-party code"

VENDOR_DIRS=$(find "$ROOT" \
  -not -path "*/node_modules/*" \
  -not -path "*/.git/*" \
  -type d \( -name "vendor" -o -name "vendors" -o -name "third_party" -o -name "thirdparty" \) 2>/dev/null)

if [[ -z "$VENDOR_DIRS" ]]; then
  pass "No vendor directories found"
else
  warn "Vendor directories found — manually verify licenses:"
  echo "$VENDOR_DIRS" | while read -r d; do warn "  $d"; done
  bump_warn
fi

# Check for bundled minified third-party files
MINIFIED=$(find "$ROOT/backend" "$ROOT/frontend" "$ROOT/shared" \
  -not -path "*/node_modules/*" \
  \( -name "*.min.js" -o -name "*.min.css" \) 2>/dev/null || true)

if [[ -n "$MINIFIED" ]]; then
  warn "Minified files found in source (may be vendored third-party code):"
  echo "$MINIFIED" | while read -r f; do warn "  $f"; done
  bump_warn
else
  pass "No minified files in source tree"
fi

# ── 6. Dependency license scan ───────────────────────────────────────────────
header "6. Dependency licenses"

if [[ ! -d "$ROOT/node_modules" ]]; then
  warn "node_modules not installed — run: npm install"
  bump_warn
else
  info "Scanning workspace dependencies with license-checker…"
  WORKSPACE_LICENSES=$(cd "$ROOT" && npx --yes license-checker \
    --excludePrivatePackages --summary 2>/dev/null || true)
  echo "$WORKSPACE_LICENSES" | while read -r line; do
    echo "  $line"
  done

  # Check for denied licenses
  DENIED_PATTERN="GPL-2.0-only|SSPL|AGPL|Commons Clause|Proprietary|Commercial|UNLICENSED"
  WORKSPACE_DENIED=$(cd "$ROOT" && npx license-checker \
    --excludePrivatePackages --csv 2>/dev/null \
    | grep -E "$DENIED_PATTERN" || true)

  if [[ -n "$WORKSPACE_DENIED" ]]; then
    fail "Denied licenses found in dependencies:"
    echo "$WORKSPACE_DENIED" | while read -r line; do fail "  $line"; done
    bump_fail
  else
    pass "No denied licenses in dependencies"
  fi

  # Check for unlicensed packages
  WORKSPACE_UNLICENSED=$(cd "$ROOT" && npx license-checker \
    --excludePrivatePackages --csv 2>/dev/null \
    | grep -i '"Custom:' || true)

  if [[ -n "$WORKSPACE_UNLICENSED" ]]; then
    warn "Packages with non-standard/custom license entries (manual review required):"
    echo "$WORKSPACE_UNLICENSED" | while read -r line; do warn "  $line"; done
    bump_warn
  fi
fi

# ── 7. Known issues from policy file ─────────────────────────────────────────
header "7. Known issues (from license-policy.json)"

if command -v node &>/dev/null && [[ -f "$POLICY" ]]; then
  POLICY_PATH="$POLICY" node -e '
    const p = require(process.env.POLICY_PATH);
    (p.knownIssues || []).forEach(i => {
      const sev = i.severity === "HIGH" ? "✘ HIGH" : "⚠  " + i.severity;
      console.log("  " + sev + " — " + i.package + "@" + i.version);
      console.log("    License : " + (i.detectedLicense || i.actualLicense));
      console.log("    Action  : " + (i.action || i.resolution || ""));
      console.log("");
    });
  ' 2>/dev/null || warn "Could not parse license-policy.json"
else
  warn "license-policy.json not found or node unavailable"
fi

info "PolyForm Internal Use requirements:"
POLICY_PATH="$POLICY" node -e '
  const p = require(process.env.POLICY_PATH);
  const r = p.polyformRequirements || {};
  Object.entries(r).forEach(([k, v]) => {
    const status = v.status || "";
    const ok = status.toLowerCase().includes("missing") ||
                status.toLowerCase().includes("not ") ? false : true;
    const icon = ok ? "✔" : "✘";
    console.log("  " + icon + " " + k + ": " + status);
  });
' 2>/dev/null || true

# ── 8. Summary ───────────────────────────────────────────────────────────────
header "8. Audit Summary"

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
echo ""
echo "  Timestamp : $TIMESTAMP"
echo "  Failures  : $FAILURES"
echo "  Warnings  : $WARNINGS"
echo ""

if [[ $FAILURES -gt 0 ]]; then
  echo -e "${RED}${BOLD}  AUDIT FAILED — $FAILURES issue(s) require attention before distribution.${RESET}"
elif [[ $WARNINGS -gt 0 ]]; then
  echo -e "${YELLOW}${BOLD}  AUDIT PASSED WITH WARNINGS — $WARNINGS item(s) need review.${RESET}"
else
  echo -e "${GREEN}${BOLD}  AUDIT PASSED — No issues found.${RESET}"
fi

# Save plain-text report
{
  echo "Vibe Payroll Time License Audit"
  echo "Timestamp: $TIMESTAMP"
  echo "Failures: $FAILURES  |  Warnings: $WARNINGS"
  echo ""
  echo "Run ./scripts/license-audit.sh for full details."
  echo "See scripts/license-policy.json for policy and known issues."
} > "$REPORT"

# Machine-readable JSON report (for CI consumption)
if $EMIT_JSON; then
  JSON_REPORT="$ROOT/scripts/license-audit-result.json"
  STATUS="pass"
  if [[ $FAILURES -gt 0 ]]; then STATUS="fail"
  elif [[ $WARNINGS -gt 0 ]]; then STATUS="warn"; fi
  cat > "$JSON_REPORT" <<EOF
{
  "timestamp": "$TIMESTAMP",
  "status": "$STATUS",
  "failures": $FAILURES,
  "warnings": $WARNINGS,
  "headerCoverage": {
    "filesWithHeaders": $HEADERS_FOUND,
    "totalSourceFiles": $TS_FILES
  },
  "policyFile": "scripts/license-policy.json",
  "reportFile": "scripts/license-audit-result.txt"
}
EOF
  echo "  JSON report saved to: scripts/license-audit-result.json"
fi

echo ""
echo "  Report saved to: scripts/license-audit-result.txt"
echo ""

exit $FAILURES
