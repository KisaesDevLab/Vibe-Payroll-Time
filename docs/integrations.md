# Integrations

Vibe Payroll Time is **hours-only**. Every dollar amount — rates, gross pay,
withholdings, accruals — lives in your payroll processor, not here. We export
hours into the shape each processor expects.

## Payroll exports

| Processor                     | Format                                 | Notes                                                                                                 |
| ----------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Payroll Relief**            | CSV, one row per employee × pay period | Employee code maps from `employees.external_payroll_id`; configure under **Settings → Payroll codes** |
| **Gusto**                     | Gusto's "time-off & hours import" CSV  | Regular vs. OT hours split per FLSA 40-hr rule                                                        |
| **QuickBooks Online Payroll** | QBO Time-compatible CSV                | Service item (job) and customer fields pass through if set                                            |
| **Generic CSV**               | Flat per-employee-day CSV              | Use for anything else — columns are stable across releases                                            |

Run an export: **Exports → New export** → pick format + pay period → review
the preflight → **Run**. The preflight lists any open shifts, unapproved days,
and employees missing payroll codes; nothing is exported until you acknowledge.

Every export is kept on disk for one year (configurable) and recorded with who
ran it + when + what window. Redownloads are idempotent — the CSV bytes are
identical to the original.

## Email — EmailIt.com

Appliance-wide or per-company. Paste your EmailIt API key under
**Settings → Email** and provide a From address.

- Missed-punch reminders
- Correction-request notifications
- Phone-verification codes when SMS is not configured

Leave the API key blank to disable email entirely.

## SMS — Twilio (BYO)

Paste your Twilio Account SID + Auth Token + From number under
**Settings → SMS**. The auth token is stored encrypted on disk.

SMS is opt-in per employee. Employees add their number under
**Notifications → Phone number**, enter the 6-digit code we text them, and
can toggle individual notification types on/off.

## AI — multi-provider

Default: Anthropic (`claude-sonnet-4-6`). Configure under **Settings → AI**:

- **Anthropic:** paste an API key, pick a model
- **OpenAI-compatible:** paste an API key + base URL + model (works with
  Azure OpenAI, together.ai, openrouter, vLLM, etc.)
- **Ollama:** paste the Ollama HTTP base URL + model name; no API key needed

When AI is off, no provider is called — not for corrections, not for the
support chat. See `docs/security-review.md` for the full data-flow.

## Licensing — kisaes-license-portal

Commercial tiers (per-firm annual, per-company monthly, per-company capped)
are vended by the shared Kisaes license portal at **licensing.kisaes.com**.

Paste the JWT under **License → Upload license**. The appliance verifies the
RS256 signature against a bundled public key. Internal-firm companies don't
need a license and the admin never sees a banner for them.

## What we **don't** integrate with

- **Gross-to-net** / tax filings / direct deposit — out of scope for v1
- **Scheduling** (shift templates, trades, availability) — out of scope
- **GPS / geofencing / photos** — out of scope (anti-buddy-punching is
  auth-based only)
- **Vibe Trial Balance / Vibe MyBooks GL sync** — they share a stack but not
  data; this is by design
