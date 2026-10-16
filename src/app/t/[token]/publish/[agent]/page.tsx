import { headers } from "next/headers";
import { LeaderboardEligibilityError, publishLeaderboardEntry } from "@/lib/leaderboard";
import { leaderboardEnabled } from "@/lib/leaderboard-config";
import { agentName } from "@/lib/leaderboard-types";
import { LinkTestError, openLinkToken } from "@/lib/link-test";
import { resolveLinkToken } from "@/lib/link-session";
import { checkNickname } from "@/lib/nickname";
import { clientAddress, withinRateLimit } from "@/lib/rate-limit";
import { AgentNameForm, LinkPage, LinkProblem } from "../../../link-views";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = {
  params: Promise<{ token: string; agent: string }>;
  searchParams: Promise<{ nickname?: string | string[] }>;
};

/**
 * GET /t/<token>/publish/<agent> — publish a link test's saved result under one
 * of the shortcut names, or /publish/custom?nickname=… for a custom name, tagged
 * AI agent. A test has one row; following the link again changes nothing.
 */
export default async function AgentPublishPage({ params, searchParams }: Props) {
  const { token: reference, agent } = await params;
  const rawName = agent === "custom" ? (await searchParams).nickname : agentName(agent);
  if (!leaderboardEnabled() || (agent !== "custom" && !rawName)) {
    return <Notice title="This result cannot be published here" text="The leaderboard is not open, or that name is not one it accepts." />;
  }
  const checked = checkNickname(rawName);
  if (!checked.ok) {
    return (
      <Notice title="This result was not published" text={checked.message}>
        <AgentNameForm token={reference} nickname={typeof rawName === "string" ? rawName : ""} />
      </Notice>
    );
  }
  const name = checked.nickname;
  let token;
  try {
    token = await resolveLinkToken(reference);
    openLinkToken(token);
  } catch (error) {
    // Publication reads only the saved result, so a site change since the test does not matter.
    if (!(error instanceof LinkTestError && error.code === "changed")) return <LinkProblem error={error} />;
  }
  let entry;
  try {
    if (!(await withinRateLimit("publish", clientAddress(await headers())))) {
      return <Notice title="Too many publications" text="Too many scores were published from this address. Try again later." />;
    }
    entry = await publishLeaderboardEntry(token!, name, "agent");
  } catch (error) {
    const text = error instanceof LeaderboardEligibilityError
      ? error.message
      : "The leaderboard could not be reached. Follow the same link again to retry.";
    return <Notice title="This result was not published" text={text} />;
  }
  // The saved row decides what this page says: a result publishes once, possibly
  // earlier and from the in-page form, under another name or tag.
  const same = entry.nickname === name && entry.kind === "agent";
  const tag = entry.kind === "agent" ? ", tagged AI agent" : entry.kind === "person" ? ", tagged Person" : "";
  return (
    <Notice
      title={same ? `Published as ${name}` : "This result was already published"}
      text={same
        ? `${entry.correct} of 30 correct, tagged AI agent.`
        : `It is on the leaderboard as ${entry.nickname}${tag}; a result can be published once.`}
      leaderboard
    />
  );
}

function Notice({ title, text, leaderboard = false, children }: {
  title: string;
  text: string;
  leaderboard?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <LinkPage profile="long-30">
      <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
      <p className="mt-3 text-gray-700">{text}</p>
      {children}
      {leaderboard && (
        <p className="mt-6">
          <a className="underline" href="/leaderboard">See the leaderboard</a>
        </p>
      )}
    </LinkPage>
  );
}
