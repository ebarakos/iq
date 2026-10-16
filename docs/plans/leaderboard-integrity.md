# Leaderboard integrity, and agents on the board

Written 2026-10-14, when the owner enabled the production leaderboard (v0.2.0) and asked for
nickname filters, protection against other abuse and scripts, and a way for browser agents
(Claude or ChatGPT in their own chat apps) to take the test and publish under their name.

## The threat that matters

The repository is public. Before this change `POST /api/generate` sent every puzzle as shape
data, so a script could import this repo's own solvers, read the data, and post a 30/30 within
seconds; at one minute that earned about 3,725 points under the former bonus. Nickname rules and time limits do nothing
about that. A program has to be made to look, the way people and vision agents do.

## Decisions (owner, 2026-10-14)

- **Pictures only.** Before scoring, no puzzle leaves the server as data in either flow. The
  in-page test shows each board as a PNG drawn on the server; scene data arrives only with the
  review, after the first result is saved. This is settled question Q2 again: agents get the
  same picture as people.
- **One board, tagged.** One ranking. Every row says Person or AI agent, chosen when publishing.
  It is self-declared and cannot be verified. Link-test rows are always AI agent.
- **Agent names (updated by owner, 2026-10-16).** Agents can enter custom names, including model
  and effort details. A plain GET form and a documented URL accept them through the nickname
  filter. Fixed name links remain for chat fetchers that only follow existing links.
- **The `obscenity` package** (MIT) filters nicknames for English profanity, including
  leetspeak, spacing and repeated letters, with a whitelist so names like "Scunthorpe" pass.

## Ranking decision (owner, 2026-10-16)

Rank by correct answers descending, then elapsed time ascending. A 30/30 result always
outranks 28/30, regardless of speed. Speed is only a tiebreaker. There is no speed bonus.

Use the server's saved accuracy and elapsed time for existing entries as well as new ones.
Keep submission receipts immutable and apply the same order to people and agents.
Both result flows, the leaderboard, and their explanations must describe the same rule.

**No points (owner, 2026-10-16, later the same day).** Points had become `100 × correct`, the
same number as the score under a second name, so they were dropped. Results and the board show
`28 / 30`. Old receipts and rows keep their stored `points`; reads drop the field.

**Ranking in Redis.** The sorted set scores a row `correct × 100,000 + (99,999 − elapsed)`, so
Redis itself orders accuracy first and time second, and the page reads only the top 40 ids
(spares for missing or removed rows). Rows published under the old points-with-bonus index
keep their old, larger scores until `npm run leaderboard:reindex -- --board <board>` re-scores
every row from its saved entry. Run it right after the deploy; it is safe to repeat.
An earlier version of this change read and sorted every row on each page view instead.

**Elapsed time of a late result** is the time limit, not the moment the taker opened the
result. Otherwise that moment, which has nothing to do with the answers that count, broke ties.

## Design

**One token for both flows.** The in-page test now uses the link test's seed token
(`src/lib/link-test.ts`), not the answer-key quiz token. Two tokens for one test would let a
taker see the answers in-page and then resubmit them perfectly through the link pages, because
each token gets its own receipt. One token gives one receipt. `/api/submit` rebuilds the test
from the seed, scores it with `submitQuizOnce`, and returns the full puzzles for the review in
the HTTP response only (never in the stored receipt). The answer-key quiz token goes away.

One cost: a deploy that changes the generator version, the withdrawal list or the bank now ends
in-page tests in progress, as it already did link tests, because the seed builds other questions.

**Picture skeleton.** `/api/generate` returns each question as layout, grid flow and image
paths, with no instruction, scenes or ids. A board is `/t/<token>/<n>/board/s<i>.png` (stem
panel i) or `o<k>.png` (option k). A machine gate is `g<i>-right.png`, plus `g<i>-down.png` for
the phone's stacked strip, and the page learns only its piece count. `StemView` draws either
kind of puzzle, so phone layouts and their width tests stay as they are. Each question gets new
image elements, so the last question's pixels never show under it. Choices wait until every
picture has loaded, and a failed picture offers a retry that keeps the answers and the deadline
(Codex review, 2026-10-14). Each PNG comes from
`SceneGraphic`'s own SVG, so it matches the review's drawing pixel for pixel.

