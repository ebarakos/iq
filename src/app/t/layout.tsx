import type { Metadata } from "next";

/**
 * The link test's pages: kept out of search results and out of crawlers' link
 * walks, but not blocked in `robots.txt`, because some chat fetchers obey it and
 * the pages exist for them (docs/plans/link-only-test.md).
 */
export const metadata: Metadata = {
  title: "IQ visual reasoning gym — test",
  robots: { index: false, follow: false },
};

export default function LinkTestLayout({ children }: { children: React.ReactNode }) {
  return children;
}
