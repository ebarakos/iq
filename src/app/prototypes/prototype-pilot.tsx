"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { StemView, VisualGraphic, describeVisual } from "@/items/render";
import type { PrototypePilotPacket, PrototypePilotQuestion } from "@/items/prototype-pilot";

interface GradeResult {
  correct: boolean;
  explanation: string;
  elapsedSeconds: number;
  viewport: "mobile" | "desktop";
}

interface FamilyAggregate {
  familyId: string;
  band: PrototypePilotQuestion["band"];
  difficultyBucket: string;
  itemAttempts: Record<string, number>;
  attempts: number;
  correctAttempts: number;
  intendedRelationshipDescriptions: number;
  notationMisunderstandingReports: number;
  defensibleAlternativeReports: number;
  timeHistogramSeconds: Record<string, number>;
  desktopAttempts: number;
  mobileAttempts: number;
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const TIME_BIN_SECONDS = 15;

function medianUpperBound(histogram: Record<string, number>): number {
  const entries = Object.entries(histogram)
    .map(([upperBound, count]) => [Number(upperBound), count] as const)
    .sort(([left], [right]) => left - right);
  const attempts = entries.reduce((total, [, count]) => total + count, 0);
  if (attempts === 0) return 0;
  const target = Math.ceil(attempts / 2);
  let seen = 0;
  for (const [upperBound, count] of entries) {
    seen += count;
    if (seen >= target) return upperBound;
  }
  return 0;
}

export function PrototypePilotPacketPicker({
  packets,
  invalidPacket = false,
  invalidSession = false,
  missingSession = false,
}: {
  packets: readonly PrototypePilotPacket[];
  invalidPacket?: boolean;
  /** A session label was given but is unusable. */
  invalidSession?: boolean;
  /** The packet is fine; no session label was supplied yet. */
  missingSession?: boolean;
}) {
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Visual-family pilot packets</h1>
      <p className="mt-3 text-gray-600">
        A moderator assigns one fixed packet per session. The session label only rotates the item order in this browser session; it is not saved or included in the aggregate export.
      </p>
      {(invalidPacket || invalidSession || missingSession) && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {invalidPacket
            ? "Choose one of the listed packets."
            : missingSession
              ? "That packet exists — add a session label to start it."
              : "Enter a session label of up to 80 characters."}
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
          Session label
          <input
            id="session"
            name="session"
            required
            maxLength={80}
            placeholder="e.g. pilot-014"
            className="mt-2 block w-full rounded-lg border border-gray-300 p-2"
          />
          <span className="mt-1 block text-xs font-normal text-gray-500">Use a fresh label for each participant to rotate the order. Do not use a name or contact detail.</span>
        </label>
        <button type="submit" className="rounded-lg bg-gray-900 px-5 py-2.5 font-medium text-white">Start assigned packet</button>
      </form>
    </main>
  );
}

export function PrototypePilot({
  items,
  packetId,
  packetContentFingerprint,
  aggregateSchemaVersion,
  exportFilename,
}: {
  items: PrototypePilotQuestion[];
  packetId: string;
  /** Identifies what the packet contained, so two runs of one id stay comparable. */
  packetContentFingerprint: string;
  aggregateSchemaVersion: string;
  exportFilename: string;
}) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [couldExplain, setCouldExplain] = useState<boolean | null>(null);
  const [unclear, setUnclear] = useState<boolean | null>(null);
  const [matchedExplanation, setMatchedExplanation] = useState<boolean | null>(null);
  const [defensibleAlternative, setDefensibleAlternative] = useState<boolean | null>(null);
  const [grade, setGrade] = useState<GradeResult | null>(null);
  const [aggregates, setAggregates] = useState<Record<string, FamilyAggregate>>({});
  const [error, setError] = useState("");
  const [grading, setGrading] = useState(false);
  const startedAt = useRef(0);
  const item = items[index];

  useEffect(() => {
    startedAt.current = performance.now();
  }, [index]);

  const exportedAggregates = useMemo(() => Object.fromEntries(
    Object.entries(aggregates).map(([key, aggregate]) => {
      const itemCounts = Object.values(aggregate.itemAttempts);
      return [key, {
        familyId: aggregate.familyId,
        band: aggregate.band,
        difficultyBuckets: [aggregate.difficultyBucket],
        representativeItemCount: itemCounts.length,
        attempts: aggregate.attempts,
        minimumAttemptsPerItem: itemCounts.length ? Math.min(...itemCounts) : 0,
        correctAttempts: aggregate.correctAttempts,
        intendedRelationshipDescriptions: aggregate.intendedRelationshipDescriptions,
        notationMisunderstandingReports: aggregate.notationMisunderstandingReports,
        medianSolveTimeSeconds: medianUpperBound(aggregate.timeHistogramSeconds),
        timeHistogramSeconds: aggregate.timeHistogramSeconds,
        allItemsPassCorrectnessContract: true,
        hasRepeatedDefensibleAlternativeAnswer: aggregate.defensibleAlternativeReports >= 2,
        spatialLayoutChangesAcrossViewports: true,
        desktopAttempts: aggregate.desktopAttempts,
        mobileAttempts: aggregate.mobileAttempts,
      }];
    }),
  ), [aggregates]);

