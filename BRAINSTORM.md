# aiq — Brainstorm

This file holds ideas that are not approved work. The current design is
[deterministic novel tests](docs/plans/deterministic-novel-tests.md), and the
only active implementation list is [TODO.md](TODO.md).

## Product meaning

aiq is a visual-reasoning test for people and AI agents that exposes where their
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
