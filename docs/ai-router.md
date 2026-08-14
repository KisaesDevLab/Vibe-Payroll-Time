# Vibe AI Router mode

Vibe Payroll Time has two AI modes:

- **Direct** (default): the app calls the provider configured under
  **Settings → AI** — Anthropic, OpenAI-compatible, or Ollama. This is the
  standalone/single-install mode; see `docs/integrations.md`.
- **Router** (`VIBE_AI_MODE=router`): all AI traffic — NL timesheet
  corrections and the support chat — goes through the appliance's **Vibe AI
  Router**. The app stops choosing providers and models; the task class is
  the only knob, and router policy decides the rest. Scrubbing, budgets,
  cost attribution, and the AI audit ledger move to the router console.

There is **no silent cross-mode fallback**. A router outage in router mode
surfaces to the user as an error — the app never quietly retries against a
direct provider, because that would ship the raw prompt around the router's
scrubber and ledger. Use router mode when the appliance runs a Vibe AI Router
for the whole Vibe suite; standalone installs stay on direct.

## Configuration

Set all three in `/opt/vibept/.env` (or leave `VIBE_AI_MODE=direct` and skip
the rest):

| Variable             | Value                                                                          |
| -------------------- | ------------------------------------------------------------------------------ |
| `VIBE_AI_MODE`       | `direct` (default) or `router`                                                 |
| `VIBE_AI_ROUTER_URL` | e.g. `http://vibe-ai-router:8220` (internal docker DNS on the appliance)       |
| `VIBE_AI_TOKEN`      | App token minted in the router console (**App tokens**) — never a provider key |

Router mode requires both URL and token. With either one missing the backend
refuses to boot: `VIBE_AI_MODE=router requires VIBE_AI_ROUTER_URL and
VIBE_AI_TOKEN`.

## Token identity — the one thing that goes wrong

> **The App token must be minted for the identity `vibe-payroll-time` — the
> exact string.** Older router docs called this app `vibe-payroll`; a token
> minted under that name makes task-class registration fail with **403,
> forever**. The app keeps retrying in the background and AI features stay
> down — fail-closed — with nothing louder than a warn line in the logs and
> a red **AI Router** card on the appliance dashboard.

## Task classes

At boot the backend registers its task classes with the router
(idempotent, version-stamped):

| Class                   | Used for                          | Requires     | Default max tokens |
| ----------------------- | --------------------------------- | ------------ | ------------------ |
| `payroll_nl_correction` | NL timesheet corrections          | tool calling | 2048               |
| `payroll_support_chat`  | Support chat (RAG over user docs) | —            | 1024               |

Registration is fire-and-forget: a failure never blocks boot (apps regularly
start before the router is healthy on an appliance). Failed attempts retry
in the background — quickly at first, capped at 60 seconds; auth failures
(401/403) slow to every 5 minutes since they need operator action. Until
registration lands, the router answers 403 for these classes and AI features
are down. Success logs `vibe-ai-router task classes registered`; each failure
logs `vibe-ai-router task-class registration failed; will retry`.

Registration state is visible on the SuperAdmin **Appliance** dashboard
(**AI Router** card) and in the `aiRouter` field of
`GET /api/v1/admin/health` — you never need to tail logs to see a stuck
registration.

> `payroll_anomaly_review` appears in the router's default task-class pack
> but is **not used** by this app — do not provision a policy for it.

## Router-side provisioning

In the router console (see the Vibe AI Router documentation for the console
workflow):

1. Mint an App token for identity `vibe-payroll-time` and paste it into
   `VIBE_AI_TOKEN`.
2. Create a policy row for each class:
   - `payroll_nl_correction` → a **tool-calling-capable** local model. The
     router's Ollama capability probe must show `tools: true` (`qwen3` is
     known-good), or set a capability override only after manually verifying
     the model handles tool calls.
   - `payroll_support_chat` → any local chat model.
3. Keep both classes on local-only tiers. This app is hours-only — it stores
   no wages and no SSNs — but appliance policy keeps payroll-adjacent traffic
   on local models as defense-in-depth. Do not widen these task classes to
   cloud tiers.

The router console will refuse to save a `payroll_nl_correction` policy
against a model without tool support (capability gate). If it saves and
fails later instead, that's a router-side bug — corrections will error at
request time.

## What changes in the app

- **Settings → AI** shows "Managed by Vibe AI Router"; the per-company
  provider/model/key fields are inert.
- The company-level AI toggle (`ai_enabled`) and daily correction limits
  **still apply** — whether a company's staff may use AI at all stays this
  app's call, in both modes.
- Usage rows in `ai_token_usage` record `provider = 'vibe_router'` and the
  model the router policy actually served.

## Verification checklist

After provisioning, verify end-to-end:

1. Boot log shows `vibe-ai-router task classes registered` on the **first**
   attempt — a retry loop means the token identity is wrong (re-mint, don't
   wait it out). The **AI Router** dashboard card should read "registered".
2. Run one NL timesheet correction end-to-end: the request carries a tool
   call, the correction applies, and the router ledger shows
   `payroll_nl_correction` with tool-usage tokens.
3. Send one support-chat message and confirm it was served by the local
   model.
4. Negative check: try to save a `payroll_nl_correction` policy against a
   no-tools model — the router console must refuse (capability gate), not
   save-and-fail-later.
5. Confirm zero cloud egress for this app: the router audit log has no
   scrub/cloud events for either class.

## Troubleshooting

See `docs/troubleshooting.md` for the three router-mode entries: registration
retry loop (wrong token identity), 502/503 on AI requests (router down, no
fallback by design), and NL corrections failing while chat works (capability
gate).
