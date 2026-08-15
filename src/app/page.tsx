"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicPuzzle } from "@/items/schema";
import { CellGraphic, StemView, describeCell } from "@/items/render";
import { apiFetch, formatApiError } from "@/lib/relay-client";

type Source = "procedural" | "fallback";

interface GenerateResponse {
  puzzles: PublicPuzzle[];
  quizToken: string;
  source: Source;
  generatorVersion?: string;
  notice?: string;
}

interface ReviewResult {
  id: string;
  chosen: number | null;
  answerIndex: number;
  correct: boolean;
  explanation: string;
}

interface SubmitResponse {
  score: number;
  total: number;
  results: ReviewResult[];
}

type Phase = "intro" | "loading" | "submitting" | "result" | "active" | "error";
const START_TIMEOUT_MS = 20000;

const LETTERS = ["A", "B", "C", "D", "E", "F"];

// v3 uses answer-free public puzzles plus an opaque scoring token.
const SESSION_KEY = "aiq-test-v3";

/** Validate a raw parsed object before restoring session state. */
function isValidSession(v: unknown): v is {
  phase: "active" | "result";
  puzzles: PublicPuzzle[];
  answers: (number | null)[];
  current: number;
  quizToken: string;
  review?: SubmitResponse;
} {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  if (s.phase !== "active" && s.phase !== "result") return false;
  if (!Array.isArray(s.puzzles) || s.puzzles.length === 0) return false;
  if (!Array.isArray(s.answers) || s.answers.length !== s.puzzles.length) return false;
  if (typeof s.current !== "number" || s.current < 0 || s.current >= s.puzzles.length) return false;
  if (typeof s.quizToken !== "string" || s.quizToken.length === 0) return false;
  if (s.phase === "result" && (!s.review || typeof s.review !== "object")) return false;
  return true;
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [puzzles, setPuzzles] = useState<PublicPuzzle[]>([]);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [quizToken, setQuizToken] = useState("");
  const [review, setReview] = useState<SubmitResponse | null>(null);
  const [current, setCurrent] = useState(0);
  const [meta, setMeta] = useState<{
    source: Source;
    generatorVersion?: string;
    notice?: string;
  } | null>(null);
  const [error, setError] = useState<string>("");
  const startRequestId = useRef(0);

  function clearStoredSession() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // Session storage failures are non-fatal; in-memory recovery still works.
    }
  }

  function resetLocalTestState() {
    setPuzzles([]);
    setAnswers([]);
    setQuizToken("");
    setReview(null);
    setCurrent(0);
    setMeta(null);
  }

  function isTokenFailureMessage(message: string): boolean {
    return message.startsWith("This quiz has expired") || message.startsWith("This quiz token is invalid");
  }

  // Restore in-progress session on mount (client-only; avoids hydration mismatch).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!isValidSession(parsed)) return;
      setPhase(parsed.phase);
      setPuzzles(parsed.puzzles);
      setAnswers(parsed.answers);
      setQuizToken(parsed.quizToken);
      if (parsed.review) setReview(parsed.review);
      setCurrent(parsed.current);
      if ("meta" in (parsed as Record<string, unknown>) && parsed && typeof parsed === "object") {
        const m = (parsed as Record<string, unknown>).meta;
        if (m && typeof m === "object") {
          setMeta(m as {
            source: Source;
            generatorVersion?: string;
            notice?: string;
          });
        }
      }
    } catch {
      // Malformed storage — ignore.
    }
  }, []);

  // Persist state whenever it changes while test is in progress.
  useEffect(() => {
    if (phase !== "active" && phase !== "result") return;
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ phase, puzzles, answers, current, meta, quizToken, review }));
    } catch {
      // Storage quota exceeded or private browsing restriction — ignore.
    }
  }, [phase, puzzles, answers, current, meta, quizToken, review]);

  async function start() {
    if (phase === "loading" || phase === "submitting") return;

    const requestId = ++startRequestId.current;
    clearStoredSession();
    resetLocalTestState();

    setError("");
    setPhase("loading");

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error("Starting the test is taking longer than expected. Please try again."));
      }, START_TIMEOUT_MS);
    });

    try {
      const data = await Promise.race([apiFetch<GenerateResponse>("/api/generate", {}), timeout]);
      if (startRequestId.current !== requestId) return;
      if (!Array.isArray(data.puzzles) || data.puzzles.length === 0) throw new Error("No puzzles returned");
      if (!data.quizToken) throw new Error("No scoring token returned");
      setPuzzles(data.puzzles);
      setQuizToken(data.quizToken);
      setAnswers(new Array(data.puzzles.length).fill(null));
      setMeta({
        source: data.source,
        generatorVersion: data.generatorVersion,
        notice: data.notice,
      });
      setCurrent(0);
      setPhase("active");
    } catch (err) {
      if (startRequestId.current !== requestId) return;
      setError(formatApiError(err, "Something went wrong"));
      setPhase("error");
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  async function finish() {
    setPhase("submitting");
    setError("");
    try {
      const result = await apiFetch<SubmitResponse>("/api/submit", { quizToken, answers });
      setReview(result);
      setPhase("result");
    } catch (err) {
      const message = formatApiError(err, "Could not score this test");
      if (isTokenFailureMessage(message)) {
        clearStoredSession();
        resetLocalTestState();
      }
      setError(message);
      setPhase("error");
    }
  }

  function choose(optionIndex: number) {
    setAnswers((prev) => {
      const next = [...prev];
      next[current] = optionIndex;
      return next;
    });
  }

  function restart(requireConfirm = false) {
    if (requireConfirm && !window.confirm("Discard your current test and start over?")) return;
    clearStoredSession();
    resetLocalTestState();
    setPhase("intro");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-8">
      <header className="mb-8 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          aiq <span className="font-normal text-gray-400">· visual reasoning test</span>
        </h1>
        {(phase === "active" || phase === "result") && (
          <button
            onClick={() => restart(phase === "active")}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-500 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
          >
            Restart
          </button>
        )}
      </header>

      {phase === "intro" && <Intro onStart={start} />}
      {phase === "loading" && <Loading label="Creating a fresh test…" />}
      {phase === "submitting" && <Loading label="Scoring your answers…" />}
      {phase === "error" && <ErrorView message={error} onRetry={start} />}

      {phase === "active" && puzzles[current] && (
        <Solver
          puzzle={puzzles[current]}
          index={current}
          total={puzzles.length}
          selected={answers[current]}
          // One concise banner on Q1 only — repeating it on every question reads
          // as a new warning each time (ui-qa finding).
          notice={current === 0 && meta?.source === "fallback" ? meta?.notice : undefined}
          onChoose={choose}
          onPrev={() => setCurrent((c) => Math.max(0, c - 1))}
          onNext={() => setCurrent((c) => Math.min(puzzles.length - 1, c + 1))}
          onFinish={finish}
        />
      )}

      {phase === "result" && review && (
        <Result
          puzzles={puzzles}
          answers={answers}
          review={review}
          meta={meta}
          onRestart={restart}
        />
      )}
    </main>
  );
}

