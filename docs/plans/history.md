# aiq history

Moved verbatim from CLAUDE.md on 2026-08-26.

Paths and links in this file are relative to the repo root.

## Status narrative (as written 2026-08-26)

**Status: GENERATED REASONING-TEST PROTOTYPE.** The app serves two test lengths,
5 and 30 questions, both drawn from the same pool of 14 eligible visual reasoning
families (22 code-valid families; withdrawals on human or structural evidence,
including two 2026-08-24 redesigns that failed their pilot and the
`containment-analogy-v2` withdrawal of 2026-08-26) and the same four
difficulty bands. Every test is generated from a fresh seed,
validated in pure code, served without answers, and scored server-side against a
whole-test deadline of 60 seconds per question. Every question offers six
answer options, so a blind guess is worth 1 in 6. Families ship behind a visible
experimental label: they pass the code-correctness contract, and four human
pilot sittings from one participant have run — most recently the 20-item v11
escalation pilot of 2026-08-26, 15 of 20 correct with four clean misses at d4/d5
(see `data/pilot/README.md`) — alongside the first trustworthy agent probes.
That evidence is enough to withdraw families, not to calibrate difficulty, so
this is not a standardized IQ score. See
[docs/plans/deterministic-novel-tests.md](docs/plans/deterministic-novel-tests.md).

---

## Concept (working definition)

- **What:** A growing battery of IQ-style test items (Mensa-style matrices,
  sequences, analogies — or a novel format if we find a better one) ordered by
  increasing complexity.
- **Audience:** Dual — the same item pool is presented to **humans** and to
  **agents** (LLMs / multimodal models). 
- **Visual-only ("visibility only"):** Items are intended to be purely visual /
  language-independent — no text comprehension, no culture-specific knowledge —
  so the test is fair across humans and vision-capable agents. *(Assumption to
  confirm — see BRAINSTORM Q1.)*
- **Adaptive audience routing:** Difficulty is calibrated against agents. If
  agents solve an item trivially, it is tagged/defaulted as a **human** test;
  items that still challenge agents are the frontier. The interesting signal is
  the gap between human-hard and agent-hard.
- **Open to a novel format.** Standard Mensa-style is the baseline, not a
  constraint. Better ideas are welcome and should be captured in BRAINSTORM.md.

This is a deliberately loose definition — it will be sharpened in later
brainstorming sessions before any implementation.

---

Historical: the layout below was written before the repo existed. The real module map
is in `docs/architecture.md`.

## Planned repo layout (not yet created)

```
src/            # app + core (TBD once framework confirmed)
src/lib/        # relay integration (added by /connect-relay)
src/items/      # item generators / schemas (visual puzzle definitions)
docs/plans/     # formalized design docs (slug per design)
BRAINSTORM.md   # free-form ideation + open questions  ← current focus
TODO.md         # short task/checklist state
```
