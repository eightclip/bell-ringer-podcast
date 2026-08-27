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

The show has two roles, named for the job rather than for who fills it:
**PARENT** (cold open, welcome, outro) and **NARRATOR** (both acts).

| Mode | Parent | Narrator | Cost/week | Needs |
|---|---|---|---|---|
| `full-stock` | OpenAI | OpenAI | ~$0.95 | `OPENAI_API_KEY` |
| `hybrid` | your clone | OpenAI | ~$1.35 | both keys |
| `duo-hume` | your clone | Hume library | ~$4 | `HUME_API_KEY` |
| `full-hume` | Hume | Hume | ~$4.50 | `HUME_API_KEY` |

Measured, not guessed: Hume bills ~$0.12/1k characters, OpenAI ~$0.025/1k, and
a five-episode week is about 38k characters.

`hybrid` is what the show this came from runs. Cloning your own voice for the
parent role costs about forty cents a week more than `full-stock`, and it is the
single thing that makes it sound like a family's show rather than a product. On
`full-stock`, set `OPENAI_VOICE_NARRATOR` to something different from
`OPENAI_VOICE` so it isn't one voice for eleven minutes.

Pacing is measured per voice, not assumed — see `WORDS_PER_MINUTE` in
`config/show.mjs`. If you swap a voice, re-measure. On the reference setup the
clone ran 160 wpm and a library voice ran 215, which is too fast for a child to
follow, and the `speed` parameter did not fix it: 1.00/0.85/0.78/0.70 measured
182/200/181/172 wpm. That is noise, not control. Word budgets per segment are
derived from the measured rate, which is why episodes land near eleven minutes
instead of drifting.

Hume providers are per voice: a clone is `CUSTOM_VOICE`, a library voice is
`HUME_AI`. Sending the wrong one returns a 404 that reads like the voice was
deleted. The variables are `HUME_VOICE_PARENT` / `HUME_VOICE_NARRATOR` and their
`_PROVIDER` counterparts.

## 4. Music

See [ASSETS.md](ASSETS.md). It renders with silent breaks if you skip this, so
it is not blocking.

## 5. Publishing

You need a Cloudflare R2 bucket and, for the paste-in page, a Vercel project.

**`site/` is a separate npm project** — its own `package.json`, its own
lockfile, its own dependencies (Next, React, the S3 client). `npm ci` at the
root does not install it, and nothing in the pipeline needs it. Vercel installs
it for you on deploy, so publishing works without this; you only need it to run
the site locally:

```bash
cd site && npm install && npm run dev     # http://localhost:3000
```

```bash
openssl rand -hex 16     # FEED_TOKEN
openssl rand -hex 16     # INGEST_PASSWORD
```

Fill in the `R2_*` values in `.env`. Locally the pipeline can shell out to
`wrangler` using your OAuth login, so `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`
are optional — but GitHub Actions and Vercel both need real S3 keys.

**The paste-in page needs all seven of these in Vercel**, Production scope, all
marked Sensitive:

```
R2_ACCOUNT_ID  R2_BUCKET  R2_PUBLIC_BASE
R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY
FEED_TOKEN  INGEST_PASSWORD
```

Worth doing carefully, because getting it wrong fails in the most annoying way
available: `/admin` renders, accepts your week, and cannot save it. Miss the two
S3 keys specifically and `/api/week` answers `missing R2 credentials` — which
you only see if you look. Check it before you rely on it:

```bash
curl -s https://<your-site>/api/week | grep storage    # want "storage":"ready"
```

Leave Vercel's Development scope empty. `npm run dev` in `site/` is `next dev`
and reads your local `.env`, so anything you put in that scope is never read —
it is just a second readable copy of live secrets. Environment changes need a redeploy
(`cd site && vercel --prod --yes`) if the project has no git integration.

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

**Your music does not reach the runner, and nothing tells you.** `*.mp3` is
gitignored — it has to be, because music licences almost never cover
redistribution from a repo — so a CI checkout has none even when your laptop is
full of it, and `render.yml` has no step that fetches any. Every scheduled week
then mixes with no theme, no stings and no beds, warns about it in a log nobody
reads, and publishes green, while the weeks you render by hand come out fine.

If you want automated weeks to have music, give the runner the tracks before
the render — private object storage, or an asset on a release of a **private**
repo, fetched in a step ahead of `Render`. Do not stage them anywhere public:
the audio bucket is world-readable, so a key in it is somebody's licensed music
published to the internet.

**Both workflows are skipped until you opt in.** Add a repository *variable*
(Settings → Secrets and variables → Actions → Variables) named
`BELL_RINGER_ENABLED` set to `true`. Until then a fork never calls a paid API
and never emails its owner about a failing cron.

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
