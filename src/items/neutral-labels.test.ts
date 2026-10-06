import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { assembleExpandedQuiz } from "./expanded-quiz";
import { CURRENT_FAMILY_PROMOTION_REGISTRY } from "./family-promotion";
import { SceneGraphic, StemView } from "./render";

/**
 * The accessibility tree is text. A label that describes a board — its
 * shapes, fills, sizes, turns, places or a gate's textures — lets a reader
 * solve the puzzle without looking, so every label the puzzle draws must be
 * one of these, each naming no more than the layout the picture shows
 * (docs/plans/link-only-test.md).
 */
const NEUTRAL_LABELS = [
  /^board$/,
  /^blank: the cell to solve$/,
  /^machine: jigsaw piece$/,
  /^machine: \d+ jigsaw pieces snapped together$/,
  /^3 by 3 grid with an arrow before the third board of every row$/,
  /^Machine rows: a board, an arrow, jigsaw pieces, an arrow, a board$/,
  /^Analogy: two rows, each a board, an arrow and a board; the last board is missing$/,
  /^Sequence: pictures in numbered order, ending with the missing one$/,
];

describe("puzzle labels", () => {
  it.each(["neutral-labels-1", "neutral-labels-2", "neutral-labels-3"])(
    "never describe what a board shows (%s)",
    (seed) => {
      const quiz = assembleExpandedQuiz(seed, "long-30", CURRENT_FAMILY_PROMOTION_REGISTRY);
      const seen = new Set<string>();
      for (const puzzle of quiz) {
        const markup = [
          renderToStaticMarkup(createElement(StemView, { puzzle })),
          ...puzzle.options.map((scene) => renderToStaticMarkup(createElement(SceneGraphic, { scene }))),
        ].join("");
        for (const [, label] of markup.matchAll(/aria-label="([^"]*)"/g)) seen.add(label);
      }
      expect(seen.size).toBeGreaterThan(0);
      for (const label of seen) {
        expect(NEUTRAL_LABELS.some((pattern) => pattern.test(label)), label).toBe(true);
      }
    },
  );
});
