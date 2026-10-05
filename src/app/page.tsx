"use client";

import { useEffect, useRef, useState } from "react";
import type { Layout, PublicPuzzle } from "@/items/schema";
import { SceneGraphic, StemView, describeScene } from "@/items/render";
import {
  countUnansweredAnswers,
  needsBlankSubmissionConfirmation,
  parseStoredSession,
  serverClockOffsetSeconds,
  type StoredSession,
} from "@/lib/quiz-progress";

type Source = "generated" | "fallback";

/** The two public test lengths. Both are built from the expanded family pool. */
type TestProfile = "short-5" | "long-30";

const PROFILE_LABELS: Record<TestProfile, string> = {
  "short-5": "5-question sample",
  "long-30": "30-question test",
};

interface GenerateResponse {
  puzzles: PublicPuzzle[];
  quizToken: string;
  profile?: TestProfile;
  /** Server-issued end of the test, in epoch seconds. The browser only displays it. */
  answerDeadline?: number;
  /** Server clock at issue time, in the same epoch-seconds unit as answerDeadline —
   *  lets the browser correct for its own clock being wrong, not just slow. */
  serverNow?: number;
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
/** Mirrors START_TIMEOUT_MS: scoring an already-finished test should not hang
 *  indefinitely either, and a timed-out submission must not lose the test. */
const SUBMIT_TIMEOUT_MS = 20000;
/** Space between the sticky clock and a question card scrolled up under it. */
const QUESTION_TOP_GAP_PX = 12;
/** The release version, inlined at build from package.json (next.config.ts). */
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;

const LETTERS = ["A", "B", "C", "D", "E", "F"];

/**
 * How to read each kind of question, shown above the diagram on the
 * 5-question sample only. Chosen by layout, which the picture already shows,
 * so a note names what to compare and never what the change is. The sample is
 * practice; the 30-question test stays without instructions while solving
 * (docs/plans/unambiguous-reading.md).
 */
const SAMPLE_GUIDES: Partial<Record<Layout, string>> = {
  row:
    "Read the pictures in number order. Follow each shape on its own from one picture to the " +
    "next: where it sits and what fill it has. The missing picture is the next step of the same pattern.",
  analogy:
    "The top row shows a change: the left board becomes the right board. Compare the two square by " +
    "square, looking at positions, fills, shapes and which way arrows point. Then make exactly the same " +
    "change to the board in the bottom row.",
  grid3x3:
    "The first two boards of a line make the third. When arrows are shown, only the rows work that " +
    "way; with no arrows, look across the rows and down the columns. Compare the boards square by " +
    "square: which squares hold a shape, and which shape.",
  machineTable:
    "Each jigsaw piece is a machine that changes a board. The rows above show each piece on its own. " +
    "The last row snaps several pieces together; the board goes through them one after another, the " +
    "way their tabs point. Watch positions, fills, shapes and which way arrows point.",
};

/**
 * Plain POST helper, replacing the llm-relay widget's `apiFetch`. This app
 * never loads that widget (it has no model picker), so it only ever needs a
 * fetch that reads the API routes' own `{ message }` error body.
 */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return (await res.json()) as T;
}

/** Read the `{ message }` body an API route sends on failure; fall back to a
 *  plain sentence for anything else (a proxy's HTML error page, an empty body). */
async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data: unknown = await res.json();
    if (data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string") {
      return (data as { message: string }).message;
    }
  } catch {
    // Not JSON — fall through to the plain sentence.
  }
  return `Request failed (${res.status})`;
}

/** Fetch failures throw a message that names the browser engine, not the
 *  problem — "Failed to fetch" in Chromium, "Load failed" in Safari, a
 *  NetworkError string in Firefox — and none of it means anything to a test
 *  taker. Recognise those and swap in a plain sentence instead. */
function isRawNetworkErrorMessage(message: string): boolean {
  return /^failed to fetch$/i.test(message) ||
    /^load failed$/i.test(message) ||
    /networkerror/i.test(message);
}

/** Build a user-friendly error string from a caught error. */
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

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

