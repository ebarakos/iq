# IQ visual reasoning gym — Brainstorm

This file holds ideas that are not approved work. The current design is
[deterministic novel tests](plans/deterministic-novel-tests.md), and the
only active implementation list is [TODO.md](../TODO.md).

## Product meaning

The IQ visual reasoning gym is for people and AI agents, and exposes where their
difficulty profiles differ. It is not a standardized IQ score yet.

## Settled questions

Q2 — agents receive the same rendered image as people. Symbolic JSON is a
separate diagnostic channel.

Q3 and Q4 — pure, versioned code generates and scores live tests. Models solve
tests and help with offline calibration or rule research; they do not author the
normal live test.

Q5 — calibrate generator feature buckets, not one-off random items. Keep human
and agent results separate.

Q7 — report the human–agent gap, not one combined IQ-like score.

Q8 — an IQ point is defined by a population, not by how hard an item is. Any
real IQ number would need either our own representative norming sample or a
study equating aiq against an already-normed test such as Raven's. Neither is
planned, so aiq reports a raw score and a reasoning-family breakdown and calls
it nothing else. A percentile among aiq takers becomes possible if human results
are ever stored; a clinical IQ figure does not.

## Parked, with the condition for coming back

**Mobile visual regression suite.** Dropped as a release requirement on
2026-08-16. The point of such a suite is to catch a visual cue that reads at
1440px and vanishes at 375px, which is a real failure mode for this product —
but it is not worth building while the families themselves are still changing
shape, because every renderer change would mean re-approving the baselines.
Reintroduce it once the test families are settled, meaning the human pilot has
run and the enabled family list has stopped moving. Until then, mobile coverage
is the `/ui-qa` browser pass and manual spot checks.

**HTTP agent mode, both the server-run and the external-client version.** Moved
here from `TODO.md` on 2026-08-16, before any of it was built.

The decision not to store attempt records removes the reason to build either
one. A server-run call would take a test, call the model, return a score, and
forget it, so nothing reaches the family report. An external-client protocol
would return a score its caller cannot prove and we do not keep. Neither feeds
the human–agent gap, which is the thing that makes aiq worth building. The
offline harness already measures agents reliably and writes a real corpus, so
nothing is lost today by not having an endpoint.

There is also an unresolved technical doubt: a synchronous 30-item run means 30
model calls inside one serverless request, and `scripts/agent-run.ts` defaults
to concurrency 2 and aborts the whole run on a single relay rate-limit error.
That behaviour is fine in a script you can rerun and wrong in a request someone
is waiting on.

Bring this back when there is somewhere to put the results — that is, once
attempts are persisted for humans, agents, or both. At that point the storage
decision, the concurrency ceiling, and the trust model all need answering
together rather than one at a time.

**LLM rule-proposal path.** Kept as a dormant alternative rather than deleted.
It is not on the roadmap and is not being developed, but the idea — letting a
model propose a rule program that pure code then validates, builds, and scores —
stays available if procedural sampling ever runs out of genuine variety. The
code lives in `src/lib/llm-rule-proposal.ts` and `scripts/llm-rule-experiment.ts`.
Nothing in production calls it.

## High-value measurement ideas

These are unapproved ideas, ordered roughly by meaning for the work they add.
None should displace the human pilot or the current calibration pass.

**Compare error paths, not only scores.** Every wrong option already has a
failed-rule witness; retain a stable witness category through option shuffling
and compare which mistakes people and agents choose. This could show that both
groups miss equally often but reason incorrectly in different ways, while also
exposing distractors that nobody finds plausible.

**Pair the human and agent evidence item by item.** Run the fixed model panel on
the exact images used in each human calibration batch, then aggregate those
paired results by generator bucket. Report an uncertainty interval and call a
gap inconclusive until the interval supports its direction, so a lucky item mix
or a tiny sample cannot create a headline result.

**Separate visual failure from reasoning failure.** Keep a small pilot-only set
of direct perception controls for every meaningful cue, and generate
answer-preserving variants that swap shape identities, palette, and harmless
layout details. Failure on a control, or a changed answer after a meaning-neutral
restyle, should be labelled notation- or vision-sensitive rather than hard
reasoning.

