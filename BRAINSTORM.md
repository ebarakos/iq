# aiq — Brainstorm

Free-form ideation space. Nothing here is committed; it's the scratchpad for the
design we'll sharpen across sessions before writing any code. When an idea
solidifies into a concrete plan, promote it to `docs/plans/<slug>.md` and create
checkable tasks in `TODO.md`.

---

## The pitch (one line)

A benchmark + playground of visual IQ-style puzzles, ordered by difficulty, that
measures **both humans and AI agents** — and surfaces the gap between what's hard
for people and what's hard for models.

---

## Open questions

Q1–Q5 and Q7 were **resolved 2026-06-10** (plan-mode session with the user); the design
they feed lives in [docs/plans/rules-bank-agent-calibration.md](docs/plans/rules-bank-agent-calibration.md).
Q6 (novel formats) remains open.

### Q1 — What does "visibility only" mean exactly? ✅ RESOLVED
**Decision: visual + minimal text** — puzzles are purely visual, with a short, fixed,
neutral instruction allowed ("Which option completes the grid?"). This is the MVP's
existing behavior; instructions are templated per type so no language skill is tested.

### Q2 — How are agents shown a *visual* test? ✅ RESOLVED
**Decision: dual-channel, image first.** Render the same SVG a human sees to a PNG →
vision model via the relay; a symbolic JSON channel (the raw cell spec) is secondary, for
text-only models. Every attempt records its channel; **only image-channel results count
for human–agent comparison** (the symbolic channel solves a different task — structure
partially leaked — so it is diagnostic only).

### Q3 — What's the role of llm-relay's model? ✅ RESOLVED
**Decision: two jobs, freely different models.** Generator = the env default
(`RELAY_*`) or widget override, as today. Solver/calibrator = per-run CLI flag from the
vision-capable relay list (gemini-3-flash, gpt-4o-mini, gpt-4.1-mini, llama-4-scout free).
Mid-tier value models throughout; no flagships.

### Q4 — Procedural generation vs. model generation? ✅ RESOLVED
**Decision: hybrid, rules as first-class data.** Rules become machine-readable
(`src/items/rules.ts` DSL); procedural re-derivation of the answer from the rule **is**
the semantic validator. Procedural generation gives guaranteed-correct items with exact
difficulty knobs; LLM generation stays for variety and must pass the validator.

### Q5 — Difficulty ladder: how is it defined and measured? ✅ RESOLVED
**Decision: both.** A priori first — `ruleComplexity(rule)` (non-constant dimensions,
deltas, wraps, axes) anchors difficulty 1–5 — then recalibrated empirically from agent
attempt artifacts (and human data once a DB exists).

### Q6 — Novel format ideas (beyond Mensa)?
Standard Mensa = Raven's matrices, number/letter sequences, analogies, odd-one-out.
Brainstorm differentiators (capture freely, no commitment):
- Puzzles designed to **maximize human–agent divergence** (easy for one, hard for
  the other) — the gap is the product.
- Compositional / multi-step visual reasoning that resists pattern-matching.
- Time/interaction dimension (animations, interactive transforms).
- Self-generating difficulty: model probes the frontier where current agents fail.

### Q7 — Scoring & comparability ✅ RESOLVED
**Decision: explicitly NOT comparable — no single IQ-like score.** Humans get a plain
score; agents get pass-rate-by-difficulty-tier per model/channel. The headline product is
the **divergence**: items that are human-easy/agent-hard and vice versa. Human percentile
norms are deferred until attempt data persists in a DB.

---

## Rough format sketch (baseline, to react against)

- **Item types:** matrices (3×3 with one missing cell), sequences (next-in-series),
  analogies (A:B :: C:?), odd-one-out.
- **Each item:** a stem (visual), N answer options (one correct), a difficulty
  tag, and the generative rule(s) used (for analysis, hidden from solver).
- **Increasing complexity:** more rules per item, more similar distractors,
  larger grids, composed transformations.

---

## Things that are already decided (constraints)

- JS/TS, deployable on **Vercel**.
- Model access exclusively through **llm-relay** (no provider keys in-repo).
- Tests target **humans AND agents**; adaptive routing toward humans when an
  item is trivial for agents.

---

## Parking lot (ideas, not yet evaluated)

- Public leaderboard: human vs frontier-model percentile over time.
- Item bank as data (JSON) so generation and presentation are decoupled.
- "Agent eval mode" that runs a batch of items against a relay model and reports
  pass rate by difficulty tier (drives Q5 calibration).
