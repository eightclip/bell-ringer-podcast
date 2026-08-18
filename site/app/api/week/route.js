import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';

function s3() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

const configured = () =>
  Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);

// --- auth -----------------------------------------------------------------
// Type the password once per device. After that a long-lived httpOnly cookie
// carries it. The cookie holds an HMAC of the password, never the password
// itself, so reading the cookie doesn't hand anyone the secret — and rotating
// INGEST_PASSWORD invalidates every device at once.
const DEVICE_COOKIE = 'br_device';

function deviceToken() {
  return createHmac('sha256', process.env.INGEST_PASSWORD || 'unset')
    .update('bell-ringer-device-v1')
    .digest('hex');
}

function sameHex(a, b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function samePassword(given) {
  const want = process.env.INGEST_PASSWORD || '';
  if (!want || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

function hasDeviceCookie(req) {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${DEVICE_COOKIE}=([a-f0-9]{64})`));
  return Boolean(m && process.env.INGEST_PASSWORD && sameHex(m[1], deviceToken()));
}

function authed(req) {
  return hasDeviceCookie(req) || samePassword(req.headers.get('x-ingest-password') || '');
}

const rememberCookie = () =>
  `${DEVICE_COOKIE}=${deviceToken()}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;

// --- brute-force limiting -------------------------------------------------
// One shared password and no lockout is a guessable door. This is deliberately
// the simplest thing that closes it: a fixed window per client IP, in memory.
//
// In memory means per serverless instance, so a determined attacker spread
// across many cold starts gets more attempts than the constant suggests. It
// raises the cost of online guessing by orders of magnitude and costs nothing
// to run, which is the right trade for a family tool. If you put anything
// sensitive behind this endpoint, move the counter to Upstash/Redis or put
// Cloudflare Turnstile in front of the form.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const failures = new Map(); // ip -> { count, resetAt }

function clientIp(req) {
  const fwd = req.headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

function rateLimited(req) {
  const rec = failures.get(clientIp(req));
  return Boolean(rec && rec.count >= MAX_FAILURES && Date.now() < rec.resetAt);
}

function noteFailure(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const rec = failures.get(ip);
  if (!rec || now >= rec.resetAt) failures.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  else rec.count += 1;

  // Bound the map so a spray across spoofed X-Forwarded-For values can't grow
  // it without limit. Drop whatever has already expired; if everything is live,
  // drop the oldest insertion.
  if (failures.size > 5000) {
    for (const [k, v] of failures) if (now >= v.resetAt) failures.delete(k);
    if (failures.size > 5000) failures.delete(failures.keys().next().value);
  }
}

const clearFailures = (req) => failures.delete(clientIp(req));

// Monday of the week containing `date`, or next Monday if none given.
function mondayOf(iso) {
  const d = iso ? new Date(`${iso}T12:00:00`) : new Date();
  const day = d.getDay();
  if (iso) d.setDate(d.getDate() - ((day + 6) % 7));      // back to that week's Monday
  else d.setDate(d.getDate() + (day === 0 ? 1 : 8 - day)); // forward to next Monday
  return d.toISOString().slice(0, 10);
}

export async function GET(req) {
  // Lets the page skip the password field entirely on a remembered device,
  // and tells "site is up" apart from "site can save".
  return Response.json({
    ok: true,
    remembered: hasDeviceCookie(req),
    storage: configured() ? 'ready' : 'missing R2 credentials',
  });
}

export async function POST(req) {
  if (rateLimited(req)) {
    return Response.json(
      { error: 'Too many failed attempts. Try again in 15 minutes.' },
      { status: 429, headers: { 'retry-after': String(WINDOW_MS / 1000) } },
    );
  }
  if (!authed(req)) {
    noteFailure(req);
    return Response.json({ error: 'wrong password' }, { status: 401 });
  }
  clearFailures(req);

  // Fail with an instruction rather than a stack trace. Locally the pipeline
  // falls back to wrangler, but Vercel has no wrangler login — it needs real
  // S3 keys, and this is the one place that difference bites.
  if (!configured()) {
    return Response.json({
      error:
        'Storage not configured. Create an R2 API token (Cloudflare dashboard → R2 → ' +
        'Manage R2 API Tokens), then add R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY ' +
        'to this project on Vercel and redeploy.',
    }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: 'bad request' }, { status: 400 });

  const week = mondayOf(body.week);
  const grade6 = (body.grade6 || '').trim();
  const grade7 = (body.grade7 || '').trim();
  if (!grade6 && !grade7) return Response.json({ error: 'paste at least one lesson plan' }, { status: 400 });

  const key = `input/${week}.json`;
  // Merge rather than overwrite — the two teachers' emails usually arrive on
  // different days, and losing Monday's paste when Tuesday's arrives would be
  // a genuinely annoying way to find out.
  let existing = {};
  try {
    const got = await s3().send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
    existing = JSON.parse(await got.Body.transformToString());
  } catch {}

  const merged = {
    ...existing,
    ...(grade6 ? { grade6 } : {}),
    ...(grade7 ? { grade7 } : {}),
    updated_at: new Date().toISOString(),
  };

  await s3().send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: JSON.stringify(merged, null, 2),
    ContentType: 'application/json',
    CacheControl: 'no-store',
  }));

  return Response.json(
    { ok: true, week, saved: Object.keys(merged).filter((k) => k !== 'updated_at') },
    { headers: { 'set-cookie': rememberCookie() } },
  );
}

// Sign out of this device.
export async function DELETE() {
  return Response.json(
    { ok: true },
    { headers: { 'set-cookie': `${DEVICE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } },
  );
}
