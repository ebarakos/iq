/**
 * Render bank items to PNG fixtures for eyeball verification (and later ui-qa).
 *
 *   npm run render:item                 # one item per puzzle type
 *   npm run render:item -- --id mx-…     # a specific bank item by id
 *
 * Offline — no relay. Composes each puzzle's standalone SVG (compose-image.tsx)
 * and rasterizes it with @resvg/resvg-js, writing `data/fixtures/<id>.png` and
 * the `.svg` next to it for debugging. Prints the paths.
 */
import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { loadBank, type BankItem } from "../src/items/bank";
import { puzzleToSvg } from "../src/items/compose-image";
import { PUZZLE_TYPES } from "../src/items/schema";

const FIXTURE_DIR = new URL("../data/fixtures/", import.meta.url).pathname;

const { values: args } = parseArgs({
  options: {
    id: { type: "string" },
  },
});

function pickItems(): BankItem[] {
  const bank = loadBank();
  if (args.id) {
    const item = bank.find((i) => i.puzzle.id === args.id);
    if (!item) throw new Error(`no bank item with id "${args.id}"`);
    return [item];
  }
  // One item per type (first available), for a spread of layouts.
  const picked: BankItem[] = [];
  for (const type of PUZZLE_TYPES) {
    const item = bank.find((i) => i.puzzle.type === type);
    if (item) picked.push(item);
  }
  return picked;
}

function render(item: BankItem): { svgPath: string; pngPath: string; pngBytes: number } {
  const svg = puzzleToSvg(item.puzzle);
  const resvg = new Resvg(svg, { font: { loadSystemFonts: true } });
  const png = resvg.render().asPng();

  const svgPath = `${FIXTURE_DIR}${item.puzzle.id}.svg`;
  const pngPath = `${FIXTURE_DIR}${item.puzzle.id}.png`;
  writeFileSync(svgPath, svg);
  writeFileSync(pngPath, png);
  return { svgPath, pngPath, pngBytes: png.length };
}

function main() {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const items = pickItems();
  for (const item of items) {
    const { svgPath, pngPath, pngBytes } = render(item);
    console.log(`${item.puzzle.id} (${item.puzzle.type}, d${item.puzzle.difficulty})`);
    console.log(`  svg: ${svgPath}`);
    console.log(`  png: ${pngPath} (${pngBytes} bytes)`);
  }
  console.log(`\nwrote ${items.length} fixture${items.length === 1 ? "" : "s"} to ${FIXTURE_DIR}`);
}

main();
