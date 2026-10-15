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
`docs/architecture.md` (integration files).

## Relay: BYO keys and local harness providers

Moved verbatim from `CLAUDE.md` (2026-10-15).

- BYO keys (optional): per-provider keys (`CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`,
  `GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) are forwarded as
  `X-User-Api-Key` to bypass the relay's shared quota. `.env` only — never commit.
- Local harness providers `claude-code` and `codex` route through the relay to the Claude Code / Codex CLIs signed in on this machine. They appear only when llm-relay is running on localhost (`npm run dev` there) — never in production — and every call spends the same subscription plan limits as using the CLIs interactively. Their
  effort and thinking budget come from `agent:run`'s `--effort` (default `RELAY_EFFORT`) and
  `--thinking-budget` flags and travel as body fields on the relay hop.
