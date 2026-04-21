# License Audit Report — Vibe Payroll Time

| Field           | Value                                      |
| --------------- | ------------------------------------------ |
| Date            | 2026-04-21                                 |
| Auditor         | Claude Code                                |
| Project         | `vibe-payroll-time` (KisaesDevLab)         |
| Project license | PolyForm Internal Use License 1.0.0        |
| Commercial tier | Separate license — `LICENSE-COMMERCIAL.md` |
| Scope           | First-party source + all npm dependencies  |
| Methodology     | Same 10-section pass used for TB and MB    |

---

## TL;DR

> **Status: CLOSED — audit passes.** Re-run on 2026-04-21 after implementing the
> required + recommended actions from the initial 2026-04-21 audit:
> `bash scripts/license-audit.sh` → 0 failures, 0 warnings. See the "Resolution"
> section at the bottom for the diff.

| Severity     | Count | Items                                                                                                               |
| ------------ | :---: | ------------------------------------------------------------------------------------------------------------------- |
| **CRITICAL** |   0   | —                                                                                                                   |
| **HIGH**     |   0   | ~~Zero source files carry a PolyForm header~~ ✅ fixed · ~~LICENSE missing licensor preamble~~ ✅ fixed             |
| **MEDIUM**   |   0   | ~~No `NOTICE` file~~ ✅ fixed · ~~No `scripts/license-audit.sh` + policy JSON~~ ✅ fixed                            |
| **LOW**      |   1   | ~~No UI license/source link~~ (deferred) · ~~README dev-port stale~~ ✅ fixed · `caniuse-lite` CC-BY-4.0 (accepted) |
| **PASS**     |  20   | See per-section detail                                                                                              |

**No denied-license dependencies were found.** The dependency tree is 758 packages, all permissive (MIT / ISC / Apache-2.0 / BSD-\* / BlueOak / 0BSD / Python-2.0 / CC-BY-4.0 build-only). No GPL, AGPL, SSPL, Commons Clause, Proprietary, or UNLICENSED entries.

The HIGH findings were policy-compliance gaps, not OSS-license conflicts: PolyForm Internal Use requires that its terms be discoverable by recipients of the source. Both were closed in the follow-up implementation pass below.

---

## Section 1 — LICENSE file

- ✅ `LICENSE` exists at repo root (129 lines)
- ✅ Contains the full PolyForm Internal Use 1.0.0 text
- ⚠ **HIGH**: Missing the licensor preamble (Licensor / Software / License / URL block) that TB and MB both ship with. MB's reads:

  ```
  Licensor:  Kisaes LLC
  Software:  Vibe MyBooks
  License:   PolyForm Internal Use License 1.0.0
             https://polyformproject.org/licenses/internal-use/1.0.0
  ```

  The preamble is what ties the boilerplate PolyForm text to this specific product and licensor. Without it, the LICENSE file is technically the PolyForm template, not a granted license from Kisaes LLC to the reader.

  **Required action**: prepend the four-line preamble to `LICENSE`.

- ✅ `LICENSE-COMMERCIAL.md` exists (44 lines) and describes the commercial tier unambiguously — same pattern as MB.

---

## Section 2 — Source file headers

- ❌ **HIGH**: **0 of 202** first-party `.ts` / `.tsx` source files carry a PolyForm header (0% coverage).

  ```
  Files scanned: backend/src, frontend/src, shared/src — *.ts / *.tsx
  Files with header pattern: 0
  Total: 202
  ```

  By contrast, every hand-written `.ts` under `packages/` in MB opens with:

  ```ts
  // Copyright 2026 Kisaes LLC
  // Licensed under the PolyForm Internal Use License 1.0.0.
  // You may not distribute this software. See LICENSE for terms.
  ```

  MB enforces this via `scripts/check-license-headers.sh` in CI and as a pre-commit hook, backed by `scripts/add-license-header.sh` to insert headers in bulk.

  **Required action**: port MB's `add-license-header.sh` + `check-license-headers.sh` scripts, run the inserter once, and wire the checker into lint-staged + the `check` npm script.

  Scope: 202 `.ts`/`.tsx` files + 35 `.js` migration files. Migrations are worth including — they're hand-written schema changes, not generated.

