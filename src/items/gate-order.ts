import { sceneSignature, type Scene } from "./schema";

/**
 * How much a gate question's answer depends on the ORDER of its gates
 * (docs/plans/harden-reasoning.md, section 1).
 *
 * A three-gate question is only as deep as the interactions between its gates.
 * When two gates commute, running them in either order gives the same board,
 * and the solver never has to track the state the first one creates. These
 * counts make that visible per item instead of per grammar.
 */

/** What changing a run did to its board: another valid board, the same board, or no board at all. */
export type GateRunChange = "different" | "same" | "undefined";

export interface GateOrderOutcome {
  gateCount: number;
  /** How many of the gateCount! orders run end to end. */
  validOrders: number;
  /** Distinct boards across every order that runs, the shown one included. */
  distinctValidOutputs: number;
  /** Swapping each adjacent pair of the shown order, first pair first. */
  adjacentSwaps: GateRunChange[];
  /**
   * Leaving out each shown gate (single-gate ablation), in shown order. "same"
   * means that gate was not needed; "undefined" means the shorter run cannot
   * apply, which is not the same as reaching an applicable wrong board.
   */
  ablations: GateRunChange[];
}

function permutations(items: readonly number[]): number[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((head, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((tail) => [head, ...tail]));
}

/**
 * Run the question's gates in every order, and with each adjacent pair swapped
 * or each gate left out, against the board the shown order produces.
 *
 * `shownOrder` is the order the question asks for, as gate indexes; `run`
 * applies the gates in a given order to the question's board and returns null
 * when some gate cannot apply.
 */
export function gateOrderOutcome(
  shownOrder: readonly number[],
  run: (order: readonly number[]) => Scene | null,
): GateOrderOutcome {
  const answer = run(shownOrder);
  if (!answer) throw new Error("the shown gate order must run end to end");
  const answerKey = sceneSignature(answer);
  const change = (order: readonly number[]): GateRunChange => {
    const board = run(order);
    if (!board) return "undefined";
    return sceneSignature(board) === answerKey ? "same" : "different";
  };

  const outputs = new Set<string>();
  let validOrders = 0;
  for (const order of permutations(shownOrder)) {
    const board = run(order);
    if (!board) continue;
    validOrders++;
    outputs.add(sceneSignature(board));
  }

  const adjacentSwaps = shownOrder.slice(0, -1).map((_, position) => {
    const swapped = [...shownOrder];
    [swapped[position], swapped[position + 1]] = [swapped[position + 1], swapped[position]];
    return change(swapped);
  });
  const ablations = shownOrder.map((gate) => change(shownOrder.filter((other) => other !== gate)));

  return {
    gateCount: shownOrder.length,
    validOrders,
    distinctValidOutputs: outputs.size,
    adjacentSwaps,
    ablations,
  };
}

/** True when every adjacent swap of the shown order reaches a different valid board. */
export function everyAdjacentSwapMatters(outcome: GateOrderOutcome): boolean {
  return outcome.adjacentSwaps.every((swap) => swap === "different");
}
