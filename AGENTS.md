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
3. **How many children, and what grade is each in?** One show per child, one
   roster line per show, and one show is a complete setup. Two children in one
   show means each sits through half an episode about a subject they don't
   take. Ask the grade for each — it is the only field you cannot derive, and
   everything else follows from it. Any grade from kindergarten (0) to 12
   works; this is not a middle-school tool.
4. **Where do lesson plans come from?** A syllabus for the whole year, or an
   email each week? This decides `planFile` vs. the paste-in page.
5. **Which voices?** Start at `full-stock` (one OpenAI key). Mention that
   cloning their own voice for the parent role costs about forty cents a week
   more and is the single thing that makes it sound like a family's show.
6. **Do they want it published at all?** An unlisted feed serves the family that
   actually listens. See §5.
7. **Which names must never be spoken?** The listener's, their friends', a
   teacher's. Ask for the list, put it in `PRIVATE_NAMES` in `.env`, and do not
   let this one slide to later — see §5 for why an empty list is not a safe
   default.

## 2. Everything configurable, and where it lives

| What | Where |
|---|---|
| Which children exist, and their grade | `config/show.mjs` → `ROSTER` |
| **Pronouns**, term of address, accent, plan file | `config/show.mjs` → the roster entry |
| Age, id, title, label, tagline, description | derived from the grade — do not hand-write these |
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

**Adding or removing a show is one line of `ROSTER`.** Nothing else in the
repository names a grade — the feed workflow asks the roster which shows exist,
the demo takes the first, and `npm run week <id>` accepts any id the roster
defines. Do not add a show by hand-writing a title or an id; `defineShow`
derives both from the grade, and a hand-written "7th Grade" outlives the year
the child was in it.

**Ask whether this show will still exist next year, and set `id` if so.** The
id is in the feed URL, every audio key and every manifest key, and it defaults
to the grade. That default is right for one year and wrong for the second: bump
`grade: 6` to `7` and the feed moves, so the subscriber's app keeps polling a
URL that will never gain another episode and the back catalogue is stranded
under the old id. Nothing errors. The show just stops arriving, and the first
person to notice is a child in a car.

Setting `id: 'blue'` — stable, meaningless, **never a name**, since it lands in
a public URL — means the grade drives the title, the age and the brief while the
plumbing holds still. Rolling a year forward is then incrementing each `grade`
and re-running `npm run plan <show>`.

This has to be decided before the first publish. Changing an id later costs the
same as never having set one.

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

**An empty `PRIVATE_NAMES` is not a safe default — it is no gate at all.** The
scrubber is a list of strings to search for; given none it finds none and passes
everything through, silently and with no warning. It ships empty because the
repo cannot know the names, which means filling it in is a setup step somebody
has to actually do. Do it before the first real render, not before the first
publish: the check that matters runs when the script is written, and by publish
time the name is already in `scripts.json`.

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