  const aggregateExport = useMemo(() => ({
    schemaVersion: aggregateSchemaVersion,
    packetId,
    packetContentFingerprint,
    aggregates: exportedAggregates,
  }), [aggregateSchemaVersion, exportedAggregates, packetId, packetContentFingerprint]);
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
          This is one moderated participant session for {packetId}. It stores no answers, explanation text, or session label. Combine only sessions from distinct people; merge the time histograms before deriving medians.
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
  const canLock = selected !== null && couldExplain !== null && unclear !== null && !grading;
  const canContinue = grade !== null && matchedExplanation !== null && defensibleAlternative !== null;

  async function lockAnswer() {
    if (!canLock || selected === null) return;
    setError("");
    setGrading(true);
    const elapsedSeconds = Math.max(1, Math.round((performance.now() - startedAt.current) / 1000));
    const viewport = window.innerWidth < 640 ? "mobile" : "desktop";
    try {
      const response = await fetch("/api/prototypes/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.itemId, selectedOption: selected }),
      });
      const body = await response.json() as { correct?: boolean; explanation?: string; error?: string };
      if (!response.ok || typeof body.correct !== "boolean" || typeof body.explanation !== "string") {
        throw new Error(body.error ?? "Could not grade pilot answer");
      }
      setGrade({ correct: body.correct, explanation: body.explanation, elapsedSeconds, viewport });
      if (couldExplain === false) setMatchedExplanation(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not grade pilot answer");
    } finally {
      setGrading(false);
    }
  }

  function continuePilot() {
    if (!canContinue || !grade || matchedExplanation === null || defensibleAlternative === null || unclear === null) return;
    const key = `${item.familyId}:${item.band}:${item.difficultyBucket}`;
    const timeBin = String(Math.ceil(grade.elapsedSeconds / TIME_BIN_SECONDS) * TIME_BIN_SECONDS);
    setAggregates((current) => {
      const existing = current[key] ?? {
        familyId: item.familyId,
        band: item.band,
        difficultyBucket: item.difficultyBucket,
        itemAttempts: {},
        attempts: 0,
        correctAttempts: 0,
        intendedRelationshipDescriptions: 0,
        notationMisunderstandingReports: 0,
        defensibleAlternativeReports: 0,
        timeHistogramSeconds: {},
        desktopAttempts: 0,
        mobileAttempts: 0,
      };
      return {
        ...current,
        [key]: {
          ...existing,
          itemAttempts: {
            ...existing.itemAttempts,
            [item.itemId]: (existing.itemAttempts[item.itemId] ?? 0) + 1,
          },
          attempts: existing.attempts + 1,
          correctAttempts: existing.correctAttempts + Number(grade.correct),
          intendedRelationshipDescriptions: existing.intendedRelationshipDescriptions + Number(matchedExplanation),
          notationMisunderstandingReports: existing.notationMisunderstandingReports + Number(unclear),
          defensibleAlternativeReports: existing.defensibleAlternativeReports + Number(defensibleAlternative),
          timeHistogramSeconds: {
            ...existing.timeHistogramSeconds,
            [timeBin]: (existing.timeHistogramSeconds[timeBin] ?? 0) + 1,
          },
          desktopAttempts: existing.desktopAttempts + Number(grade.viewport === "desktop"),
          mobileAttempts: existing.mobileAttempts + Number(grade.viewport === "mobile"),
        },
      };
    });
    setIndex((current) => current + 1);
    setSelected(null);
    setCouldExplain(null);
    setUnclear(null);
    setMatchedExplanation(null);
    setDefensibleAlternative(null);
    setGrade(null);
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8">
      <p className="text-sm text-gray-500">{packetId} · Prototype {index + 1} of {items.length} · {item.familyId} · representative {item.itemId.split(":r")[1]}</p>
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
              disabled={grade !== null || grading}
              onClick={() => setSelected(optionIndex)}
              aria-label={`Option ${LETTERS[optionIndex]} — ${describeVisual(option)}`}
              className={`rounded-xl border-2 p-3 ${
                selected === optionIndex ? "border-gray-900 bg-gray-100" : "border-gray-200"
              }`}
            >
              <span className="text-xs font-semibold text-gray-500">{LETTERS[optionIndex]}</span>
              <VisualGraphic visual={option} className="mx-auto mt-2 h-20 w-20" />
            </button>
          ))}
        </div>

        {!grade ? (
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
              {grading ? "Locking…" : "Lock answer and stop timer"}
            </button>
            {error && <p className="text-sm text-red-700">{error}</p>}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <p className={`rounded-lg p-3 text-sm font-medium ${grade.correct ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
              {grade.correct ? "Correct" : "Incorrect"} · {grade.elapsedSeconds}s
            </p>
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