type TestMeta = {
  profile: TestProfile;
  secondsPerQuestion: number;
  source: Source;
  generatorVersion?: string;
  notice?: string;
};

type SavedSession = StoredSession<PublicPuzzle, SubmitResponse, Partial<TestMeta>>;

export default function Page() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [puzzles, setPuzzles] = useState<PublicPuzzle[]>([]);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [quizToken, setQuizToken] = useState("");
  const [review, setReview] = useState<SubmitResponse | null>(null);
  const [current, setCurrent] = useState(0);
  const [meta, setMeta] = useState<TestMeta | null>(null);
  // The countdown is restored from the deadline the server issued, never from a
  // locally kept elapsed time, so a reload cannot hand anyone extra minutes.
  const [answerDeadline, setAnswerDeadline] = useState<number | null>(null);
  // How far the server's clock sat ahead of (or behind) the browser's when the
  // test was issued (serverNow - clientNow). Added to the browser's own clock
  // at every tick, so the countdown runs on the server's clock rather than
  // trusting a taker's device to have the right time.
  const [clockOffset, setClockOffset] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const autoSubmitted = useRef(false);
  const [error, setError] = useState<string>("");
  // Whether the error on screen came from a failed *submission* that left the
  // test intact — as opposed to a failed start, or an expired/invalid token,
  // both of which already reset back to a blank test.
  const [canRetrySubmit, setCanRetrySubmit] = useState(false);
  // Whether the last submission was the automatic one fired when time ran
  // out, so the result screen can say so plainly.
  const [wasAutomaticSubmit, setWasAutomaticSubmit] = useState(false);
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
    setClockOffset(0);
    setSecondsLeft(null);
    setCanRetrySubmit(false);
    setWasAutomaticSubmit(false);
    autoSubmitted.current = false;
  }

  function isTokenFailureMessage(message: string): boolean {
    return message.startsWith("This quiz has expired") || message.startsWith("This quiz token is invalid");
  }

  // Restore in-progress session on mount (client-only; avoids hydration mismatch).
  useEffect(() => {
    try {
      const restored = parseStoredSession<PublicPuzzle, SubmitResponse, Partial<TestMeta>>(
        sessionStorage.getItem(SESSION_KEY),
      );
      if (!restored) return;
      setPhase(restored.phase);
      setPuzzles(restored.puzzles);
      setAnswers(restored.answers);
      setQuizToken(restored.quizToken);
      setAnswerDeadline(restored.answerDeadline);
      setClockOffset(restored.clockOffset);
      setWasAutomaticSubmit(restored.wasAutomaticSubmit);
      if (restored.review) setReview(restored.review);
      setCurrent(restored.current);
      if (restored.meta) {
        const profile = restored.meta.profile ?? "long-30";
        setMeta({
          ...restored.meta,
          source: restored.meta.source ?? "generated",
          profile,
          secondsPerQuestion: restored.meta.secondsPerQuestion ?? 60,
        });
        requestedProfile.current = profile;
      }
    } catch {
      // Storage unavailable (private browsing, blocked site data) — ignore.
    }
  }, []);

  // Persist state whenever it changes while a test is in progress — including
  // while an error is on screen, so a reload after a failed submission hands
  // the test back instead of losing it. The error screen itself is not worth
  // restoring (its message may already be stale), so it is saved as "active":
  // a reload during it resumes the test exactly as it stood before the failed
  // submission, ready to submit again. A token failure already clears
  // everything (puzzles is empty by the time this runs), so there is nothing
  // useful to save then.
  useEffect(() => {
    if (phase !== "active" && phase !== "result" && phase !== "error") return;
    if (phase === "error" && puzzles.length === 0) return;
    const storedPhase = phase === "error" ? "active" : phase;
    const snapshot: SavedSession = {
      phase: storedPhase, puzzles, answers, current, meta, quizToken, answerDeadline, clockOffset,
      wasAutomaticSubmit, review,
    };
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(snapshot));
    } catch {
      // Storage quota exceeded or private browsing restriction — ignore.
    }
  }, [phase, puzzles, answers, current, meta, quizToken, answerDeadline, clockOffset, wasAutomaticSubmit, review]);

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
      const requestSentAtMs = Date.now();
      const data = await Promise.race([
        postJson<GenerateResponse>("/api/generate", { profile }),
        timeout,
      ]);
      if (startRequestId.current !== requestId) return;
      if (!Array.isArray(data.puzzles) || data.puzzles.length === 0) throw new Error("No puzzles returned");
      if (!data.quizToken) throw new Error("No scoring token returned");
      setPuzzles(data.puzzles);
      setQuizToken(data.quizToken);
      setAnswers(new Array(data.puzzles.length).fill(null));
      const secondsPerQuestion = data.secondsPerQuestion ?? 60;
      const deadline = data.answerDeadline ??
        Math.floor(Date.now() / 1000) + secondsPerQuestion * data.puzzles.length;
      setAnswerDeadline(deadline);
      // The countdown runs on the server's clock: how far ahead (or behind)
      // it sits, added back at every tick (`serverClockOffsetSeconds` says why
      // the estimate is taken from when the request left). A session saved
      // before this field existed reads as 0 (the client's own clock),
      // matching how it already behaved.
      setClockOffset(typeof data.serverNow === "number"
        ? serverClockOffsetSeconds(data.serverNow, requestSentAtMs)
        : 0);
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
      const message = errorMessage(err, "Something went wrong");
      setError(
        isRawNetworkErrorMessage(message)
          ? "Could not reach the server. Please check your connection and try again."
          : message,
      );
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
    const tick = () => {
      const estimatedServerNow = Date.now() / 1000 + clockOffset;
      setSecondsLeft(Math.max(0, Math.floor(answerDeadline - estimatedServerNow)));
    };
    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [phase, answerDeadline, clockOffset]);

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

  /**
   * Score the current test.
   *
   * `isRetry` is set only by the "Retry submission" button on the error
   * screen: it resubmits the same answers and token without reopening the
   * blank-answers confirm the taker already got past (or deliberately never
   * triggered, on an automatic submission).
   */
  async function finish(automatic = false, isRetry = false) {
    if (!isRetry) {
      const unanswered = countUnansweredAnswers(answers);
      if (needsBlankSubmissionConfirmation(answers, automatic)) {
        const unansweredLabel = unanswered === 1
          ? "1 unanswered question; it counts"
          : `${unanswered} unanswered questions; they count`;
        if (!window.confirm(`You have ${unansweredLabel} as incorrect. Submit your answers now?`)) return;
      }
      setWasAutomaticSubmit(automatic);
    }
    setPhase("submitting");
    setError("");
    setCanRetrySubmit(false);

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error("Scoring is taking longer than expected. Your answers are kept — try again."));
      }, SUBMIT_TIMEOUT_MS);
    });

    try {
      const result = await Promise.race([
        postJson<SubmitResponse>("/api/submit", { quizToken, answers }),
        timeout,
      ]);
      setReview(result);
      setPhase("result");
    } catch (err) {
      const raw = errorMessage(err, "Could not score this test. Your answers are kept — try again.");
      if (isTokenFailureMessage(raw)) {
        // The token itself is dead — nothing left to retry. Same recovery as
        // today: drop back to a blank test.
        clearStoredSession();
        resetLocalTestState();
        setError(raw);
      } else {
        // Every other failure — a network error, a timeout, a 500 — leaves
        // the test exactly as it was. The taker can retry the same
        // submission or, from the same screen, choose to start over instead.
        setCanRetrySubmit(true);
        setError(
          isRawNetworkErrorMessage(raw)
            ? "Could not reach the server to score this test. Your answers are kept — try again."
            : raw,
        );
      }
      setPhase("error");
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
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
          IQ <span className="font-normal text-gray-400">visual reasoning gym</span>
          {APP_VERSION && <span className="ml-2 text-xs font-normal text-gray-400">v{APP_VERSION}</span>}
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
      {phase === "error" && (
        <ErrorView
          message={error}
          canRetrySubmit={canRetrySubmit}
          onRetrySubmit={() => finish(false, true)}
          onRetryStart={() => start(requestedProfile.current)}
          onStartNew={() => restart(true)}
        />
      )}

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
          guide={meta?.profile === "short-5" ? SAMPLE_GUIDES[puzzles[current].layout] : undefined}
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
          automatic={wasAutomaticSubmit}
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
        Choose one answer for each visual puzzle. You can move between questions, change
        answers, and press Submit answers at any time to finish early.
      </p>
      <p className="mt-3 text-gray-600">
        The timer gives one minute per question in a single countdown. Unanswered questions
        count as incorrect.
      </p>
      <p className="mt-3 text-gray-600">
        The 5-question sample adds a short note to each question on how to read it.
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

function ErrorView({
  message,
  canRetrySubmit,
  onRetrySubmit,
  onRetryStart,
  onStartNew,
}: {
  message: string;
  /** True only for a failed submission that left the test intact — a token
   *  failure or a failed start has already reset back to a blank test. */
  canRetrySubmit: boolean;
  onRetrySubmit: () => void;
  onRetryStart: () => void;
  onStartNew: () => void;
}) {
  const isTokenError = message.includes("quiz token") || message.includes("quiz has expired");
  return (
    <section className="rounded-2xl border border-red-200 bg-red-50 p-8 shadow-sm">
      <h2 className="text-lg font-semibold text-red-800">Something went wrong</h2>
      <p className="mt-2 text-red-700">{message}</p>
      {canRetrySubmit ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            onClick={onRetrySubmit}
            className="rounded-lg bg-red-700 px-4 py-2 font-medium text-white hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
          >
            Retry submission
          </button>
          <button
            onClick={onStartNew}
            className="rounded-lg border border-red-300 px-4 py-2 font-medium text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
          >
            Start a new test
          </button>
        </div>
      ) : (
        <button
          onClick={onRetryStart}
          className="mt-5 rounded-lg bg-red-700 px-4 py-2 font-medium text-white hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
        >
          {isTokenError ? "Start a fresh test" : "Try again"}
        </button>
      )}
    </section>
  );
}

