# Security and privacy

This tool builds a podcast about a specific child's schoolwork and puts the
audio on the public internet. That is worth being precise about.

## What the feed protection actually is

The feed lives at `https://<your-bucket>/feed/<FEED_TOKEN>/<show>.xml`, where
`FEED_TOKEN` is 16 random bytes. The bucket is public. There is no login.

**This is security through obscurity, and it is a deliberate trade.** A podcast
app has no way to authenticate, so the choice is an unguessable URL or no
podcast app. The token is long enough that guessing is not a realistic attack.

Understand the limits:

- **Anyone who obtains the URL keeps access forever.** There is no per-listener
  revocation. It will be in browser history, in whatever app you used to send
  it, and in the podcast app's own sync service.
- **Rotating the token breaks every subscriber.** They must re-add the feed.
- **Audio object paths are guessable in structure** (`audio/<show>/<week>/partN.mp3`)
  but not in content — you would still need the bucket's public base URL.
- **`<itunes:block>` is a request, not a control.** It asks directories not to
  list you. Set `SHOW_LISTED=false` and keep it there for a private family show.

If you need real access control, put the audio behind signed URLs with a short
expiry and generate the feed per subscriber. That is a meaningfully bigger
project and this repo does not do it.

## The ingest site

`/admin` is protected by one shared secret, `INGEST_PASSWORD`.

What is done properly:

- Comparison is timing-safe on both the password and the device cookie.
- The device cookie stores an HMAC of the password, never the password, so
  reading the cookie does not hand anyone the secret.
- The cookie is `HttpOnly; Secure; SameSite=Lax`.
- Rotating `INGEST_PASSWORD` invalidates every device at once.
- Failed attempts are rate limited per IP — 8 per 15 minutes.

Where it is weak:

- **The rate limiter is in-process memory.** On serverless it is per instance,
  so an attacker spread across cold starts gets more than 8 attempts per
  window. It raises the cost of online guessing by orders of magnitude, which
  is the right trade for a family tool, but it is not a hard bound. Move the
  counter to Redis/Upstash, or put Cloudflare Turnstile in front of the form,
  if this endpoint ever guards anything that matters.
- **One shared password, no accounts, no audit log.** Use a generated value
  (`openssl rand -hex 16`), not a password you use elsewhere.

## Credentials

`.gitignore` excludes `.env` **and every `.env.*` variant** except
`.env.example`. This is deliberate and it is not paranoia: the single most
common way a project like this leaks is a `.env.bak` or `.env.local` left
behind by an editor and swept up by `git add -A`. A bare `.env` rule does not
catch those.

Before making any fork of this public:

```bash
git log --all --full-history --name-only | sort -u | grep -iE '\.env|secret|key'
git grep -nIE 'sk-(ant|proj)-|AKIA|BEGIN [A-Z ]*PRIVATE KEY' $(git rev-list --all)
```

If either finds anything, **rotate the credential first**. Rewriting history
does not un-publish what has already been cloned, and GitHub keeps unreachable
objects addressable for a period after a force push.

## Child privacy

The thing this repo cannot protect you from.

A published feed built from a real timetable discloses, to anyone with the URL:
your child's grade level, their school's curriculum and calendar, what they are
studying and when, and — via a custom domain or an `<itunes:author>` tag — very
often who their parent is. Aggregated across a school year, that is a detailed
picture of a minor who did not consent to any of it.

Practical mitigations, in the order they matter:

1. **Keep `SHOW_LISTED=false`.** No directory, no index, no search result.
2. **Key shows by grade, not by name.** This repo already does — show ids reach
   the outside world in feed URLs, audio paths, and artwork filenames, so a
   name there would put a child's name on a public URL for no benefit. The
   scripts address the listener as "you".
3. **Don't commit the curriculum.** `plans/*-year.json` and `plans/*-blocks.json`
   are gitignored. A teacher's block plan is also their work, not yours to
   republish.
4. **Don't put the child's name in `SHOW_AUTHOR` or the show title.**
5. **Ask them.** An eleven-year-old can hold an opinion about whether a podcast
   about their homework should exist. They are also the only person here who
   has to live with the result for the rest of their life.

## Cost as a safety property

An unattended weekly cron calling paid APIs can run away. The repo keeps a cost
ledger (`npm run costs`), caps claims via `MAX_CLAIMS`, caches every stage by
content hash, and bounds research with timeouts rather than `max_uses` — the
model batches searches, so one round of four counts as eight and `max_uses` is
a bad governor. Set billing alerts on every provider anyway.

## Reporting

Found a problem? Open an issue. Please don't include a real feed URL, a real
token, or a real child's details in it.
