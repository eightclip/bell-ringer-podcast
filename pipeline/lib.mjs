import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// config/show.mjs imports only config/env.mjs, which imports only node
// builtins — so this is a one-way edge, not a cycle.
import { showIds } from '../config/show.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// `import.meta.url === "file://" + process.argv[1]` is the usual idiom and it
// is wrong the moment a path contains a space (or any character a URL escapes)
// — "Bell Ringer" becomes "Bell%20Ringer" and the guard silently never fires,
// so the script exits 0 having done nothing. Compare real paths instead.
export function isMain(importMetaUrl) {
  return process.argv[1] && resolve(fileURLToPath(importMetaUrl)) === resolve(process.argv[1]);
}
export const BUILD = join(ROOT, 'build');
export const MUSIC = join(ROOT, 'music');
export const ASSETS = join(ROOT, 'assets');

// --- env ------------------------------------------------------------------
// Lives in config/env.mjs so config and pipeline share one loader and neither
// depends on the other being imported first.
export { loadEnv } from '../config/env.mjs';

export function need(key) {
  const v = process.env[key];
  if (!v) throw new Error(`Missing ${key} — copy .env.example to .env and fill it in.`);
  return v;
}

// --- logging --------------------------------------------------------------
const t0 = Date.now();
const stamp = () => `${String(Math.floor((Date.now() - t0) / 1000)).padStart(4)}s`;
export const log = (...a) => console.log(`\x1b[2m${stamp()}\x1b[0m`, ...a);
export const step = (m) => console.log(`\n\x1b[1m▸ ${m}\x1b[0m`);
export const ok = (m) => console.log(`\x1b[32m  ✔ ${m}\x1b[0m`);
export const warn = (m) => console.log(`\x1b[33m  ! ${m}\x1b[0m`);

// --- week paths -----------------------------------------------------------
// Everything for one show's week lives under build/<show>/<monday-date>/ so a
// re-run is idempotent, a bad week can be blown away without touching the
// others, and the two boys' shows never collide.
export function weekDir(show, week) {
  const d = join(BUILD, show, week);
  mkdirSync(d, { recursive: true });
  return d;
}

export function readJSON(p, fallback = null) {
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function writeJSON(p, data) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2));
  return p;
}

// The Monday that starts the week we are rendering for — by default the *next*
// one, since rendering happens Sunday night for the week ahead.
//
// Everything here is UTC, deliberately and consistently. The previous version
// asked for the day-of-week in local time, added days in local time, and then
// formatted the result with toISOString(), which is UTC — so the answer
// depended on the machine's timezone. On the GitHub runner (UTC) the Sunday
// 01:00 cron resolved correctly to the following Monday; run from a Mac in
// US Eastern the same instant reads as Sunday 9pm, and it returned a TUESDAY.
// A week key that is not a Monday matches nothing in the year plan and would
// silently create a junk week directory.
//
// Week keys are calendar labels, not instants, so UTC throughout is the right
// call: the same date produces the same key everywhere it is ever run.
export function mondayOf(date = new Date()) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const delta = day === 0 ? 1 : 8 - day; // Sunday -> tomorrow, else next Monday
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function currentWeek() {
  const arg = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  return arg || process.env.WEEK || mondayOf();
}

// Which show a command is operating on. Every stage takes it as the first
// non-flag, non-date argument: `node pipeline/run.mjs grade6 2026-08-17`.
//
// The known list comes from the roster rather than being written out here.
// Hardcoded, it silently ignored any show that was not one of the original two:
// `npm run week grade4` would parse no show argument at all and quietly render
// the *first* show instead, which is the kind of wrong that looks like it
// worked. With one show configured, the argument is optional and that one is
// always the answer.
export function currentShow(known = showIds()) {
  const args = process.argv.slice(2).map((a) => a.toLowerCase());
  const arg = args.find((a) => known.includes(a));
  if (!arg) {
    // A show-shaped argument that is not on the roster is almost always a
    // grade nobody configured — the year rolled over, or it is a typo. Falling
    // through to the first show renders a real week for the wrong child and
    // looks like it worked, so say so rather than guessing quietly.
    const looksLikeShow = args.find((a) => /^(grade\d{1,2}|kindergarten)$/.test(a));
    if (looksLikeShow) {
      warn(`"${looksLikeShow}" is not on the roster (${known.join(', ')}) — add it to ROSTER in config/show.mjs`);
    }
  }
  return (arg || process.env.SHOW || known[0]).toLowerCase();
}

