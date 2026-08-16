import { notFound } from "next/navigation";
import { buildPrototypePilotQuestions } from "@/items/prototype-pilot";
import { PrototypePilot } from "./prototype-pilot";

export const dynamic = "force-dynamic";

/** Development/pilot surface; never part of the normal scored test. */
export default function PrototypePage() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_SCENE_PROTOTYPES !== "1") {
    notFound();
  }

  return <PrototypePilot items={buildPrototypePilotQuestions()} />;
}
