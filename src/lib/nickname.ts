import { englishDataset, englishRecommendedTransformers, RegExpMatcher } from "obscenity";
import { NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from "./leaderboard-types";

/**
 * Nickname rules for the leaderboard (docs/plans/leaderboard-integrity.md).
 *
 * A name is shown publicly, so it is normalized, kept to plain characters, and
 * checked for profanity. Every refusal says what to change, never which word
 * matched: naming the word would only teach the way around it.
 */

/** Letters, digits, spaces and `. - _ ' : |`; nothing invisible or text-reversing. */
const ALLOWED = /^[\p{L}\p{N} .\-_':|]+$/u;
const HAS_LETTER = /\p{L}/u;
/** Something that reads as a web address: "word.com", "www.", "http". */
const WEB_ADDRESS = /(?:https?|www\.)|\p{L}\.(?:[a-z]{2,})(?:$|[\s.\-_':|])/iu;
/**
 * Hate terms the profanity list does not cover, matched against whole words so
 * ordinary names that contain the letters (Ignazio, Nazir) pass.
 */
const EXTRA_BLOCKED_WORD = /^(?:(?:neo)?nazis?\d*|hitler\p{L}*|kkk\d*)$/u;

/** A name's words, split at separators and at camelCase joins ("NaziFan" is two). */
function words(nickname: string): string[] {
  return nickname.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").toLowerCase().split(/[ .\-_':|]+/).filter(Boolean);
}

function hasBlockedWord(nickname: string): boolean {
  const parts = words(nickname);
  // Spaced-out letters ("n a z i") read as one word.
  const spelled = parts.every((part) => [...part].length === 1) ? [parts.join("")] : [];
  return [...parts, ...spelled, parts.join("")].some((word) => EXTRA_BLOCKED_WORD.test(word));
}

const CHARACTERS_MESSAGE = "Use letters, numbers, spaces and . - _ ' : | only, with at least one letter.";

const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

export type NicknameCheck = { ok: true; nickname: string } | { ok: false; message: string };

export function checkNickname(raw: unknown): NicknameCheck {
  if (typeof raw !== "string") return { ok: false, message: "Enter a nickname." };
  // Control and invisible characters are refused before spaces collapse, or a
  // newline would quietly become a space.
  if (/[\p{Cc}\p{Cf}]/u.test(raw.trim())) return { ok: false, message: CHARACTERS_MESSAGE };
  const nickname = raw.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const length = [...nickname].length;
  if (length < NICKNAME_MIN_LENGTH || length > NICKNAME_MAX_LENGTH) {
    return {
      ok: false,
      message: `Enter a nickname between ${NICKNAME_MIN_LENGTH} and ${NICKNAME_MAX_LENGTH} characters.`,
    };
  }
  if (!ALLOWED.test(nickname) || !HAS_LETTER.test(nickname)) {
    return { ok: false, message: CHARACTERS_MESSAGE };
  }
  if (WEB_ADDRESS.test(nickname)) {
    return { ok: false, message: "A nickname cannot be a web address." };
  }
  // Spaced-out letters ("f u c k") get past the matcher, so check the joined form too.
  const joined = nickname.replace(/[ .\-_':|]/g, "");
  if (matcher.hasMatch(nickname) || matcher.hasMatch(joined) || hasBlockedWord(nickname)) {
    return { ok: false, message: "Choose a different nickname. This one is not allowed on the leaderboard." };
  }
  return { ok: true, nickname };
}
