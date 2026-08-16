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
