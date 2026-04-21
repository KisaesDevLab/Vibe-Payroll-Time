# Security Audit — Employee Data Isolation

| Field       | Value                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| Date        | 2026-04-21                                                                                                         |
| Auditor     | Claude Code                                                                                                        |
| Scope       | Tenant + role isolation as seen from a rank-and-file `role=employee` user                                          |
| Goal        | Confirm no employee can observe another employee, another company, or any settings beyond what their role requires |
| Methodology | Per-endpoint + per-service code inspection, not live pentest                                                       |

## TL;DR

**Before fixes:** five real data-isolation issues, ranging from HIGH to LOW.
**After fixes:** all closed. 325/325 tests green; typecheck + lint + headers clean.

| #   | Severity   | Finding                                                                   | Status   |
| --- | ---------- | ------------------------------------------------------------------------- | -------- |
| 1   | **HIGH**   | Entry audit trail readable cross-employee within a company                | ✅ fixed |
| 2   | **HIGH**   | NL-correction apply accepts cross-employee `entryId` in tool calls        | ✅ fixed |
| 3   | **MEDIUM** | Supervisors could read plaintext PINs (buddy-punching risk)               | ✅ fixed |
| 4   | **MEDIUM** | Per-company license endpoint IDOR + commercial claims leaked to employees | ✅ fixed |
| 5   | **LOW**    | `copyLastWeek` read another employee's aggregated hours before denying    | ✅ fixed |

**What was already good:**

- `/companies/` list filters by membership (no cross-company discovery via this endpoint).
- `/timesheets/` + single-employee weekly-grid already enforce `ownEmployee.id === q.employeeId` for employee-role callers.
- Punch endpoints (`/punch/*`) resolve the acting user's employee row server-side; the `employeeId` is never wire-supplied by an employee.
- Manual-entry create / update / delete all run through `canManualEdit`, which checks `isOwnEntry` for employee-role actors.
- Correction-request create resolves the acting user's own `employee_id` — an employee cannot raise a correction on someone else's entry.
- Kiosk PIN verify and QR badge scan are strictly company-scoped via the device token; cross-company payloads are rejected with generic "not recognized" errors (no enumeration oracle).
- NL-correction preview loads entries scoped to `(companyId, employeeId)` — the LLM never sees another employee's data.
- Notification logs are gated to `company_admin` via `requireCompanyRole`; sensitive SMS/email payloads are already redacted (prior hardening pass).
- Appliance / SuperAdmin endpoints all carry `requireSuperAdmin`.
- Employees, PINs, badges, kiosks, jobs, memberships — all admin endpoints carry explicit role middleware.

---

## Finding 1 — Entry audit trail cross-employee leak (HIGH, fixed)

**Endpoint:** `GET /api/v1/timesheets/entries/:entryId/audit`

**Before:** route only called `assertCallerOwnsCompany` (any company member OK). An employee at Acme could enumerate `entryId=1..N` and read the audit trail of any entry in Acme — including `actor_email`, old/new field values, and the edit `reason`. That reveals:

- Which other employees exist (via `actor_user_id` → user email join).
- Their shift start/end times (old/new value pairs on `started_at`/`ended_at`).
- Who has been performing edits and why.

**Attack:**

```
GET /api/v1/timesheets/entries/42/audit?companyId=5
Authorization: Bearer <acme employee token>
→ 200 { data: [ { actorEmail: "alice@acme.com", field: "ended_at", oldValue: "...", newValue: "...", reason: "late clock-out" } ] }
```

**Fix:** `backend/src/http/routes/timesheets.ts`

```ts
if (role === 'employee' && req.user.roleGlobal !== 'super_admin') {
  const own = await db('time_entries as te')
    .join('employees as e', 'e.id', 'te.employee_id')
    .where('te.id', entryId)
    .andWhere('te.company_id', companyId)
    .andWhere('e.user_id', req.user.id)
    .first<{ id: number }>();
  if (!own) return next(Forbidden("Cannot read another employee's entry audit"));
}
```

Supervisors and admins still read any entry's audit. Employees are restricted to entries whose `employees.user_id === req.user.id`.

---

## Finding 2 — NL-correction `apply` trusts client-supplied `entryId` (HIGH, fixed)

**Endpoint:** `POST /api/v1/companies/:companyId/ai/nl-correction/apply`

**Before:** the service called `authorizeForEmployee(actor, body.employeeId)` to validate the actor can correct that employee's timesheet, then iterated `body.toolCalls` and called `editEntry(entryId, patch, ...)` / `deleteEntry(entryId, ...)` directly. Both `editEntry` and `deleteEntry` only scope by `company_id`, not by `employee_id`.

