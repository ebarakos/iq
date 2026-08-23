# Human pilot results

One file per completed pilot packet, exactly as the pilot screen's **Download
JSON** produced it, named `<date>-<packetId>.json`. Nothing generates or edits
these; they are the human half of the evidence, and the only reason a family
gets withdrawn.

Read `packetContentFingerprint` before comparing two files. It names the exact
item set the packet held at the time. Packets change whenever a family is
withdrawn, so two results with the same `packetId` and different fingerprints
did not answer the same questions.

## 2026-08-23 — `pilot-v1-a`, first human pilot ever run

Seven of eight correct on a desktop. The miss was `concept-induction-v2`, filed
with `notationMisunderstandingReports: 1` — the pilot could not tell what the
check-marked and crossed example groups were asking. It was withdrawn the same
day. `transformation-machine-v3` was solved but took 135 seconds, by far the
slowest item in the packet; worth watching against the 60-seconds-per-question
budget the public test allows.

## 2026-08-23 — `pilot-v2-b`, second and final pilot from this participant

Seven of seven correct, every item in 15 to 30 seconds, no notation
misunderstandings and no reports of a second defensible answer. Combined with
`pilot-v1-a`, one person has now judged 12 of the 15 eligible families and got
14 of 15 items right; the single miss was `concept-induction-v2`, withdrawn.

Not covered by any human: `fold-punch-v2`, `interleaved-sequence-v2`,
`inverse-analogy-v2`. All three sit in packet `pilot-v2-a`, which was never run.
`interleaved-sequence-v2` is the gap that matters — the strong vision model
answers it wrongly four times in five, so whether a person can read it decides
whether it is the project's first genuinely agent-hard family or a broken one.

What this evidence supports: these 12 families are legible, and their intended
relationship is recoverable by sight. What it does not support: any statement
about difficulty. One person, one item per family, and 14 of 15 correct means
the ceiling was never found — a battery this participant nearly sweeps cannot
be calibrated from these files.

Timing worth carrying forward: `transformation-machine-v3` took 135 seconds
against a 60-second-per-question budget in the public test. Everything else
finished in 15 to 60 seconds.