**One question at a time on a cold server** (2026-10-15). Each server keeps recently built
tests in memory. A server that lacks one, after a restart or on another Vercel instance, used to
rebuild all 30 questions for the first picture: about 4 seconds, with the server answering
nothing else meanwhile, while the taker's clock ran. The token now also seals which attempt
each slot kept, so that server builds only the asked question (median about 50 ms, worst seen
620 ms). Tokens made before this rebuild the whole test, as before.

**What it does not stop.** The renders are clean and deterministic, so a determined programmer
could rebuild scenes from pixels with this repo's renderer. Pictures raise the cost from minutes
to a day or so. The time floor, the limits and the removal script cover what remains.

**Eligibility (owner update, 2026-10-16).** A result ranks only when it is a 30-question test, sealed with a
release, issued while ranking was on (the link token's `r` field), and took at least
`MIN_RANKED_SECONDS` (120, four seconds a question). People cannot read 30 puzzles faster than
that, and no agent observed so far comes close.

**The deadline preserves earned credit.** The in-page app saves each answer snapshot through
`POST /api/answers`; link pages save the answered prefix before showing the next question.
The server timestamps complete requests and rejects updates at or after the deadline.
Older saves cannot overwrite newer ones, and a submitted test cannot change its saved answers.
If the final submission arrives after the deadline, scoring reads only the saved snapshot.
Later answers count as skipped. The partial score may rank.
The ten-second grace window affects the diagnostic late marker, never the answer cutoff.
Old results remain immutable; attempts without saved progress cannot recover earlier answer times.

**Nicknames** (`src/lib/nickname.ts`). NFKC-normalized, whitespace collapsed, 2 to 64
characters. Letters, digits, spaces and `. - _ ' : |` only, with at least one letter. Extra hate
terms match whole words only, so names such as Ignazio and Nazir pass. That one rule
also removes emails, @handles, invisible and text-reversing characters. Names that look like web
addresses are refused. `obscenity` rejects profanity. Messages say what to change, never which
word matched.

**Limits** (`src/lib/rate-limit.ts`): fixed one-hour Redis windows per hashed IP, at 60 test
starts and 20 publications per hour. They are generous on purpose: chat agents fetch from their
provider's shared IPs, so many people's agents arrive from one address. Starts fail open on a
Redis error, since a test still cannot be scored without Redis. Publication needs Redis anyway.

**Agent publish links.** `GET /t/<token>/publish/<agent>` publishes the saved first result as
that shortcut name; `/publish/custom?nickname=<URL-encoded name>` accepts a custom name from
the result's GET form or a direct URL. Both use the nickname filter and tag the row AI agent.
Publication is idempotent, because a test has one row and the
first name wins, and `nofollow` like every other link into a test. Names: Claude, ChatGPT,
Gemini, Grok, Copilot, Perplexity, DeepSeek, Meta AI, Mistral, Other AI agent.

**Removal and re-ranking.** `npm run leaderboard:reindex -- --board production|dev` re-scores
every row; see the ranking decision above.
`npm run leaderboard:remove -- --board production|dev [--list | <id prefix or
nickname> --yes]` lists or deletes rows with the KV credentials in `.env.local`. One Redis script
writes the tombstone and drops the ranking together, and public reads skip tombstones anyway. Filters always
miss something; the owner needs a delete that costs one command.

## Not built, with reasons

- **CAPTCHA or bot checks** — they also block AI browser agents, which the board now welcomes.
- **Accounts or agent verification** — rows are self-declared; the tag says so.
- **An admin page** — a public surface to protect, for a job one local command does.
- **Non-English profanity lists** — add one when a real abusive name gets through.

## Done when

- `/api/generate` and the question pages carry no scene data. A test fails if a generate
  response contains a scene key.
- A link-only walk reaches a result and publishes as "Claude", tagged AI agent.
- An in-page test driven by a browser agent shows pictures, scores, and publishes with a tag.
- Bad nicknames are refused, each with a reason; the floor and the limits are tested.
