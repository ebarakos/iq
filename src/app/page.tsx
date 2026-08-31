"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicPuzzle, Visual } from "@/items/schema";
import { StemView, VisualGraphic, describeVisual } from "@/items/render";
import { countUnansweredAnswers, needsBlankSubmissionConfirmation } from "@/lib/quiz-progress";
import { apiFetch, formatApiError } from "@/lib/relay-client";

type Source = "generated" | "fallback";

/** The two public test lengths. Both are built from the expanded family pool. */
type TestProfile = "short-5" | "long-30";

const PROFILE_LABELS: Record<TestProfile, string> = {
  "short-5": "5-question sample",
  "long-30": "30-question test",
};

interface GenerateResponse {
  puzzles: PublicPuzzle<Visual>[];
  quizToken: string;
  profile?: TestProfile;
  /** Server-issued end of the test, in epoch seconds. The browser only displays it. */
  answerDeadline?: number;
  secondsPerQuestion?: number;
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
  familyId?: string;
  band?: string;
}

interface SubmitResponse {
  score: number;
  total: number;
  results: ReviewResult[];
  late?: boolean;
  secondsLate?: number;
  breakdown?: {
    bands: Array<{ key: string; correct: number; attempted: number }>;
    families: Array<{ key: string; correct: number; attempted: number }>;
  };
}

type Phase = "intro" | "loading" | "submitting" | "result" | "active" | "error";
const START_TIMEOUT_MS = 20000;

const LETTERS = ["A", "B", "C", "D", "E", "F"];

