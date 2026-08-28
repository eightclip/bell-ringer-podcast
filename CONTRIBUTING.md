# Contributing

This is a personal project that happens to be open. I built it for my own two
kids and I still run it every week, which is the reason it works and also the
reason it moves slowly. Setting expectations honestly up front seems better than
leaving you to guess.

## What to expect from me

**Issues and pull requests are welcome and may sit for a while.** There is no
support, no SLA, and no roadmap. I read everything. I reply to a lot of it. I
merge less than I read.

I am most likely to act on:

- a bug with a reproduction — what you ran, what happened, what you expected
- a fix for something demonstrably broken
- a report that the setup path failed on your machine, because that path is the
  whole point and I can only test it on mine

I am least likely to act on:

- new integrations, providers, or platforms I do not use myself
- refactors that trade clarity for cleverness
- anything that makes the show easier to publish and harder to trust

## If you build something with it

I would genuinely like to hear about it — that is what
[Discussions](../../discussions) is for. What grade, what subject, what you
changed, what your kid said. That is more useful to me than a star.

## Before you open a pull request

Run the tests that exist. There is no suite; there is a clean-checkout check:

```bash
npm ci
npm run demo      # asks before it spends anything
```

Then, please:

- **Keep the comments.** This codebase explains *why* far more than *what*, and
  several of those comments exist because something failed silently once and
  cost a week. A change that deletes the reasoning is usually a change that
  reintroduces the bug.
- **Match the surrounding voice.** Plain sentences, present tense, no headings
  in code comments.
- **One concern per PR.** A fix and a refactor in the same diff takes ten times
  as long to review.
- **Do not commit anything you cannot redistribute** — music, fonts with a
  commercial EULA, photography, or a real child's lesson plan. See
  [docs/ASSETS.md](docs/ASSETS.md). `.gitignore` covers the usual suspects and
  is not a substitute for checking.

## Things I will not merge

- **A name in a public path.** Show ids reach the feed URL, every audio key and
  every artwork filename. They are keyed by grade for that reason.
- **A weakened source allowlist.** `config/sources.mjs` is why this can be
  trusted with a child. Adding a general-purpose search engine defeats the
  entire verification design — add specific institutions instead.
- **Anything that spends money in CI by default.** Both paid workflows are
  gated behind a repository variable, and a fork must never be able to bill its
  owner by accident.

## Security

Read [docs/SECURITY.md](docs/SECURITY.md) first. It is honest about where the
design is weak on purpose — the unguessable feed URL is not authentication, and
the audio bucket is public — so what looks like a hole may be a documented
trade-off.

If it is not covered, open an issue, and **never put a real feed URL, a real
token, or a real child's details in it.**
