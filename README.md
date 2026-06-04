# aiq

Visual IQ-style tests of increasing difficulty, for **humans and AI agents**.

> **Status: planning.** No application code yet. See [CLAUDE.md](CLAUDE.md) for the
> concept and constraints, and [BRAINSTORM.md](BRAINSTORM.md) for the open design
> questions.

## What it is

A growing battery of visual, language-independent IQ-style puzzles (Mensa-style
matrices / sequences / analogies as a baseline, open to a novel format) ordered
by complexity. The same items are presented to humans and to agents; difficulty
is calibrated against agents, and items that are trivial for agents default to
being human tests. The signal of interest is the gap between human-hard and
agent-hard.

## Stack (planned)

- JS/TS, deployable on **Vercel** (likely Next.js).
- All model calls route through [`llm-relay`](../llm-relay) — no provider API
  keys in this repo. Configure with `RELAY_BASE_URL` / `RELAY_PROVIDER` /
  `RELAY_MODEL` (see [.env.example](.env.example)).

## Development

This project is in the planning phase. Setup instructions will be added once the
framework is scaffolded.