function Intro({ onStart }: { onStart: () => void }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
      <h2 className="text-xl font-semibold">Take a fresh 5-question reasoning test</h2>
      <p className="mt-3 text-gray-600">
        Five language-independent puzzles across matrices, sequences, analogies, odd-one-out,
        and worked visual equations. Pick the option that fits each hidden rule; you&apos;ll get a
        score and a per-question review at the end.
      </p>
      <p className="mt-2 text-sm text-gray-500">
        This test always starts at the hard ramp (3, 4, 4, 5, 5). It measures performance on
        fresh visual rules. It is not yet a standardized human IQ score.
      </p>

      <div className="mt-6">
        <p className="mt-2 text-xs text-gray-500">
          Keyboard shortcuts: 1–6 or A–F to answer, ← → to move, Enter to continue.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onStart}
          className="rounded-lg bg-gray-900 px-5 py-2.5 font-medium text-white transition hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
        >
          Start a fresh test
        </button>
      </div>
    </section>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <section className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-gray-200 bg-white p-12 text-center shadow-sm">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
      <p className="text-gray-600">{label}</p>
    </section>
  );
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  const isTokenError = message.includes("quiz token");
  return (
    <section className="rounded-2xl border border-red-200 bg-red-50 p-8 shadow-sm">
      <h2 className="text-lg font-semibold text-red-800">Something went wrong</h2>
      <p className="mt-2 text-red-700">{message}</p>
      <button
        onClick={onRetry}
        className="mt-5 rounded-lg bg-red-700 px-4 py-2 font-medium text-white hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
      >
        {isTokenError ? "Start a fresh test" : "Try again"}
      </button>
    </section>
  );
}

