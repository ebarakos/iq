import { NextResponse } from "next/server";
import { z } from "zod";
import { startPrototypePilotItem } from "@/items/prototype-pilot";
import { notFoundResponse, prototypesDisabled, refusalResponse } from "../refusals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The handshake that makes the pilot's solve times server-derived.
 *
 * The browser says "the participant is looking at this item now" and the server
 * writes down when that was. Nothing about the time comes from the request: a
 * client cannot start a clock early, late, or twice, because the first stamp on
 * an item is the one that counts.
 */
const RequestSchema = z.object({
  sittingId: z.string().regex(/^[0-9a-f]{32}$/, "a sitting id is 32 hexadecimal characters"),
  itemId: z.string().min(1).max(200),
  contentFingerprint: z.string().regex(/^[0-9a-f]{16}$/, "a content fingerprint is 16 hexadecimal characters"),
}).strict();

/**
 * POST /api/prototypes/start — record that one pilot item has been shown.
 *
 * Request body: `{ sittingId, itemId, contentFingerprint }`.
 * Response 200: `{ started: true, alreadyStarted, timeBudgetSeconds }`.
 * Response 400: `{ error }` — malformed body, or an item this sitting is not
 * serving (`reason: "unknown-item"`).
 * Response 409: `{ error, reason }` — `unknown-sitting` (restarted or expired),
 * `content-drift` (the page is showing other content than the sitting froze),
 * or `already-recorded` (the item has been graded).
 * Response 404: `{ error }` — production without `ENABLE_SCENE_PROTOTYPES=1`.
 */
export async function POST(request: Request) {
  if (prototypesDisabled()) return notFoundResponse();
  try {
    return NextResponse.json(startPrototypePilotItem(RequestSchema.parse(await request.json())));
  } catch (error) {
    return refusalResponse(error);
  }
}
