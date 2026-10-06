import { answerKeyItems } from "@/lib/quiz-token";
import {
  loadLinkTest,
  OPTION_LETTERS,
  parseLinkAnswers,
  puzzleImagePath,
  questionPath,
  resultPath,
} from "@/lib/link-test";
import { submitQuizOnce, SubmissionConflictError } from "@/lib/leaderboard";
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
  const { token } = await params;
  const { a } = await searchParams;

  let loaded;
  try {
    loaded = loadLinkTest(token);
  } catch (error) {
    return <LinkProblem error={error} />;
  }
  const { test, puzzles } = loaded;
  const answers = parseLinkAnswers(a);
  if (!answers || answers.length !== puzzles.length) {
    const resume = answers && answers.length < puzzles.length
      ? questionPath(token, answers.length + 1, answers)
      : questionPath(token, 1, []);
    return (
      <LinkPage profile={test.profile}>
        <h1 className="mt-4 text-2xl font-semibold">This test is not finished</h1>
        <p className="mt-3 text-gray-700">
          A result needs one answer or skip for each of the {puzzles.length} questions.{" "}
          <a className="underline" href={resume}>Continue the test</a>.
        </p>
      </LinkPage>
    );
  }

  let scored;
  try {
    scored = await submitQuizOnce(token, {
      version: 1,
      issuedAt: test.issuedAt,
      expiresAt: test.expiresAt,
      answerDeadline: test.answerDeadline,
      appVersion: test.appVersion,
      leaderboardAllowed: test.leaderboardAllowed,
      leaderboardScope: test.leaderboardScope,
      items: answerKeyItems(puzzles),
    }, answers, Math.floor(Date.now() / 1000));
  } catch (error) {
    const conflict = error instanceof SubmissionConflictError;
    return (
      <LinkPage profile={test.profile}>
        <h1 className="mt-4 text-2xl font-semibold">{conflict ? "This test was already submitted" : "Scoring is temporarily unavailable"}</h1>
        <p className="mt-3 text-gray-700">
          {conflict ? error.message : "Your answers are kept in this link. Try again to recover your result."}
        </p>
        {!conflict && <p className="mt-4"><a className="underline" href={resultPath(token, answers)}>Retry submission</a></p>}
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
      {scored.late && (
        <p className="mt-2 text-amber-800">
          {`Marked late: these answers arrived ${scored.secondsLate} seconds after the deadline ` +
            `of ${clockTime(test.answerDeadline)}. They are still scored.`}
        </p>
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
