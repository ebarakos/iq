# A test a chat agent can take by following links

Written 2026-10-06 from a chat LLM's report: it could read iq.ebarakos.com but could
not start a test. Its browser fetches pages and follows links; it runs no JavaScript
and submits no forms. Both start controls are JavaScript buttons, so it stopped there.

**Goal:** an agent that can only fetch pages and follow links takes the 5- or
30-question test under the same rules as a person — the same puzzles, six options,
one minute per question, scored on the server. The in-page app stays as it is,
apart from the start links and the labels below.

## The flow

1. `GET /sample` or `GET /test` makes a fresh test and redirects to its first
   question: `/t/<token>/1`.
2. A question page shows "Question 2 of 5", the deadline as a clock time and the
   seconds left, the puzzle as an image, and one link per option plus Skip. Each
   link carries the answers so far: on question 2, option C links to
   `/t/<token>/3?a=BC`. A skip adds `-`.
3. The last question's links go to `/t/<token>/result?a=BC-AF`. That page scores
   the answers on the server and shows the score, the late marker, and the review
   (the correct option and the explanation for each question).

The flow is linear. To change an answer, go back a page and follow another link.
Option links come from `OPTIONS_PER_ITEM`, never a literal six.

## The token: a seed, not the test

Today's token holds every answer and explanation: about 5,600 characters for 5
questions and 35,000 for 30 (measured 2026-10-06), far too long for a link. The
link token instead seals what is needed to rebuild the test:

- the seed, the length (`short-5` / `long-30`), and the source (`generated` or
  `fallback`, the reference bank);
- `EXPANDED_GENERATOR_VERSION` and a hash of the withdrawn-family list, since
  either one changes what a seed builds;
- `issuedAt`, `answerDeadline`, and `expiresAt`, with the same rules as today.

That is about 120 characters once sealed. Every page rebuilds the test with
`assembleExpandedQuiz` (or `sampleExpandedBankQuiz` for a fallback test). It is
fast and exact: the same seed gave the identical test for both lengths, in
60–120 ms for 5 questions and 300–420 ms for 30 (2026-10-06, after a cold first call).

If the version or hash no longer matches, the page says the site changed since the
test started and links to a new one. The in-page app keeps its own token; nothing
in it changes.

**Accepted tradeoff (owner, 2026-10-06):** the result URL can be reloaded with
other answers until it scores full marks. Today's `/api/submit` has the same hole.
Single-use tokens wait until scores are stored (the 2026-09-28 note in
`docs/brainstorm.md`); a server store was weighed and declined for now.

## The puzzle is a picture

The question page shows `<img src="/t/<token>/2/puzzle.png" alt="Question 2 puzzle">`.
The image is the agent channel's standalone SVG (`src/items/compose-image.tsx`: the
stem plus options lettered A–F), rasterized on the server. Use `next/og`'s bundled
resvg first. If it cannot draw that SVG, move `@resvg/resvg-js` from
devDependencies to dependencies; that is not a new package.

It is a PNG, not inline SVG, because SVG markup is text: a reader would get every
shape's fill and position and solve the puzzle as text. That breaks the
visual-only rule. The consequence: a fetcher that cannot see images cannot solve
the puzzles. That is the rule working, not a bug. The page says plainly that the
puzzle is the image and the answer is one of the links.

## The label leak, in the in-page app too

Every board's `aria-label` is `describeScene(scene)` (`src/items/render.tsx:311`).
Every option button's label is `Option A: <the scene description>`
(`src/app/page.tsx:869`, `:1100`). The accessibility tree therefore spells out each
shape, fill, size, rotation and position. A browser agent that reads that tree
gets the whole puzzle as text and never has to look. Replace these with neutral
labels ("Question 2 puzzle", "Option A").

Then check the remaining layout and gate labels (`render.tsx:518`, `:656`, `:696`,
`:719`): each one may name the layout the picture shows, but never say more.
`:656` ("in every row, the first two boards make the third") is the first one to
check.

## Not changed, with reasons

- **Radio buttons instead of clickable divs** — the in-page options are already
  `<button aria-pressed>` (`page.tsx:869`). The link pages use links, because an
  agent that cannot submit forms cannot use radios either.
- **State as text and ARIA** — already there: "Question N of M" (`page.tsx:800`),
  a labelled `role="timer"` (`:670`), labelled navigator buttons (`:820`). The link
  pages print the same facts as plain text.
- **No `robots.txt` block on `/sample`, `/test` or `/t/`** — some chat fetchers obey
  it, and blocking them defeats the goal. The link pages carry `noindex` only.
  A crawler that follows `/sample` mints a test that nobody uses; nothing is stored,
  so that costs only CPU.

## Done when

- Plain HTTP (curl, no JavaScript) can go from `/sample` to a scored result by
  following links only. A route test does the same walk.
- No `aria-label` in the app describes a board's contents.
- A chat LLM given only `https://iq.ebarakos.com/sample` reaches a result.
  Record below what it could see and how it scored.

## Built (2026-10-06)

Everything above except the chat-LLM check, which waits for a deploy.

- **Token.** `src/lib/link-test.ts` seals the seed (16 random bytes), length, source,
  generator version, withdrawn-family hash, a bank hash for a fallback test, and the three
  times, in the quiz token's AES-GCM envelope under its own version tag (`l1`) and AAD, so
  neither kind of token opens as the other. Sealed, it is about 240 characters, not the 120
  estimated above: the fields are kept readable rather than packed. That is still a short
  link. A small in-process cache holds the last 64 built tests, so a question page and its
  picture do not each rebuild a 30-question test.
- **Changed site.** A fallback test is drawn from the reference bank, so its token also seals
  a hash of the bank; a new bank refuses it the same way a new generator version does.
- **Picture.** `next/og` could not draw the SVG's text: the option letters, the "?" and the
  arrows came out blank. `@resvg/resvg-js` moved to dependencies and draws with the bundled
  Noto Sans subsets (`src/items/puzzle-png.ts`). Those subsets have no "→", so the agent
  image now draws its arrows as lines, which also makes it look the same under any font. The
  harness and `render:item` use the same function, so all three draw the same pixels.
- **Time.** A question page past the deadline says the time is up and links to the result
  with the unanswered questions skipped. The result page marks a late result exactly as
  `/api/submit` does, with the same scorer (`src/lib/scoring.ts`).
- **Out-of-order links.** A link whose answers do not match its question number redirects to
  the question those answers lead to; unreadable answers get a page that says so.
- **Labels.** Boards are "board", options "Option A". The gate label keeps the piece count
  and drops the textures and "used in tab order". The 3 × 3 label no longer says "the first
  two boards make the third" (that is the rule, not the picture): it is "3 by 3 grid with an
  arrow before the third board of every row". The machine and analogy labels say what is
  drawn in each row, and the sequence label was already only the picture.
  `src/items/neutral-labels.test.ts` holds every label to that list.
- **Checked.** `src/app/t/link-walk.test.ts` walks `/sample` to a scored result by reading
  each page's HTML and following its links. The same walk with curl against `next start`
  reached "0 of 5 correct" (always option C) with a PNG for each question and no `<svg>`
  in any page.

## Chat LLM check

Not yet run: it needs the deploy. Give a chat LLM only `https://iq.ebarakos.com/sample` and
record here what it saw and how it scored.
