import { NextResponse } from "next/server";
import { PrototypePilotRefusal, type PrototypePilotRefusalReason } from "@/items/prototype-pilot";

/**
 * Shared HTTP shell for the two pilot endpoints.
 *
 * It exists so both routes hide themselves and phrase a refusal identically. A
 * copy per route is one edit away from drifting, and a refusal that says more
 * on one endpoint than the other is exactly the leak these endpoints close.
 */

/** Production hides the whole pilot surface unless it is explicitly enabled. */
export function prototypesDisabled(): boolean {
  return process.env.NODE_ENV === "production" && process.env.ENABLE_SCENE_PROTOTYPES !== "1";
}

export function notFoundResponse(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

/**
 * 400 means "this request is wrong"; 409 means "the request is well formed but
 * the sitting is not in a state that can answer it". The split matters to the
 * pilot page, which retries nothing but explains a 409 to the participant.
 */
const REFUSAL_STATUS: Record<PrototypePilotRefusalReason, number> = {
  "unknown-item": 400,
  "unknown-sitting": 409,
  "content-drift": 409,
  "not-started": 409,
  "already-recorded": 409,
};

/**
 * Turn any failure into a response that explains itself and says nothing about
 * the answer: no `correct`, no `explanation`, no solve time — only a message
 * and, for a refusal, the machine-readable reason the page shows the person.
 */
export function refusalResponse(error: unknown): NextResponse {
  if (error instanceof PrototypePilotRefusal) {
    return NextResponse.json(
      { error: error.message, reason: error.reason },
      { status: REFUSAL_STATUS[error.reason] },
    );
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Invalid pilot request" },
    { status: 400 },
  );
}