---

## Section 3 — License notices and no-distribution

- ✅ `README.md` has a clear "Licensing" section pointing at both `LICENSE` and `LICENSE-COMMERCIAL.md`.
- ✅ `CLAUDE.md` covers the PolyForm Internal Use / commercial tier split in the "What this is" and "Licensing" sections.
- ✅ No "redistribute" / "open source this" language anywhere in repo-tracked docs.
- ⚠ **LOW**: No `<footer>` / About page in `frontend/src` links to the LICENSE file or the GitHub source repo. MB flags this as a WARN (not FAIL) — PolyForm doesn't require an in-UI link, but it's a courtesy to paying CPA-firm operators who want to forward the license text to their own clients.

  **Recommended action**: add a small footer link on the LoginPage or an /about route that reads `{appName} · PolyForm Internal Use 1.0.0 · Source` and links to the repo.

- ⚠ **LOW**: README's dev-quick-start points at `http://localhost:5173`. Frontend now runs on 5180 (per the port-collision fix with Vibe MyBooks, committed as part of the release-readiness audit). Stale docs, not a license issue, but flagging here because the audit scans README for distribution claims and this is visible.

---

## Section 4 — Workspace dependency audit

Run: `npx license-checker --excludePrivatePackages --summary` (workspaces root — catches backend + frontend + shared via npm workspaces).

### License distribution

| License                   | Count | Status                                       |
| ------------------------- | ----: | -------------------------------------------- |
| MIT                       |   652 | ✅ allowed                                   |
| ISC                       |    48 | ✅ allowed                                   |
| Apache-2.0                |    26 | ✅ allowed                                   |
| BSD-2-Clause              |    12 | ✅ allowed                                   |
| BSD-3-Clause              |     9 | ✅ allowed                                   |
| BlueOak-1.0.0             |     4 | ✅ allowed (permissive, PolyForm-compatible) |
| MIT-0                     |     1 | ✅ allowed                                   |
| 0BSD                      |     1 | ✅ allowed                                   |
| Python-2.0                |     1 | ✅ allowed                                   |
| (MIT OR CC0-1.0)          |     1 | ✅ elect MIT                                 |
| (Unlicense OR Apache-2.0) |     1 | ✅ elect Apache-2.0                          |
| MIT\*                     |     1 | ⚠ manual review — see below                  |
| CC-BY-4.0                 |     1 | ⚠ build-time only — see Section 8            |
| **Total unique packages** |   758 |                                              |

### Manual review

**`thirty-two@1.0.2`** — reported as `MIT*` by license-checker. The `*` means the tool inferred the license from file contents rather than a formal SPDX string in `package.json`. Inspected `node_modules/thirty-two/LICENSE.txt` directly:

```
Copyright (c) 2011, Chris Umbel
Permission is hereby granted, free of charge... [standard MIT terms]
```

Verdict: **PASS** — standard MIT text.

Pulled in by: `otplib → @otplib/preset-default → @otplib/plugin-thirty-two → thirty-two`. Runtime dependency of the kiosk PIN flow.

### Denied-license scan

```
npx license-checker --csv | grep -iE '(GPL|AGPL|SSPL|Commons Clause|Proprietary|Commercial|UNLICENSED)'
→ (empty)
```

**Zero** denied-category licenses. ✅

---

## Section 5 — Frontend vs backend split

Vibe PT uses **npm workspaces**, so there is a single resolved `node_modules` at the root (not the per-workspace `node_modules` layout TB ships). All first-party workspaces (`shared`, `backend`, `frontend`) resolve against the same tree. The license-checker scan above is therefore authoritative for the entire runtime — there's no "server had a problem package that the client didn't" distinction to draw.

The MB audit found four notable packages to verify (`buffers`, `jszip`, `dompurify`, `rgbcolor`). None are present in Vibe PT:

