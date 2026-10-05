# One reading per worked row

Status: built in `scene-families-v29`, 2026-10-05; the v27 re-test failed on the combining
machine's chain, fixed in v28 with a chained example row; the v28 re-test passed (below). The
combining machine was then retired in `v30` (owner's decision), so its sections below are history.
Items in `TODO.md` under
"2026-10-04 — Findings from the Opus 5.5 and Sonnet 5.5 tests". The check is
`src/items/worked-row-readings.ts`, run by `families:verify`.

## Where this comes from

On 2026-10-04 Opus 5.5 took one 30-question test (seed `probe-v21-opus`, `scene-families-v21`,
image channel, `--debrief`). It scored 29/30. After each answer it reported its confidence, the
rule it used, and, once shown the intended answer, whether another option was also defensible.
Artifact: `data/attempts/2026-10-04T06-35-30.160Z-claude-opus-5-5-image.json`.

Its own ratings (difficulty 1–5, confidence 0–100), one to five questions per family:

| family | right | difficulty | confidence |
| --- | --- | --- | --- |
| spatial transform | 2/2 | 1.0 | 93 |
| inverse analogy | 3/3 | 2.0 | 91 |
| attribute pairing | 2/2 | 2.0 | 87 |
| relational sequence | 1/1 | 2.0 | 92 |
| relational matrix | 5/5 | 2.2 | 90 |
| compositional analogy | 2/2 | 2.5 | 89 |
| second-order sequence | 3/3 | 2.7 | 90 |
| transformation machine | 3/3 | 3.0 | 83 |
| visual set algebra | 4/5 | 3.0 | 76 |
| composed transform | 4/4 | 3.3 | 76 |

One test is weak evidence, and self-ratings weaker still. The flags were worth checking because
each one names a concrete reading, and a reading can be measured on hundreds of generated items.

## What the flags showed

**A worked row can allow a second reading.** The owner's rule is that no hidden convention may
decide an answer. A worked row breaks it when two different rules both reproduce it, and the
question then lands on a different option under each.

1. **Composed transform: the fill gate's worked row sits on the diagonal.** `composedWorkedInput`
   always puts the fill gate's two shapes at the top-left and bottom-right squares. A flip across
   that diagonal leaves both where they are, so "flip, then shade the top-left shape" reproduces
   the row exactly. Opus flagged it on item 12 and named the option it leads to. Measured over 200
   items per bucket: a wrong option follows from that reading in **131 of 200 d4 items** and
   **15 of 200 d5 items**. Most of those wrong options exist anyway, as "replace a step with
   another primitive" near misses, because a diagonal flip after a turn equals a plain mirror.
   Fix: move the fill gate's second shape off the diagonal. **Done 2026-10-04** (Codex's review
   reproduced the finding the same day): the arrow now sits in the bottom row's middle square, so
   no flip or turn but "no move" keeps both shapes in place. Re-measured: 0 of 200 items in either
   bucket. Options and answers did not change; only the fill rows' arrow moved. A test in
   `scene-families.test.ts` ("one reading per worked row") tries all seven flips and turns on
   every worked row, before and after its gate.
2. **Set algebra: both worked outputs can share one layout.** On item 25, Opus's one miss, both
   worked rows left one shape at the same square, so "the result always sits bottom-left" fit both
   rows as well as the intended mirror. Measured: both worked outputs share one layout in 9 of 200
   d4 items and 7 of 200 d5 items, and a wrong option repeats that layout in 1 and 2 of them. Rare,
   but it cost the one wrong answer. Fix: redraw when the two worked outputs share one layout.
3. **Other rules both set-algebra rows allow.** Trying every combine rule (8), every flip and turn
   of the board (8) and every token turn (4) against both worked rows, a wrong option follows from
   another fitting rule in 4 of 200 d4 items and none of 200 d5 items.
4. **Transformation machine: the copy gate shows one copy.** On item 26 the copy gate's worked row
   copies a shape from the square below the centre into the centre, which also reads as "copy every
   shape one square up". Opus answered correctly and assumed the rest. Measured after the v22 tests:
   no wrong option follows from "copy every shape" or from "fill only that kind of shape" in any of
   200 d5 items, because neither reading lands on an option.

