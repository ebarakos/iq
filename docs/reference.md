# aiq reference

Moved verbatim from CLAUDE.md on 2026-08-26.

## Tech stack

This was written as a proposal; every row below is the stack the repo actually runs on as of
2026-08-26 (see `package.json`).

| Layer | Proposed choice | Rationale |
|---|---|---|
| Host | **Vercel** | Required by the user; first-class Next.js support |
| Framework | Next.js (App Router) | Frontend + API routes in one deploy, no separate proxy |
| Language | TypeScript (strict) | Type safety across item schemas and scoring |
| Model access | **llm-relay** (see below) | All model calls (item generation + agent solving) go through the relay |
| Validation | Zod | Validate generated item structures and model responses |

Nothing here is locked except **JS/TS + Vercel + llm-relay** (explicit user
requirements). Framework and libraries are proposals open to revision.

The relay section the table points at lives in `CLAUDE.md` (env vars, rules) and
`docs/architecture.md` (integration files, widget).