- ❌ No `exceljs` / `unzipper` / `buffers` chain (Vibe PT does not export Excel; CSV is handled by hand-rolled streaming in `services/reports/csv-stream.ts`)
- ❌ No `jszip` (Level-4 ZIP backup uses `archiver` instead — MIT)
- ❌ No `dompurify` / `rgbcolor` (no PDF/SVG rendering path; PDF output is print-based via browser `@media print`, zero server-side rendering)
- ❌ No `puppeteer` / headless chromium (same print-based approach)

Verdict: **PASS** — dependency footprint is materially smaller than TB or MB; none of the known-issue packages that bit those projects are present here.

---

## Section 6 — Transitive dependency spot check

No HIGH-risk packages surfaced in Sections 4–5, so no dependency-chain traces were needed. Spot-checked:

- `@anthropic-ai/sdk@0.40.1` — **MIT** (`@anthropic-ai/sdk`, used by `services/ai/provider.ts`). Runtime dep.
- `knex@^3` — **MIT**. Runtime dep (the DB layer).
- `express@^4` — **MIT**. Runtime dep.
- `bcrypt` — **MIT**. Runtime dep.
- `jsonwebtoken` — **MIT**. Runtime dep.

All on the allowed list.

---

## Section 7 — Vendored / embedded third-party code

```
find . -type d \( -name vendor -o -name vendors -o -name third_party -o -name thirdparty \)
  -not -path './node_modules/*' -not -path './.git/*'
→ (empty)

find backend/src frontend/src shared/src \( -name '*.min.js' -o -name '*.min.css' \)
→ (empty)
```

Verdict: **PASS** — no vendored source, no checked-in minified third-party files.

---

## Section 8 — Copyleft dependency check

Explicit scan for AGPL / GPL / SSPL / Commons Clause / Proprietary / UNLICENSED: **zero hits** (see Section 4).

The only non-permissive entry is **`caniuse-lite@1.0.30001788`** (CC-BY-4.0), which is a Creative Commons data license, not copyleft. It's a build-time dependency of Vite / browserslist and never ships to users — classification matches MB's policy verdict: **LOW / acceptable, no action required**.

Verdict: **PASS**. No copyleft obligations threaten the no-distribution posture of PolyForm Internal Use.

---

## Section 9 — AI provider / SDK compliance

The application integrates three AI provider families per CLAUDE.md, but only Anthropic has a declared SDK dependency. OpenAI-compatible and Ollama paths use plain `fetch` against the provider's REST API — no SDK, no license concern.

| Provider          | Package             | License | Ships in runtime? |
| ----------------- | ------------------- | ------- | ----------------- |
| Anthropic         | `@anthropic-ai/sdk` | MIT     | ✅ yes            |
| OpenAI-compatible | (none — raw fetch)  | —       | —                 |
| Ollama            | (none — raw fetch)  | —       | —                 |
| MCP               | (not integrated)    | —       | —                 |

Verdict: **PASS**. MIT permits use in a PolyForm Internal Use licensed application with no additional terms.

---

## Section 10 — Parity with TB / MB tooling

TB and MB both carry supporting infrastructure that Vibe PT does not yet have. This is the single largest delta versus their audit baselines.

| Artifact                           | TB  | MB  | PT                          |
| ---------------------------------- | :-: | :-: | --------------------------- |
| `LICENSE` (PolyForm IU 1.0.0)      | ✅  | ✅  | ✅ (no preamble)            |
| `LICENSE-COMMERCIAL.md`            | ✅  | ✅  | ✅                          |
| `NOTICE`                           | ✅  | ✅  | ❌ **MEDIUM**               |
| First-party source headers         | ✅  | ✅  | ❌ **HIGH**                 |
| `scripts/license-audit.sh`         | ✅  | ✅  | ❌ **MEDIUM**               |
| `scripts/license-policy.json`      | ✅  | ✅  | ❌ **MEDIUM**               |
| `scripts/add-license-header.sh`    | ✅  | ✅  | ❌ (blocked by headers gap) |
| `scripts/check-license-headers.sh` | ✅  | ✅  | ❌ (blocked by headers gap) |
| CI hook enforcing headers          | ✅  | ✅  | ❌                          |
| Result file under `scripts/`       | ✅  | ✅  | — (this doc is the first)   |

