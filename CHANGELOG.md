# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
