import type { ExpandedProfile } from "@/items/expanded-quiz";
import { LinkTestError, startPath } from "@/lib/link-test";

/**
 * Shared pieces of the link test's pages. Plain links and text only: these
 * pages are for a reader that fetches pages, follows links, and runs no
 * JavaScript (docs/plans/link-only-test.md).
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
      className="inline-block rounded-lg bg-gray-900 px-5 py-2.5 font-medium text-white hover:bg-gray-700"
    >
      {children}
    </a>
  );
}

/** What a reader sees when a test link cannot be used, and where to go instead. */
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
