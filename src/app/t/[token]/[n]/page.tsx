import { notFound, redirect } from "next/navigation";
import { SAMPLE_GUIDES } from "@/items/sample-guides";
import {
  loadLinkTest,
  OPTION_LETTERS,
  parseLinkAnswers,
  puzzleImagePath,
  questionPath,
  resultPath,
} from "@/lib/link-test";
import { clockTime, LinkPage, LinkProblem, PROFILE_NAMES } from "../../link-views";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = {
  params: Promise<{ token: string; n: string }>;
  searchParams: Promise<{ a?: string | string[] }>;
};

/**
 * GET /t/<token>/<n>?a=<answers so far> — one question of a link test: the
 * puzzle as a picture and one link per option, each carrying the answers so
 * far plus its own letter.
 */
export default async function LinkQuestionPage({ params, searchParams }: Props) {
  const { token, n } = await params;
  const { a } = await searchParams;

  let loaded;
  try {
    loaded = loadLinkTest(token);
  } catch (error) {
    return <LinkProblem error={error} />;
  }
  const { test, puzzles } = loaded;
  const total = puzzles.length;
  const number = /^[1-9]\d*$/.test(n) ? Number(n) : NaN;
  if (!(number >= 1 && number <= total)) notFound();

  const answers = parseLinkAnswers(a);
  if (!answers || answers.length > total) {
    return (
      <LinkPage profile={test.profile}>
        <h1 className="mt-4 text-2xl font-semibold">These answers cannot be read</h1>
        <p className="mt-3 text-gray-700">
          The link&apos;s answers are not in the form this test writes them.{" "}
          <a className="underline" href={questionPath(token, 1, [])}>Start this test again from question 1</a>.
        </p>
      </LinkPage>
    );
  }
  // Each page belongs to one point in the test: the answers so far decide which
  // question comes next.
  if (answers.length === total) redirect(resultPath(token, answers));
  if (answers.length !== number - 1) redirect(questionPath(token, answers.length + 1, answers));

  const puzzle = puzzles[number - 1];
  const now = Math.floor(Date.now() / 1000);
  const secondsLeft = test.answerDeadline - now;
  const next = (choice: number | null) => number < total
    ? questionPath(token, number + 1, [...answers, choice])
    : resultPath(token, [...answers, choice]);

  if (secondsLeft <= 0) {
    const padded = [...answers, ...Array<null>(total - answers.length).fill(null)];
    return (
      <LinkPage profile={test.profile}>
        <h1 className="mt-4 text-2xl font-semibold">Time is up</h1>
        <p className="mt-3 text-gray-700">
          The deadline for the whole test was {clockTime(test.answerDeadline)}. Questions not
          answered by then count as incorrect.
        </p>
        <p className="mt-6">
          <a className="underline" href={resultPath(token, padded)}>See your result</a>
        </p>
      </LinkPage>
    );
  }

  const letters = OPTION_LETTERS.slice(0, puzzle.options.length);
  const guide = test.profile === "short-5" ? SAMPLE_GUIDES[puzzle.layout] : undefined;
  return (
    <LinkPage profile={test.profile}>
      <h1 className="mt-4 text-2xl font-semibold">{`Question ${number} of ${total}`}</h1>
      <p className="mt-2 text-gray-700">
        Answer every question by{" "}
        <time dateTime={new Date(test.answerDeadline * 1000).toISOString()}>{clockTime(test.answerDeadline)}</time>.{" "}
        {`${secondsLeft} seconds are left for the whole ${PROFILE_NAMES[test.profile]}.`}
      </p>
      {test.source === "fallback" && (
        <p className="mt-2 text-sm text-gray-600">
          Fresh generation failed, so this test comes from the verified reference set.
        </p>
      )}
      <p className="mt-4 text-gray-700">
        {`The puzzle is the picture below. Find the option, ${letters[0]} to ${letters[letters.length - 1]}, ` +
          "that completes it, then follow that option's link. Skip leaves the question unanswered."}
      </p>
      {guide && (
        <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-900">
          <p className="font-semibold">How to read this</p>
          <p className="mt-1">{guide}</p>
        </div>
      )}
      {/* A server-rendered PNG at a fixed URL: next/image would only add a resizing hop. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={puzzleImagePath(token, number)}
        alt={`Question ${number} puzzle`}
        width={800}
        className="mt-4 h-auto w-full rounded-xl border border-gray-200 bg-white"
      />
      <nav aria-label="Answer options" className="mt-4">
        <ul className="flex flex-wrap gap-2">
          {letters.map((letter, index) => (
            <li key={letter}>
              <a
                href={next(index)}
                className="inline-block rounded-lg border-2 border-gray-300 bg-white px-4 py-2 font-semibold hover:border-gray-900"
              >
                {`Option ${letter}`}
              </a>
            </li>
          ))}
          <li>
            <a
              href={next(null)}
              className="inline-block rounded-lg border-2 border-dashed border-gray-300 px-4 py-2 text-gray-600 hover:border-gray-900"
            >
              Skip
            </a>
          </li>
        </ul>
      </nav>
      <p className="mt-4 text-sm text-gray-500">
        {answers.length === 0
          ? "No answers yet."
          : `Answers so far: ${answers.map((answer, index) =>
            `${index + 1}: ${answer === null ? "skipped" : OPTION_LETTERS[answer]}`).join(", ")}.`}{" "}
        To change an answer, go back a page and follow another link.
      </p>
    </LinkPage>
  );
}
