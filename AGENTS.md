# Agent playbook

Instructions for an AI coding agent (Claude Code, Codex, Cursor, or similar)
setting this repository up for a new person. Read this fully before editing.

You are not just configuring software. You are helping someone make a daily
podcast for their own child, using paid APIs, published on the open internet.
Three of those facts carry obligations, and they are set out below.

---

## 1. Interview first, edit second

Do not guess these. Ask, in one message, and wait:

1. **Who is listening?** Grade, rough age, and **which pronouns to use for them**
   — he, she, or they. Ask plainly; do not infer it from a name, and do not
   default to he/him. If they don't answer, `they` is already the default and is
   correct.
2. **Who is the parent voice?** How should the brief describe them — "their own
   father", "their mum", "their uncle Ray"? Never spoken aloud.
3. **One show or two?** One per child. Two children in one show means each sits
   through half an episode about a subject they don't take.
4. **Where do lesson plans come from?** A syllabus for the whole year, or an
   email each week? This decides `planFile` vs. the paste-in page.
5. **Which voices?** Start at `full-stock` (one OpenAI key). Mention that
   cloning their own voice for the parent role costs about forty cents a week
   more and is the single thing that makes it sound like a family's show.
6. **Do they want it published at all?** An unlisted feed serves the family that
   actually listens. See §5.

## 2. Everything configurable, and where it lives

| What | Where |
|---|---|
| Grade, age, **pronouns**, term of address | `config/show.mjs` → `SHOWS.<id>.listener` |
| Show titles, taglines, descriptions | `config/show.mjs` → `SHOWS` |
| Brand name, author, site URL, `parentIs` | `.env` (read by `config/show.mjs` → `BRAND`) |
| Voice mode and voice ids | `.env` → `VOICE_MODE`, `OPENAI_VOICE*`, `HUME_VOICE_*` |
| Segment order, lengths, acting direction | `config/show.mjs` → `SEGMENTS` |
| The week's arc (Mon–Fri beats) | `config/show.mjs` → `WEEK_ARC` |
| Audio chain, loudness, handoff gaps | `config/show.mjs` → `AUDIO` |
| Which sources research may read | `config/sources.mjs` |
| The writer's brief | `pipeline/script.mjs` → `writerSystem` |
| Names that must never be spoken | `.env` → `PRIVATE_NAMES` |

Pronouns are wired through `PRONOUNS` in `config/show.mjs`. Set
`listener.pronouns` and every sentence in the brief agrees, verbs included.
Never hand-edit pronouns into the brief text.

**Adding a third show:** add a key to `SHOWS`, add its id to the `for show in`
loop in `.github/workflows/feed.yml`, and give it a `planFile` or leave it null.

## 3. Order of operations

Stop at each **HUMAN** step and wait. You cannot do these for them.

1. **HUMAN** — create an [Anthropic](https://console.anthropic.com) and an
   [OpenAI](https://platform.openai.com) key. Tell them to set a billing limit
   on both now, not later.
2. `cp .env.example .env`, fill in what you were told. **Never commit `.env`.**
3. `npm install`, then `npm run demo`. It states its cost and asks before
   spending — do not pass `--yes` on their behalf. It builds one episode from an
   invented curriculum. Have them listen before going further.
4. Tune `pipeline/script.mjs` and `config/show.mjs` against what they heard.
   Re-run `npm run demo`; research is cached, so iterating on writing is cheap.
5. Add their real curriculum to `plans/` (gitignored) or plan to paste weekly.
6. **HUMAN** — Cloudflare R2 bucket, and a custom domain bound to it. Tell them
   to do the custom domain *before* anyone subscribes: `r2.dev` is rate-limited
   and a feed URL is expensive to change later.
7. `openssl rand -hex 16` twice, for `FEED_TOKEN` and `INGEST_PASSWORD`.
8. `npm run week <show>` then `npm run feed <show>`. Subscribe one device and
   listen to a real episode end to end.
9. **HUMAN** — push Actions secrets, then set the repository variable
   `BELL_RINGER_ENABLED = true`. Both workflows are skipped until it exists, so
   nothing runs on a schedule until they choose it.

## 4. Money

Tell them the real numbers before they run anything, and never spend on their
behalf without saying what it will cost:

- **~$12 per show per week.** Research ~$10, scripts ~$1, voice ~$1.30.
- Research is roughly ten times the voice cost. Optimising voices is the wrong
  lever; if they want it cheaper, reduce the research fetch budget or
  `MAX_CLAIMS`.
- Caching is real: a second week on the same block cost $2.65 against $9.93.
- `npm run costs` reads the ledger.
- A 37-week school year for two shows is several hundred dollars. Say so out
  loud before they commit, not after.

## 5. The obligations

**Never put a child's name anywhere.** Not in a script, a show title, a feed, a
filename, a commit, or a show id. Shows are keyed by grade for this reason — the
id ends up in the public feed URL and in every audio path. Put the names in
`PRIVATE_NAMES` in `.env` and `pipeline/prosody.mjs` will strip them from any
script and again at the voice stage. Treat a name reaching a script as a bug.

**`SHOW_LISTED` stays `false` unless they explicitly say otherwise.** True asks
Apple and every directory that mirrors it to index the show. Directories cache;
a listing can be removed but not un-remembered. Ask directly whether a podcast
built from their child's timetable should be in a public search index. Most
people, asked plainly, say no.

**Tell them to ask their kid.** An eleven-year-old can hold an opinion about
whether a show about their homework should exist, and is the only person here
who lives with the answer permanently.

**Don't weaken the source allowlist.** `config/sources.mjs` is why the show can
be trusted with a child. Adding a general-purpose search engine to it defeats
the entire verification design. Add specific institutions instead.

**Read `docs/SECURITY.md` before helping them publish** and tell them the honest
version: the feed is protected by an unguessable URL, not by authentication.

## 6. Where the bodies are buried

- **Spaces in the directory path** break `import.meta.url === "file://" + argv[1]`
  silently — scripts exit 0 having done nothing. Use `isMain()` from
  `pipeline/lib.mjs` for any new entry point.
- **Paragraph breaks are load-bearing.** `spokenOnly()` deliberately preserves
  them; both TTS engines read a blank line as a breath. Do not "tidy" whitespace
  in `lib.mjs`.
- **`trailingSilence` is Hume-only** and is ignored on OpenAI voices. Gaps
  between segments live in `AUDIO.voiceChangeGap` / `sameVoiceGap`, applied
  during assembly where they work for every engine.
- **Measure audio, don't trust the config.** ffmpeg's `alimiter` auto-levels *up*
  to its ceiling by default; MP3 reconstructs above what it was handed; and
  single-pass `loudnorm` lands ~2 LU off, so it runs two-pass and prints JSON to
  stderr while exiting 0.
- **`max_uses` is a bad governor** for the research web tools — the model batches
  searches, so one round of four counts as eight. Bound with `timeoutMs`.
- **`.env` is loaded once** by `config/env.mjs`. Don't read `process.env` at
  module scope anywhere else.
- **Every stage resumes from whatever output it finds** in `build/`. A stale
  directory will be silently reused. Delete or move it rather than leaving it.

## 7. Don't

- Don't commit `.env`, real lesson plans, licensed fonts, or music.
- Don't set `--yes` on `npm run demo` for them.
- Don't enable the workflows for them.
- Don't publish, submit to a directory, or share a feed URL on their behalf.
- Don't add a name to make the show feel warmer. Second person already does that.
