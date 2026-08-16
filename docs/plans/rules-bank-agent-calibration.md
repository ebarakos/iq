# Rules, bank, and agent calibration

Status: **implemented foundation, June 2026**. This is a compact record of the
decisions that still govern the code. It has no active tasks. Current work lives
only in [TODO.md](../../TODO.md), and the current generator design lives in
[deterministic-novel-tests.md](deterministic-novel-tests.md).

## Lasting decisions

Puzzle rules are machine-readable data. Pure code checks the whole visible stem,
derives the answer, rejects visually ambiguous options, and never trusts a model
to mark its own answer.

Difficulty must come from rule complexity, not visual subtlety. Options must be
categorically different at a glance. Rotation is meaningful only for triangles,
and size differences may rely only on small versus large.

The committed item bank is a regression corpus and emergency fallback. It is
not evidence that a live test is fresh. The normal human path now uses the
versioned deterministic generator described by the current plan.

Agents solve the same rendered image humans see. Symbolic JSON remains a
separate diagnostic channel and is never pooled with image results.

Calibration keeps model, prompt version, channel, generator bucket, latency,
and attempt count explicit. Human and agent results remain separate; there is no
combined IQ score.

Verification is local: lint, typecheck, tests, bank integrity, and a production
build. The project does not use remote continuous integration.

## Implemented locations

- Rules and validation: `src/items/rules.ts`, `src/items/schema.ts`
- Procedural generation: `src/items/generate.ts`
- Reference bank: `src/items/bank.ts`, `data/bank/items.json`
- Shared human and agent rendering: `src/items/render.tsx`,
  `src/items/compose-image.tsx`
- Agent attempts and reports: `src/lib/solver.ts`, `src/lib/calibrate.ts`,
  `scripts/agent-run.ts`, `scripts/report.ts`

## Superseded choices

The first implementation served bank items by default, offered public
difficulty levels, and used models as optional item writers. The August 2026
design replaced that product path with one hard public mode and fresh,
deterministic, answer-safe generation. The model writer remains an offline
experiment only.