const FAMILY_LABELS: Record<string, string> = {
  "relational-sequence-v2": "relational sequence",
  "attribute-pairing-v1": "attribute pairing",
  "compositional-analogy-v2": "compositional analogy",
  "composed-transform-v2": "composed transformation",
  "relational-matrix-v2": "relational matrix",
  "visual-set-algebra-v2": "visual set algebra",
  "spatial-transform-v2": "spatial transformation",
  "transformation-machine-v3": "transformation machine",
  "second-order-sequence-v2": "second-order sequence",
  "inverse-analogy-v2": "inverse analogy",
};

/**
 * A readable name for a reasoning family. The explicit map above is checked
 * first; anything not in it (a family added since, or the review screen's
 * own gaps) falls back to turning the raw id into words — strip a trailing
 * "-vN" version suffix, hyphens to spaces — so a raw id is never shown.
 */
function familyLabel(familyId: string): string {
  if (FAMILY_LABELS[familyId]) return FAMILY_LABELS[familyId];
  return familyId.replace(/-v\d+$/, "").replaceAll("-", " ");
}

const BAND_LABELS: Record<string, string> = {
  warmup: "warm-up",
  composition: "composition",
  "constraint-spatial": "constraint & spatial",
  "induction-transfer": "induction & transfer",
};

