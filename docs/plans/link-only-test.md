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
   question: `/t/<token>/1`. With Redis, a request builds for about 1.2 s only (see
   "Built over several requests" below); a test not finished by then answers with a
   page that says how many questions are built and links to `/t/start/<id>/<built>`, which
   builds the next part. The request that finishes it starts the clock and redirects.
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

**Updated requirement (owner, 2026-10-06):** the leaderboard implementation now saves the
first scored submission in Redis before revealing answers. Both flows reuse
`src/lib/quiz-scoring.ts` and the single-use receipt logic in `src/lib/leaderboard.ts`.
Identical retries recover the first result; changed answers are refused. Link tokens
also seal the app version and deployment when issued, independently of `LEADERBOARD_ENV`; changing
the selected board does not invalidate a link. Since 2026-10-14 link results rank and publish
through one fixed agent-name link each (`docs/plans/leaderboard-integrity.md`). The quiz UI moved to `src/app/quiz.tsx`; `page.tsx` supplies the server feature flag.

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
(`src/app/quiz.tsx`). The accessibility tree therefore spells out each
shape, fill, size, rotation and position. A browser agent that reads that tree
gets the whole puzzle as text and never has to look. Replace these with neutral
labels ("Question 2 puzzle", "Option A").

Then check the remaining layout and gate labels (`render.tsx:518`, `:656`, `:696`,
`:719`): each one may name the layout the picture shows, but never say more.
`:656` ("in every row, the first two boards make the third") is the first one to
check.

## Not changed, with reasons

- **Radio buttons instead of clickable divs** — the in-page options are already
  `<button aria-pressed>` (`quiz.tsx`). The link pages use links, because an
  agent that cannot submit forms cannot use radios either.
- **State as text and ARIA** — already there: "Question N of M" (`quiz.tsx`),
  a labelled `role="timer"` and labelled navigator buttons. The link
  pages print the same facts as plain text.
- **No `robots.txt` block on `/sample`, `/test` or `/t/`** — some chat fetchers obey
  it, and blocking them defeats the goal. Crawlers are kept out another way (below).

## Crawlers (2026-10-06 review)

Each question page links to seven more, so a crawler that follows every link walks
7⁵ ≈ 16,800 result URLs per 5-question test, and each visit to `/sample` makes a new
one. Every result page costs a Redis call, and scoring needs Redis, so a crawler could
use up the Upstash quota and stop scoring for everyone. So:

- every link into a test (the home page's start links, options, Skip, result and start
  links) is `rel="nofollow"`; the pages say `noindex, nofollow`, and `next.config.ts`
  sends `X-Robots-Tag: noindex, nofollow` on `/sample`, `/test` and every `/t/` URL;
- an invalid, expired or changed-site link stays a 200 page that says why and links to a
  new test. A 404 was tried and dropped: Next 15.5 sends `notFound()` from a dynamic page
  as an empty shell that only JavaScript fills, so a reader without it saw a blank page
  (checked over HTTP with curl, Googlebot, ClaudeBot and ChatGPT-User agents, 2026-10-06).
  `noindex, nofollow` keeps crawlers off these pages instead.

`nofollow` is a crawler hint; a chat agent fetching links at a user's request is
expected to ignore it. The chat-LLM check below confirms that.

## Done when

- Plain HTTP (curl, no JavaScript) can go from `/sample` to a scored result by
  following links only. A route test does the same walk.
- No `aria-label` in the app describes a board's contents.
- A chat LLM given only `https://iq.ebarakos.com/sample` reaches a result.
  Record below what it could see and how it scored.

## Built (2026-10-06)

Everything above except the chat-LLM check, which waits for a deploy.

- **Token.** `src/lib/link-test.ts` seals the seed (16 random bytes), length, source,
  generator version, withdrawn-family hash, a bank hash for a fallback test, the app release, leaderboard settings and the three
  times, in the quiz token's AES-GCM envelope under its own version tag (`l1`) and AAD, so
  neither kind of token opens as the other. Sealed, it is under 300 characters in the generated-token tests, not the 120
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
- **Submission.** Both flows save their first score in Redis before revealing the review.
  Identical retries retain that score and its timing; changed answers show an error without
  a review. A Redis failure offers the same result link for retry.
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

