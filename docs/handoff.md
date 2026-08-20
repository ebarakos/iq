# Handoff
from: codex → to: claude
stage: review→fix
updated: 2026-08-20
branch: main · plan: docs/plans/mechanism-variety.md · tasks: TODO.md

## Just did
- Reviewed all 48 uncommitted paths across mechanism variety, the expanded bank, agent evidence, the public test, and the prototype pilot; no fixes were applied.
- Confirmed the generator work is sound: 253 tests pass, the production build is clean, bank verification passes under the current configuration, and all 19 converted families pass the fixed 200-seed diversity gate.
- Reproduced the two highest-signal failures: a legitimate withdrawal breaks expanded-bank replay, and generated `agent:run --all` can never satisfy its own minimum coverage.
- Confirmed the two new v5 attempt artifacts contain 38/38 transport failures each and no model answers; the pending v5 capability probe therefore remains unfinished.
- Left `.claude/runs/2026-08-19-mechanism-variety.md` in place because its integration/probe item is still unchecked.

## State
- diff: `git diff` + `git status --short` — 35 modified, 13 untracked; key files: `src/items/scene-families.ts`, `src/items/bank.ts`, `scripts/agent-run.ts`, `scripts/report.ts`, `src/items/prototype-pilot.ts`
- tests: pass — run: `npm run typecheck && npm run lint && npm test && npm run build && npm run bank:verify && npm run families:verify`
- blockers: real v5 agent evidence is blocked; both attempted final probes failed at transport, and no strong-model result exists.

## You next
- Make expanded provenance replay-complete by storing the normalized withdrawal configuration in both bank records and generated attempt artifacts; replay against the stored value, including when the runtime withdrawal list later changes.
- Repair the agent-evidence control flow: make generated `--all` coherent with the coverage contract, prevent a terminal rate limit from being marked complete, and pass `--include-partial` through to diagnostic report aggregation.
- Keep the two transport-only v5 artifacts out of capability claims and calibration writes; add a clear all-harness-failure population warning, and ask before deleting those files.
- Freeze or fingerprint the `prototype-pilot-packets-v1` membership and visible content so results stay comparable; also distinguish a missing session label from an invalid packet in the picker.
- Reconcile smaller contracts: `bank:topup --source expanded` ignores its documented `--count`, and `docs/plans/deterministic-novel-tests.md` still calls the live generator `scene-families-v3`.
- verify: `npm run typecheck && npm run lint && npm test && npm run build && npm run bank:verify && npm run families:verify`

## Open questions
- Should the two transport-only v5 artifacts remain as diagnostics, or be removed from the corpus? They contain no model evidence; deletion requires user approval.
- `docs/bugs.md` now proves that public puzzle ids reveal almost the whole seed. Keep it at the checkpoint promotion gate rather than expanding this fix pass silently.
