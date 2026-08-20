# Bugs

Reproduced defects, captured outside the task that found them. Entries reach
`TODO.md` only through the checkpoint gate, and only after their proof re-runs
true. No proof, no entry.

## 2026-08-19 — `topology-path-v1` — RESOLVED: withdrawn by the human gate

Both calibrated models scored 0% on this family in every run while the other
seventeen families reached 100% for the strong model. Human review the same day
established the cause: the rendered item admits two defensible readings — the
answer as the shape being completed (a square), or as the visible line simply
continuing — so the intended answer is ambiguous by sight. The product owner
withdrew the family; its registry entry now has no eligible band
(`src/items/family-promotion.ts`). The generator stays in the code. If a
redesign ever makes the task unambiguous on screen, it returns as a new family
version through the normal gate.

## 2026-08-19 — public puzzle ids disclosed almost all of the generation seed — RESOLVED 2026-08-20

`runtimePuzzleId()` put the first 28 characters of the 32-character random seed
into every puzzle id, and `toPublicPuzzle()` preserved it, leaving only four hex
digits (65,536 guesses) between a served puzzle and full seed recovery — and so
every answer. This defeated the answer-free public contract.

Fixed by replacing the id with a one-way keyed hash of seed and slot
(`src/items/expanded-quiz.ts`). Ids stay deterministic for replay and unique
within a test; the seed now lives only inside the sealed server token. Guarded
by a regression test in `src/items/expanded-quiz.test.ts` that asserts no served
id contains the seed or any 8-character prefix of it. Bank ids are
content-addressed and were never affected.

## 2026-08-20 — `relational-outlier-v2` size items are an eyesight test, not a reasoning test — RESOLVED 2026-08-20

Two of the eleven relations this family can hide are "same size" and "different
size", and the only two sizes a scene token may take are medium and large. The
project's own legibility rule says that difference is not enough on its own:
`isInstantlyDistinct` in `src/items/domains.ts` deliberately returns false for
medium-versus-large, and the comment above `areScenesCategoricallyDistinct` in
`src/items/schema.ts` states that "medium-vs-large alone is intentionally not
enough". So an item whose whole question is "which pair differs in size" asks
the solver to make exactly the comparison the codebase refuses to call visible.

Proof, on the code as it stood before the fix — run from the project root:

```
node --import tsx --input-type=module -e 'import {seededRng} from "./src/lib/rng";
import {generateSceneFamilyCandidate} from "./src/items/scene-families";
const c = generateSceneFamilyCandidate("relational-outlier-v2", seededRng("six-options", "relational-outlier-v2:0"));
console.log(c.puzzle.options.map((o) => o.objects.map((p) => JSON.stringify(p.object)).join(" | ")).join("\n"));'
```

Five of the six options are a pair of same-shape, same-fill tokens differing
only in size (medium beside large); the sixth repeats one size. Nothing else
distinguishes the answer. (`qa/runs/` is not tracked in git, so the rendered PNG
that first showed this is local only; `puzzleToSvg` from
`src/items/compose-image.tsx` reproduces it from the same seed.)

This predates the six-option change — the family has always been able to sample
a size relation — but a longer option list makes it more visible, because now
five options in a row differ only by that margin.

Fixed on the product owner's instruction: the two size relations are gone from
`OUTLIER_RELATION_GRAMMAR` in `src/items/scene-families.ts`, and `size` is no
longer part of `OutlierRelationProgram`, so the reading cannot come back by a
later edit that only touches the list. Both tokens in an option now always take
the same size, so size cannot become the discriminator by accident either.

Nine relations remain — five about position, four about shape and fill. All nine
appear across 400 seeds, one above the eight distinct program fingerprints the
diversity gate demands, so this family has no room left to lose another relation
without widening somewhere else first. Verified: 200 seeds through
`npm run families:verify` with no rejections, and no option in 2,400 generated
options has two tokens of different sizes. The emergency bank was rebuilt, since
some of its stored outlier items were size items.