Run 2026-10-15 on the v0.2.0 deploy, in ChatGPT (the owner's account, default model):

- **Given only the home page and "take the test"** (the owner's run): it read the page and the
  public repository, took the start links for JavaScript buttons, said `/sample` was
  "inaccessible through my web tool", and stopped without a score.
- **Given `https://iq.ebarakos.com/sample` and told to follow each chosen option's link**: it
  opened all five pictures, followed the redirect and every option link, and reached the
  result: 5 of 5 correct in 2 min 3 s, with no blocked link or image.

So `nofollow`, the redirect and the long token links do not stop its tool; knowing that links
alone take the test does. The home page now says so in plain text for AI agents, with the full
`/test` and `/sample` addresses (`src/app/quiz.tsx`, `Intro`).

On the v0.2.1 deploy, given the home page, ChatGPT's tool gave up on `/test` ("Timeout
fetching", then "URL is not accessible via this tool"): building 30 questions took 7–9 s
there, `/sample` 2–3 s. The server refused nothing (at most 4 starts per address that hour).

## Built over several requests (2026-10-15)

A fetch tool waits only a few seconds for a page, so no request may build for long. Every
link-test start with Redis builds for about 1.2 s (`BUILD_BUDGET_MS`, `src/lib/link-start.ts`),
and stops before a question that would likely run past it (the slowest one so far).
If the test is not finished, its progress (seed, and each filled slot's kept attempt and
question fingerprint) goes to Redis for 10 minutes under a random id, and the page links to
`/t/start/<id>/<built>`, which builds the next part on whichever server instance gets it. A slot
depends on earlier ones only through the questions they ask (`fillExpandedSlots`), so the
test is the one `createLinkTest` builds at once from the same seed; the tests prove it.

- **No background work.** A build left running after a response (`after`) was tried first:
  the follow-up request waited behind it for 6 s on the same process, because a question
  takes 0.3–0.5 s to build and only then lets other work in.
- **The clock starts when the last part is built**, so building never uses the taker's time.
- **One link, one test.** The finishing request saves its issued token until that token
  expires. A retry recovers the same token and deadline, even if the first redirect was
  lost. An atomic compare-and-save returns the newest saved state, so overlapping requests
  cannot move progress backward or replace an opened test.
- **Unchanged without Redis** (a development server): the start builds everything and
  redirects. The in-page test (`POST /api/generate`) still builds at once; people wait there.
- **A new address at every step.** `<built>` is there only so each page links somewhere new;
  the server ignores it. The earlier `/t/start/<id>` route remains usable. Temporary
  failures return a readable page with a fresh retry address for the same test.

First ChatGPT run on production (2026-10-16), with a 1.5 s budget and one fixed `/t/start/<id>`
link: its tool timed out on the first requests (one follow took 3.3 s there), then showed
"19 of 30" over and over. The server held 19 and moved to 23 on the next real request, so the
tool was serving its cached copy of the same address. Hence the new address per step and the
shorter budget with a stop before an overrun. Measured on a development server afterwards:
six requests of 0.6–1.5 s each, then the redirect to question 1.

## Results over several requests (2026-10-16)

A completed 30-question test still timed out: the result page rebuilt the whole test
before checking its saved receipt, including on every retry. It now opens the token and
checks the receipt first. A saved result needs no puzzle generation.

A cold result rebuilds its answer key in short requests (`src/lib/link-result.ts`). Redis
claims the complete answers and their first arrival time before rebuilding starts, and
keeps progress until token expiry. Calculation time changes neither the speed bonus nor
the late marker. Each progress page links to `/t/<token>/result/<built>?a=<answers>`, so a
fetcher's cached page cannot repeat the same step. Temporary failures offer fresh retry
addresses. Concurrent requests save progress atomically and use the newest state.

The key stays server-side. Only the durable first submission receipt releases the score,
review and publication links. Legacy generated tokens resume their original assembler;
fallback tests retain the bank sampler, measured at about 60 ms for 30 questions locally.

## Short sessions and an untimed entry (2026-10-16)

Claude Haiku reported a 250-character image URL limit. The sealed token made its PNG
addresses too long. New agent links now carry a random 22-character session id. Redis
keeps the original token in the completed start record until token expiry. Pages, images,
answer links, result steps and publication links keep the id; scoring and publication
resolve it to the original token, so both URLs share one receipt and leaderboard entry.
Existing sealed-token URLs still open. Development without Redis keeps those older URLs;
a configured store failure offers a fresh retry instead of falling back to oversized URLs.

The home page now has a small Agent access link. `/agents` offers a fixed PNG image check
before any timed test. Canonical `/test` and `/sample` redirect there without generation
or storage work. The guide's explicit start links carry a fresh `new` nonce, as do new-test
links after a result or error. This prevents cached canonical starts from opening an old
test. The clock starts when the prepared test opens, as before; the in-page JS flow stays
on its existing API. No test question is exposed by the untimed check.

Public DNS checks through Google and Cloudflare and an HTTPS request outside the sandbox
succeeded on 2026-10-16. A tool's DNS, egress or image restrictions require a tool that
permits that access; changing the app cannot grant those permissions. No alternate hostname
was verified, and no domain configuration was changed.