/** A readable name for a difficulty band, with the same words-from-id fallback. */
function bandLabel(band: string): string {
  return BAND_LABELS[band] ?? band.replaceAll("-", " ");
}

/**
 * A readable label for a review-screen question header. The family id comes
 * from the submit response's per-question results, never from the served
 * puzzle — the public puzzle type carries no family/band before answers ride
 * back from the server (see the "answer-free until scored" rule).
 */
function puzzleTypeLabel(type: PublicPuzzle["type"], familyId?: string): string {
  return familyId ? familyLabel(familyId) : type;
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
  guide,
  secondsLeft,
  lowTimeAt,
  onChoose,
  onPrev,
  onNext,
  onGoTo,
  onFinish,
}: {
  puzzle: PublicPuzzle;
  index: number;
  total: number;
  selected: number | null;
  answers: readonly (number | null)[];
  notice?: string;
  /** How to read this kind of question; the 5-question sample only. */
  guide?: string;
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
  const stickyRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // A new question starts at its top. Without this the page keeps the previous
  // question's scroll position, so answering from the options and pressing Next
  // drops the player into the middle of the next puzzle with its stem — the part
  // they must read first — above the fold.
  //
  // Where the whole question fits below the navigator, that top is the page's
  // top, so the navigator stays in view. Where it does not, the question gets
  // the screen: on a 375 px phone the 30-question navigator wraps to five rows
  // and pushed every diagram 424 px down (bug of 2026-09-28), so the card lands
  // just under the sticky clock instead and the navigator is a scroll up.
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const cardTop = card.getBoundingClientRect().top + window.scrollY;
    const fits = cardTop + card.offsetHeight <= window.innerHeight;
    const underClock = cardTop - (stickyRef.current?.offsetHeight ?? 0) - QUESTION_TOP_GAP_PX;
    window.scrollTo({ top: fits ? 0 : Math.max(0, underClock), behavior: "auto" });
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
      <div ref={stickyRef} className="sticky top-0 z-20 -mx-4 mb-5 border-b border-gray-200 bg-gray-50/95 px-4 py-2 backdrop-blur-sm">
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

      {/* Phone padding is trimmed so the diagram has 301px of a 375px screen;
          every stem layout is priced against that (NARROW_VIEWPORT_STEM_WIDTH). */}
      <div ref={cardRef} className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:p-6">
        {guide && (
          <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-900">
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">How to read this</p>
            <p className="mt-1">{guide}</p>
          </div>
        )}
        {puzzle.stem.length > 0 ? (
          <div className="mb-6 rounded-xl bg-gray-50 p-2 sm:p-4" aria-label="Puzzle diagram">
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
                aria-label={`Option ${LETTERS[i]}: ${describeScene(opt)}`}
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
                <SceneGraphic scene={opt} className="h-20 w-20" />
              </button>
            );
          })}
        </div>

        {/* Keyboard hint — hidden on mobile to save space. */}
        <p className="mt-3 hidden text-center text-xs text-gray-400 sm:block">
          Tip: press 1–6 or A–F to answer, ← → to navigate, Enter to {isLast ? "submit your answers" : "continue"}
        </p>
      </div>

      <div className="mt-6 flex items-center justify-between">
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
            Submit answers
          </button>
        ) : (
          // Submitting is open on every question, not only the last: to check
          // answers part-way, to finish early, or to stop. `onFinish` warns when
          // questions are still unanswered.
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onFinish()}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
            >
              Submit answers
            </button>
            <button
              onClick={onNext}
              className="rounded-lg bg-gray-900 px-6 py-2.5 font-medium text-white hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
            >
              Next →
            </button>
          </div>
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
  automatic,
  onRestart,
}: {
  puzzles: PublicPuzzle[];
  answers: (number | null)[];
  review: SubmitResponse;
  meta: {
    profile: TestProfile;
    secondsPerQuestion: number;
    source: Source;
    generatorVersion?: string;
    notice?: string;
  } | null;
  /** True when this submission was the automatic one fired at time-up,
   *  rather than the taker choosing to submit. */
  automatic: boolean;
  onRestart: () => void;
}) {
  const pct = Math.round((review.score / review.total) * 100);
  const skipped = review.results.filter((result) => result.chosen === null).length;
  const wrong = review.total - review.score - skipped;

  const length = meta ? PROFILE_LABELS[meta.profile] : `${puzzles.length}-question test`;
  const attribution = meta?.source === "fallback"
    ? `${length} · from the verified reference set`
    : `${length} · freshly generated questions`;

  return (
    <section>
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm uppercase tracking-wide text-gray-400">Your score</p>
        <p className="mt-1 text-5xl font-bold">
          {review.score}
          <span className="text-2xl font-normal text-gray-400"> / {puzzles.length}</span>
        </p>
        <p className="mt-2 text-gray-600">{pct}% correct</p>
        <div className="mt-3 flex items-center justify-center gap-4 text-sm">
          <span className="text-green-700">{review.score} correct</span>
          <span className="text-red-700">{wrong} wrong</span>
          <span className="text-gray-500">{skipped} skipped</span>
        </div>
        {automatic && (
          <p className="mt-3 text-sm text-amber-700">
            Time ran out; unanswered questions count as wrong.
          </p>
        )}
        {review.late && (
          <p className="mt-2 text-sm text-amber-700">
            Submitted {formatClock(review.secondsLate ?? 0)} after time ran out. Your answers were
            still scored.
          </p>
        )}
        <div className="mt-3 text-xs text-gray-400">{attribution}</div>
        {meta?.generatorVersion && (
          <div className="mt-1 text-[11px] text-gray-400">Generator {meta.generatorVersion}</div>
        )}
        <button
          onClick={onRestart}
          className="mt-6 rounded-lg bg-gray-900 px-5 py-2.5 font-medium text-white transition hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
        >
          Take another test
        </button>
      </div>

      {review.breakdown && (review.breakdown.bands.length > 0 || review.breakdown.families.length > 0) && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <BreakdownCard title="By band" rows={review.breakdown.bands} label={bandLabel} />
          <BreakdownCard title="By reasoning family" rows={review.breakdown.families} label={familyLabel} />
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

function BreakdownCard({
  title,
  rows,
  label,
}: {
  title: string;
  rows: Array<{ key: string; correct: number; attempted: number }>;
  label: (key: string) => string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-left">
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      <ul className="mt-2 space-y-1 text-sm text-gray-600">
        {rows.map((row) => (
          <li key={row.key} className="flex justify-between gap-3">
            <span>{label(row.key)}</span>
            <span>{row.correct} / {row.attempted}</span>
          </li>
        ))}
      </ul>
    </div>
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
  // Match Solver's responsive grid: 4 options → 4-col, 5–6 → 3-col.
  const gridClass = optionCount <= 4
    ? "grid grid-cols-4 gap-2"
    : "grid grid-cols-3 gap-2";
  return (
    <div className={`rounded-xl border bg-white p-3 shadow-sm sm:p-5 ${correct ? "border-green-300" : "border-red-200"}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-500">
          Q{index + 1} · {puzzleTypeLabel(puzzle.type, result.familyId)}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${correct ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
            {correct ? "Correct" : chosen === null ? "Skipped" : "Incorrect"}
          </span>
        </div>
      </div>

      {puzzle.stem.length > 0 && (
        <div className="mb-4 rounded-lg bg-gray-50 p-2 sm:p-3">
          <StemView puzzle={puzzle} />
        </div>
      )}

      <div className={gridClass}>
        {puzzle.options.map((opt, i) => {
          const isCorrect = i === result.answerIndex;
          const isChosen = i === chosen;
          const status = isCorrect ? "correct answer" : isChosen ? "your incorrect choice" : "";
          // Colour and border alone do not carry the status: a screen reader
          // ignores an aria-label on this role-less tile, and a colour-blind
          // reader cannot use border colour either. State it as plain text —
          // a tile can be both the correct answer and the taker's own pick.
          const letterColor = isCorrect ? "text-green-700" : isChosen ? "text-red-700" : "text-gray-600";
          const noteText = isCorrect && isChosen
            ? "Correct answer · your choice"
            : isCorrect ? "Correct answer" : isChosen ? "Your choice" : "";
          return (
            <div
              key={i}
              aria-label={`Option ${LETTERS[i]}: ${describeScene(opt)}${status ? ` (${status})` : ""}`}
              className={`flex flex-col items-center gap-1 rounded-lg border-2 p-2 ${
                isCorrect ? "border-green-400 bg-green-50" : isChosen ? "border-red-400 bg-red-50" : "border-gray-200"
              }`}
            >
              <span className={`text-xs font-semibold ${letterColor}`}>
                {LETTERS[i]}
              </span>
              <SceneGraphic scene={opt} className="h-16 w-16" />
              {noteText && (
                <span className={`text-center text-xs font-medium leading-tight ${isCorrect ? "text-green-700" : "text-red-700"}`}>
                  {noteText}
                </span>
              )}
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