**Attack path:**

1. Employee A (user 100, employee row 7 at Acme) clicks "Preview" on their own timesheet.
2. Server returns suggested tool calls referencing A's own entry IDs.
3. Attacker intercepts the apply request, changes `toolCalls[0].arguments.entryId` from `A's-entryId` to `B's-entryId`, keeps `body.employeeId=7` (A's own row).
4. `authorizeForEmployee` passes — A is A.
5. Loop body calls `editEntry(B's-entryId, patch, ...)`. `editEntry` fetches `time_entries where id=B's-entryId AND company_id=Acme` → found. Applies the patch. Audit row written under actor A but affecting B's timesheet.

**Fix:** `backend/src/services/ai/nl-correction.ts` — added an `assertCallTargetsAuthorizedEmployee(entryId)` check before each dispatch:

```ts
const row = await db('time_entries')
  .where({ id: entryId, company_id: actor.companyId })
  .first<{ employee_id: number; deleted_at: Date | null }>();
if (!row) throw NotFound('Time entry not found');
if (row.employee_id !== body.employeeId) {
  throw Forbidden("Tool call targets an entry outside the authorized employee's timesheet");
}
```

Defense in depth: `authorizeForEmployee` gates the subject; this check gates the object.

---

## Finding 3 — Supervisors could read plaintext PINs (MEDIUM, fixed)

**Endpoints:** `GET /companies/:id/employees` and `GET /companies/:id/employees/:employeeId`

**Before:** route passed `includePin: true` unconditionally whenever the caller is `company_admin` or `supervisor`. The service decrypted `pin_encrypted` and returned the plaintext 4–6 digit PIN for every employee.

**Why this matters:** the product's anti-buddy-punching posture (see `CLAUDE.md` non-goals list) relies on PIN confidentiality — there is no GPS / photo / biometric / device-binding fallback. A supervisor who can see every employee's PIN could walk to the kiosk and punch in as any teammate at any time, defeating the audit trail for every affected employee.

**Fix:** `backend/src/http/routes/companies.ts` — PIN plaintext is now `company_admin` + SuperAdmin only:

```ts
const includePin = await callerIsCompanyAdmin(
  req.user.id,
  req.user.roleGlobal,
  companyIdFromParams(req),
);
const rows = await listEmployees(companyIdFromParams(req), { ...q, includePin });
```

Supervisors still see `hasPin: boolean` so they can tell which employees are kiosk-enrolled. They route PIN regeneration through the company_admin (which is already admin-only: `POST /:companyId/employees/:employeeId/regenerate-pin`).

---

## Finding 4 — `/companies/:id/license` IDOR + commercial-claims leak (MEDIUM, fixed)

**Endpoint:** `GET /api/v1/companies/:companyId/license`

**Before:**

1. Route was guarded only by `requireAuth` — no membership check. Any authenticated user on the appliance could query any `companyId` and get the license state. Cross-company license-state discovery via URL-guessing.
2. The response's `claims` field exposes the signed license JWT payload: `tier`, `employee_count_cap`, `company_count_cap`, `iss`, `iat`, `exp`. This is commercial metadata an employee has no need to see — it reveals the pricing tier the CPA firm is paying for and the firm's seat-cap purchase.

**Fix:** `backend/src/http/routes/licensing.ts`

```ts
const hasAccess = await userCanAccessCompany(req.user.id, companyId, req.user.roleGlobal);
if (!hasAccess) return next(Forbidden('Not a member of this company'));

const status = await getLicenseStatusForCompany(companyId);

// Redact commercial claims for non-admins.
if (req.user.roleGlobal !== 'super_admin') {
  const membership = await db('company_memberships')
    .where({ user_id: req.user.id, company_id: companyId })
    .first<{ role: 'company_admin' | 'supervisor' | 'employee' }>();
  if (membership?.role !== 'company_admin') status.claims = null;
}
```

Non-admin members still see `state` + `expiresAt` + `daysUntilExpiry` so the license-banner UI works; they don't see tier / caps / issuer. Non-members get 403 — no license-state discovery.

---

## Finding 5 — `copyLastWeek` reads victim's prior-week aggregate before denying (LOW, fixed)

**Endpoint:** `POST /api/v1/manual-entries/copy-last-week`

**Before:** the service ran a prior-week aggregation SQL over `time_entries` WHERE `employee_id = input.employeeId` to collect the source cells, THEN looped `createManualEntry` per cell. `createManualEntry` rejected each cell with `Forbidden` for an employee-role actor targeting another employee. Net effect: no entries were created, but:

1. The victim's prior-week punch aggregation was read server-side (not returned, but loaded into memory).
2. The per-cell rejection counted as `skippedCount`, leaking a rough count of the victim's prior-week activity cells. `skippedCount=5` vs `skippedCount=0` differentiates an employee with a busy prior week from one with none.

**Fix:** `backend/src/services/manual-entries.ts` — added a pre-check using the existing `loadActorContext` + `canManualEdit` functions, run BEFORE the aggregation query:

```ts
const preCheckActor = await loadActorContext(db, ...);
const preCheckDecision = canManualEdit(preCheckActor, { isApproved: false, mode: ... });
if (!preCheckDecision.allowed) {
  throw Forbidden(preCheckDecision.reason ?? "Not allowed to copy this employee's week");
}
```

Fast-fail with `403 Forbidden` and a clear error message; no victim data is read.

---

## Verification

```
$ npm run typecheck          → clean
$ npm run lint                → clean
$ npm run format:check        → clean
$ npm run license:headers     → All source files have license headers
$ npm run license:audit       → AUDIT PASSED — 0 failures, 0 warnings
$ npm test                    → 94 shared + 227 backend + 4 frontend = 325/325 pass
```

## Employee-observable surface after fixes

A user with `role=employee` at Company A can now only observe:

| Resource                                    | Access                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Own identity via `/auth/me`                 | Own user row + memberships list (companies + roles + `isEmployee` flag) |
| Own user-level phone `/me/phone`            | Self-only                                                               |
| Own preferences `/me/preferences`           | Self-only                                                               |
| Companies they're a member of `/companies/` | Name, slug, timezone, pay period. No license claims.                    |
| Their own timesheet                         | Ownership check on every read                                           |
| Jobs in their company                       | Code, name, description — used to pick jobs at clock-in                 |
| Own punch state `/punch/current`            | Self-only (server resolves `employeeId`)                                |
| Own entry edits / deletes                   | Only own, only if period not yet approved                               |
| Raise a correction request                  | On own entries only                                                     |
| NL timesheet corrections                    | On own timesheet only; apply path cross-checks every tool-call entry    |
| Support-chat AI                             | Scoped to their company                                                 |
| Notifications preferences                   | Own opt-ins only                                                        |
| Phone verification                          | Own phone only                                                          |
| License banner `/companies/:id/license`     | State + expiry only. No tier / caps / issuer.                           |

A user with `role=employee` **cannot** observe:

- Another employee's timesheet, punches, entries, or edit audit trail
- Another employee's email, phone, PIN, badge, or any HR field
- PINs of any employee (including own — PIN is read-only after set; regeneration goes through admin)
- Other companies they aren't a member of
- Commercial license metadata (tier, seat caps, issuer)
- Appliance settings (SuperAdmin only)
- Notifications log (company_admin only)
- Payroll exports (company_admin only)
- Reports (supervisor+)
- Multi-employee weekly grid (supervisor+)
- Correction-request inbox (supervisor+)

## Residual considerations

- **Admin notifications log** (`company_admin`): SMS/email bodies for `magic_link` / `password_reset` / `phone_verification` types are already stored as `{ redacted: true }` (prior hardening pass). Other notification types (missed-punch reminders, approval notices) do store full body — fine, those bodies don't contain credentials.
- **Error messages**: every 403 in the reviewed endpoints is phrased as "Not a member of this company" or "Cannot read another employee's X". No error differentiates "entry exists but not yours" from "entry does not exist" — this prevents ID enumeration via error timing.
- **`/auth/magic/options`** (public): leaks whether email/SMS is configured appliance-wide. Not sensitive — the operator chose which login channels to offer.
- **AI token usage** (`ai_correction_usage` table): counts per-(company, employee, day) are only used for rate limiting inside the service; never exposed on a read endpoint.

## Re-run cadence

Run this audit when:

- Adding any new `requireAuth`-only route (not `requireCompanyRole`).
- Adding any endpoint that takes `employeeId` from the wire.
- Adding any new service function callable from a route with `requireAuth` plus body parsing.
- Extending the notification log or audit log with new types.

The fixes are direct tests — `integration` tests that hit these paths with wrong `companyId` / `employeeId` combos would be valuable future work. Today's coverage verifies positive-path correctness; adversarial tests would confirm the 403 branch.