function puzzleTypeLabel(type: PublicPuzzle["type"]): string {
  return type === "operatorInduction" ? "visual equation" : type === "oddOneOut" ? "odd one out" : type;
}

function FallbackBanner({ notice }: { notice?: string }) {
  if (!notice) return null;
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
      {notice}
    </div>
  );
}

function Solver({
  puzzle,
  index,
  total,
  selected,
  notice,
  onChoose,
  onPrev,
  onNext,
  onFinish,
}: {
  puzzle: PublicPuzzle;
  index: number;
  total: number;
  selected: number | null;
  notice?: string;
  onChoose: (i: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onFinish: () => void;
}) {
  const isLast = index === total - 1;
  const optionCount = puzzle.options.length;

  // Keyboard shortcuts: digits 1–6 / letters a–f select options; arrows navigate;
  // Enter advances. Guarded against modifier keys and non-puzzle target elements.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Ignore modified shortcuts and inputs.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) return;

      const key = e.key.toLowerCase();

      // Digits 1–6 or letters a–f → select corresponding option.
      const digitMatch = /^[1-6]$/.test(e.key) ? parseInt(e.key, 10) - 1 : -1;
      const letterMatch = "abcdef".indexOf(key);
      const optIdx = digitMatch >= 0 ? digitMatch : letterMatch;
      if (optIdx >= 0 && optIdx < optionCount) {
        onChoose(optIdx);
        return;
      }

      if (e.key === "ArrowLeft") {
        if (index > 0) onPrev();
        return;
      }

      if (e.key === "ArrowRight") {
        if (selected !== null && !isLast) onNext();
        return;
      }

      if (e.key === "Enter") {
        // Skip if a button already has focus — its native click handles it.
        if (document.activeElement?.tagName === "BUTTON") return;
        if (selected === null) return;
        if (isLast) onFinish();
        else onNext();
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [index, total, selected, isLast, optionCount, onChoose, onPrev, onNext, onFinish]);

  // Options grid: 4 options → 4-col, 5–6 → 3-col (at sm breakpoint) to avoid cramped tiles.
  const gridClass = optionCount <= 4
    ? "grid grid-cols-2 gap-3 sm:grid-cols-4"
    : "grid grid-cols-2 gap-3 sm:grid-cols-3";

  return (
    <section>
      <FallbackBanner notice={notice} />
      <div className="mb-3 flex items-center justify-between text-sm text-gray-500">
        <span>
          Question {index + 1} of {total}
        </span>
      </div>
      <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
        <div className="h-full bg-gray-900 transition-all" style={{ width: `${((index + 1) / total) * 100}%` }} />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="mb-5 text-center text-gray-700">{puzzle.instruction}</p>

        {puzzle.stem.length > 0 && (
          <div className="mb-6 rounded-xl bg-gray-50 p-4">
            <StemView puzzle={puzzle} />
          </div>
        )}

        <div className={gridClass}>
          {puzzle.options.map((opt, i) => {
            const isSel = selected === i;
            return (
              <button
                key={i}
                onClick={() => onChoose(i)}
                aria-label={`Option ${LETTERS[i]} — ${describeCell(opt)}`}
                aria-pressed={isSel}
                className={`group flex flex-col items-center gap-2 rounded-xl border-2 p-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 ${
                  isSel
                    ? "border-gray-900 bg-gray-900/[0.08] ring-2 ring-gray-900 ring-offset-2"
                    : "border-gray-200 hover:border-gray-400 hover:bg-gray-50"
                }`}
              >
                <span className={`text-xs font-semibold ${isSel ? "text-gray-900" : "text-gray-400"}`}>
                  Option {LETTERS[i]} {isSel ? "· selected" : ""}
                </span>
                <CellGraphic cell={opt} className="h-16 w-16" />
              </button>
            );
          })}
        </div>

        {/* Keyboard hint — hidden on mobile to save space. */}
        <p className="mt-3 hidden text-center text-xs text-gray-400 sm:block">
          Tip: press 1–6 or A–F to answer, ← → to navigate, Enter to {isLast ? "see results" : "continue"}
        </p>
      </div>

      <div className="mt-6 flex items-center justify-between pr-14 sm:pr-0">
        <button
          onClick={onPrev}
          disabled={index === 0}
          className="rounded-lg px-4 py-2 text-gray-600 enabled:hover:bg-gray-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
        >
          ← Back
        </button>
        {isLast ? (
          <button
            onClick={onFinish}
            disabled={selected === null}
            className="rounded-lg bg-gray-900 px-6 py-2.5 font-medium text-white enabled:hover:bg-gray-700 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
          >
            See results
          </button>
        ) : (
          <button
            onClick={onNext}
            disabled={selected === null}
            className="rounded-lg bg-gray-900 px-6 py-2.5 font-medium text-white enabled:hover:bg-gray-700 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
          >
            Next →
          </button>
        )}
      </div>
    </section>
  );
}

function Result({
  puzzles,
  answers,
  review,
  meta,
  onRestart,
}: {
  puzzles: PublicPuzzle[];
  answers: (number | null)[];
  review: SubmitResponse;
  meta: {
    source: Source;
    generatorVersion?: string;
    notice?: string;
  } | null;
  onRestart: () => void;
}) {
  const pct = Math.round((review.score / review.total) * 100);

  const attribution = meta?.source === "fallback"
    ? "From the verified reference set"
    : `Fresh deterministic test${meta?.generatorVersion ? ` · ${meta.generatorVersion}` : ""}`;

  return (
    <section>
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm uppercase tracking-wide text-gray-400">Your score</p>
        <p className="mt-1 text-5xl font-bold">
          {review.score}
          <span className="text-2xl font-normal text-gray-400"> / {puzzles.length}</span>
        </p>
        <p className="mt-2 text-gray-600">{pct}% correct</p>
        <div className="mt-3 text-xs text-gray-400">{attribution}</div>
        <button
          onClick={onRestart}
          className="mt-6 rounded-lg bg-gray-900 px-5 py-2.5 font-medium text-white transition hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
        >
          Take another test
        </button>
      </div>

      <h3 className="mb-3 mt-8 text-lg font-semibold">Review</h3>
      <div className="space-y-4">
        {puzzles.map((p, i) => (
          <ReviewItem
            key={p.id}
            puzzle={p}
            chosen={answers[i]}
            index={i}
            result={review.results[i]}
          />
        ))}
      </div>
    </section>
  );
}

function ReviewItem({
  puzzle,
  chosen,
  index,
  result,
}: {
  puzzle: PublicPuzzle;
  chosen: number | null;
  index: number;
  result: ReviewResult;
}) {
  const correct = result.correct;
  const optionCount = puzzle.options.length;
  const [showExplanation, setShowExplanation] = useState(false);
  // Match Solver's responsive grid: 4 options → 4-col, 5–6 → 3-col.
  const gridClass = optionCount <= 4
    ? "grid grid-cols-4 gap-2"
    : "grid grid-cols-3 gap-2";
  return (
    <div className={`rounded-xl border bg-white p-5 shadow-sm ${correct ? "border-green-300" : "border-red-200"}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-500">
          Q{index + 1} · {puzzleTypeLabel(puzzle.type)}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${correct ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
            {correct ? "Correct" : chosen === null ? "Skipped" : "Incorrect"}
          </span>
        </div>
      </div>

      {puzzle.stem.length > 0 && (
        <div className="mb-4 rounded-lg bg-gray-50 p-3">
          <StemView puzzle={puzzle} />
        </div>
      )}

      <div className={gridClass}>
        {puzzle.options.map((opt, i) => {
          const isCorrect = i === result.answerIndex;
          const isChosen = i === chosen;
          const status = isCorrect ? "correct answer" : isChosen ? "your incorrect choice" : "";
          return (
            <div
              key={i}
              aria-label={`Option ${LETTERS[i]} — ${describeCell(opt)}${status ? ` (${status})` : ""}`}
              className={`flex flex-col items-center gap-1 rounded-lg border-2 p-2 ${
                isCorrect ? "border-green-400 bg-green-50" : isChosen ? "border-red-400 bg-red-50" : "border-gray-200"
              }`}
            >
              <span className={`text-[10px] font-semibold ${isChosen ? "text-red-700" : "text-gray-600"}`}>
                {LETTERS[i]}
              </span>
              <CellGraphic cell={opt} className="h-12 w-12" />
            </div>
          );
        })}
      </div>

      <button
        onClick={() => setShowExplanation((value) => !value)}
        className="mt-3 text-sm font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900"
      >
        {showExplanation ? "Hide explanation" : "Show explanation"}
      </button>
      {showExplanation && (
        <p className="mt-2 text-sm text-gray-600">
          <span className="font-medium text-gray-800">Why:</span> {result.explanation}
        </p>
      )}
    </div>
  );
}
