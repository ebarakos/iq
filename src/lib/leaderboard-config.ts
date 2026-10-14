/** Development only by default; deployments require an explicit opt-in. */
export function leaderboardEnabled(): boolean {
  const flag = process.env.LEADERBOARD_ENABLED;
  if (flag !== undefined) return flag === "true";
  return process.env.NODE_ENV === "development" && !process.env.VERCEL && !process.env.VERCEL_ENV;
}

/** Testing stays on dev until production explicitly opts in. Previews always use dev. */
export function leaderboardEnvironment(): "dev" | "production" {
  return process.env.LEADERBOARD_ENV === "production" && process.env.VERCEL_ENV === "production"
    ? "production" : "dev";
}

export function leaderboardLabel(): string {
  return leaderboardEnvironment() === "dev" ? "Dev leaderboard" : "Leaderboard";
}

/** Reuse the existing local board for all dev/testing/staging attempts. */
export function leaderboardNamespace(): string {
  return leaderboardEnvironment() === "production" ? "aiq:production" : "aiq:local";
}

/** Tokens and single-use receipts follow the deployment, independently of the selected board. */
export function quizNamespace(): string {
  return process.env.VERCEL_ENV === "production" ? "aiq:production" : "aiq:local";
}