The durable fix is a check, not only the three local fixes: **for every machine and set-algebra
item, no wrong option may follow from any reading that every worked row allows.** Readings are the
natural ones a person tries: the eight flips and turns of the board, a mirror that also turns
arrows, token turns, fill changes on one square or all or never on an arrow, and for the copy gate,
one-square moves. The measuring script that produced the
numbers above is the starting point; it belongs in `families:verify` beside the options-only gate,
so a family cannot drift back.

**Grey is hard to see inside small stars.** Three of the thirty answers flagged grey versus white
on a star ("the star fills are small"), including the one on item 12. A star's arms are thin, so
little grey shows. Fatter arms (a larger inner radius) raise the grey area without touching other
shapes; a test on the drawn grey area at phone size keeps it there. The v22 tests put a price on it:
Opus lost an easy attribute-pairing question because it could not see a star turn from white to grey,
and half of the 28 "hard to see" notes in 180 answers were grey against white on small shapes.

## Not changed

- Item 24 (set algebra): Opus could not see which shape wins where both inputs fill a square. The
  rule is "the second board's shape wins", the rows show it, and no other combine rule fits both
  rows. Opus missed it; the item is sound.
- The second-order sequence's path dots, flagged twice ("the options show no dots"), were removed
  in `scene-families-v22` on the owner's request.

## The v22 tests (2026-10-04)

Sonnet 5.5 and Opus 5.5 each took the same three 30-question tests (seeds `probe-v22-1` to `-3`,
`scene-families-v22`, `solver-v5`, `--debrief`). Sonnet scored 76/90 and Opus 80/90. Of the 24 wrong
answers, 9 came from the items. Each was checked on the picture and measured on 200 generated items
per bucket.

5. **Composed transform: a fill piece can land on the arrow.** Every fill example colours a shape in
   the top-left square while an arrow elsewhere stays uncoloured, so "the fill piece never colours an
   arrow" fits it. In three questions an arrow had moved into that square when the fill ran. Both
   models coloured the shape that had started there instead and lost 5 of 6 answers, each time on
   the option that reading gives. The query board is fixed, with the arrow top right, so this depends
   on the program alone: a fill after a move that carries the top-right square to the top left.
   Measured: 51 of 200 d4 items and 38 of 200 d5 items. Fix: such programs are not servable.
6. **Composed transform: the mirror example's arrow points up.** An up arrow looks the same mirrored,
   so "a mirror also turns arrows" fits the row. In one question a turn had pointed the arrow sideways
   before the mirror ran, and both models reversed it. Measured: a wrong option follows in 10 of 200
   d5 items, and in none of the d4 items, which have no turn. Fix: the left-right mirror's worked row
   shows a sideways arrow that keeps its direction. A top-bottom flip's up arrow already shows it,
   because a real flip would point it down.
7. **Set algebra d5: where shapes go is never tested.** "Which shapes" and "which turns" are separate
   clues, each held by two options, but the answer is often the only option with both. Both models
   answered two such questions while saying they could not tell where the shapes go. Measured: the
   answer is the only option with its shapes in 134 of 200 d5 items, against 0 of 200 in d4. Fix: d5
   always offers a wrong option with the answer's shapes in other squares.

Checked and left alone:

- Composed transform: for one piece, "colour the top-left square" and "colour the shape that starts
  there" look the same. With no arrow involved it cost 1 of 6 answers, and in a move-then-fill
  program its option is the one the pieces give in the wrong order, which the family tests on purpose.
- Second-order sequence was the hardest family (Sonnet 3/8, Opus 5/8), but every miss had one rule,
  steps around the eight outer squares, that fits all five pictures. The models numbered squares in
  reading order or split odd and even pictures instead.
- Combining machine: how a chain of pieces combines is never shown, and the models used the intended
  reading whenever they found the pieces' rules.

## The v23 re-run (2026-10-04)

Opus 5.5 and Codex default (it answered as `gpt-6-astra`) each took one 30-question test of
`scene-families-v23` (seed `probe-v23-1`, `solver-v6`, `--debrief`). Both scored 29/30 and missed
the same question the same way, so the re-test failed its bar: two flags named a real second
reading.

