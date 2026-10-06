/** Public rows contain no quiz tokens, answers or internal puzzle data. */
export interface LeaderboardEntry {
  id: string;
  nickname: string;
  points: number;
  correct: number;
  total: 30;
  elapsedSeconds: number;
  appVersion: string;
  submittedAt: number;
}
