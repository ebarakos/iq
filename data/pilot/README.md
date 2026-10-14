# Human pilot results

One file per completed pilot packet, exactly as the pilot screen's **Download
JSON** produced it, named `<date>-<packetId>.json`. Nothing generates or edits
these; they are the human half of the evidence, and the only reason a family
gets withdrawn.

**What these files are evidence OF, and what they are not.** They are evidence
about *items*: that a family could not be read, that a notation misled, that two
readings were both defensible. Those are facts a single sitting establishes, and
they are the only reason to withdraw a family. They are **not** evidence about
*difficulty*. Every aggregate here has one participant, who does other things
while answering — so a slow solve may be an interruption and a wrong answer may
be boredom. `npm run pilot:report` therefore prints the miss counts and solve
times as numbers with no verdict attached; it stopped calling them an escalation
result on 2026-08-27. Difficulty needs the multi-participant retention pilot,
which has not run.

Read `packetContentFingerprint` before comparing two files. It names the exact
item set the packet held at the time. Packets change whenever a family is
withdrawn, so two results with the same `packetId` and different fingerprints
did not answer the same questions.

## 2026-10-09 — new mechanisms, prepared for retention

Spatial assembly was disabled at the owner's request on 2026-10-09.
`pilot-v3-manifest-scene-families-v33.json` records 15 items across two packets.
Packet **A has three new items**: interacting machines in induction-transfer.
Packet B holds 12 familiar keys for diagnostics;
the owner need not repeat it. No participant results or invitations have been created.