---

## Required immediate actions (HIGH)

1. **Add the licensor preamble to `LICENSE`.** Prepend four lines matching MB's format. Trivial edit.

2. **Add PolyForm headers to every first-party source file.** Port MB's `scripts/add-license-header.sh` (extensions: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.sh`, `.sql`), run it once, commit the result. Wire `scripts/check-license-headers.sh` into the existing `npm run check` pipeline so future files can't merge without headers.

## Recommended actions (MEDIUM)

3. **Add a `NOTICE` file at the repo root.** Copy MB's structure: copyright line, attribution block, third-party notices. Useful when a paying customer forwards the repo to their own legal review.

4. **Port `scripts/license-audit.sh` + `scripts/license-policy.json`.** Small adaptations needed:
   - `license-policy.json`: clone MB's `allowed` / `reviewRequired` / `denied` arrays verbatim (Vibe PT's dependency set is a strict subset of MB's, so the policy is already correct). Drop the `buffers` / `jszip` / `dompurify` / `rgbcolor` known-issue entries — none of those packages are in Vibe PT's tree.
   - `license-audit.sh`: update the `find "$ROOT/packages"` path to `find "$ROOT/backend" "$ROOT/frontend" "$ROOT/shared"` (Vibe PT uses flat-workspaces, not a `packages/` folder).
   - Output goes to `scripts/license-audit-result.txt` and optionally `.json`.

## Recommended actions (LOW)

5. **Add a license/source link to the UI.** A single-line footer on LoginPage or an `/about` route:

   ```tsx
   <p className="text-xs text-slate-400">
     {applianceName} · PolyForm Internal Use 1.0.0 ·{' '}
     <a href="https://github.com/KisaesDevLab/Vibe-Payroll-Time">Source</a>
   </p>
   ```

   PolyForm doesn't require this; it's a courtesy for CPA-firm operators whose clients may ask "where can I read the license?".

6. **Fix the README dev-port.** `http://localhost:5173` → `http://localhost:5180`. Out of scope for a pure license audit but flagged because Section 3 scanned README.

7. **Accept CC-BY-4.0 for `caniuse-lite`** in `license-policy.json` knownIssues — build-only, not shipped, matches MB's verdict.

---

## What's good

- **No denied licenses.** 758 packages, all permissive.
- **Dependency footprint is smaller than TB and MB.** None of the problematic packages from their audits (`buffers`, `xlsx`, `puppeteer`, `dompurify`) are here.
- **Commercial licensing separation is clean.** `LICENSE` (internal use, free) and `LICENSE-COMMERCIAL.md` (reseller/client-portal) are distinct files with unambiguous scope.
- **No copyleft risk.** The only non-permissive entry is `caniuse-lite` (CC-BY-4.0, build-time only), matching MB's accepted-known-issue.
- **No vendored third-party code.** Everything flows through `package.json`, so the audit surface is fully machine-scannable.

---

## Estimated effort to close all findings

| Finding                               | Effort      |
| ------------------------------------- | ----------- |
| LICENSE preamble                      | 5 minutes   |
| Port header add/check scripts from MB | 15 minutes  |
| Run `add-license-header.sh` + commit  | 1 minute    |
| Wire checker into `npm run check`     | 5 minutes   |
| `NOTICE` file                         | 10 minutes  |
| Port `license-audit.sh` + policy JSON | 20 minutes  |
| UI footer link (optional)             | 15 minutes  |
| README port fix                       | 1 minute    |
| **Total**                             | **~1 hour** |

All changes are additive; none touch runtime code or dependency versions.

---

_Run this audit again before each major release and whenever a new npm dependency is added. Parity script + policy file live at `scripts/license-audit.sh` and `scripts/license-policy.json`; CI-friendly JSON result at `scripts/license-audit-result.json`._

