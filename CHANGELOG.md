# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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

[0.1.0]: https://github.com/ebarakos/iq/releases/tag/v0.1.0