**Measure example efficiency with matched variants.** Hold the rule and query
fixed while changing only how many worked examples reveal it; compare the
human and agent learning curves. The number of demonstrations needed to infer a
fresh rule may expose a larger and more useful gap than final accuracy alone.

**Gate personal interpretations on parallel-form reliability.** Ask a pilot
subset to take two fresh, equivalent forms far enough apart to limit immediate
practice effects. If overall or family-level results swing widely, describe a
test result as one sample and suppress profile-like claims until the forms are
stable enough to support them.

Research anchors: wrong-option choices can carry useful information in Raven's
matrices ([distractor analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC7151189/));
paired equivalent representations can expose modality-specific failure
([SEAM](https://arxiv.org/abs/2508.18179)); held-out rule compositions measure
transfer rather than surface novelty
([CVR](https://openreview.net/forum?id=MKDdTASg_1y)); and fresh forms need their
own consistency check
([alternate-forms reliability](https://pmc.ncbi.nlm.nih.gov/articles/PMC8243205/)).

## Low-hanging, high-leverage ideas

These ideas reuse state or machinery the project already has. They are ordered
roughly by likely benefit, not by implementation sequence.

**Return a useful completion receipt.** The server already knows issue time,
submission time, generator version, and item ids. After scoring, show elapsed
time plus a short opaque test code and a Copy diagnostics action, giving users
useful context and making a confusing generated item easy to report without
storing an account or exposing the seed.

## Captured ideas

Short dated notes, appended as they come up: what and why, no proof needed.

- 2026-08-24: the odd-one-out format has now failed the human gate twice — `-v2` with no worked evidence, `-v3` with three demonstrated example boards. A third attempt should change the presentation (e.g. label the examples as belonging together, or show one counter-example) rather than just the evidence count.
- 2026-08-24: `interleaved-sequence-v3` was withdrawn on a right-answer-wrong-reading pilot result. If the alternation notation itself is the problem, a redesign could mark the two strands visually (alternating panel backgrounds) instead of asking the solver to discover the interleaving.
- 2026-09-28: before any score is stored, shared, or served to agents over HTTP, quiz tokens must become single-use. `/api/submit` returns every `answerIndex` and accepts the same token again until it expires (2 hours), so submitting blanks and then resubmitting the returned answers scores full marks, on time. Harmless while nothing is stored; the fix needs server state (a key-value store keyed on the token's IV).
- 2026-09-28: before the next pilot sitting, fix two things on the pilot page: it shows each item's family, band and bucket above the puzzle while the participant solves it (`src/app/prototypes/prototype-pilot.tsx:393`), and the recorded responses live only in React state, so a reload loses the sitting (`:157`). Sittings are scarce.
- 2026-10-01: a leaderboard for the 30-question test, with the recorded agent probes as fixed rows ("gpt-5.6-sol, 76%"), so a person sees where they stand against the models — the human–agent gap made personal. Easiest store: Upstash Redis through the Vercel Marketplace (free tier, one env var), a sorted set ranked by score then time, written only by `/api/submit` from its own scoring after an on-time submission, with the taker adding a short display name. It needs single-use tokens first (the 2026-09-28 idea above) or the replay gives everyone 30/30; the same Redis can hold the used-token marks. Each test is drawn fresh, so rank only the 30-question length, whose band schedule is fixed.
- 2026-10-04: Opus 5.5 scored 29/30 on one 30-question test (23/24 on the hard bands), so the ladder no longer separates the strongest models from each other. The ladder exists to separate human-hard from agent-hard items, and at 97% its hard end is not agent-hard for this model. Worth a look before more families: which mechanisms the strongest models still miss (Opus's one miss was a reading the evidence allowed, not a rule it failed to see).
- 2026-10-04: a grey arrow shows less grey than a grey triangle of the same size (about 30 against 38 square pixels for a large token on a 64px review board), for the same reason stars did: a thin stem under a thick outline. Composed transform's near misses still colour arrows grey, so a slightly wider stem would help takers compare those options.
- 2026-10-06: the owner wants leaderboard points to reward speed: 28/30 in 20 minutes should outrank 30/30 in 30 minutes. Implemented after the owner requested the leaderboard: 100 × correct × (1 + 0.25 × fraction of time remaining), using server time; raw accuracy stays beside points. Local only until the owner enables it on deployments.
