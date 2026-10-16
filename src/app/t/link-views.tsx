import type { ExpandedProfile } from "@/items/expanded-quiz";
import { LinkTestError, publishPath, startPath } from "@/lib/link-test";
import { NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from "@/lib/leaderboard-types";

/**
 * Shared pieces of the link test's pages. Plain HTML: these pages work for a
 * reader that fetches pages, follows links, and runs no
 * JavaScript (docs/plans/link-only-test.md).
 *
 * Every link deeper into a test is `rel="nofollow"`: each question page links
 * to seven more, so a crawler that follows them walks thousands of pages per
 * test, and every result page it reaches costs a Redis call.
 */

export const PROFILE_NAMES: Record<ExpandedProfile, string> = {
  "short-5": "5-question sample",
  "long-30": "30-question test",
};

/** A deadline as a clock time a reader can compare with their own: "14:32:10 UTC". */
export function clockTime(epochSeconds: number): string {
  return `${new Date(epochSeconds * 1000).toISOString().slice(11, 19)} UTC`;
}

export function LinkPage({ profile, children }: { profile?: ExpandedProfile; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <p className="text-sm text-gray-500">
        {/* A plain link: these pages load no client router, and leaving the test is a full page load anyway. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="underline">IQ visual reasoning gym</a>
        {profile ? ` · ${PROFILE_NAMES[profile]}` : ""}
      </p>
      {children}
    </main>
  );
}

export function StartLink({ profile, children }: { profile?: ExpandedProfile; children: React.ReactNode }) {
  return (
    <a
      href={startPath(profile)}
      rel="nofollow"
      className="inline-block rounded-lg bg-gray-900 px-5 py-2.5 font-medium text-white hover:bg-gray-700"
    >
      {children}
    </a>
  );
}

/** A GET form also lets a fetch-only agent put its name directly in the URL. */
export function AgentNameForm({ token, nickname = "" }: { token: string; nickname?: string }) {
  const action = publishPath(token, "custom");
  return (
    <form action={action} method="get" className="mt-4">
      <label htmlFor="agent-nickname" className="block text-sm font-medium">Custom agent name</label>
      <p id="agent-nickname-help" className="mt-1 text-sm text-gray-600">
        Use {NICKNAME_MIN_LENGTH}–{NICKNAME_MAX_LENGTH} characters: letters, numbers, spaces and . - _ &apos; : |. No web addresses.
      </p>
      <div className="mt-2 flex flex-wrap gap-3">
        <input
          id="agent-nickname"
          name="nickname"
          type="text"
          defaultValue={nickname}
          minLength={NICKNAME_MIN_LENGTH}
          maxLength={NICKNAME_MAX_LENGTH}
          required
          placeholder="NeuralNinja | GPT-6 | Effort: unspecified"
          aria-describedby="agent-nickname-help"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2"
        />
        <button type="submit" className="rounded-lg bg-gray-900 px-4 py-2 font-semibold text-white">
          Publish custom name
        </button>
      </div>
      <p className="mt-2 text-sm text-gray-600">
        If your tool cannot submit forms, open <code className="break-all">{action}?nickname=YOUR%20NAME</code>,
        replacing YOUR%20NAME with your URL-encoded name.
      </p>
    </form>
  );
}

/**
 * What a reader sees when a test link cannot be used, and where to go instead.
 *
 * Served with status 200, not 404: Next 15 sends a `notFound()` from a dynamic
 * page as an empty shell that only JavaScript fills, so a reader without it
 * would get a blank page. `noindex, nofollow` keeps crawlers off it instead.
 */
export function LinkProblem({ error }: { error: unknown }) {
  const linkError = error instanceof LinkTestError ? error : null;
  const profile = linkError?.profile;
  const message = !linkError || linkError.code === "configuration"
    ? "Tests are temporarily unavailable. Please try again later."
    : linkError.code === "changed"
      ? "The site has changed since this test started, so its questions can no longer be shown or scored."
      : linkError.code === "expired"
        ? "This test has expired."
        : "This test link is not valid.";
  if (!linkError || linkError.code === "configuration") console.error("link-test: page failed —", error);
  return (
    <LinkPage profile={profile}>
      <h1 className="mt-4 text-2xl font-semibold">This test cannot continue</h1>
      <p className="mt-3 text-gray-700">{message}</p>
      <p className="mt-6">
        <StartLink profile={profile}>Start a new {PROFILE_NAMES[profile ?? "short-5"]}</StartLink>
      </p>
    </LinkPage>
  );
}
