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

Q1–Q5 and Q7 were resolved 2026-06-10. Q3–Q6 were refined on 2026-08-13 after
the procedural generator and first agent calibration exposed the limits of live
model-authored items. The current decision lives in
[docs/plans/deterministic-novel-tests.md](docs/plans/deterministic-novel-tests.md).

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

### Q3 — What's the role of llm-relay's model? ✅ REVISED 2026-08-13
**Decision: models solve and calibrate; they do not write live tests.** The normal
test path uses no model call. A live call happens only when an agent is asked to take
an already-generated test. Offline model panels calibrate generator families; models may
also suggest or red-team rule ideas, but code owns ground truth.

### Q4 — Procedural generation vs. model generation? ✅ REVISED 2026-08-13
**Decision: deterministic procedural generation at runtime.** A fresh cryptographic seed
feeds a versioned pure generator. The same seed reproduces the same test; program search
checks that the shown evidence forces one answer. The committed bank becomes a regression
and reference corpus, not the default source of supposedly fresh tests.

### Q5 — Difficulty ladder: how is it defined and measured? ✅ REVISED 2026-08-13
**Decision: calibrate generator buckets, not ephemeral items.** Program features provide a
provisional ordering. Repeated human and agent attempts are pooled by generator version,
family, composition depth, and other declared features. Human and agent rates remain
separate; agent failure alone never makes an item human-hard.

### Q6 — Novel format ideas (beyond Mensa)? ✅ RESOLVED 2026-08-13
**Decision: build one example-driven visual operator family.** Several worked rows show
the same hidden operation over two visual cells; the final row asks for the output. Rules
compose bounded operators and may change by visual context. A mechanical search accepts a
puzzle only when every program consistent with the examples predicts the same answer.
Animations, interactive worlds, and multiple new formats stay out until this family proves
useful with people and agents.

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
