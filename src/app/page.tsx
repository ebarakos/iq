"use client";

import { useState } from "react";
import type { Puzzle } from "@/items/schema";
import { CellGraphic, StemView } from "@/items/render";
import { apiFetch, formatApiError } from "@/lib/relay-client";

type Source = "relay" | "fallback";

interface GenerateResponse {
  puzzles: Puzzle[];
  source: Source;
  providerUsed?: string | null;
  modelId?: string;
  notice?: string;
}

type Phase = "intro" | "loading" | "active" | "result" | "error";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export default function Page() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [puzzles, setPuzzles] = useState<Puzzle[]>([]);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [current, setCurrent] = useState(0);
  const [meta, setMeta] = useState<{ source: Source; providerUsed?: string | null; modelId?: string; notice?: string } | null>(null);
  const [error, setError] = useState<string>("");

  async function start() {
    setPhase("loading");
    setError("");
    try {
      // apiFetch attaches the widget's chosen provider/model/key as headers.
      const data = await apiFetch<GenerateResponse>("/api/generate", {});
      if (!Array.isArray(data.puzzles) || data.puzzles.length === 0) throw new Error("No puzzles returned");
      setPuzzles(data.puzzles);
      setAnswers(new Array(data.puzzles.length).fill(null));
      setMeta({ source: data.source, providerUsed: data.providerUsed, modelId: data.modelId, notice: data.notice });
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

  function restart() {
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
          <button onClick={restart} className="text-sm text-gray-500 underline-offset-2 hover:underline">
            Restart
          </button>
        )}
      </header>

      {phase === "intro" && <Intro onStart={start} />}
      {phase === "loading" && <Loading />}
      {phase === "error" && <ErrorView message={error} onRetry={start} />}

      {phase === "active" && puzzles[current] && (
        <Solver
          puzzle={puzzles[current]}
          index={current}
          total={puzzles.length}
          selected={answers[current]}
          notice={meta?.source === "fallback" ? meta?.notice : undefined}
          onChoose={choose}
          onPrev={() => setCurrent((c) => Math.max(0, c - 1))}
          onNext={() => setCurrent((c) => Math.min(puzzles.length - 1, c + 1))}
          onFinish={() => setPhase("result")}
        />
      )}

      {phase === "result" && (
        <Result puzzles={puzzles} answers={answers} score={score} meta={meta} onRestart={restart} />
      )}
    </main>
  );
}

function Intro({ onStart }: { onStart: () => void }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
      <h2 className="text-xl font-semibold">Take a 5-question visual IQ test</h2>
      <p className="mt-3 text-gray-600">
        Five language-independent puzzles — matrices, sequences, an analogy, and an odd-one-out — of
        increasing difficulty. Each is generated on the fly through <span className="font-medium">llm-relay</span> and
        rendered as shapes. Pick the option that fits the pattern; you&apos;ll get a score and a per-question
        review at the end.
      </p>
      <button
        onClick={onStart}
        className="mt-6 rounded-lg bg-gray-900 px-5 py-2.5 font-medium text-white transition hover:bg-gray-700"
      >
        Start test
      </button>
    </section>
  );
}

function Loading() {
  return (
    <section className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-gray-200 bg-white p-12 text-center shadow-sm">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
      <p className="text-gray-600">Generating your test via llm-relay…</p>
      <p className="text-sm text-gray-400">Designing 5 puzzles of increasing difficulty.</p>
    </section>
  );
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="rounded-2xl border border-red-200 bg-red-50 p-8 shadow-sm">
      <h2 className="text-lg font-semibold text-red-800">Couldn&apos;t start the test</h2>
      <p className="mt-2 text-red-700">{message}</p>
      <button onClick={onRetry} className="mt-5 rounded-lg bg-red-700 px-4 py-2 font-medium text-white hover:bg-red-600">
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

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {puzzle.options.map((opt, i) => {
            const isSel = selected === i;
            return (
              <button
                key={i}
                onClick={() => onChoose(i)}
                className={`group flex flex-col items-center gap-2 rounded-xl border-2 p-3 transition ${
                  isSel ? "border-gray-900 bg-gray-900/[0.03]" : "border-gray-200 hover:border-gray-400"
                }`}
                aria-pressed={isSel}
              >
                <span className={`text-xs font-semibold ${isSel ? "text-gray-900" : "text-gray-400"}`}>{LETTERS[i]}</span>
                <CellGraphic cell={opt} className="h-16 w-16" />
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={onPrev}
          disabled={index === 0}
          className="rounded-lg px-4 py-2 text-gray-600 enabled:hover:bg-gray-100 disabled:opacity-40"
        >
          ← Back
        </button>
        {isLast ? (
          <button
            onClick={onFinish}
            disabled={selected === null}
            className="rounded-lg bg-gray-900 px-6 py-2.5 font-medium text-white enabled:hover:bg-gray-700 disabled:opacity-40"
          >
            See results
          </button>
        ) : (
          <button
            onClick={onNext}
            disabled={selected === null}
            className="rounded-lg bg-gray-900 px-6 py-2.5 font-medium text-white enabled:hover:bg-gray-700 disabled:opacity-40"
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
  score,
  meta,
  onRestart,
}: {
  puzzles: Puzzle[];
  answers: (number | null)[];
  score: number;
  meta: { source: Source; providerUsed?: string | null; modelId?: string; notice?: string } | null;
  onRestart: () => void;
}) {
  const pct = Math.round((score / puzzles.length) * 100);
  return (
    <section>
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm uppercase tracking-wide text-gray-400">Your score</p>
        <p className="mt-1 text-5xl font-bold">
          {score}
          <span className="text-2xl font-normal text-gray-400"> / {puzzles.length}</span>
        </p>
        <p className="mt-2 text-gray-600">{pct}% correct</p>
        <div className="mt-3 text-xs text-gray-400">
          {meta?.source === "relay"
            ? `Generated via llm-relay${meta?.providerUsed ? ` · ${meta.providerUsed}` : ""}${meta?.modelId ? ` · ${meta.modelId}` : ""}`
            : "Sample puzzles (relay unavailable)"}
        </div>
        <button
          onClick={onRestart}
          className="mt-6 rounded-lg bg-gray-900 px-5 py-2.5 font-medium text-white transition hover:bg-gray-700"
        >
          Take another test
        </button>
      </div>

      <h3 className="mb-3 mt-8 text-lg font-semibold">Review</h3>
      <div className="space-y-4">
        {puzzles.map((p, i) => (
          <ReviewItem key={p.id} puzzle={p} chosen={answers[i]} index={i} />
        ))}
      </div>
    </section>
  );
}

function ReviewItem({ puzzle, chosen, index }: { puzzle: Puzzle; chosen: number | null; index: number }) {
  const correct = chosen !== null && chosen === puzzle.answerIndex;
  return (
    <div className={`rounded-xl border bg-white p-5 shadow-sm ${correct ? "border-green-300" : "border-red-200"}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-500">
          Q{index + 1} · {puzzle.type}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${correct ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
          {correct ? "Correct" : chosen === null ? "Skipped" : "Incorrect"}
        </span>
      </div>

      {puzzle.stem.length > 0 && (
        <div className="mb-4 rounded-lg bg-gray-50 p-3">
          <StemView puzzle={puzzle} />
        </div>
      )}

      <div className="grid grid-cols-4 gap-2">
        {puzzle.options.map((opt, i) => {
          const isCorrect = i === puzzle.answerIndex;
          const isChosen = i === chosen;
          return (
            <div
              key={i}
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
