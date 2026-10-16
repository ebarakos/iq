#!/usr/bin/env -S node --import tsx

import { listBoardEntries, reindexBoard, removeLeaderboardEntry } from "../src/lib/leaderboard";
import type { LeaderboardEntry } from "../src/lib/leaderboard-types";

/**
 * The owner's delete for leaderboard rows the filters missed
 * (docs/plans/leaderboard-integrity.md). Reads the KV credentials in .env.local.
 *
 *   npm run leaderboard:remove -- --board production --list
 *   npm run leaderboard:remove -- --board production <id prefix or nickname>        # shows matches
 *   npm run leaderboard:remove -- --board production <id prefix or nickname> --yes  # removes them
 *   npm run leaderboard:reindex -- --board production                               # re-ranks every row
 *
 * A removed row stays stored as a tombstone, so its test cannot be published again.
 * Re-ranking recomputes each row's place from its saved correct count and elapsed time;
 * run it once after a deploy that changes the ranking rule.
 */

const BOARDS = { production: "aiq:production", dev: "aiq:local" } as const;

function usage(message: string): never {
  console.error(`${message}\nUsage: npm run leaderboard:remove -- --board production|dev (--list | --reindex | <id prefix or nickname> [--yes])`);
  process.exit(2);
}

function row(entry: LeaderboardEntry, rank: number): string {
  const date = new Date(entry.submittedAt * 1000).toISOString().slice(0, 10);
  const elapsed = `${Math.floor(entry.elapsedSeconds / 60)}m${String(entry.elapsedSeconds % 60).padStart(2, "0")}s`;
  return [String(rank).padStart(3), entry.id.slice(0, 12), entry.nickname.padEnd(24), (entry.kind ?? "-").padEnd(6),
    `${entry.correct}/30`.padStart(5), elapsed.padStart(7), date].join("  ");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const boardIndex = args.indexOf("--board");
  const board = args[boardIndex + 1] as keyof typeof BOARDS | undefined;
  if (boardIndex < 0 || !board || !(board in BOARDS)) usage("Name the board with --board production or --board dev.");
  const namespace = BOARDS[board];
  const rest = args.filter((_, index) => index !== boardIndex && index !== boardIndex + 1);
  if (rest.includes("--reindex")) {
    console.log(`Re-ranked ${await reindexBoard(namespace)} row(s) on the ${board} board.`);
    return;
  }
  const entries = await listBoardEntries(namespace);
  const ranked = entries.map((entry, index) => ({ entry, rank: index + 1 }));

  if (rest.includes("--list")) {
    console.log(`${board} board: ${entries.length} rows`);
    for (const { entry, rank } of ranked) console.log(row(entry, rank));
    return;
  }
  const target = rest.find((arg) => !arg.startsWith("--"));
  if (!target) usage("Give an id prefix or a nickname, or --list.");
  const matches = ranked.filter(({ entry }) =>
    entry.nickname === target || (target.length >= 8 && entry.id.startsWith(target)));
  if (matches.length === 0) {
    console.log(`No row on the ${board} board matches "${target}".`);
    return;
  }
  for (const { entry, rank } of matches) console.log(row(entry, rank));
  if (!rest.includes("--yes")) {
    console.log(`${matches.length} row(s) match. Run again with --yes to remove them.`);
    return;
  }
  for (const { entry } of matches) await removeLeaderboardEntry(namespace, entry);
  console.log(`Removed ${matches.length} row(s) from the ${board} board.`);
}

main().catch((error: unknown) => {
  // Network errors can include data; print only our transport's safe errors.
  const message = error instanceof Error && /^(Set KV_|KV_REST_API_URL|Upstash Redis|Redis is only)/.test(error.message)
    ? error.message
    : "The command failed. Check Redis credentials and connectivity.";
  console.error(`Leaderboard: ${message}`);
  process.exitCode = 1;
});
