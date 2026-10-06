import Link from "next/link";
import { notFound } from "next/navigation";
import { listLeaderboard } from "@/lib/leaderboard";
import { leaderboardEnabled } from "@/lib/leaderboard-config";
import type { LeaderboardEntry } from "@/lib/leaderboard-types";

export const dynamic = "force-dynamic";

function elapsedLabel(seconds: number): string {
  const elapsed = Math.floor(Math.max(0, seconds));
  return `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
}

function dateLabel(submittedAt: number): string {
  return new Date(submittedAt * 1000).toISOString().slice(0, 10);
}

export default async function LeaderboardPage() {
  if (!leaderboardEnabled()) notFound();

  let entries: LeaderboardEntry[] = [];
  let failed = false;
  try {
    entries = await listLeaderboard();
  } catch {
    failed = true;
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8">
      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Leaderboard</h1>
        <Link
          href="/"
          className="rounded-md text-sm text-gray-600 underline underline-offset-4 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
        >
          Back to the test
        </Link>
      </header>
      <p className="mb-5 text-sm text-gray-600">
        Top 20 published scores from on-time 30-question tests. Correct answers earn 100 points each,
        plus up to 25% for time remaining.
      </p>

      {failed ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-6">
          <h2 className="font-semibold text-red-800">The leaderboard could not be loaded.</h2>
          <p className="mt-2 text-sm text-red-700">Please try again in a moment.</p>
          <a
            href="/leaderboard"
            className="mt-4 inline-block rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
          >
            Try again
          </a>
        </section>
      ) : entries.length === 0 ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-semibold">No scores published yet.</h2>
          <p className="mt-2 text-sm text-gray-600">Complete a 30-question test to publish your score.</p>
          <Link
            href="/"
            className="mt-5 inline-block rounded-lg bg-gray-900 px-5 py-2.5 font-medium text-white hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
          >
            Take the test
          </Link>
        </section>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Top 20 published scores</caption>
            <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium text-gray-500">
              <tr>
                <th scope="col" className="px-3 py-3 sm:px-4">Rank</th>
                <th scope="col" className="px-3 py-3 sm:px-4">Nickname</th>
                <th scope="col" className="px-3 py-3 text-right sm:px-4">Points</th>
                <th scope="col" className="hidden whitespace-nowrap px-4 py-3 text-right sm:table-cell">Correct / 30</th>
                <th scope="col" className="hidden px-4 py-3 text-right sm:table-cell">Elapsed</th>
                <th scope="col" className="hidden whitespace-nowrap px-4 py-3 sm:table-cell">App version</th>
                <th scope="col" className="hidden whitespace-nowrap px-4 py-3 sm:table-cell">Date (UTC)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((entry, index) => (
                <tr key={entry.id}>
                  <td className="px-3 py-4 tabular-nums text-gray-500 sm:px-4">{index + 1}</td>
                  <th scope="row" className="max-w-48 break-words px-3 py-4 font-medium text-gray-900 sm:px-4">
                    {entry.nickname}
                    <span className="mt-1 block text-xs font-normal text-gray-500 sm:hidden">
                      {elapsedLabel(entry.elapsedSeconds)} · {entry.appVersion}
                    </span>
                    <span className="mt-1 block text-xs font-normal text-gray-500 sm:hidden">{dateLabel(entry.submittedAt)} UTC</span>
                  </th>
                  <td className="px-3 py-4 text-right font-semibold tabular-nums sm:px-4">
                    {entry.points.toLocaleString("en-US")}
                    <span className="mt-1 block text-xs font-normal text-gray-500 sm:hidden">{entry.correct} / 30</span>
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-4 text-right tabular-nums text-gray-600 sm:table-cell">{entry.correct} / 30</td>
                  <td className="hidden px-4 py-4 text-right font-mono tabular-nums text-gray-600 sm:table-cell">{elapsedLabel(entry.elapsedSeconds)}</td>
                  <td className="hidden px-4 py-4 text-gray-600 sm:table-cell">{entry.appVersion}</td>
                  <td className="hidden whitespace-nowrap px-4 py-4 text-gray-600 sm:table-cell">{dateLabel(entry.submittedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
