import { leaderboardEnabled, leaderboardLabel } from "@/lib/leaderboard-config";
import Quiz from "./quiz";

export const dynamic = "force-dynamic";

export default function Page() {
  return <Quiz leaderboardEnabled={leaderboardEnabled()} leaderboardLabel={leaderboardLabel()} />;
}
