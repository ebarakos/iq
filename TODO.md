# TODO

- [x] After deploy, give a chat LLM only `https://iq.ebarakos.com/sample`; record what it saw and scored in the plan — `docs/plans/link-only-test.md`
- [x] The local gate's `next build` must not break a running `npm run dev`: give it its own output folder (bugs.md 2026-10-15) — `qa/run.sh`, `next.config.ts`

## 2026-10-15 — Question order (owner)

- [x] The growing-jump ring sequence ("1, 3, 5, 7, 9") is too easy and repetitive: only in questions 1–10, at most 2 per test — `src/items/expanded-quiz.ts`, `src/items/family-promotion.ts`
- [x] Transformation questions ramp up through the test: one transform early (questions 1–5), two combined mid-test, three at the end — `src/items/expanded-quiz.ts`, `src/items/family-promotion.ts`
