# Single sign-on (Vibe Auth)

Vibe Payroll Time can sign staff in through the firm's identity provider
(Vibe Auth / authentik, or any OpenID Connect provider) using the shared
`@kisaesdevlab/vibe-auth` package. Local sign-in keeps working until a
SuperAdmin decides otherwise.

**Scope: the staff realm only.** SSO covers `users` — SuperAdmins, company
admins, supervisors, and employees who sign in on their own device. The
**kiosk realm is untouched**: a paired kiosk authenticates with its device
token and employees identify by PIN or QR badge, in every mode, with no
identity-provider account. The SSO engine only ever handles `/auth/*`;
kiosk traffic lives under `/api/v1/kiosk/*` and cannot pass through it.

---

## Modes

| Mode              | Password / login link                  | "Sign in with …" button |
| ----------------- | -------------------------------------- | ----------------------- |
| `local` (default) | yes                                    | hidden                  |
| `both`            | yes                                    | shown                   |
| `oidc_only`       | refused — except break-glass, password | shown                   |

Set from **Appliance → Authentication** (SuperAdmin), from the Vibe
Appliance console's Identity panel, or with `VIBE_AUTH_MODE`. A value saved
in the settings page overrides the environment.

`oidc_only` is guarded: it cannot be enabled until the break-glass account
exists and a **Test connection** has succeeded in the same admin session.
On boot, `oidc_only` without an active break-glass account **aborts
startup** with the package's message — starting anyway would leave an IdP
outage with no way in.

Under `oidc_only` the server refuses, with `403 local_login_disabled`:

- `POST /api/v1/auth/login` for everyone but break-glass
- `POST /api/v1/auth/magic/request`, `…/password-reset/request`, and
  `…/magic/consume` for everyone (a link is a local credential)
- the three admin "send a sign-in link" actions (nobody could use the link)

## Roles

The product has two layers — `users.role_global` (`super_admin | none`) and
a per-company membership role. The identity provider's groups map onto them:

| Vibe Auth group         | Becomes                                    |
| ----------------------- | ------------------------------------------ |
| `vibe-admin`, `vibe-it` | `super_admin` (appliance-wide)             |
| `vibe-partner`          | `company_admin` membership                 |
| `vibe-manager`          | `supervisor` membership                    |
| `vibe-staff`            | `employee` membership                      |
| anything else           | sign-in refused ("not assigned to a role") |

The map is explicit in code (`VIBE_PT_ROLE_MAP`). Do **not** rely on the
package's default map: before 1.0.6 it guessed, making every `vibe-partner`
an appliance SuperAdmin and every `vibe-manager` a plain employee; since
1.0.6 it leaves those groups unmapped, which here would refuse them. Override per install
with `VIBE_OIDC_ROLE_MAP` or in the settings page.

Roles are re-synced from the IdP on every sign-in, with two safeguards:

- **The last SuperAdmin is never demoted.** If the only active SuperAdmin
  signs in through an IdP group that maps lower, their role is kept, a
  warning is logged, and `auth_events` gets a `vibe.auth.role.changed` row
  with `refused: true` (never a change that did not happen). The engine
  asks `countOtherActiveAdmins` first; the adapter's `setRole` re-checks
  under a row lock and returns `false`, which is the guard that holds. The break-glass account does not count as "another
  SuperAdmin" — it is an outage tool, not somebody's account.
- Per-company memberships are only written when `TENANT_MODE=single` (the
  appliance default), where "the company" is unambiguous.

**`TENANT_MODE=multi`.** The package cannot know which company an SSO user
belongs to. SuperAdmin promotion/demotion still syncs; company memberships
do not. A user provisioned by SSO arrives with no memberships and a
SuperAdmin assigns them under **People**. Set `VIBE_OIDC_DEFAULT_ROLE` if
users without a mapped group should still be admitted.

## Accounts created by SSO

A first-time SSO user with a verified email is provisioned just in time
(disable with `VIBE_OIDC_ALLOW_JIT=false`). An existing account with the
same verified email is linked instead, and keeps its local password.

A provisioned account has **no local credential** (`users.sso_provisioned_at`
is set; the password hash is random and unknown). To keep it that way:

- self-service "email me a login link" and "forgot my password" silently
  skip it (same 204 as an unknown address — nothing is revealed);
- an SSO session cannot use `set-password`, and `change-password` needs a
  current password nobody knows.

So an SSO account cannot bootstrap a local password from its mailbox alone.
An **admin** can still grant one deliberately: sending that user a reset
link from Team / Employees / People works, and completing it clears the
marker. Unverified emails are never linked or provisioned.

## Break-glass

One local SuperAdmin that still works when the identity provider does not.