// --- shell ----------------------------------------------------------------
export function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
}

// ImageMagick 7 installs `magick`; Ubuntu (and therefore the GitHub Actions
// runner) still ships v6, where the binary is `convert`. Resolve once.
let _magick;
export function magick(args) {
  if (!_magick) {
    for (const bin of ['magick', 'convert']) {
      try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); _magick = bin; break; } catch {}
    }
    if (!_magick) throw new Error('ImageMagick not found — install it (`brew install imagemagick` / `apt-get install imagemagick`)');
  }
  return run(_magick, args);
}

export function ffprobeDuration(path) {
  const out = run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    path,
  ]);
  return Number(out.trim());
}

export function fmtDuration(seconds) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`;
}

// Sorted, deliberately. The pool's order decides which track a week gets, so it
// has to be the same order everywhere: readdirSync returns directory order,
// which is usually alphabetical on a Mac and is not promised to be, and is a
// different filesystem again on a CI runner. Unsorted, the same week rendered
// in two places quietly gets different music.
export function listMusic(kind) {
  const dir = join(MUSIC, kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(mp3|wav|m4a|aac|flac)$/i.test(f))
    .sort()
    .map((f) => join(dir, f));
}

// How many weeks since a fixed Monday. The epoch is arbitrary and only has to
// never move; it exists so the rotation below has an ordinal to walk.
const WEEK_ZERO = Date.UTC(2026, 0, 5);   // Monday 2026-01-05
const weekOrdinal = (week) =>
  Math.floor((Date.parse(`${week}T00:00:00Z`) - WEEK_ZERO) / (7 * 86400 * 1000));

// Deterministic and non-repeating: the same week always picks the same track,
// and consecutive weeks always pick different ones.
//
// This used to hash the week string modulo the pool size, which gave the first
// property and only approximated the second — with six themes, two weeks
// running had a one-in-six chance of drawing the same one. The `history`
// argument that was supposed to prevent that was never passed by any caller:
// dead parameter, live bug.
//
// Storing what was used is the obvious fix and the wrong one, because weeks
// render on an ephemeral CI runner and a ledger on disk does not survive to the
// next render. Walking an ordinal needs no state at all — week N takes slot N,
// N+1 takes N+1, and a repeat is impossible until the pool wraps.
//
// `salt` offsets the walk so the theme, the bed and each episode's sting are on
// independent rotations instead of moving in lockstep.
//
// Stings fall back to the theme pool. A sting is a fifteen-second button and
// the mixer already trims and fades whatever it is handed, so a library of
// full-length tracks can supply one — no reason to go silent at every break
// just because nobody bought a cue package.
export function pickTrack(kind, week, salt = 0) {
  let pool = listMusic(kind);
  if (!pool.length && kind === 'sting') pool = listMusic('theme');
  if (!pool.length) return null;
  // Positive modulo: a week before the epoch gives a negative ordinal, and
  // JavaScript's % keeps the sign, which would index off the front of the pool.
  const n = weekOrdinal(week) + salt;
  return pool[((n % pool.length) + pool.length) % pool.length];
}

// --- text -----------------------------------------------------------------
export function countWords(s) {
  return (s.match(/\b[\w'’-]+\b/g) || []).length;
}

// Strip stage directions so only spoken words reach the TTS engine.
//
// Paragraph breaks are PRESERVED, and that is the point. Both OpenAI and Hume
// read a blank line as a structural boundary and give it breath; collapsing all
// whitespace to single spaces — which this used to do — handed the engine a
// 1000-character wall and threw away every pause the writer had built. An act
// with nineteen paragraphs was arriving as one. That is the difference between
// a narrator who lands a sentence and one who runs them together.
//
// Horizontal whitespace inside a paragraph is still collapsed, and runs of
// three or more newlines are normalised to two, so the engine sees exactly one
// kind of boundary.
export function spokenOnly(s) {
  return s
    .replace(/\[[^\]]*\]/g, ' ')   // [MUSIC], [STING], [PAUSE 3s]
    .replace(/\([^)]*\)/g, ' ')    // (beat)
    .replace(/^\s*[A-Z][A-Z ]+:\s*/gm, '') // SPEAKER:
    .replace(/[^\S\n]+/g, ' ')     // collapse spaces/tabs, keep newlines
    .replace(/ *\n */g, '\n')      // no trailing space around a break
    .replace(/\n{3,}/g, '\n\n')    // at most one blank line
    .trim();
}
