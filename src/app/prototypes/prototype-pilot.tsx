"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SceneGraphic, StemView, describeScene } from "@/items/render";
import type {
  PrototypePilotItemAggregate,
  PrototypePilotPacket,
  PrototypePilotServedQuestion,
} from "@/items/prototype-pilot";

interface GradeResult {
  correct: boolean;
  /** Which option was right. Arrives only with the grade, never before it. */
  answerIndex: number;
  explanation: string;
  late: boolean;
  timeBudgetSeconds: number;
  /** The server's own measurement. This is what gets binned and exported. */
  elapsedSeconds: number;
  /** What this browser measured, kept only so a disagreement can be shown. */
  clientElapsedSeconds: number;
  clientTimingDisagrees: boolean;
  viewport: "mobile" | "desktop";
}

/** A server refusal, phrased for the person sitting the pilot. */
interface Refusal {
  reason: string;
  serverMessage: string;
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];

/**
 * What the participant is told when the server refuses.
 *
 * Every branch names the situation, says what happens to the work already
 * done, and gives one next step. None of them is a dead end, and none of them
 * says anything about the answer.
 */
const REFUSALS: Record<string, { headline: string; guidance: string }> = {
  "already-recorded": {
    headline: "This item is already recorded.",
    guidance:
      "Its response was saved once for this sitting, and the pilot will not grade the same item twice. " +
      "Continue to the next item, and tell the moderator if this item turns out to be missing from the exported JSON.",
  },
  "unknown-sitting": {
    headline: "This sitting is no longer active.",
    guidance:
      "The server was restarted, or the sitting has been open too long. Download the responses recorded so far, " +
      "then reload this page to start a new sitting.",
  },
  "content-drift": {
    headline: "This page is showing an older version of the item.",
    guidance:
      "The pilot refuses to grade an answer against different content than the one on screen. " +
      "Download the responses recorded so far, then reload this page to start a new sitting.",
  },
  "not-started": {
    headline: "The server never recorded this item being shown.",
    guidance:
      "Without that stamp there is no solve time to judge the answer against. Download the responses recorded so far, " +
      "then reload this page to start a new sitting.",
  },
  offline: {
    headline: "Could not reach the server to start this item's timer.",
    guidance: "Nothing has been lost. Check the connection and try again.",
  },
};

const UNEXPECTED_REFUSAL = {
  headline: "The server refused this item.",
  guidance: "Download the responses recorded so far, then reload this page to start a new sitting.",
};