Each new item needs at least eight independent attempts without the answer or hidden rule.
Collect the intended relationship and unclear visual distinctions before revealing the rule.
Include phone and desktop attempts because both layouts change with viewport size.
Apply the existing [retention thresholds](../../docs/plans/deterministic-novel-tests.md#human-solvability-promotion-gate):
at least 75% describe the intended relationship; at most 20% report unclear notation;
no repeated defensible alternative answer. Median time must fit 55 seconds for machines.
No band median may exceed 60 seconds; the 30-question
weighted medians must average at most 45 seconds. Difficulty remains unmeasured until
that evidence exists. Invitations require separate approval. The v32 manifest remains
unchanged as the record of its earlier 18-item packet population.

## 2026-10-10 — approved matrix families, prepared for retention

`pilot-v3-manifest-scene-families-v34.json` records 36 items across two packets.
Packet A holds 24 items: three per overlapping-figure and shape/count/shading key,
plus the three interacting-machine items. Packet B retains 12 familiar keys.
The new matrices use six rule levels across seven served band/bucket keys;
overlapping d5 appears in both the constraint-spatial ramp and induction-transfer.
The same retention thresholds apply. Band medians must fit 25/40/50/55 seconds,
respectively. No new human results have been collected.

## Pilot v3 manifests — what each generator population held

`pilot-v3-manifest-scene-families-v38.json` is the current 36-item record, requiring every machine transformation to distinguish six choices.
Its packets retain the same 24 new-mechanism and 12 familiar-item design. Earlier manifests remain
the records of their original populations; no timed human results have been collected for v38.

The answer-free record of every pilot-v3 packet: item identity, difficulty, and
band time budget, plus each packet's content fingerprint. No puzzle, no answer,
no explanation. `buildPrototypePilotManifest()` generates the current record.
A test compares it with the committed manifest for the current generator.

`npm run pilot:report -- <aggregate.json>` reads
`pilot-v3-manifest-<generatorVersion>.json`, for example
`pilot-v3-manifest-scene-families-v31.json`. Each generator version gets its own
file. Preserve all older manifests and recorded results unchanged. A versioned
filename selects the manifest; the content fingerprint still proves which
questions were answered. A mismatched packet id, fingerprint, item set, or
schema version remains a hard error.

`pilot-v3-manifest.json` is the preserved `scene-families-v30` record from
2026-10-05. Both recorded v3 aggregates below predate it and fail its fingerprint
check. Historical reports require a manifest with the aggregate's exact packet
fingerprint; `runPilotReport(aggregatePath, manifestPath)` accepts an explicit
historical manifest. Never recreate a missing manifest from the aggregate.

Aggregate exports from the pilot screen are schema
`prototype-pilot-aggregate-v2`: one row of counts per item, five-second solve
time bins, and an explicit defensible-alternative count. Aggregate v1 files
(the three results below) are per family with fifteen-second bins, and
`pilot:report` refuses them by name — they belong to packets v1 and v2, which
held different items.

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

Not covered by any human at that point: `fold-punch-v2`,
`interleaved-sequence-v2`, `inverse-analogy-v2`. All three sat in packet
`pilot-v2-a`, which was never run in its two-packet form. The 2026-08-24
full-battery run below closed that gap (for `interleaved-sequence` via its
`-v3` redesign; `-v2` had already been withdrawn on structural grounds).

What this evidence supports: these 12 families are legible, and their intended
relationship is recoverable by sight. What it does not support: any statement
about difficulty. One person, one item per family, and 14 of 15 correct means
the ceiling was never found — a battery this participant nearly sweeps cannot
be calibrated from these files.

Timing worth carrying forward: `transformation-machine-v3` took 135 seconds
against a 60-second-per-question budget in the public test. Everything else
finished in 15 to 60 seconds.

## 2026-08-24 — `pilot-v2-a`, full battery in one sitting, same participant

The packet held all 16 then-eligible families, one item each (the packet size
cap was raised to 20 at the user's request so the whole battery fits one
sitting). Result: 15 of 16 correct, most items in 15 to 30 seconds.

Withdrawn the same day, shipped as `scene-families-v10`:

- `relational-outlier-v3` — wrong answer, a notation-misunderstanding report,
  45 seconds. The demonstrated-examples redesign fixed the structural defect
  that withdrew `-v2`, and people still cannot read the format. The battery
  again has no odd-one-out item.
- `interleaved-sequence-v3` — answered correctly in 30 seconds, but with a
  notation-misunderstanding report and no intended-relationship description.
  The user withdrew it: a right answer without the intended reading does not
  prove the item measures its rule, and the gate withdraws rather than admits.

Worth watching, not withdrawn: `composed-transform-v2` (the new three-step
composer) was solved correctly but took 60 seconds against its band's
40-second budget — the same one-slow-item signature `transformation-machine-v3`
showed on 2026-08-23. One more slow reading and the band placement needs a
second look.

Every other family: correct, intended relationship described, no notation
reports. `containment-analogy-v2` was judged in its new `constraint-spatial`
band (15 seconds) — the 2026-08-24 band move survives its first human contact.

## 2026-08-26 — pilot-v3-a (the v11 escalation pilot)

One participant, one sitting, 20 items — one per enabled family/band/bucket key.
Aggregate: `2026-08-26-pilot-v3-a.json`. It matched the manifest current at the
time; the present v17 manifest intentionally rejects it as a different item set.

**Result: 15 of 20 correct, with four clean misses** among the 15 d4/d5 items —
`visual-set-algebra-d5`, `composed-transform-d4`, `compositional-analogy-d4` and
`fold-punch-d5`. At the time this was recorded as the escalation test passing,
against a bar of two clean misses. **Read now, it says less than that.** A clean
miss was defined as "understood the rule, described it correctly, reported no
notation problem and no defensible alternative, and still chose wrong", which
sounded like difficulty coming from the rule. The next sitting showed the
definition cannot tell that apart from not engaging: the same participant
produced six clean misses while answering an eighteen-panel item in five seconds.
The four misses here are a fact about the sitting, not a measurement of the
ceiling.

**Timing is not evidence in this sitting.** The participant said they were
interrupted throughout, and the data shows it: one warmup item sat at 495 seconds
against a 25-second budget. Every "median over budget" flag in the report is
discounted for that reason. The report no longer draws a branch verdict from
either number.

**One family withdrawn: `containment-analogy-v2`.** It drew the single
notation-misunderstanding report, and the participant independently named it as the
only thing they disliked ("tiny shapes encircled in triangles"). It is the only
family that draws a token inside another shape, so it is the only one that renders
a token smaller than every other family does. Withdrawn the same day; the
constraint-spatial pool drops from four families to three.

**One family flagged but kept: `attribute-pairing-v1`.** Its single response was
wrong, did not describe the intended relationship, and reported a defensible
alternative — the ill-posed signature. The participant judged the rest of the
battery good and asked to keep it, so it stays on one observation; a second
sitting showing the same pattern should withdraw it.

## 2026-08-27 — pilot-v3-a again (19 items), and the end of pilot sittings

Aggregate: `2026-08-27-pilot-v3-b.json`. 15 of 21 correct, six clean misses, both
d6 items among them and no notation report on either — so the written d6 success
test passed.

**Do not read that as evidence, and do not run this packet again.** The
participant said plainly that they were doing other things while sitting it, that
they now know every mechanism instantly, and that their wrong answers come from
boredom rather than difficulty. The timing bears it out: the five-gate
`composed-transform-d6` item — the whole point of that batch — was answered wrong
inside five seconds, which is not long enough to read an eighteen-panel table.
A clean miss is supposed to mean "understood the rule and still chose wrong";
here it meant "did not engage". The metric cannot tell those apart.

Two decisions followed, both the owner's:

1. **Never more than three gates.** More gates is more procedure, not more
   reasoning. Both d6 buckets were withdrawn the same day.
2. **No more repeat sittings.** Invite a sitting only when a genuinely new
   mechanism exists to try; otherwise the owner runs the real test themselves.

The useful signal from this sitting was not numeric. It was the report that the
explanations say "the highlighted option" while nothing on the pilot screen was
highlighted (now fixed), and that the set-algebra items were "too easy/toy"
(the family was rebuilt on 2026-08-27).
