import { NextResponse } from "next/server";
import { z } from "zod";
import { gradePrototypePilotSittingAnswer } from "@/items/prototype-pilot";
import { OPTIONS_PER_ITEM } from "@/items/schema";
import { notFoundResponse, prototypesDisabled, refusalResponse } from "../refusals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The pilot's grading request.
 *
 * `elapsedSeconds` is the browser's own stopwatch reading and decides nothing.
 * The solve time the pilot records, and the late marker, come from the stamp
 * `/api/prototypes/start` wrote when the item was shown. The reading is still
 * asked for because a disagreement between the two clocks is worth seeing: it
 * comes back in the response so the moderator is told rather than the server
 * quietly winning. The upper bound is a day — long enough that no honest
 * sitting hits it, short enough that a broken client cannot post a nonsense
 * number.
 */
const RequestSchema = z.object({
  sittingId: z.string().regex(/^[0-9a-f]{32}$/, "a sitting id is 32 hexadecimal characters"),
  itemId: z.string().min(1).max(200),
  contentFingerprint: z.string().regex(/^[0-9a-f]{16}$/, "a content fingerprint is 16 hexadecimal characters"),
  selectedOption: z.number().int().min(0).max(OPTIONS_PER_ITEM - 1),
  elapsedSeconds: z.number().int().min(0).max(86_400),
}).strict();

/**
 * POST /api/prototypes/answer — grade one pilot answer, once, without ever
 * sending the answer key to the browser.
 *
 * Request body: `{ sittingId, itemId, contentFingerprint, selectedOption, elapsedSeconds }`.
 * Response 200: `{ correct, explanation, late, timeBudgetSeconds, elapsedSeconds,
 * clientElapsedSeconds, clientTimingDisagreementSeconds, clientTimingDisagrees }`,
 * where `elapsedSeconds` is the server's measurement and `clientElapsedSeconds`
 * is the browser's, echoed for comparison only.
 * Response 400: `{ error }` — malformed body, an option outside the item's
 * option list, or an item this sitting is not serving (`reason: "unknown-item"`).
 * Response 409: `{ error, reason }` — `unknown-sitting`, `content-drift`,
 * `not-started` (no server stamp for this item), or `already-recorded` (this
 * item has been graded once already). A refusal never says whether an answer
 * was correct.
 * Response 404: `{ error }` — production without `ENABLE_SCENE_PROTOTYPES=1`.
 */
export async function POST(request: Request) {
  if (prototypesDisabled()) return notFoundResponse();
  try {
    const body = RequestSchema.parse(await request.json());
    return NextResponse.json(gradePrototypePilotSittingAnswer({
      sittingId: body.sittingId,
      itemId: body.itemId,
      contentFingerprint: body.contentFingerprint,
      selectedOption: body.selectedOption,
      clientElapsedSeconds: body.elapsedSeconds,
    }));
  } catch (error) {
    return refusalResponse(error);
  }
}
