# TODO

Work this backlog top to bottom. Designs, branch targets, and evidence gates: [escalate the quiz](docs/plans/escalate-the-quiz.md) for v11; [raise the ceiling (d6 tail)](docs/plans/raise-the-ceiling-v12.md) records the d6 tier that was built and then withdrawn; [the answer must not be guessable from the options alone](docs/plans/blind-answer-leak.md) for v19.

## 2026-10-06 — A test a chat agent can take by following links

Design: [link-only test](docs/plans/link-only-test.md). From a chat LLM's report that it could not start a test.

- [ ] Replace scene descriptions in `aria-label`s with neutral labels ("Question 2 puzzle", "Option A") — `src/items/render.tsx:311`, `src/app/quiz.tsx`
- [ ] Check the layout and gate labels say no more than the picture shows, starting with the 3 × 3 row label — `src/items/render.tsx:518,656,696,719`
- [ ] Short link token sealing seed, length, source, generator version, withdrawn-family hash and deadline; rebuild the test from it — `src/lib/quiz-token.ts`, new `src/lib/link-test.ts`
- [ ] Test that a link token rebuilds the identical test, and that a version or hash mismatch is refused — `src/lib/link-test.test.ts`
- [ ] Reuse shared scoring and single-use receipts in the link result — `src/lib/quiz-scoring.ts`, `src/lib/leaderboard.ts`
- [ ] Puzzle image: question n as a PNG of the agent-channel SVG, rasterized on the server — `src/items/compose-image.tsx`, `src/app/t/[token]/[n]/puzzle.png/route.ts`
- [ ] `GET /sample` and `GET /test` make a fresh test and redirect to its first question — `src/app/sample/route.ts`, `src/app/test/route.ts`
- [ ] Question page: "Question N of M", deadline as text, the puzzle image, one link per option plus Skip, carrying the answers so far — `src/app/t/[token]/[n]/page.tsx`
- [ ] Result page: score, late marker and review from the answers in the URL — `src/app/t/[token]/result/page.tsx`
- [ ] `noindex` on the link pages, and no `robots.txt` block — link page metadata
- [ ] Home start buttons become links to `/sample` and `/test` that still start the in-page test when JavaScript runs — `src/app/quiz.tsx` (`Intro`)
- [ ] Route test: walk `/sample` to a scored result over plain HTTP — `src/app/t/`
- [ ] After deploy, give a chat LLM only `https://iq.ebarakos.com/sample`; record what it saw and scored in the plan — `docs/plans/link-only-test.md`