- **Sign in at `/login/local`** (not linked from anywhere) as
  **`vibe-breakglass`** with the password the appliance stored in
  `CREDENTIALS.txt`. The address `vibe-breakglass@vibe-payroll.local` is
  accepted too; the login form admits the bare username as its one
  non-email identifier.
- **Password only.** This product has no second factor, so there is none to
  enrol or to fail during an outage.
- The address is deliberately undeliverable: the account can never receive
  a login or reset link.
- Every use writes a `vibe.auth.breakglass.used` row to `auth_events`.
- Nothing in the admin UI can disable, demote, or re-address it: this
  product has no UI for disabling users or changing `role_global` or email.
  Its company memberships are irrelevant (SuperAdmins bypass them).
- Keep `VIBE_BREAKGLASS_USERNAME` at its default. There are no usernames in
  this product; the default is mapped to the fixed address above.

Provisioning runs inside the API container, from `/app`:

```bash
node --import tsx/esm node_modules/@kisaesdevlab/vibe-auth/dist/cli.js \
  breakglass ensure --json      # or: rotate | status | verify
```

- `status` reports `exists`, `active`, `admin` and `ready` (with
  `problems[]` when not ready). There are no product-specific blockers to
  add: no second factor, lockout or forced password change for staff.
- `verify` reads a password on stdin and answers `{ checked: true,
matches }` — a bare hash compare that touches neither `last_login_at`
  nor `auth_events`. The appliance runs it before allowing `oidc_only`, to
  catch a stored password that no longer matches the database.

The image has no build step, hence `--import tsx/esm`; the CLI finds the
adapter through `"vibeAuth"` in `/app/package.json`. On the appliance this
is `sudo vibe identity register vibe-payroll` (and
`sudo vibe identity rotate-breakglass vibe-payroll`).

> **Run the first-run `/setup` wizard before registering.** `ensure` (and
> just-in-time provisioning) refuses until setup has completed. The wizard
> locks itself for ever once any SuperAdmin row exists, so a break-glass
> account created into an empty database would shut the operator out of
> setup with no company to administer. If registration ran first, the
> appliance swallowed the failure: finish `/setup`, then register again.

> **After restoring an older database**, the stored break-glass password no
> longer matches the restored hash, and `ensure` will not notice (the
> account exists), but `breakglass verify` does — the appliance refuses
> `oidc_only` until you run `rotate-breakglass`.

## Sessions, sign-out, revocation

Sessions are bearer tokens in the browser, not cookies. A successful SSO
login ends with a redirect to

```
<base>/login#sso_token=<access>&sso_refresh=<refresh>
```

The pair rides the URL **fragment**, which is never sent to a server or
written to an access log; the SPA stores it and scrubs the URL before its
first render. They are the same tokens a password login mints. The access
token additionally carries a `sid` claim (kept across refresh via
`refresh_tokens.sso_sid`) tying it to a row in `auth_sessions_oidc`.

- **Sign out** in the app ends the app session (identity row + refresh
  chain). The identity provider's own session is left alone — it is shared
  with the person's other Vibe apps.
- **Back-channel logout** from the IdP revokes all of that user's refresh
  tokens and puts them on the revocation list; `requireAuth` checks the list
  on every request (one primary-key read), so outstanding access tokens die
  on their next use rather than after 15 minutes. A later sign-in is valid.

## Routing

The engine's routes must reach the **API** container. The SPA is a separate
container, and — unlike the other Vibe products — it already owns two paths
under `/auth`:

| Path                                                                             | Goes to |
| -------------------------------------------------------------------------------- | ------- |
| `/auth/oidc/*`, `/auth/status`, `/auth/me`, `/auth/settings`, `/auth/settings/*` | API     |
| `/auth/magic`, `/auth/reset` (login-link and password-reset landing pages)       | SPA     |

**Never route `/auth/*` wholesale to the API** — every emailed login and
reset link would break. The path list lives in four places that must agree:
`caddy/Caddyfile`, `caddy/Caddyfile.public`, the dev proxy in
`frontend/vite.config.ts`, and the appliance manifest's `routing.matchers`.

The ingress strips the product prefix (`/time` on the appliance) before the
API sees a request, so the engine runs with an empty base path and applies
the prefix only to URLs it hands the browser. The prefix and scheme come
from the public URL — `VIBE_OIDC_PUBLIC_URL`, else `PUBLIC_URL`, else the
first `ALLOWED_ORIGIN`. Nothing assumes `https`: a LAN appliance is plain
`http://<ip>`.

## Environment

Written by the appliance at registration: `VIBE_OIDC_ISSUER`,
`VIBE_OIDC_INTERNAL_BASE`, `VIBE_OIDC_CLIENT_ID`, `VIBE_OIDC_CLIENT_SECRET`,
`VIBE_OIDC_PUBLIC_URL`, `VIBE_OIDC_IDP_NAME`.

