import { join } from "node:path";
import type { Puzzle, PublicPuzzle } from "./schema";
import { puzzleToSvg } from "./compose-image";

/**
 * The bundled Latin subsets of Noto Sans (`src/app/fonts`, OFL). The image's
 * only text is the option letters, the sequence numbers and the "?", and a
 * server has no system fonts to fall back on, so these are the fonts it draws
 * with everywhere: the agent harness, `render:item`, and the link test's
 * puzzle image all get the same pixels.
 */
const FONT_FILES = [
  "src/app/fonts/NotoSans-Regular-latin.ttf",
  "src/app/fonts/NotoSans-ExtraBold-latin.ttf",
].map((file) => join(process.cwd(), file));

/**
 * Rasterize the agent channel's standalone puzzle SVG (stem plus options
 * lettered A–F) to PNG bytes.
 *
 * `@resvg/resvg-js` is imported lazily: it is a native module, and this keeps
 * it out of the graph of anything that only imports the module.
 */
export async function puzzleToPng(
  puzzle: Puzzle | PublicPuzzle,
  options: { optionsOnly?: boolean } = {},
): Promise<Uint8Array> {
  const { Resvg } = await import("@resvg/resvg-js");
  const svg = puzzleToSvg(puzzle, options);
  const resvg = new Resvg(svg, {
    font: {
      loadSystemFonts: false,
      fontFiles: FONT_FILES,
      defaultFontFamily: "Noto Sans",
      sansSerifFamily: "Noto Sans",
    },
  });
  return resvg.render().asPng();
}
