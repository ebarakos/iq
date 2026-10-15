import { join } from "node:path";
import type { Puzzle, PublicPuzzle } from "./schema";
import { pictureToSvg, puzzleToSvg } from "./compose-image";
import type { PicturePart } from "./picture-puzzle";

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

async function rasterize(svg: string): Promise<Uint8Array> {
  // A native module, imported lazily to keep it out of anything that only imports this one.
  const { Resvg } = await import("@resvg/resvg-js");
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

/**
 * Rasterize the agent channel's standalone puzzle SVG (stem plus options
 * lettered A–F) to PNG bytes.
 */
export async function puzzleToPng(
  puzzle: Puzzle | PublicPuzzle,
  options: { optionsOnly?: boolean } = {},
): Promise<Uint8Array> {
  return rasterize(puzzleToSvg(puzzle, options));
}

/** One served picture of a question as PNG bytes, or null when it has no such part. */
export async function pictureToPng(puzzle: Puzzle, part: PicturePart): Promise<Uint8Array | null> {
  const svg = pictureToSvg(puzzle, part);
  return svg === null ? null : rasterize(svg);
}
