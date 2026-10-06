/** Development only by default; deployments require an explicit opt-in. */
export function leaderboardEnabled(): boolean {
  const flag = process.env.LEADERBOARD_ENABLED;
  if (flag !== undefined) return flag === "true";
  return process.env.NODE_ENV === "development" && !process.env.VERCEL && !process.env.VERCEL_ENV;
}

/** Local attempts never populate a deployed leaderboard. */
export function leaderboardNamespace(): string {
  const environment = process.env.VERCEL_ENV ?? (process.env.VERCEL ? "deployment" : "local");
  return `aiq:${environment}`;
}