Firm-controlled: `VIBE_AUTH_MODE` (`local`), `VIBE_OIDC_REQUIRE_MFA_AMR`
(`false`; **recommended `true`** — the product has no MFA of its own, so the
IdP's is the only second factor SSO sessions get), `VIBE_OIDC_ROLE_MAP`,
`VIBE_OIDC_DEFAULT_ROLE`, `VIBE_OIDC_ALLOW_JIT` (`true`).

A client secret saved in the settings page is stored AES-256-GCM-wrapped
with `SECRETS_ENCRYPTION_KEY` (`services/crypto.ts`), never in the clear.

Standalone (no appliance): register an OIDC client at your provider with
redirect URI `<public url>/auth/oidc/callback` and back-channel logout URI
`<public url>/auth/oidc/backchannel`, enter issuer / client id / secret
under Appliance → Authentication, run **Test connection**, then switch the
mode to `both`.

## Building

`@kisaesdevlab/vibe-auth` is a private package on GitHub Packages, which
wants a token even for reads. `.npmrc` maps the scope; the token never
lives in the repo.

- **Local:** a `read:packages` token in `~/.npmrc`
  (`//npm.pkg.github.com/:_authToken=…`).
- **Images:** a BuildKit secret —
  `docker build --secret id=NODE_AUTH_TOKEN,env=NODE_AUTH_TOKEN -f backend/Dockerfile .`
  (same for `frontend/Dockerfile`; `docker-compose.grouped.yml` reads
  `NODE_AUTH_TOKEN` from the environment).
- **CI:** `GITHUB_TOKEN` with `packages: read`. The Vibe-Auth package must
  grant this repository access (package settings → Manage Actions access).
- **Pinned exactly** (`"1.0.6"`, not a caret range) in both workspaces. The
  package's publish job stamps every Vibe-Auth tag, so `^1.0.6` would pull
  1.0.14 and client features nobody has reviewed here. Bump deliberately.

## Audit

Every SSO event lands in `auth_events` beside password and login-link
events, under the package's names: `vibe.auth.login.success` / `.failure`,
`.user.provisioned`, `.user.linked`, `.role.changed`, `.logout`,
`.mode.changed`, `.settings.changed`, `.breakglass.used` / `.rotated`,
`.idp.unreachable`, `.mfa.enforcement.disabled`. They follow the table's
365-day retention.

## Deviations from the Vibe Auth integration plan

Recorded so the next reader of
`Vibe-Auth/docs/integration-plans/vibe-payroll-time.md` is not surprised.

1. **No `/auth/*` matcher.** The plan prescribes one; it would have broken
   `/auth/magic` and `/auth/reset`. Replaced by the explicit path list above.
2. **`users.sso_provisioned_at` added** (the plan said "add no column", about
   `disabled_at`, which is indeed reused). Needed for I7: `password_hash` is
   NOT NULL, so an unusable hash is indistinguishable from a real one and
   the self-service paths had nothing to key on.
3. **`refresh_tokens.sso_sid` added** so the `sid` claim survives the
   15-minute access-token rotation. Without it a refreshed SSO session looks
   like a password session and sign-out cannot find its identity row.
4. **Setup-first guard** on account provisioning (see Break-glass) — not in
   the plan; without it, registering before `/setup` bricks first-run.
5. **Last-SuperAdmin guard lives in the adapter's `setRole`**, under a row
   lock. Since 1.0.6 it returns `false` so the refusal is audited, and
   `countOtherActiveAdmins` lets the engine refuse first — but that check
   runs outside the lock, so the adapter's stays authoritative.
6. **Audit goes to `auth_events`**, the existing trail; no new table.
7. **Secrets use the existing `services/crypto.ts`**; no new `secretWrap`.
8. **Tests are a vitest integration suite** (`services/vibe-auth/__tests__/`)
   run by `npm test` in the existing CI job, rather than a standalone
   `sso-e2e.mjs` plus workflow — the repo already had the Postgres-backed
   integration harness the plan assumed was missing.
9. **`requireAuth` does not re-check `disabled_at`.** Unchanged behaviour: a
   disabled user's access token lives out its ≤15 minutes and their refresh
   is refused. Nothing in the product or the package disables a user at
   runtime, so this was left alone rather than adding a second per-request
   query.
10. The in-tree `.appliance/manifest.json` was corrected (ports, upstreams,
    migrate command, slug) and given the `routing` / `sso` blocks, keeping
    its informational `kiosk` / `workers` / `backup` blocks rather than
    being replaced wholesale. `backend/src/db/migrate.ts` now actually runs
    migrations when executed directly, which that command assumed.
