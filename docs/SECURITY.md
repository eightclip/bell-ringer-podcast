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

## Security headers

The site (`site/`) sends a Content-Security-Policy on every route, built in
[`site/next.config.mjs`](../site/next.config.mjs) by its `headers()` hook:

```
default-src 'self';
base-uri 'self';
object-src 'none';
frame-ancestors 'self';
frame-src 'none';
form-action 'self';
script-src 'self' 'unsafe-inline' <posthog-assets-host>;
style-src 'self' 'unsafe-inline';
font-src 'self';
img-src 'self' data: <your R2_PUBLIC_BASE origin>;
media-src 'self' <your R2_PUBLIC_BASE origin>;
connect-src 'self' <posthog-host> <posthog-assets-host>;
manifest-src 'self';
worker-src 'self' blob:;
upgrade-insecure-requests
```

Nothing in it is hardcoded, so there is nothing to edit after you fork:

- **The image and media origin is the origin of your `R2_PUBLIC_BASE`.** That is
  where the cover art lives. If the build cannot see that variable the two
  directives fall back to `https:` rather than dropping the origin — a policy
  that silently blanks the covers is a worse failure than a loose `img-src`. If
  you want the strict version, make sure `R2_PUBLIC_BASE` is set in the build
  environment, not only at runtime.
- **The PostHog entries appear only if `NEXT_PUBLIC_POSTHOG_KEY` is set.** This
  repo ships no analytics, so by default they are absent entirely. They exist
  because the upstream private deployment loads PostHog's pinned `array.js`.
- **`'unsafe-eval'` and `ws:` are added in development only**, for webpack's
  HMR, and `upgrade-insecure-requests` is omitted there so `http://localhost`
  still loads. Production gets neither concession.

Everything the site loads was enumerated before the policy was written: fonts
are self-hosted in `site/public/fonts` (no Google Fonts, no CDN), cover art
comes from your bucket, and the only browser `fetch` is to same-origin
`/api/week`. If you add a font service, an embed, or any third-party script,
you must widen the policy or it will be blocked.

### Added 2026-09-24, and what is deliberately left

An audit of the upstream deployment that day found HSTS, `X-Frame-Options`,
`X-Content-Type-Options` and `Referrer-Policy` in place and **no CSP at all**.
This is the fix, and it is the same file in both repositories.

**`script-src` keeps `'unsafe-inline'`.** This is the one real weakness and it
is a choice. Next's App Router ships its Flight payload as inline `<script>`
blocks; the strict alternative is a per-request nonce issued from middleware,
which opts every route out of static generation and costs the home page its
15-minute ISR. On a site with no user-generated content that is a bad trade.
Revisit it if your fork renders anything a stranger can supply.

There is no `report-uri`/`report-to` — no endpoint exists to collect reports.

**This repo sets no other headers.** `Strict-Transport-Security`,
`X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy` come from a
`site/vercel.json` that exists only in the upstream private repo. If you deploy
this one, add them yourself:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "X-Frame-Options", "value": "SAMEORIGIN" }
      ]
    }
  ]
}
```

Headers from `next.config.mjs` and from `vercel.json` compose; neither replaces
the other. Verified against the live upstream deployment on 2026-09-24, with all
five present exactly once.

### How it was verified

`cd site && npm run build && npm start`, then headless Chrome against `/`,
`/admin` and a 404 with a `securitypolicyviolation` listener installed before
first paint: zero violations and no new console errors on either this repo's
build or the upstream deployed one, with the upstream run also confirming the
cover art, all self-hosted font faces, and the feed links still load.
