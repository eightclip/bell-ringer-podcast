import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
export function currentShow(known = ['grade6', 'grade7']) {
  const arg = process.argv.slice(2).find((a) => known.includes(a.toLowerCase()));
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

export function listMusic(kind) {
  const dir = join(MUSIC, kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(mp3|wav|m4a|aac|flac)$/i.test(f))
    .map((f) => join(dir, f));
}

// Deterministic-but-varied pick: same week always picks the same track (so a
// re-render is reproducible), but consecutive weeks don't repeat.
//
// Stings fall back to the theme pool. A sting is a fifteen-second button and
// the mixer already trims and fades whatever it is handed, so a library of
// full-length tracks can supply one — no reason to go silent at every break
// just because nobody bought a cue package.
export function pickTrack(kind, week, salt = 0, history = []) {
  let pool = listMusic(kind);
  if (!pool.length && kind === 'sting') pool = listMusic('theme');
  if (!pool.length) return null;
  const fresh = pool.filter((p) => !history.includes(p));
  const from = fresh.length ? fresh : pool;
  let h = salt;
  for (const c of week) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return from[h % from.length];
}

// --- text -----------------------------------------------------------------
export function countWords(s) {
  return (s.match(/\b[\w'’-]+\b/g) || []).length;
}

// Strip stage directions so only spoken words reach the TTS engine.
export function spokenOnly(s) {
  return s
    .replace(/\[[^\]]*\]/g, ' ')   // [MUSIC], [STING], [PAUSE 3s]
    .replace(/\([^)]*\)/g, ' ')    // (beat)
    .replace(/^\s*[A-Z][A-Z ]+:\s*/gm, '') // SPEAKER:
    .replace(/\s+/g, ' ')
    .trim();
}