export function PrototypePilotPacketPicker({
  packets,
  invalidPacket = false,
  invalidSession = false,
}: {
  packets: readonly PrototypePilotPacket[];
  invalidPacket?: boolean;
  /** A session label was given but is unusable. */
  invalidSession?: boolean;
}) {
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Visual-family pilot packets</h1>
      <p className="mt-3 text-gray-600">
        A moderator assigns one fixed packet per session. The session label only rotates the item order in this browser session; it is not saved or included in the aggregate export.
      </p>
      {(invalidPacket || invalidSession) && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {invalidPacket
            ? "Choose one of the listed packets."
            : "That session label cannot be used. Leave it blank to have one made for you."}
        </p>
      )}
      <form className="mt-6 space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" method="get">
        <label className="block text-sm font-medium" htmlFor="packet">
          Packet
          <select id="packet" name="packet" className="mt-2 block w-full rounded-lg border border-gray-300 p-2" defaultValue={packets[0]?.packetId}>
            {packets.map((packet) => (
              <option key={packet.packetId} value={packet.packetId}>
                {packet.packetId} · {packet.items.length} questions
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium" htmlFor="session">
          Session label <span className="font-normal text-gray-500">(optional)</span>
          <input
            id="session"
            name="session"
            maxLength={80}
            placeholder="e.g. pilot-014"
            className="mt-2 block w-full rounded-lg border border-gray-300 p-2"
          />
          <span className="mt-1 block text-xs font-normal text-gray-500">Leave blank and one is made for you. Use a fresh label per participant to rotate the order; never a name or contact detail.</span>
        </label>
        <button type="submit" className="rounded-lg bg-gray-900 px-5 py-2.5 font-medium text-white">Start assigned packet</button>
      </form>
    </main>
  );
}

export function PrototypePilot({
  items,
  sittingId,
  packetId,
  packetContentFingerprint,
  packetSchemaVersion,
  aggregateSchemaVersion,
  timeBinSeconds,
  exportFilename,
}: {
  items: PrototypePilotServedQuestion[];
  /** Identifies this participant's sitting to the server. One page load, one sitting. */
  sittingId: string;
  packetId: string;
  /** Identifies what the packet contained, so two runs of one id stay comparable. */
  packetContentFingerprint: string;
  packetSchemaVersion: string;
  aggregateSchemaVersion: string;
  /** Width of the exported solve-time bins, in seconds. */
  timeBinSeconds: number;
  exportFilename: string;
}) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [couldExplain, setCouldExplain] = useState<boolean | null>(null);
  const [unclear, setUnclear] = useState<boolean | null>(null);
  const [matchedExplanation, setMatchedExplanation] = useState<boolean | null>(null);
  const [defensibleAlternative, setDefensibleAlternative] = useState<boolean | null>(null);
  const [grade, setGrade] = useState<GradeResult | null>(null);
  const [aggregates, setAggregates] = useState<PrototypePilotItemAggregate[]>([]);
  const [error, setError] = useState("");
  const [grading, setGrading] = useState(false);
  const [itemState, setItemState] = useState<"starting" | "ready" | "refused">("starting");
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [startAttempt, setStartAttempt] = useState(0);
  const clientStartedAt = useRef(0);
  const item = items[index];
  const activeItemId = item?.itemId;
  const activeFingerprint = item?.contentFingerprint;

  // Telling the server the item is on screen is what makes the recorded solve
  // time the server's. It runs by itself when the item appears, so the sitting
  // gains no click and no screen; the participant only ever sees it when the
  // request fails, which is also the only moment they could do anything about it.
  useEffect(() => {
    if (!activeItemId || !activeFingerprint) return;
    let cancelled = false;
    setItemState("starting");
    setRefusal(null);
    setError("");
    (async () => {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt += 1) {
        try {
          const response = await fetch("/api/prototypes/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sittingId, itemId: activeItemId, contentFingerprint: activeFingerprint }),
          });
          const body = await response.json() as { reason?: string; error?: string };
          if (cancelled) return;
          if (response.ok) {
            clientStartedAt.current = performance.now();
            setItemState("ready");
            return;
          }
          // A refusal is the server's decision, not a dropped packet: repeating
          // it would only produce the same answer and hide it behind a delay.
          setRefusal({ reason: body.reason ?? "", serverMessage: body.error ?? "" });
          setItemState("refused");
          return;
        } catch {
          // Transport failure — worth one more try before bothering anybody.
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      if (cancelled) return;
      setRefusal({ reason: "offline", serverMessage: "" });
      setItemState("refused");
    })();
    return () => { cancelled = true; };
  }, [sittingId, activeItemId, activeFingerprint, startAttempt]);

  const aggregateExport = useMemo(() => ({
    schemaVersion: aggregateSchemaVersion,
    packetSchemaVersion,
    packetId,
    packetContentFingerprint,
    timeBinSeconds,
    items: aggregates,
  }), [aggregateSchemaVersion, aggregates, packetSchemaVersion, packetId, packetContentFingerprint, timeBinSeconds]);
  const [copyStatus, setCopyStatus] = useState<"" | "copied" | "failed">("");

  function downloadAggregateJson() {
    const blob = new Blob([JSON.stringify(aggregateExport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFilename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyAggregateJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(aggregateExport, null, 2));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  if (!item) {
    return (
      <main className="mx-auto min-h-screen max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold">Prototype pilot complete</h1>
        <p className="mt-3 text-gray-600">
          This is one moderated participant session for {packetId}. It stores no answers, explanation text, or session label, only counts per item. Paste the JSON below into a file and run <code className="rounded bg-gray-100 px-1">npm run pilot:report -- &lt;file&gt;</code>.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={downloadAggregateJson} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white">Download JSON</button>
          <button type="button" onClick={copyAggregateJson} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium">Copy JSON</button>
          {copyStatus === "copied" && <span className="self-center text-sm text-green-700">Copied</span>}
          {copyStatus === "failed" && <span className="self-center text-sm text-red-700">Copy failed; use Download JSON.</span>}
        </div>
        <pre className="mt-5 overflow-auto rounded-xl bg-gray-950 p-4 text-xs text-gray-100">
          {JSON.stringify(aggregateExport, null, 2)}
        </pre>
      </main>
    );
  }

  const { puzzle } = item;
  const canLock = selected !== null && couldExplain !== null && unclear !== null &&
    !grading && itemState === "ready";
  const canContinue = grade !== null && matchedExplanation !== null && defensibleAlternative !== null;

  async function lockAnswer() {
    if (!canLock || selected === null) return;
    setError("");
    setGrading(true);
    // Sent as a cross-check only. The server measures the solve time itself and
    // returns its own number, which is the one this page displays and exports.
    const clientElapsedSeconds = Math.max(1, Math.round((performance.now() - clientStartedAt.current) / 1000));
    const viewport = window.innerWidth < 640 ? "mobile" : "desktop";
    try {
      const response = await fetch("/api/prototypes/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sittingId,
          itemId: item.itemId,
          contentFingerprint: item.contentFingerprint,
          selectedOption: selected,
          elapsedSeconds: clientElapsedSeconds,
        }),
      });
      const body = await response.json() as {
        correct?: boolean;
        answerIndex?: number;
        explanation?: string;
        late?: boolean;
        timeBudgetSeconds?: number;
        elapsedSeconds?: number;
        clientElapsedSeconds?: number;
        clientTimingDisagrees?: boolean;
        reason?: string;
        error?: string;
      };
      if (!response.ok && typeof body.reason === "string") {
        setRefusal({ reason: body.reason, serverMessage: body.error ?? "" });
        setItemState("refused");
        return;
      }
      if (
        !response.ok || typeof body.correct !== "boolean" || typeof body.answerIndex !== "number" ||
        typeof body.explanation !== "string" ||
        typeof body.late !== "boolean" || typeof body.timeBudgetSeconds !== "number" ||
        typeof body.elapsedSeconds !== "number"
      ) {
        throw new Error(body.error ?? "Could not grade pilot answer");
      }
      setGrade({
        correct: body.correct,
        answerIndex: body.answerIndex,
        explanation: body.explanation,
        late: body.late,
        timeBudgetSeconds: body.timeBudgetSeconds,
        elapsedSeconds: body.elapsedSeconds,
        clientElapsedSeconds: body.clientElapsedSeconds ?? clientElapsedSeconds,
        clientTimingDisagrees: body.clientTimingDisagrees === true,
        viewport,
      });
      if (couldExplain === false) setMatchedExplanation(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not grade pilot answer");
    } finally {
      setGrading(false);
    }
  }

  /** Move to the next item and clear everything that belonged to this one. */
  function advance() {
    setIndex((current) => current + 1);
    setSelected(null);
    setCouldExplain(null);
    setUnclear(null);
    setMatchedExplanation(null);
    setDefensibleAlternative(null);
    setGrade(null);
    setError("");
  }

  function continuePilot() {
    if (!canContinue || !grade || matchedExplanation === null || defensibleAlternative === null || unclear === null) return;
    // Binned from the SERVER's solve time, never this browser's reading. The
    // escalation gate is an argument about median solve time, and a number the
    // participant's own machine reported cannot carry that argument.
    const timeBin = String(Math.ceil(grade.elapsedSeconds / timeBinSeconds) * timeBinSeconds);
    // The plan's clean miss: wrong, but the participant identified the intended
    // relationship and reported neither unclear notation nor a defensible
    // alternative. It is recorded here because this is the only place the four
    // facts about one response are known together; once they are summed into
    // separate counts the conjunction cannot be recovered.
    const cleanMiss = !grade.correct && matchedExplanation && !unclear && !defensibleAlternative;
    setAggregates((current) => {
      const existing = current.find((row) => row.itemId === item.itemId) ?? {
        itemId: item.itemId,
        familyId: item.familyId,
        band: item.band,
        difficultyBucket: item.difficultyBucket,
        difficulty: item.difficulty,
        attempts: 0,
        correctAttempts: 0,
        cleanMisses: 0,
        intendedRelationshipDescriptions: 0,
        notationMisunderstandingReports: 0,
        defensibleAlternativeReports: 0,
        lateAttempts: 0,
        timeBinsSeconds: {},
        desktopAttempts: 0,
        mobileAttempts: 0,
      };
      const updated: PrototypePilotItemAggregate = {
        ...existing,
        attempts: existing.attempts + 1,
        correctAttempts: existing.correctAttempts + Number(grade.correct),
        cleanMisses: existing.cleanMisses + Number(cleanMiss),
        intendedRelationshipDescriptions: existing.intendedRelationshipDescriptions + Number(matchedExplanation),
        notationMisunderstandingReports: existing.notationMisunderstandingReports + Number(unclear),
        defensibleAlternativeReports: existing.defensibleAlternativeReports + Number(defensibleAlternative),
        lateAttempts: existing.lateAttempts + Number(grade.late),
        timeBinsSeconds: {
          ...existing.timeBinsSeconds,
          [timeBin]: (existing.timeBinsSeconds[timeBin] ?? 0) + 1,
        },
        desktopAttempts: existing.desktopAttempts + Number(grade.viewport === "desktop"),
        mobileAttempts: existing.mobileAttempts + Number(grade.viewport === "mobile"),
      };
      return [...current.filter((row) => row.itemId !== item.itemId), updated];
    });
    advance();
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8">
      <p className="text-sm text-gray-500">{packetId} · Prototype {index + 1} of {items.length} · {item.familyId} · {item.band} · {item.difficultyBucket}</p>
      <h1 className="mt-1 text-2xl font-bold">Visual-family pilot</h1>
      <p className="mt-2 text-sm text-amber-700">
        These items are not scored test items. Use one uninterrupted session per person and do not inspect source or network responses.
      </p>

      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
        {puzzle.stem.length > 0 && (
          <div className="mb-6 rounded-xl bg-gray-50 p-2 sm:p-4">
            <StemView puzzle={puzzle} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {puzzle.options.map((option, optionIndex) => (
            <button
              key={optionIndex}
              type="button"
              disabled={grade !== null || grading || itemState !== "ready"}
              onClick={() => setSelected(optionIndex)}
              aria-label={`Option ${LETTERS[optionIndex]}: ${describeScene(option)}${
                grade === null
                  ? ""
                  : grade.answerIndex === optionIndex
                    ? ": correct answer"
                    : selected === optionIndex
                      ? ": your incorrect choice"
                      : ""
              }`}
              className={`rounded-xl border-2 p-3 ${
                // Before grading, the only mark is which option the participant
                // picked. After grading the answer is marked green and a wrong
                // pick red, the same way the real test's review screen does it —
                // every explanation refers to "the correct answer", so the screen
                // has to show which option that is.
                grade !== null && grade.answerIndex === optionIndex
                  ? "border-green-500 bg-green-50"
                  : grade !== null && selected === optionIndex
                    ? "border-red-400 bg-red-50"
                    : selected === optionIndex
                      ? "border-gray-900 bg-gray-100"
                      : "border-gray-200"
              }`}
            >
              <span className="text-xs font-semibold text-gray-500">
                {LETTERS[optionIndex]}
                {grade !== null && grade.answerIndex === optionIndex && (
                  <span className="ml-1 font-normal text-green-700">correct</span>
                )}
                {grade !== null && grade.answerIndex !== optionIndex && selected === optionIndex && (
                  <span className="ml-1 font-normal text-red-700">your choice</span>
                )}
              </span>
              <SceneGraphic scene={option} className="mx-auto mt-2 h-20 w-20" />
            </button>
          ))}
        </div>

        {itemState === "refused" ? (
          <div className="mt-6 space-y-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">{(REFUSALS[refusal?.reason ?? ""] ?? UNEXPECTED_REFUSAL).headline}</p>
            <p>{(REFUSALS[refusal?.reason ?? ""] ?? UNEXPECTED_REFUSAL).guidance}</p>
            {refusal?.serverMessage && <p className="text-xs text-amber-800">Server said: {refusal.serverMessage}</p>}
            <div className="flex flex-wrap gap-3 pt-1">
              {refusal?.reason === "already-recorded" && (
                <button type="button" onClick={advance} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white">
                  Continue to the next item
                </button>
              )}
              {refusal?.reason === "offline" && (
                <button type="button" onClick={() => setStartAttempt((current) => current + 1)} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white">
                  Try again
                </button>
              )}
              {refusal?.reason !== "already-recorded" && refusal?.reason !== "offline" && (
                <button type="button" onClick={downloadAggregateJson} className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium">
                  Download the responses recorded so far
                </button>
              )}
            </div>
          </div>
        ) : !grade ? (
          <div className="mt-6 space-y-4">
            <fieldset>
              <legend className="text-sm font-medium">State the rule or relationship aloud before locking. Could you explain one?</legend>
              <div className="mt-2 flex gap-4">
                {[true, false].map((value) => (
                  <label key={String(value)} className="text-sm">
                    <input type="radio" name="could-explain" checked={couldExplain === value} onChange={() => setCouldExplain(value)} /> {value ? "Yes" : "No"}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-sm font-medium">Was any notation or required visual distinction unclear?</legend>
              <div className="mt-2 flex gap-4">
                {[true, false].map((value) => (
                  <label key={String(value)} className="text-sm">
                    <input type="radio" name="unclear" checked={unclear === value} onChange={() => setUnclear(value)} /> {value ? "Yes" : "No"}
                  </label>
                ))}
              </div>
            </fieldset>
            <button
              type="button"
              disabled={!canLock}
              onClick={lockAnswer}
              className="rounded-lg bg-gray-900 px-5 py-2.5 font-medium text-white disabled:opacity-40"
            >
              {grading ? "Locking…" : itemState === "starting" ? "Preparing item…" : "Lock answer and stop timer"}
            </button>
            {error && <p className="text-sm text-red-700">{error}</p>}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <p className={`rounded-lg p-3 text-sm font-medium ${grade.correct ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
              {grade.correct ? "Correct" : "Incorrect"} · {grade.elapsedSeconds}s
              {grade.late && ` · over the ${grade.timeBudgetSeconds}s ${item.band} budget`}
            </p>
            {grade.clientTimingDisagrees && (
              <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                Timing check for the moderator: this browser measured {grade.clientElapsedSeconds}s and the server
                recorded {grade.elapsedSeconds}s. The server&apos;s {grade.elapsedSeconds}s is what gets exported.
              </p>
            )}
            <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{grade.explanation}</p>
            {couldExplain && (
              <fieldset>
                <legend className="text-sm font-medium">Moderator: did the explanation stated before reveal match the intended relationship?</legend>
                <div className="mt-2 flex gap-4">
                  {[true, false].map((value) => (
                    <label key={String(value)} className="text-sm">
                      <input type="radio" name="matched" checked={matchedExplanation === value} onChange={() => setMatchedExplanation(value)} /> {value ? "Yes" : "No"}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <fieldset>
              <legend className="text-sm font-medium">After seeing the intended rule, did another option still seem defensible?</legend>
              <div className="mt-2 flex gap-4">
                {[true, false].map((value) => (
                  <label key={String(value)} className="text-sm">
                    <input type="radio" name="defensible" checked={defensibleAlternative === value} onChange={() => setDefensibleAlternative(value)} /> {value ? "Yes" : "No"}
                  </label>
                ))}
              </div>
            </fieldset>
            <button
              type="button"
              disabled={!canContinue}
              onClick={continuePilot}
              className="rounded-lg bg-gray-900 px-5 py-2.5 font-medium text-white disabled:opacity-40"
            >
              Continue
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
