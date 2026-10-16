import { randomBytes } from "node:crypto";
import {
  linkTestLength,
  openLinkToken,
  OPTION_LETTERS,
  parseLinkAnswers,
  publishPath,
  puzzleImagePath,
  questionPath,
  resultPath,
} from "@/lib/link-test";
import { MIN_RANKED_SECONDS, SubmissionConflictError } from "@/lib/leaderboard";
import { scoreLinkResult } from "@/lib/link-result";
import { leaderboardEnabled } from "@/lib/leaderboard-config";
import { AGENT_NAMES } from "@/lib/leaderboard-types";
import { clockTime, LinkPage, LinkProblem, PROFILE_NAMES, StartLink } from "../../link-views";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ a?: string | string[] }>;
};

/**
 * GET /t/<token>/result?a=<every answer> — scores the answers in the link on
 * the server, with the same scorer as `POST /api/submit`, and shows the review.
 */
export default async function LinkResultPage({ params, searchParams }: Props) {
  const receivedAt = Math.floor(Date.now() / 1000);
  const { token } = await params;
  const { a } = await searchParams;

  let test;
  try {
    test = openLinkToken(token);
  } catch (error) {
    return <LinkProblem error={error} />;
  }
  const total = linkTestLength(test);
  const answers = parseLinkAnswers(a);
  if (!answers || answers.length !== total) {
    const resume = answers && answers.length < total
      ? questionPath(token, answers.length + 1, answers)
      : questionPath(token, 1, []);
    return (
      <LinkPage profile={test.profile}>
        <h1 className="mt-4 text-2xl font-semibold">This test is not finished</h1>
        <p className="mt-3 text-gray-700">
          A result needs one answer or skip for each of the {total} questions.{" "}
          <a className="underline" rel="nofollow" href={resume}>Continue the test</a>.
        </p>
      </LinkPage>
    );
  }

  let scored;
  try {
    const step = await scoreLinkResult(token, test, answers, receivedAt);
    if (!("scored" in step)) {
      return (
        <LinkPage profile={test.profile}>
          <h1 className="mt-4 text-2xl font-semibold">Calculating your result</h1>
          <p className="mt-3 text-gray-700">
            Your answers have been received. {step.built} of {total} questions checked.
            Your finish time is already recorded.
          </p>
          <p className="mt-4">
            <a className="underline" rel="nofollow" href={resultPath(token, answers, step.built)}>Continue to your result</a>
          </p>
        </LinkPage>
      );
    }
    scored = step.scored;
  } catch (error) {
    const conflict = error instanceof SubmissionConflictError;
    return (
      <LinkPage profile={test.profile}>
        <h1 className="mt-4 text-2xl font-semibold">{conflict ? "This test was already submitted" : "Scoring is temporarily unavailable"}</h1>
        <p className="mt-3 text-gray-700">
          {conflict ? error.message : "Your answers are kept in this link. Try again to recover your result."}
        </p>
        {!conflict && <p className="mt-4"><a className="underline" rel="nofollow" href={resultPath(token, answers, `retry-${randomBytes(8).toString("base64url")}`)}>Retry submission</a></p>}
        <p className="mt-6"><StartLink profile={test.profile}>Start a new {PROFILE_NAMES[test.profile]}</StartLink></p>
      </LinkPage>
    );
  }
  return (
    <LinkPage profile={test.profile}>
      <h1 className="mt-4 text-2xl font-semibold">Your result</h1>
      <p className="mt-3 text-3xl font-semibold">
        {`${scored.score} of ${scored.total} correct`}
      </p>
      {scored.total === 30 && (
        <div className="mt-4">
          <p className="text-2xl font-semibold">{scored.points.toLocaleString("en-US")} points</p>
          <p className="mt-1 text-sm text-gray-600">
            Each correct answer earns 100 points. A time bonus of up to 25% is added to
            your correct-answer points. The earlier you finish, the bigger the bonus.
          </p>
        </div>
      )}
      {scored.late && (
        <p className="mt-2 text-amber-800">
          {`Marked late: these answers arrived ${scored.secondsLate} seconds after the deadline ` +
            `of ${clockTime(test.answerDeadline)}. They are still scored.`}
        </p>
      )}
      {scored.total === 30 && leaderboardEnabled() && (
        <AgentPublication token={token} eligible={scored.leaderboardEligible} late={scored.late} />
      )}
      <h2 className="mt-8 text-xl font-semibold">Review</h2>
      <ol className="mt-4 space-y-8">
        {scored.results.map((result, index) => (
          <li key={result.id}>
            <h3 className="font-semibold">{`Question ${index + 1}`}</h3>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={puzzleImagePath(token, index + 1)}
              alt={`Question ${index + 1} puzzle`}
              width={800}
              loading="lazy"
              className="mt-2 h-auto w-full rounded-xl border border-gray-200 bg-white"
            />
            <p className="mt-2">
              {result.chosen === null ? "Skipped" : `Your answer: ${OPTION_LETTERS[result.chosen]}`}
              {" · "}
              {result.correct ? "correct" : `incorrect; the answer is ${OPTION_LETTERS[result.answerIndex]}`}
            </p>
            <p className="mt-1 text-gray-700">{result.explanation}</p>
          </li>
        ))}
      </ol>
      <p className="mt-8">
        <StartLink profile={test.profile}>Take a new {PROFILE_NAMES[test.profile]}</StartLink>
      </p>
    </LinkPage>
  );
}

/**
 * One publish link per agent name: a reader that only follows links cannot type
 * a name into a form (docs/plans/leaderboard-integrity.md).
 */
function AgentPublication({ token, eligible, late }: { token: string; eligible: boolean; late: boolean }) {
  if (!eligible) {
    return (
      <p className="mt-6 text-gray-700">
        {late
          ? "This result was late, so it cannot join the leaderboard."
          : `Only on-time 30-question tests that took at least ${MIN_RANKED_SECONDS / 60} minutes can join the leaderboard.`}
      </p>
    );
  }
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold">Publish to the leaderboard</h2>
      <p className="mt-2 text-gray-700">
        If you are an AI agent, follow the link with your name to publish this result, tagged AI agent.
        Publishing is optional, and a result can be published once.
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {Object.entries(AGENT_NAMES).map(([slug, name]) => (
          <li key={slug}>
            <a
              href={publishPath(token, slug)}
              rel="nofollow"
              className="inline-block rounded-lg border-2 border-gray-300 bg-white px-4 py-2 font-semibold hover:border-gray-900"
            >
              {`Publish as ${name}`}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
