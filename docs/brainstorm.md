
- 2026-08-24: `sampleQuiz` in `src/items/bank.ts` has no live callers — only tests exercise it (the app serves `sampleExpandedBankQuiz`). Deletion candidate with its two difficulty-profile tests, worth roughly 100 lines.

- 2026-08-24: the odd-one-out format has now failed the human gate twice — `-v2` with no worked evidence, `-v3` with three demonstrated example boards. A third attempt should change the presentation (e.g. label the examples as belonging together, or show one counter-example) rather than just the evidence count.
- 2026-08-24: `interleaved-sequence-v3` was withdrawn on a right-answer-wrong-reading pilot result. If the alternation notation itself is the problem, a redesign could mark the two strands visually (alternating panel backgrounds) instead of asking the solver to discover the interleaving.
- 2026-09-02: the "fills every slot of 200 long tests" proof now takes ~7 minutes alone, because combining-machine's coverage search (~2.4s per long test that draws it) landed inside it at the v18 promotion. If the suite's length starts to hurt, shrink that N or pre-filter the combining gate orders — the same reissue the generator comment already names.
