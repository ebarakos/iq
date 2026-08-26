# Handoff
from: claude → to: codex
stage: implement→review
updated: 2026-08-26
branch: main · plan: docs/plans/raise-the-ceiling-v12.md · tasks: TODO.md

## Just did
- Shipped the d6 tail as `scene-families-v12`: five-gate `composed-transform-d6` (1848 servable
  programs, 18-panel table, 1×5 strip at 248px of 261px) and four-gate `transformation-machine-d6`
  (288-program grammar, exactly 16 servable). Both locked by exhaustive ablation tests.
- Withdrew `containment-analogy-v2` on the 2026-08-26 pilot's notation evidence, and dropped a
  built-and-tested `inverse-fold-punch-d6`: `SceneSchema` caps a board at two guides and d5
  already draws both two-crease programs, so it raised no ceiling. The reason is now a test, not
  a comment.
- Guaranteed the tail: `evenSplit` spends a band's leftover questions first on families whose
  next occurrence reaches a new bucket. Over 10,000 seeds every long-30 ends on a d6 item
  (was 8,289/10,000), split 50.3/49.7 between the two d6 families. Asserted per seed, not averaged.
- Rebuilt the pilot packet over 21 keys, rebuilt the bank at `--per-bucket 4 --seed emergency-v12`
  (84 items), and recorded the withdrawn key in `data/fixtures/scene-distance-v10.json` as
  `withdrawnKeys` — `families:verify` now fails both if a withdrawn key is served and if a key
  appears in both objects.

## State
- diff: `git diff` — 43 files changed plus 23 untracked; everything unstaged and uncommitted.
- tests: pass — `npm run typecheck && npm run lint && npm test && npm run families:verify &&
  npm run bank:verify && npm run build` (447 tests, exit 0, verified by me not by the wave agents).
- blockers: none.

## You next
- Review the tail guarantee in `src/items/expanded-quiz.ts` (`evenSplit`) hardest: it is the one
  change that alters every long test, and its cost is that the two d6 families always take the
  band's two repeats.
- Judge whether 16 servable programs is enough for `transformation-machine-d6`. The owner accepted
  it knowingly; the swap gate can only name the three filled slots, so the population cannot grow
  without re-planning the gate order.
- `src/lib/relay-*.ts` and `src/lib/model.ts` remain yours; I have not touched them since your
  last pass.
- verify: `npm run typecheck && npm run lint && npm test && npm run families:verify && npm run bank:verify`

## Open questions
- The v12 packet has not been sat yet. Until it is, the d6 buckets have code evidence only —
  no human has seen a five-gate or four-gate item.