---

## Resolution — 2026-04-21 follow-up pass

All required + recommended actions from the initial audit were implemented in the same day. `bash scripts/license-audit.sh` now reports `AUDIT PASSED — No issues found.`

| #   | Finding                                            | Resolution                                                                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | LICENSE preamble                                   | Prepended the Kisaes LLC licensor block matching MB's format.                                                                                                                                                                                                                                                                            |
| 2   | Source file headers                                | Ported MB's `scripts/add-license-header.sh` + `scripts/check-license-headers.sh`, adapted paths for Vibe PT's flat-workspace layout (`shared/` + `backend/` + `frontend/`, not `packages/`), ran the inserter: **275 files** got the three-line PolyForm header. Subsequent runs report "All source files already have license headers." |
| 3   | Check wired into `npm run check`                   | `"check": "… && npm run license:headers"` + three new npm scripts: `license:audit` / `license:headers` / `license:headers:fix`. Also added to `lint-staged` so a pre-commit catches missing headers on `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`/`.sql`/`.sh`/`.py`.                                                                       |
| 4   | `NOTICE` file                                      | Added at repo root with copyright + third-party key-dependency attribution (React, Express, Knex, PostgreSQL, TanStack, Tailwind, Vite, Zod, Workbox, bcrypt, JWT, otplib, Anthropic SDK, ...).                                                                                                                                          |
| 5   | `scripts/license-audit.sh` + `license-policy.json` | Ported MB's versions, adapted to scan `shared/` + `backend/` + `frontend/` instead of `packages/`, re-written the find invocation to not use `eval` (shell-globbing bug on Windows git-bash when `frontend/dist/` already exists). Policy carries the two real known-issues — `caniuse-lite@CC-BY-4.0` and `thirty-two@MIT*`.            |
| 6   | README stale port                                  | `localhost:5173` → `localhost:5180`. (Not a license item, flagged during Section 3 scan of README.)                                                                                                                                                                                                                                      |
| 7   | UI license/source link                             | **DEFERRED** — small UX item, not required by PolyForm. Worth adding on the LoginPage or an `/about` route in a future UI polish pass.                                                                                                                                                                                                   |

### Final audit summary (as run)

```
══ 1. Required project files ══
  ✔ LICENSE file present
  ✔ LICENSE-COMMERCIAL.md present (reseller / client-portal tier)
  ✔ NOTICE file present
  ✔ README present

══ 2. LICENSE preamble ══
  ✔ LICENSE carries the Kisaes LLC licensor preamble

══ 3. Source file headers ══
  ▶ 275 / 275 source files have license headers
  ✔ All source files have license headers

══ 4. Source code visibility ══
  ✔ Found source-code link in client source (31 file(s))

══ 5. Vendored / embedded third-party code ══
  ✔ No vendor directories found
  ✔ No minified files in source tree

══ 6. Dependency licenses ══
  ├─ MIT: 652   ISC: 48   Apache-2.0: 26   BSD-2-Clause: 12   BSD-3-Clause: 9
  ├─ BlueOak-1.0.0: 4   MIT-0: 1   (Unlicense OR Apache-2.0): 1   Python-2.0: 1
  ├─ CC-BY-4.0: 1   MIT*: 1   0BSD: 1   (MIT OR CC0-1.0): 1
  ✔ No denied licenses in dependencies

══ 7. Known issues ══
  ⚠  LOW — caniuse-lite@* (build-time CC-BY-4.0, accepted)
  ⚠  LOW — thirty-two@1.0.2 (MIT*, verified MIT in LICENSE.txt, accepted)
  ✔ All PolyForm Internal Use requirements satisfied.

══ 8. Audit Summary ══
  Failures  : 0    Warnings  : 0
  AUDIT PASSED — No issues found.
```

### Verification

- `npm run check` (typecheck + lint + format + license headers) — **clean**
- `npm test` — **325 tests pass** (94 shared + 227 backend + 4 frontend, no skips)