8. **Composed transform: the fill example's shape.** The worked partners are drawn from the same
   shuffled list as the question's shapes, and the third worked row's partner is always the
   question's top-left shape. On question 30 the fill example coloured a star in the top-left
   square and the question started with a star there, so "colour the star, wherever it is" fitted
   the row as well as "colour the top-left square". Both models took it. With "colour that kind of
   shape" added to the check, a wrong option followed in 19 of 200 d4 items and 26 of 200 d5 items;
   where the question has no shape of that kind, the reading leaves the board uncoloured, which is
   the near miss that skips the fill. Fix (`v24`): the fill row shows its shape twice and colours
   only the top-left one. Re-measured: 0 of 200 in every checked bucket.
9. **Attribute pairing: a fill step the example cannot pin.** The rule is "the fill changes", but a
   one-step change also reads as "one step darker (or lighter)", and the question's fill can sit at
   the end of that scale. Codex flagged question 1 (white to grey in the example, black in the
   question). Measured: a wrong option follows in 20 of 200 items. A first fix (`v25`, on the
   owner's go) redrew the fill orders whose one-step change could not continue; the v25 re-run
   below showed it was not enough. Fix (`v26`): the question starts in the worked pair's first
   fill and a change takes it to the second, so the change the answer needs is the one shown and
   every reading of it agrees.

Codex's two other flags were not second readings: one needed "only filled shapes change", the
other "a diamond is a turned square".

## The v25 re-run (2026-10-04)

Same models, seed `probe-v25-1`. Opus 5.5 scored 29/30 and Codex 27/30.

- Both missed question 1, attribute pairing: the example went from black to white, the question
  started grey, and both kept it grey, as "swap black and white" says. The v25 redraw had only
  covered one-step changes. Fixed in `v26` (item 9).
- Codex missed question 20, combining machine, and named its reading: the dark piece (combine,
  the left board winning a clash) "adds only the shapes whose kind the left board already has".
  The example cannot refute it, because the family gives its left-only and right-only shapes the
  same kind on purpose (`combiningMachinePair`), which is what keeps one shape from naming the
  answer. Opus answered it. Not changed: it needs a design choice. The check does not read the
  combining machine yet.
- Codex's other flags were not second readings: on question 24 it misread a cell (the striped
  example keeps a square that sits under the right board's star, which rules its reading out),
  and two flags were about the order of the pieces, which the tabs show.

## The v26 re-run (2026-10-05)

Same models, seed `probe-v26-1`. Opus 5.5 and Codex both scored 28/30; two of Codex's follow-up
turns failed on a service error (403), and its answers were scored.

- The fixes held: no flag named a reading in composed transform, the transformation machine or
  attribute pairing.
- Codex missed question 18, combining machine, and named its reading: "striped removes triangles,
  dark removes circles, dotted adds squares from the right board". It reproduces all three worked
  rows and gives an option. It is the class of its v25 flag on the same family. Measured with "one
  kind of shape" readings of each piece (remove every shape of a kind, keep only one kind, add the
  right board's shapes of a kind), chained the way the question chains its pieces: such a reading
  fits a worked row in all 200 items per bucket, and lands on a wrong option in 102 of 200 d4 items
  and 115 of 200 d5 items. Each piece is shown once, on small boards whose left-only and right-only
  shapes share a kind on purpose (`combiningMachinePair`), so a change reads as "the circle went"
  as easily as "positions both boards hold". On those boards five of the eight combines always
  matched a one-kind reading. Fix (`v27`, on the owner's go): each worked row draws its own boards,
  each shape free and one more shape after twenty draws, until its combine is the only reading;
  the question keeps the family's boards. Most rows still show three shapes a board. With one
  reading per row, a chain has one reading, so no board needs keeping out of the options.
  Re-measured: 0 of 200 in both buckets.
- Opus missed questions 21 and 25, set algebra d5. On 25 it found the turn but not where the
  shapes go, which the v23 change now makes a step the solver has to take. On 21 it named a pattern
  in where the results sat, row to row, that ignores the input boards; the rule that reads the
  inputs gives one answer, so it is not a second reading.

## The v27 re-run (2026-10-05)

Seed `probe-v27-1`. Codex scored 29/30. The Opus 5.5 run did not start: the auto-mode permission
classifier blocked it.

- The v27 piece fix held: no flag named a "one kind of shape" reading.
- Codex missed question 23, set algebra d5. It found the arrow's turn and said it guessed the
  square. Only one rule fits both worked rows (keep the left-only shape, turn the board a quarter
  clockwise, turn the arrow a quarter counterclockwise), and it gives the answer. Not a second
  reading.
- **The chain is a second reading the check never tried.** On combining questions 16 and 22,
  Codex answered right and named another defensible option. Its reading keeps the left board
  fixed and feeds the board so far in as the right board. Each worked row shows one piece alone,
  so no row shows how a chain combines, and the family offers such boards as near misses on
  purpose (`combiningMistakes`: "chains onto the left board instead of the right one", one gate
  run the other way round). Codex called the chain unclear on all five combining questions.
  Measured over 200 items per bucket, with each piece kept to its one reading: another way of
  chaining lands on a wrong option in 102 of 200 d4 items and 103 of 200 d5 items. Codex's own
  way does so in 53 and 69; the other ways are the left board fixed with the pieces right to left,
  the pieces right to left against the right board, and every piece after the first against the
  left board. With every way of chaining in the check (the tabs' way or against it, the board so
  far in on the left or the right, meeting the right board or the left), 119 and 117.
- Fix (`v28`, the owner's choice of three shown on 2026-10-05): a row of two of the question's
  pieces snapped together, on boards of its own, sits between the one-piece rows and the
  question. It is drawn so that every way of chaining it allows gives the question's answer, and
  each piece changes the board, so the row shows which board the second piece meets. It prefers
  two pieces the question does not run one right after the other, so it works no step of the
  question's chain; over 200 items per bucket it never needed the fallback. The reading check now
  tries every way of chaining, and the oracle reports no answer when the chained rows leave two
  ways that disagree. Re-measured: 0 of 200 in both buckets. The cost is one more row: d4 items
  have four, d5 items five. Not chosen: dropping the chain near misses (the convention stays
  hidden, and a solver who chains another way finds no option) and accepting the convention as
  part of the puzzle (it breaks the owner's rule).
- Question 10's "white and grey are hard to tell apart" is the thin arrow grey already in
  `docs/brainstorm.md`.

## The v28 re-run (2026-10-05)

Opus 5.5 and Codex, two seeds. `probe-v28-1` drew no combining question (the band draws two of
its three families), so `probe-v28-2`, with five, tested the fix. No flag named a second reading.

| Seed | Opus 5.5 | Codex (`gpt-6-astra`) |
|---|---|---|
| `probe-v28-1` | 28/30 | 23/30: 6 lost to a service error (403), 23 of 24 answered right |
| `probe-v28-2` | 30/30 | 28/30: 1 lost to the same error |

- **Combining machine, 9 of 10 right.** Opus said the chained row settled the chaining three
  times ("row 4 confirms this reading"). Codex missed question 18 by misreading the pieces
  ("could not establish a consistent rule for every operator"), not the chain.
- **Set algebra d5 is the hardest step left**: Opus missed questions 22 and 24 of `probe-v28-1`
  and flagged 18 and 20, Codex missed 22, each time finding the arrow's turn and guessing its
  square. Checked with a wider vocabulary than the check (any combine either way round, any flip,
  turn or wrapped shift as squares or as a picture, any arrow turn): on 18 one rule fits both
  rows; on 20, 22 and 24 every other fitting rule gives the answer or no option. Over 200 items
  such a rule reaches a wrong option in 0 d4 items and 1 d5 item (the boards swapped and a
  wrapped shift). Left alone at first; Codex's review the same day rejected that, and `v29`
  adds both to the set-algebra readings, so their boards stay out of the options (options
  changed in 3 of 200 d5 items).
- Codex's one "also defensible" flag, attribute pairing (`probe-v28-2` question 2), read the
  circle-to-diamond change as "becomes a quadrilateral, so a square stays a square": the v23
  "a diamond is a turned square" class, not a second reading.
- Composed-transform notes asked only about the order of the pieces, which both models called
  the natural reading.

## Re-test

After the fixes, run the same 30-question test with `--debrief` on Opus 5.5 and on the project
default (Codex), and check that no flag names a second reading. A 97% score also says the test no
longer separates the strongest models; that question is in `docs/brainstorm.md`, not here.
