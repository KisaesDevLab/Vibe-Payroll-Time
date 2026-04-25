# Contributing to Vibe Payroll Time

Thanks for working on Vibe PT. This document captures the branching and commit
conventions used in this repository. Read [`CLAUDE.md`](./CLAUDE.md) first for
architecture and scope; read [`BUILD_PLAN.md`](./BUILD_PLAN.md) for the phased
checklist.

## Branching

- `main` — always deployable; all merges land here via PR
- Feature branches: `feat/<short-description>` or `phase-<N>/<description>`
- Fix branches: `fix/<short-description>`
- Chore/docs: `chore/<short-description>` or `docs/<short-description>`

Keep branches short-lived. Rebase on `main` before opening a PR.

## Commit messages

Conventional Commits style:

```
<type>(<scope>): <short summary>

<body — the "why", not the "what">

<footer — breaking changes, issue refs>
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `build`,
`ci`. Scope is optional; use a workspace name (`backend`, `frontend`,
`shared`) or a domain (`punch`, `auth`, `timesheet`).

Keep the summary imperative and under 72 characters. One logical change per
commit.

## Pull requests

- Target `main`
- Link the `BUILD_PLAN.md` item(s) being delivered
- CI must be green: `npm run check` and `npm test`
- Prefer reviewable PRs (under ~400 lines of diff) — split large phases into
  multiple PRs

## Local development

```bash
npm install
docker compose up -d
npm run migrate --workspace=backend
npm run dev
```

Run `npm run check` before pushing — it runs TypeScript and ESLint across
every workspace. The pre-commit hook (husky + lint-staged) will also block
commits that fail typecheck or lint on staged files.

## Code conventions

- Durations are stored as **BIGINT seconds**. Never floats, never minutes.
- Timestamps are **TIMESTAMPTZ in UTC**. Company timezone is applied at
  render time only.
- Every service function touching company-scoped data takes `companyId` as an
  explicit argument. No implicit scoping from JWT deep in the call stack.
- Every mutation to a `time_entry` goes through the single punch-service
  chokepoint, which writes an audit row.
- Migrations are plain JS (`.js`) for Windows compatibility. Never edit an
  applied migration — add a new one.

## Reporting issues

Open a GitHub issue with a short title and a reproducer. For security-sensitive
reports, do not open a public issue — email the maintainers first.
