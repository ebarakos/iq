/** Who took a published test, as the publisher declared it. It cannot be verified. */
export const TAKER_KINDS = ["person", "agent"] as const;
export type TakerKind = (typeof TAKER_KINDS)[number];

/** Shared by the publication forms and server-side nickname validation. */
export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 64;

/** Points describe accuracy; speed only breaks leaderboard ties. Shared by both result views. */
export function leaderboardPoints(correct: number): number {
  return 100 * correct;
}

/** Public rows contain no quiz tokens, answers or internal puzzle data. */
export interface LeaderboardEntry {
  id: string;
  nickname: string;
  /** Absent on rows published before the tag existed. */
  kind?: TakerKind;
  points: number;
  correct: number;
  total: 30;
  elapsedSeconds: number;
  appVersion: string;
  submittedAt: number;
}

/**
 * Shortcut names for agents that can only follow existing links. Custom names
 * use /publish/custom?nickname=… instead. The key is the link's path segment.
 */
export const AGENT_NAMES = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  grok: "Grok",
  copilot: "Copilot",
  perplexity: "Perplexity",
  deepseek: "DeepSeek",
  "meta-ai": "Meta AI",
  mistral: "Mistral",
  other: "Other AI agent",
} as const satisfies Record<string, string>;
export type AgentSlug = keyof typeof AGENT_NAMES;

export function agentName(slug: string): string | null {
  return Object.hasOwn(AGENT_NAMES, slug) ? AGENT_NAMES[slug as AgentSlug] : null;
}
