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

## Open questions (resolve these before designing)

### Q1 — What does "visibility only" mean exactly?
Current assumption: **visual-only / language-independent** — image-based puzzles
(no reading, no language, no cultural knowledge), so the same item is fair for a
human and for a vision-capable agent. Alternatives to consider:
- "view-only" (no interaction beyond picking an answer) — likely not the intent.
- "visual + minimal text" (allow short neutral instructions).
**→ Confirm with user.**

### Q2 — How are agents shown a *visual* test?
If items are images, agents must be **multimodal** (vision). Options:
- Render each item as an image → send to a vision model via the relay.
- Provide a **structured/symbolic** representation of the same puzzle (e.g. a
  grid of shape descriptors) so text-only models can attempt it too — but that
  changes the task and may leak the answer structure.
- Dual-channel: humans see the image, agents get the image *and/or* a symbolic
  form, recorded separately. **→ Decide what "fair" means here.**

### Q3 — What's the role of llm-relay's model?
Two distinct jobs, possibly different models:
- **Generator:** authors/varies items. (Pure procedural generation may be better
  for matrices; the model adds variety, distractors, and validation.)
- **Solver/calibrator:** attempts items to estimate agent difficulty → drives the
  adaptive "if agents ace it, default to humans" routing.
**→ Which model(s)? Generation likely wants a stronger model; solving wants the
model(s) we actually want to benchmark.**

### Q4 — Procedural generation vs. model generation?
Matrix/sequence puzzles have clean generative rules (rotation, progression, set
ops, XOR on shapes). Pros of procedural: guaranteed-correct answers, infinite
supply, exact difficulty knobs. The relay model could instead/also generate
*novel rule families* or validate/critique generated items. **→ Hybrid likely.**

### Q5 — Difficulty ladder: how is it defined and measured?
- A priori (number of transformation rules, branching, distractor similarity)?
- Empirical (item response theory from human + agent attempts)?
- Both — start a priori, recalibrate from data.

### Q6 — Novel format ideas (beyond Mensa)?
Standard Mensa = Raven's matrices, number/letter sequences, analogies, odd-one-out.
Brainstorm differentiators (capture freely, no commitment):
- Puzzles designed to **maximize human–agent divergence** (easy for one, hard for
  the other) — the gap is the product.
- Compositional / multi-step visual reasoning that resists pattern-matching.
- Time/interaction dimension (animations, interactive transforms).
- Self-generating difficulty: model probes the frontier where current agents fail.

### Q7 — Scoring & comparability
Single IQ-like score? Separate human-norm vs agent-norm? Percentile vs raw?
How to make a human score and an agent score comparable (or explicitly not)?

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
