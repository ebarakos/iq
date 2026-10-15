# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.1] - 2026-10-15

### Added
- The home page tells AI agents, in plain text, that following links takes the test, with the
  full `/test` and `/sample` addresses. A chat agent given only the home page had taken the start
  links for JavaScript buttons and stopped.
- One-piece machine questions: one example row, then the same piece on a new board.

### Changed
- Machine questions ramp through every 30-question test: one piece in questions 1–5, two pieces
  in the middle, three at the end. They used to arrive only near the end.
- The shape that jumps round the edge with growing jumps ("1, 3, 5, 7, 9") is now an early
  question (6–9 in the 30-question test) and appears at most twice.
- The questions a test draws changed (generator v39), so a deploy ends tests in progress.

### Fixed
- Chat agents can start the 30-question test. Building it took 7–9 s, longer than ChatGPT's
  fetch tool waits, so `/test` now answers within a few seconds with a page saying how many
  questions are built and a link that builds the rest. The questions are the same, and the
  clock starts only when the first question opens. `/sample` usually still opens at once.

## [0.2.0] - 2026-10-15

### Added
- Two matrix families, each with three difficulty levels: overlapping line figures that
  combine across rows and down columns, and a grid where every row and column holds each
  shape and each shading once.
- Interacting transformation machines: move a board, repaint one square, then copy its
  current symbol. Contrasting examples distinguish shape and fill readings.
- Points on every 30-question result, even with the leaderboard disabled: 100 per correct
  answer, plus a time bonus of up to 25%. Skipped and wrong answers earn no base points.
  The introduction, results and leaderboard explain the same calculation.
- A leaderboard for on-time 30-question tests, with an optional nickname, speed points,
  accuracy, elapsed time and the app release used. It is on in production from this release;
  previews show none.
- A test you can take by following links alone: `/sample` (5 questions) and `/test` (30)
  start a fresh test, each question is a picture with one link per option plus Skip, and
  the last link opens the scored result with its review. Same puzzles, same one minute per
  question, scored on the server. Made for chat agents that fetch pages but run no
  JavaScript; the home page's start buttons are now these links too.
- Frozen evaluation replay and separate report populations for reliable before/after probes.
- Two prototypes that are built but not served: a conditional composed transform, where
  repainting changes which shapes move, and spatial assembly, which fits pieces into a frame.
- AI agents on the leaderboard. Every row says whether a person or an AI agent took the test,
  as the publisher declares it. A link-test result offers one publish link per agent name
  (Claude, ChatGPT, Gemini and others), so a chat agent that only follows links can publish.
- `npm run leaderboard:remove` lists a board's rows and takes one down; a removed test cannot
  be published again.

### Changed
- Difficulty is fixed by question number: the sample runs at levels 2/3/4/4/5, and the
  30-question test has 5/4/13/8 questions at levels 2/3/4/5. Each question's family is drawn
  from the families valid at its level. A long test covers all twelve families, at most five
  questions each, never the same family twice in a row.
- Every transform in a machine question is needed: ignoring any one leaves at least two
  choices open. Level 5 machine questions use all three transforms in a mixed order.
- Six options still mean one right answer and five plausible near misses. Wrong options now
  include mistakes affecting one symbol, property, square or repeated copy. Checking one
  symbol cannot finish a puzzle with several independent outcomes, even when options omit
  or duplicate symbols. Balanced option lists prefer more indispensable clues while keeping rich rules.
- The sample's "How to read this" note for a 3 × 3 grid describes only that grid: the rows
  for a grid with arrows, the rows and columns for one without.
- Two leaderboard rankings: Dev, shared by development, testing, previews and staging, and
  Production, which needs `LEADERBOARD_ENV=production` on a production deployment. Stored
  scores stay separate.
- Quiz tokens and first-submission receipts keep their deployment scope when the selected
  leaderboard changes, preserving active tests and retries. A scored result stays bound to
  its first selected board and cannot be republished to another; existing receipts keep their original board.
