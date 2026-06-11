"use client";

import { useState, useEffect } from "react";
import type { Puzzle } from "@/items/schema";
import type { AgentStats, DifficultyLevel } from "@/items/bank";
import { CellGraphic, StemView, describeCell } from "@/items/render";
import { apiFetch, formatApiError } from "@/lib/relay-client";

type Source = "bank" | "relay" | "fallback";

interface GenerateResponse {
  puzzles: Puzzle[];
  source: Source;
  providerUsed?: string | null;
  modelId?: string;
  notice?: string;
  agentStats?: (AgentStats | null)[];
}

type Phase = "intro" | "loading" | "result" | "active" | "error";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

// Bumped to v2 — persisted shape gains `agentStats`; avoids stale v1 restores.
const SESSION_KEY = "aiq-test-v2";

/** Validate a raw parsed object before restoring session state. */
function isValidSession(v: unknown): v is {
  phase: "active" | "result";
  puzzles: Puzzle[];
  answers: (number | null)[];
  current: number;
} {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  if (s.phase !== "active" && s.phase !== "result") return false;
  if (!Array.isArray(s.puzzles) || s.puzzles.length === 0) return false;
  if (!Array.isArray(s.answers) || s.answers.length !== s.puzzles.length) return false;
  if (typeof s.current !== "number" || s.current < 0 || s.current >= s.puzzles.length) return false;
  return true;
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [puzzles, setPuzzles] = useState<Puzzle[]>([]);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [current, setCurrent] = useState(0);
  const [meta, setMeta] = useState<{
    source: Source;
    providerUsed?: string | null;
    modelId?: string;
    notice?: string;
    agentStats?: (AgentStats | null)[];
  } | null>(null);
  const [error, setError] = useState<string>("");
  // Track whether the loading state is for a fresh (relay) or bank request.
  const [loadingFresh, setLoadingFresh] = useState(false);
  // Difficulty chosen on the intro screen; also reused by the error-screen retry.
  const [difficulty, setDifficulty] = useState<DifficultyLevel>("standard");

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
      setCurrent(parsed.current);
      if ("meta" in (parsed as Record<string, unknown>) && parsed && typeof parsed === "object") {
        const m = (parsed as Record<string, unknown>).meta;
        if (m && typeof m === "object") {
          setMeta(m as {
            source: Source;
            providerUsed?: string | null;
            modelId?: string;
            notice?: string;
            agentStats?: (AgentStats | null)[];
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
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ phase, puzzles, answers, current, meta }));
    } catch {
      // Storage quota exceeded or private browsing restriction — ignore.
    }
  }, [phase, puzzles, answers, current, meta]);

  async function start(fresh = false) {
    // Clear any previous session before starting fresh.
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    setPhase("loading");
    setLoadingFresh(fresh);
    setError("");
    try {
      // apiFetch attaches the widget's chosen provider/model/key as headers.
      const data = await apiFetch<GenerateResponse>("/api/generate", { fresh, difficulty });
      if (!Array.isArray(data.puzzles) || data.puzzles.length === 0) throw new Error("No puzzles returned");
      setPuzzles(data.puzzles);
      setAnswers(new Array(data.puzzles.length).fill(null));
      setMeta({
        source: data.source,
        providerUsed: data.providerUsed,
        modelId: data.modelId,
        notice: data.notice,
        // agentStats may be absent on relay path or in old sessions — default to undefined.
        agentStats: data.agentStats,
      });
      setCurrent(0);
      setPhase("active");
    } catch (err) {
      setError(formatApiError(err, "Something went wrong"));
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
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    setPhase("intro");
    setPuzzles([]);
    setAnswers([]);
    setCurrent(0);
    setMeta(null);
  }

  const score = answers.reduce<number>((acc, a, i) => acc + (a !== null && a === puzzles[i]?.answerIndex ? 1 : 0), 0);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-8">
      <header className="mb-8 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          aiq <span className="font-normal text-gray-400">· visual IQ test</span>
        </h1>
        {(phase === "active" || phase === "result") && (
          <button
            onClick={() => restart(phase === "active")}
            className="text-sm text-gray-500 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
          >
            Restart
          </button>
        )}
      </header>

      {phase === "intro" && <Intro difficulty={difficulty} onDifficulty={setDifficulty} onStart={start} />}
      {phase === "loading" && <Loading fresh={loadingFresh} />}
      {phase === "error" && <ErrorView message={error} onRetry={() => start()} />}

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
          onFinish={() => setPhase("result")}
        />
      )}

      {phase === "result" && (
        <Result
          puzzles={puzzles}
          answers={answers}
          score={score}
          meta={meta}
          onRestart={restart}
        />
      )}
    </main>
  );
}

