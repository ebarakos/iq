/**
 * Relay multimodal passthrough smoke test (Phase C gate).
 *
 *   npm run agent:smoke                                  # all candidate vision models
 *   npm run agent:smoke -- --provider openai --model gpt-4o-mini
 *
 * Sends ONE tiny composed PNG (a bank item) through the relay to each candidate
 * vision model and prints a pass/fail table. PASS = a non-error response that
 * contains any parseable A–F letter. Per-model errors are caught and printed so
 * one dead model does not abort the rest.
 *
 * The relay is /v1/chat/completions-only and has only ever been exercised with
 * string content — this confirms image content parts pass through before the
 * full harness depends on them.
 */
import { parseArgs } from "node:util";
import { loadBank } from "../src/items/bank";
import { solveItem, SOLVER_PROMPT_VERSION } from "../src/lib/solver";

/** Candidate vision models (provider, model) from the approved list. */
const CANDIDATES: { provider: string; model: string }[] = [
  { provider: "openrouter", model: "google/gemini-3-flash-preview" },
  { provider: "openai", model: "gpt-4o-mini" },
  { provider: "openai", model: "gpt-4.1-mini" },
  { provider: "groq", model: "meta-llama/llama-4-scout-17b-16e-instruct" },
];

const { values: args } = parseArgs({
  options: {
    provider: { type: "string" },
    model: { type: "string" },
  },
});

function truncate(s: string, n = 120): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n)}…` : clean;
}

async function main() {
  const targets =
    args.provider && args.model
      ? [{ provider: args.provider, model: args.model }]
      : CANDIDATES;

  // Smallest available item keeps the test image tiny and cheap.
  const bank = loadBank();
  const item = [...bank].sort((a, b) => a.puzzle.options.length - b.puzzle.options.length)[0];
  if (!item) throw new Error("bank is empty — cannot smoke test");

  console.log(`smoke test (prompt ${SOLVER_PROMPT_VERSION}) on item ${item.puzzle.id} (${item.puzzle.type})\n`);

  const rows: { target: string; pass: boolean; detail: string }[] = [];
  for (const { provider, model } of targets) {
    const target = `${provider} / ${model}`;
    try {
      const outcome = await solveItem(item.puzzle, "image", { provider, model });
      const pass = outcome.chosen !== null;
      rows.push({
        target,
        pass,
        detail: `${outcome.latencyMs}ms · chose ${outcome.chosen ?? "—"} · "${truncate(outcome.raw)}"`,
      });
    } catch (err) {
      rows.push({ target, pass: false, detail: `ERROR: ${truncate(err instanceof Error ? err.message : String(err))}` });
    }
  }

  console.log("result  model                                                    detail");
  console.log("------  -------------------------------------------------------  ------");
  for (const r of rows) {
    console.log(`${r.pass ? "PASS" : "FAIL"}    ${r.target.padEnd(55)}  ${r.detail}`);
  }

  const passed = rows.filter((r) => r.pass).length;
  console.log(`\n${passed}/${rows.length} models passed`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
