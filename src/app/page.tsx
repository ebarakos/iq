import { headers } from "next/headers";
import { leaderboardEnabled, leaderboardLabel } from "@/lib/leaderboard-config";
import Quiz from "./quiz";

export const dynamic = "force-dynamic";

/** This site's own address, so the note for AI agents can print full start links. */
async function siteOrigin(): Promise<string> {
  const request = await headers();
  const host = request.get("x-forwarded-host") ?? request.get("host");
  if (!host) return "";
  const protocol = request.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${protocol}://${host}`;
}

export default async function Page() {
  return (
    <Quiz
      leaderboardEnabled={leaderboardEnabled()}
      leaderboardLabel={leaderboardLabel()}
      siteOrigin={await siteOrigin()}
    />
  );
}