- Submissions in both test flows save their first result in Upstash Redis before revealing
  answers. Identical retries recover it; changed answers are refused, preventing score replay.
- Screen-reader labels no longer describe what is on a board ("Option A", "board"), and the
  layout labels name only what the picture shows. A label that spelled out every shape let a
  reader solve the puzzle without looking.
- The agent image draws its arrows as lines rather than text, so it looks the same with any font.
- Search crawlers are asked not to follow links into a test, so they cannot wander through
  thousands of answer pages.
- Before scoring, the in-page test shows every board as a picture drawn on the server and sends
  no shape data, so a program has to look at the puzzles as people and vision agents do. The
  full puzzles arrive with the review.
- Both test flows use one sealed seed token per test, so a test has exactly one scored result.
  A site update that changes the questions ends tests in progress.
- Nicknames are 2–24 letters, digits, spaces and `. - _ '`, never a web address, and pass a
  profanity filter.
- A 30-question test must take at least 2 minutes to rank. One address may start 60 tests and
  publish 20 scores an hour.
- Link-test results can now join the leaderboard.

## [0.1.2] - 2026-10-06

### Added
- A site icon: three dots and one ring on a dark tile, the missing cell of a puzzle. It shows
  in browser tabs and, as a larger version, on phone home screens.
- A link preview for chats and social posts: a 3 × 3 puzzle with its last cell asked, beside
  the site name and "Visual puzzles for humans and AI agents."

## [0.1.1] - 2026-10-05

### Added
- A "Submit answers" button on every question, so a test can be finished early. It warns
  when some questions are still unanswered, and they count as wrong.
- Reading cues on every question: sequence pictures are numbered with an arrow before each,
  an analogy reads "A → B" over "C → ?", and a 3 × 3 grid whose rule runs along the rows
  carries arrows. Table rows no longer fold on a phone.
- A short "How to read this" note for each layout, on the 5-question sample only.
- `agent:run --debrief`: after each answer the model is asked for its confidence, its rule,
  the difficulty, and whether another option was also defensible.

### Changed
- Every worked example reads one way only: examples show every fill change the answer needs,
  and no reading the examples allow leads to a wrong option (checked on 200 questions per
  bucket by `npm run families:verify`).
- No single clue picks the answer: every clue a question needs appears on at least two of its
  options.
- Machine gates are drawn as jigsaw pieces told apart by texture, snapped together in the
  order they run.
- The review screen explains each answer in the picture's own words.
- Grey is easier to see inside small stars.
- Tests draw from ten families; the emergency bank holds 65 questions.

### Removed
- The combining-machine family: its chained pieces could be read more than one way.
- Code no question reached: the compact-cell format, the legacy rule language, two retired
  question types, four unused layouts, and the strip for four or five gates.

### Fixed
- `agent:run --debrief` keeps a finished debrief answer when a later one fails, and drops a
  reply from a model other than the one that answered.

## [0.1.0] - 2026-10-01

First release of the IQ visual reasoning gym.

### Added
- Two test lengths, 5 and 30 questions, drawn from eleven visual reasoning families in four
  difficulty bands. Every test is generated in pure code from a fresh seed (no model calls),
  checked for exactly one right answer, and served without answers.
- Six options per question, chosen so the answer cannot be read off the options alone: 28
  options-only strategies are held to 30% (a frontier model shown only the options scored
  13%; chance is 16.7%).
- Server-side scoring from an encrypted answer token, and a whole-test countdown (60 seconds
  per question) that runs on the server's clock.
- Results: score, skipped versus wrong, a breakdown by family, and a review of every question.
- Retry a failed submission without losing answers; progress survives a reload.
- An emergency bank of 75 questions for when live generation fails.
- An agent harness: the same rendered puzzle sent to vision models through llm-relay,
  recorded per answering model, with an options-only arm and a held-out set.
- One-command Vercel setup (`npm run vercel:setup`).
- The release version in the page header.

[0.1.1]: https://github.com/ebarakos/iq/releases/tag/v0.1.1
[0.1.0]: https://github.com/ebarakos/iq/releases/tag/v0.1.0
