# Setup

From clone to a show that drips five mornings a week.

## 1. Hear an episode first (10 minutes)

```bash
npm install
cp .env.example .env
# fill in ANTHROPIC_API_KEY and OPENAI_API_KEY
npm run demo
```

You need `ffmpeg` on PATH (`brew install ffmpeg`). ImageMagick is optional —
without it you get audio and no covers.

The demo uses `plans/example-year.json`, an invented curriculum, renders one
episode, and writes it under `build/`. Nothing is uploaded. It asks before
spending and the run costs roughly $2–4.

If you don't like what you hear, the two files to change are
`pipeline/script.mjs` (the writer's brief) and `config/show.mjs` (structure,
timings, acting direction). Re-run `npm run demo` — research is cached, so
iterating on the writing is cheap.

## 2. Your own curriculum

Two ways in.

**A whole year, if you have the syllabus.** Put the block plan at
`plans/<show>-blocks.json`, then:

```bash
npm run plan grade6      # expands blocks into per-week slices
```

Blocks expand so that four weeks of Astronomy aren't four versions of one
episode — each week gets its own slice of the block's topics and knows what
earlier weeks already covered.

**Week by week, if plans arrive by email.** Set `planFile: null` for that show
and paste each week in at `/admin` on the deployed site.

Either way the per-week shape is what `plans/example-year.json` shows. Your
real plans are gitignored.

## 3. Voice

`VOICE_MODE` in `.env`:

| Mode | Who speaks | Needs |
|---|---|---|
| `full-stock` | OpenAI throughout | `OPENAI_API_KEY` |
| `hybrid` | Your clone opens and closes, OpenAI narrates | both keys |
| `full-hume` | Hume throughout | `HUME_API_KEY` |

`hybrid` is what the reference show runs: it sounds like a parent introducing
something, which a fully synthetic read does not.

Pacing is measured per voice, not assumed — see `WORDS_PER_MINUTE` in
`config/show.mjs`. If you swap a voice, re-measure. On the reference setup the
clone ran 160 wpm and a library voice ran 215, which is too fast for a child to
follow, and the `speed` parameter did not fix it: 1.00/0.85/0.78/0.70 measured
182/200/181/172 wpm. That is noise, not control. Word budgets per segment are
derived from the measured rate, which is why episodes land near eleven minutes
instead of drifting.

Hume providers are per voice: a clone is `CUSTOM_VOICE`, a library voice is
`HUME_AI`. Sending the wrong one returns a 404 that reads like the voice was
deleted.

## 4. Music

See [ASSETS.md](ASSETS.md). It renders with silent breaks if you skip this, so
it is not blocking.

## 5. Publishing

You need a Cloudflare R2 bucket and, for the paste-in page, a Vercel project.

```bash
openssl rand -hex 16     # FEED_TOKEN
openssl rand -hex 16     # INGEST_PASSWORD
```

Fill in the `R2_*` values in `.env`. Locally the pipeline can shell out to
`wrangler` using your OAuth login, so `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`
are optional — but GitHub Actions and Vercel both need real S3 keys.

**Bind a custom domain to the bucket before you subscribe anyone.** The
`r2.dev` endpoint is rate-limited, and a feed URL is expensive to change once
apps have it.

Read [SECURITY.md](SECURITY.md) before this step, not after.

```bash
npm run week grade6           # next Monday, whole pipeline
npm run week grade6 2026-09-07
npm run week -- --dry-run     # everything except the upload
npm run feed grade6           # rebuild RSS from what has aired
```

## 6. Automation

Two workflows, both needing repository secrets:

- **`render.yml`** — Saturday night. Builds and uploads the whole week, verifies
  it, retries Sunday if it failed.
- **`feed.yml`** — weekday mornings at 09:20 UTC. Rebuilds the feed, which is
  what releases that morning's episode. Audio was uploaded days earlier; the
  rebuild just makes it visible.

Push `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `HUME_*`, `UNSPLASH_ACCESS_KEY`,
`R2_*`, and `FEED_TOKEN` as Actions secrets.

Note the schedule is UTC and does not observe daylight saving. 09:20 UTC is
2:20am Pacific in summer and 1:20am in winter. Air times are stamped at 09:00
UTC so an episode lands on the right local calendar day year-round; pick times
that stay overnight for your own timezone.

## Things that will bite you

**A space in the directory path.** `import.meta.url === "file://" + argv[1]`
fails silently on `My%20Folder` and scripts exit 0 having done nothing. The
repo uses `isMain()` from `pipeline/lib.mjs` everywhere for this reason — use
it for any new entry point.

**Measure audio, don't trust the config.** Three defects only appeared in the
output: ffmpeg's `alimiter` auto-levels *up* to its limit by default, so a
"safety" limiter caused clipping; 64 kbps MP3 reconstructs ~2.6 dB above what
it is handed, hence `truePeak: -3.0`; and single-pass `loudnorm` lands ~2 LU
off, so it runs two-pass — and ffmpeg prints that JSON to stderr while exiting
0, which needs `spawnSync`.

**`max_uses` is a bad governor for web tools.** The model batches searches and
one round of four counts as eight. Bound research with `timeoutMs`.

**`.env` is loaded by `config/env.mjs`,** imported by both config and pipeline.
Don't read `process.env` at module scope anywhere else — `show.mjs` reads
`VOICE_MODE` at module scope and only saw the right value because another
import happened to run the loader first.