const DIFFICULTY_CHOICES: { level: DifficultyLevel; label: string; blurb: string }[] = [
  { level: "easy", label: "Easy", blurb: "Gentler single-rule patterns to warm up." },
  { level: "standard", label: "Standard", blurb: "The default ramp, ending in a two-rule grid." },
  { level: "hard", label: "Hard", blurb: "Tougher multi-rule puzzles from the first question." },
];

function Intro({
  difficulty,
  onDifficulty,
  onStart,
}: {
  difficulty: DifficultyLevel;
  onDifficulty: (level: DifficultyLevel) => void;
  onStart: (fresh?: boolean) => void;
}) {
  const active = DIFFICULTY_CHOICES.find((c) => c.level === difficulty) ?? DIFFICULTY_CHOICES[1];
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
      <h2 className="text-xl font-semibold">Take a 5-question visual IQ test</h2>
      <p className="mt-3 text-gray-600">
        Five language-independent puzzles — matrices, sequences, an analogy, and an odd-one-out — of
        increasing difficulty. Each is rendered as shapes. Pick the option that fits the pattern;
        you&apos;ll get a score and a per-question review at the end.
      </p>

      <div className="mt-6">
        <span id="difficulty-label" className="text-sm font-medium text-gray-700">
          Difficulty
        </span>
        <div
          role="group"
          aria-labelledby="difficulty-label"
          className="mt-2 inline-flex rounded-lg border border-gray-300 bg-gray-50 p-0.5"
        >
          {DIFFICULTY_CHOICES.map(({ level, label }) => {
            const isActive = level === difficulty;
            return (
              <button
                key={level}
                onClick={() => onDifficulty(level)}
                aria-pressed={isActive}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 ${
                  isActive ? "bg-gray-900 text-white shadow-sm" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-gray-500">{active.blurb}</p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          onClick={() => onStart(false)}
          className="rounded-lg bg-gray-900 px-5 py-2.5 font-medium text-white transition hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
        >
          Start test
        </button>
        <button
          onClick={() => onStart(true)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:border-gray-400 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
        >
          Generate a fresh test with AI
        </button>
      </div>
    </section>
  );
}

function Loading({ fresh }: { fresh: boolean }) {
  return (
    <section className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-gray-200 bg-white p-12 text-center shadow-sm">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
      {fresh ? (
        <>
          <p className="text-gray-600">Generating your test via llm-relay…</p>
          <p className="text-sm text-gray-400">Designing 5 puzzles of increasing difficulty.</p>
        </>
      ) : (
        <p className="text-gray-600">Loading your test…</p>
      )}
    </section>
  );
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="rounded-2xl border border-red-200 bg-red-50 p-8 shadow-sm">
      <h2 className="text-lg font-semibold text-red-800">Couldn&apos;t start the test</h2>
      <p className="mt-2 text-red-700">{message}</p>
      <button onClick={onRetry} className="mt-5 rounded-lg bg-red-700 px-4 py-2 font-medium text-white hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2">
        Try again
      </button>
    </section>
  );
}

function DifficultyDots({ level }: { level: number }) {
  return (
    <span className="inline-flex items-center gap-1" title={`Difficulty ${level} / 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className={`h-1.5 w-1.5 rounded-full ${i < level ? "bg-gray-800" : "bg-gray-300"}`} />
      ))}
    </span>
  );
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
  puzzle: Puzzle;
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
        <DifficultyDots level={puzzle.difficulty} />
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
                  isSel ? "border-gray-900 bg-gray-900/[0.03]" : "border-gray-200 hover:border-gray-400"
                }`}
              >
                <span className={`text-xs font-semibold ${isSel ? "text-gray-900" : "text-gray-400"}`}>{LETTERS[i]}</span>
                <CellGraphic cell={opt} className="h-16 w-16" />
              </button>
            );
          })}
        </div>

        {/* Keyboard hint — hidden on mobile to save space. */}
        <p className="mt-3 hidden text-center text-xs text-gray-400 sm:block">
          Tip: press 1–6 to answer, ← → to navigate, Enter to continue
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

/** Agent calibration chip — rendered only in ReviewItem (never during solving). */
function AgentChip({ stats }: { stats: AgentStats }) {
  if (stats.attempts < 1) return null;
  const pct = Math.round(stats.solveRate * 100);
  let label: string;
  if (stats.solveRate >= 0.9) {
    label = `AI agents get this right ${pct}% of the time`;
  } else if (stats.solveRate <= 0.4) {
    label = "Most AI agents fail this one";
  } else {
    label = `AI agents solve this ${pct}% of the time`;
  }
  return (
    <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
      {label} · based on {stats.attempts} runs
    </span>
  );
}

function Result({
  puzzles,
  answers,
  score,
  meta,
  onRestart,
}: {
  puzzles: Puzzle[];
  answers: (number | null)[];
  score: number;
  meta: {
    source: Source;
    providerUsed?: string | null;
    modelId?: string;
    notice?: string;
    agentStats?: (AgentStats | null)[];
  } | null;
  onRestart: () => void;
}) {
  const pct = Math.round((score / puzzles.length) * 100);

  let attribution: string;
  if (meta?.source === "relay") {
    attribution = `Generated via llm-relay${meta?.providerUsed ? ` · ${meta.providerUsed}` : ""}${meta?.modelId ? ` · ${meta.modelId}` : ""}`;
  } else if (meta?.source === "fallback") {
    attribution = "Item-bank sample (relay unavailable)";
  } else {
    attribution = "From the calibrated item bank";
  }

  return (
    <section>
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm uppercase tracking-wide text-gray-400">Your score</p>
        <p className="mt-1 text-5xl font-bold">
          {score}
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
            agentStats={meta?.agentStats?.[i] ?? null}
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
  agentStats,
}: {
  puzzle: Puzzle;
  chosen: number | null;
  index: number;
  agentStats: AgentStats | null;
}) {
  const correct = chosen !== null && chosen === puzzle.answerIndex;
  const optionCount = puzzle.options.length;
  // Match Solver's responsive grid: 4 options → 4-col, 5–6 → 3-col.
  const gridClass = optionCount <= 4
    ? "grid grid-cols-4 gap-2"
    : "grid grid-cols-3 gap-2";
  return (
    <div className={`rounded-xl border bg-white p-5 shadow-sm ${correct ? "border-green-300" : "border-red-200"}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-500">
          Q{index + 1} · {puzzle.type}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {agentStats && agentStats.attempts >= 1 && <AgentChip stats={agentStats} />}
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
          const isCorrect = i === puzzle.answerIndex;
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
              <span className="text-[10px] font-semibold text-gray-400">{LETTERS[i]}</span>
              <CellGraphic cell={opt} className="h-12 w-12" />
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-sm text-gray-600">
        <span className="font-medium text-gray-800">Why:</span> {puzzle.explanation}
      </p>
    </div>
  );
}