/** Warn in the last tenth of the budget, and never later than the last 30 seconds. */
function lowTimeThreshold(totalSeconds: number): number {
  return Math.max(30, Math.round(totalSeconds / 10));
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

// Bump when the default test shape changes so an old in-progress quiz cannot
// hide the new start experience after a reload.
const SESSION_KEY = "aiq-test-v5";

/** Validate a raw parsed object before restoring session state. */
function isValidSession(v: unknown): v is {
  phase: "active" | "result";
  puzzles: PublicPuzzle<Visual>[];
  answers: (number | null)[];
  current: number;
  quizToken: string;
  answerDeadline?: number;
  review?: SubmitResponse;
} {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  if (s.phase !== "active" && s.phase !== "result") return false;
  if (!Array.isArray(s.puzzles) || s.puzzles.length === 0) return false;
  if (!Array.isArray(s.answers) || s.answers.length !== s.puzzles.length) return false;
  if (typeof s.current !== "number" || s.current < 0 || s.current >= s.puzzles.length) return false;
  if (typeof s.quizToken !== "string" || s.quizToken.length === 0) return false;
  if (s.answerDeadline !== undefined && typeof s.answerDeadline !== "number") return false;
  if (s.phase === "result" && (!s.review || typeof s.review !== "object")) return false;
  return true;
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [puzzles, setPuzzles] = useState<PublicPuzzle<Visual>[]>([]);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [quizToken, setQuizToken] = useState("");
  const [review, setReview] = useState<SubmitResponse | null>(null);
  const [current, setCurrent] = useState(0);
  const [meta, setMeta] = useState<{
    profile: TestProfile;
    secondsPerQuestion: number;
    source: Source;
    generatorVersion?: string;
    notice?: string;
  } | null>(null);
  // The countdown is restored from the deadline the server issued, never from a
  // locally kept elapsed time, so a reload cannot hand anyone extra minutes.
  const [answerDeadline, setAnswerDeadline] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const autoSubmitted = useRef(false);
  const [error, setError] = useState<string>("");
  const startRequestId = useRef(0);
  const requestedProfile = useRef<TestProfile>("long-30");

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
    setAnswerDeadline(null);
    setSecondsLeft(null);
    autoSubmitted.current = false;
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
      if (typeof parsed.answerDeadline === "number") setAnswerDeadline(parsed.answerDeadline);
      if (parsed.review) setReview(parsed.review);
      setCurrent(parsed.current);
      if ("meta" in (parsed as Record<string, unknown>) && parsed && typeof parsed === "object") {
        const m = (parsed as Record<string, unknown>).meta;
        if (m && typeof m === "object") {
          const restored = m as {
            profile?: TestProfile;
            secondsPerQuestion?: number;
            source: Source;
            generatorVersion?: string;
            notice?: string;
          };
          setMeta({
            ...restored,
            profile: restored.profile ?? "long-30",
            secondsPerQuestion: restored.secondsPerQuestion ?? 60,
          });
          requestedProfile.current = restored.profile ?? "long-30";
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
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        phase, puzzles, answers, current, meta, quizToken, answerDeadline, review,
      }));
    } catch {
      // Storage quota exceeded or private browsing restriction — ignore.
    }
  }, [phase, puzzles, answers, current, meta, quizToken, answerDeadline, review]);

  async function start(profile: TestProfile) {
    if (phase === "loading" || phase === "submitting") return;

    const requestId = ++startRequestId.current;
    requestedProfile.current = profile;
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
      const data = await Promise.race([
        apiFetch<GenerateResponse>("/api/generate", { profile }),
        timeout,
      ]);
      if (startRequestId.current !== requestId) return;
      if (!Array.isArray(data.puzzles) || data.puzzles.length === 0) throw new Error("No puzzles returned");
      if (!data.quizToken) throw new Error("No scoring token returned");
      setPuzzles(data.puzzles);
      setQuizToken(data.quizToken);
      setAnswers(new Array(data.puzzles.length).fill(null));
      const secondsPerQuestion = data.secondsPerQuestion ?? 60;
      setAnswerDeadline(
        data.answerDeadline ??
          Math.floor(Date.now() / 1000) + secondsPerQuestion * data.puzzles.length,
      );
      autoSubmitted.current = false;
      setMeta({
        profile: data.profile ?? profile,
        secondsPerQuestion,
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

  // One countdown for the whole test, driven by the wall clock so a paused tab
  // or a slow render cannot slow it down.
  useEffect(() => {
    if (phase !== "active" || answerDeadline === null) {
      setSecondsLeft(null);
      return;
    }
    const tick = () => setSecondsLeft(Math.max(0, answerDeadline - Math.floor(Date.now() / 1000)));
    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [phase, answerDeadline]);

  // Out of time: submit whatever is answered. Everything left blank scores wrong,
  // exactly as it would have on an early submission.
  useEffect(() => {
    if (phase !== "active" || secondsLeft === null || secondsLeft > 0) return;
    if (autoSubmitted.current) return;
    autoSubmitted.current = true;
    void finish(true);
    // `finish` is stable in behaviour but recreated each render; re-running this
    // effect on that alone would fire a second submission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, secondsLeft]);

  async function finish(automatic = false) {
    const unanswered = countUnansweredAnswers(answers);
    if (needsBlankSubmissionConfirmation(answers, automatic)) {
      const questionLabel = unanswered === 1 ? "question" : "questions";
      if (!window.confirm(`You have ${unanswered} unanswered ${questionLabel}. Submit anyway?`)) return;
    }
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
      {phase === "error" && <ErrorView message={error} onRetry={() => start(requestedProfile.current)} />}

      {phase === "active" && puzzles[current] && (
        <Solver
          puzzle={puzzles[current]}
          index={current}
          total={puzzles.length}
          selected={answers[current]}
          answers={answers}
          secondsLeft={secondsLeft}
          lowTimeAt={lowTimeThreshold((meta?.secondsPerQuestion ?? 60) * puzzles.length)}
          // One concise banner on Q1 only — repeating it on every question reads
          // as a new warning each time (ui-qa finding).
          notice={current === 0 && meta?.source === "fallback"
            ? meta?.notice
            : undefined}
          onChoose={choose}
          onPrev={() => setCurrent((c) => Math.max(0, c - 1))}
          onNext={() => setCurrent((c) => Math.min(puzzles.length - 1, c + 1))}
          onGoTo={setCurrent}
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

function Intro({ onStart }: { onStart: (profile: TestProfile) => void }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
      <h2 className="text-xl font-semibold">Test instructions</h2>
      <p className="mt-3 text-gray-600">
        Choose one answer for each visual puzzle. You can move between questions and change
        answers before submitting.
      </p>
      <p className="mt-3 text-gray-600">
        The timer gives one minute per question in a single countdown. Unanswered questions
        count as incorrect.
      </p>
      <p className="mt-4 text-xs text-gray-500">
        Keyboard shortcuts: 1–6 or A–F to answer, ← → to move, Enter to continue.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => onStart("long-30")}
          className="rounded-lg bg-gray-900 px-5 py-2.5 font-medium text-white transition hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
        >
          Start the 30-question test · 30 min
        </button>
        <button
          type="button"
          onClick={() => onStart("short-5")}
          className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
        >
          Try the 5-question sample · 5 min
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

function puzzleTypeLabel(puzzle: PublicPuzzle<Visual>): string {
  const familyLabels: Record<string, string> = {
    "relational-sequence-v2": "relational sequence",
    "attribute-pairing-v1": "attribute pairing",
    "compositional-analogy-v2": "compositional analogy",
    "composed-transform-v2": "composed transformation",
    "relational-matrix-v2": "relational matrix",
    "visual-set-algebra-v2": "visual set algebra",
    "spatial-transform-v2": "spatial transformation",
    "transformation-machine-v3": "transformation machine",
    "rule-switching-v2": "rule switching",
    "second-order-sequence-v2": "second-order sequence",
    "inverse-analogy-v2": "inverse analogy",
  };
  if (puzzle.familyId && familyLabels[puzzle.familyId]) return familyLabels[puzzle.familyId];
  return puzzle.type === "operatorInduction"
    ? "visual equation"
    : puzzle.type === "oddOneOut" ? "odd one out" : puzzle.type;
}

function NoticeBanner({ notice }: { notice?: string }) {
  if (!notice) return null;
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
      {notice}
    </div>
  );
}

function Countdown({ secondsLeft, lowTimeAt }: { secondsLeft: number | null; lowTimeAt: number }) {
  if (secondsLeft === null) return null;
  const low = secondsLeft <= lowTimeAt;
  return (
    <span
      role="timer"
      aria-live={low ? "polite" : "off"}
      aria-label={`${Math.floor(secondsLeft / 60)} minutes and ${secondsLeft % 60} seconds left in the test`}
      className={`rounded-md px-2 py-0.5 font-mono text-sm tabular-nums ${
        low ? "bg-amber-100 font-semibold text-amber-800" : "text-gray-500"
      }`}
    >
      {formatClock(secondsLeft)} left
    </span>
  );
}

function Solver({
  puzzle,
  index,
  total,
  selected,
  answers,
  notice,
  secondsLeft,
  lowTimeAt,
  onChoose,
  onPrev,
  onNext,
  onGoTo,
  onFinish,
}: {
  puzzle: PublicPuzzle<Visual>;
  index: number;
  total: number;
  selected: number | null;
  answers: readonly (number | null)[];
  notice?: string;
  secondsLeft: number | null;
  lowTimeAt: number;
  onChoose: (i: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onGoTo: (index: number) => void;
  onFinish: () => void;
}) {
  const isLast = index === total - 1;
  const optionCount = puzzle.options.length;

  // A new question starts at its top. Without this the page keeps the previous
  // question's scroll position, so answering from the options and pressing Next
  // drops the player into the middle of the next puzzle with its stem — the part
  // they must read first — above the fold.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [index]);

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
        if (!isLast) onNext();
        return;
      }

      if (e.key === "Enter") {
        // Skip if a button already has focus — its native click handles it.
        if (document.activeElement?.tagName === "BUTTON") return;
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
      <NoticeBanner notice={notice} />
      {/* Sticky: only two of six options fit above the fold on a phone, so the
          clock scrolls away exactly when a player is deciding how long to spend
          — which is the whole-test timer's entire point. Full-bleed via -mx-4
          against the page's px-4. */}
      <div className="sticky top-0 z-20 -mx-4 mb-5 border-b border-gray-200 bg-gray-50/95 px-4 py-2 backdrop-blur-sm">
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            Question {index + 1} of {total}{selected === null ? " · Unanswered" : ""}
          </span>
          <Countdown secondsLeft={secondsLeft} lowTimeAt={lowTimeAt} />
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
          <div className="h-full bg-gray-900 transition-all" style={{ width: `${((index + 1) / total) * 100}%` }} />
        </div>
      </div>
      <nav className="mb-5" aria-label="Question navigation">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs text-gray-500">Questions</span>
          {answers.map((answer, questionIndex) => {
            const isCurrent = questionIndex === index;
            const isAnswered = answer !== null;
            return (
              <button
                key={questionIndex}
                type="button"
                onClick={() => onGoTo(questionIndex)}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`Question ${questionIndex + 1}, ${isAnswered ? "answered" : "unanswered"}${isCurrent ? ", current" : ""}`}
                className={`h-8 min-w-8 rounded-md border px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 ${
                  isCurrent
                    ? "border-gray-900 bg-gray-900 text-white"
                    : isAnswered
                      ? "border-gray-300 text-gray-700 hover:bg-gray-100"
                      : "border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100"
                }`}
              >
                {questionIndex + 1}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          {countUnansweredAnswers(answers)} unanswered · amber questions need an answer.
        </p>
      </nav>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        {puzzle.stem.length > 0 ? (
          <div className="mb-6 rounded-xl bg-gray-50 p-4" aria-label="Puzzle diagram">
            <StemView puzzle={puzzle} />
          </div>
        ) : (
          // Odd-one-out items carry their evidence in the options and have no
          // stem. Without this line the question renders as bare option
          // buttons and reads as missing. The line states the task form only —
          // never the hidden relationship.
          <p className="mb-6 rounded-xl bg-gray-50 p-4 text-center text-gray-700">
            All options but one follow the same hidden rule. Pick the one that breaks it.
          </p>
        )}

        <div className={gridClass}>
          {puzzle.options.map((opt, i) => {
            const isSel = selected === i;
            return (
              <button
                key={i}
                onClick={() => onChoose(i)}
                aria-label={`Option ${LETTERS[i]}: ${describeVisual(opt)}`}
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
                <VisualGraphic visual={opt} className="h-20 w-20" />
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
            onClick={() => onFinish()}
            className="rounded-lg bg-gray-900 px-6 py-2.5 font-medium text-white hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
          >
            See results
          </button>
        ) : (
          <button
            onClick={onNext}
            className="rounded-lg bg-gray-900 px-6 py-2.5 font-medium text-white hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
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
  puzzles: PublicPuzzle<Visual>[];
  answers: (number | null)[];
  review: SubmitResponse;
  meta: {
    profile: TestProfile;
    secondsPerQuestion: number;
    source: Source;
    generatorVersion?: string;
    notice?: string;
  } | null;
  onRestart: () => void;
}) {
  const pct = Math.round((review.score / review.total) * 100);

  const length = meta ? PROFILE_LABELS[meta.profile] : `${puzzles.length}-question test`;
  const version = meta?.generatorVersion ? ` · ${meta.generatorVersion}` : "";
  const attribution = meta?.source === "fallback"
    ? `${length} · from the verified reference set`
    : `${length} · freshly generated questions${version}`;

  return (
    <section>
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm uppercase tracking-wide text-gray-400">Your score</p>
        <p className="mt-1 text-5xl font-bold">
          {review.score}
          <span className="text-2xl font-normal text-gray-400"> / {puzzles.length}</span>
        </p>
        <p className="mt-2 text-gray-600">{pct}% correct</p>
        {review.late && (
          <p className="mt-2 text-sm text-amber-700">
            Submitted {formatClock(review.secondsLate ?? 0)} after time ran out. Your answers are
            still scored; this result is left out of the family measurements.
          </p>
        )}
        <div className="mt-3 text-xs text-gray-400">{attribution}</div>
        <button
          onClick={onRestart}
          className="mt-6 rounded-lg bg-gray-900 px-5 py-2.5 font-medium text-white transition hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
        >
          Take another test
        </button>
      </div>

      {review.breakdown && (review.breakdown.bands.length > 0 || review.breakdown.families.length > 0) && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {[
            ["By band", review.breakdown.bands],
            ["By reasoning family", review.breakdown.families],
          ].map(([title, rows]) => (
            <div key={title as string} className="rounded-xl border border-gray-200 bg-white p-4 text-left">
              <h3 className="text-sm font-semibold text-gray-800">{title as string}</h3>
              <ul className="mt-2 space-y-1 text-sm text-gray-600">
                {(rows as Array<{ key: string; correct: number; attempted: number }>).map((row) => (
                  <li key={row.key} className="flex justify-between gap-3">
                    <span>{row.key.replaceAll("-", " ")}</span>
                    <span>{row.correct} / {row.attempted}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

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
  puzzle: PublicPuzzle<Visual>;
  chosen: number | null;
  index: number;
  result: ReviewResult;
}) {
  const correct = result.correct;
  const optionCount = puzzle.options.length;
  // Match Solver's responsive grid: 4 options → 4-col, 5–6 → 3-col.
  const gridClass = optionCount <= 4
    ? "grid grid-cols-4 gap-2"
    : "grid grid-cols-3 gap-2";
  return (
    <div className={`rounded-xl border bg-white p-5 shadow-sm ${correct ? "border-green-300" : "border-red-200"}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-500">
          Q{index + 1} · {puzzleTypeLabel(puzzle)}
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
              aria-label={`Option ${LETTERS[i]}: ${describeVisual(opt)}${status ? ` (${status})` : ""}`}
              className={`flex flex-col items-center gap-1 rounded-lg border-2 p-2 ${
                isCorrect ? "border-green-400 bg-green-50" : isChosen ? "border-red-400 bg-red-50" : "border-gray-200"
              }`}
            >
              <span className={`text-[10px] font-semibold ${isChosen ? "text-red-700" : "text-gray-600"}`}>
                {LETTERS[i]}
              </span>
              <VisualGraphic visual={opt} className="h-16 w-16" />
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-lg bg-gray-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Explanation</p>
        <p className="mt-2 text-sm leading-6 text-gray-700">{result.explanation}</p>
      </div>
    </div>
  );
}
