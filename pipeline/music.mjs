// Sort a pile of music into themes, stings and beds.
//
// The three roles are genuinely different jobs and the difference is
// measurable, so there is no reason to make a human file them by hand:
//
//   sting  short, self-contained, ends cleanly. Punctuation between acts.
//   theme  the recognisable one. Plays alone at the top and tail.
//   bed    plays UNDERNEATH a voice at -18 dB. Wants a narrow loudness range
//          and a dark spectrum; anything bright and dynamic fights the speech.
//
//   npm run music            measure everything in music/_inbox and print a plan
//   npm run music -- --apply move the files
//
// Nothing moves without --apply.

import { readdirSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { MUSIC, writeJSON, step, ok, warn, log, isMain, fmtDuration } from './lib.mjs';

const INBOX = join(MUSIC, '_inbox');
const AUDIO_RE = /\.(mp3|wav|m4a|flac|aac|aif|aiff|ogg)$/i;

function ffprobeJSON(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file],
    { encoding: 'utf8' });
  try { return Number(JSON.parse(r.stdout).format.duration); } catch { return 0; }
}

// ebur128 gives loudness and — more usefully here — loudness RANGE, which is
// the single best predictor of whether a track can sit under a voice.
function loudness(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 1 << 26 });
  const out = `${r.stderr}`;
  const grab = (label) => {
    const m = out.match(new RegExp(`${label}:\\s*(-?[\\d.]+)`));
    return m ? Number(m[1]) : null;
  };
  const tail = out.slice(out.lastIndexOf('Integrated loudness'));
  const i = (tail.match(/I:\s*(-?[\d.]+)/) || [])[1];
  const lra = (tail.match(/LRA:\s*(-?[\d.]+)/) || [])[1];
  return { lufs: i ? Number(i) : grab('I'), lra: lra ? Number(lra) : grab('LRA') };
}

// Spectral centroid is "brightness" in one number: where the weight of the
// spectrum sits. A bed wants it low, a theme can carry it high.
function spectrum(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-t', '45',
    '-af', 'aspectralstats=measure=centroid+flatness,ametadata=print:file=-', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 1 << 26 });
  const blob = `${r.stdout}${r.stderr}`;
  const nums = (key) => [...blob.matchAll(new RegExp(`${key}=([\\d.]+)`, 'g'))].map((m) => Number(m[1]));
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return {
    centroid: mean(nums('lavfi\\.aspectralstats\\.1\\.centroid')) ?? mean(nums('centroid')),
    flatness: mean(nums('lavfi\\.aspectralstats\\.1\\.flatness')) ?? mean(nums('flatness')),
  };
}

// Filenames are evidence too — libraries label this stuff, and a human naming a
// file "logo" or "underscore" knew what it was for.
function nameHint(file) {
  const n = basename(file).toLowerCase();
  if (/\b(sting|logo|ident|bumper|button|tag|transition|whoosh|riser)\b/.test(n)) return 'sting';
  if (/\b(bed|underscore|under|loop|ambient|drone|texture|backing|pad)\b/.test(n)) return 'bed';
  if (/\b(theme|intro|opener|main title|titles)\b/.test(n)) return 'theme';
  return null;
}

const vocalSuspect = (file) => /\b(vocal|vox|sing|choir|lyric|feat\.?)\b/i.test(basename(file));

export function classify(m) {
  const hint = nameHint(m.file);
  const why = [];

  // A short cue is a sting almost regardless of anything else — there isn't
  // enough of it to be a theme and it can't loop under three minutes of speech.
  if (m.seconds <= 30) { why.push(`${Math.round(m.seconds)}s — too short for anything else`); return { role: 'sting', why, hint }; }

  if (hint) { why.push(`filename says "${hint}"`); return { role: hint, why, hint }; }

  const dark = m.centroid !== null && m.centroid < 2400;
  const steady = m.lra !== null && m.lra <= 6;

  if (steady && dark) {
    why.push(`loudness range ${m.lra} LU (steady)`, `centroid ${Math.round(m.centroid)} Hz (dark)`);
    return { role: 'bed', why, hint };
  }
  if (m.seconds <= 45) {
    why.push(`${Math.round(m.seconds)}s and ${m.lra ?? '?'} LU — short and dynamic`);
    return { role: 'sting', why, hint };
  }
  why.push(
    m.lra !== null ? `loudness range ${m.lra} LU` : 'loudness range unknown',
    m.centroid !== null ? `centroid ${Math.round(m.centroid)} Hz` : 'centroid unknown',
  );
  return { role: 'theme', why, hint };
}

export function analyse(file) {
  const seconds = ffprobeJSON(file);
  const { lufs, lra } = loudness(file);
  const { centroid, flatness } = spectrum(file);
  const m = { file, seconds, lufs, lra, centroid, flatness };
  return { ...m, ...classify(m) };
}

export function sortInbox({ apply = false } = {}) {
  if (!existsSync(INBOX)) { warn(`nothing at ${INBOX}`); return []; }
  const files = readdirSync(INBOX).filter((f) => AUDIO_RE.test(f)).map((f) => join(INBOX, f));
  if (!files.length) { warn('inbox is empty'); return []; }

  step(`Measuring ${files.length} track(s)`);
  const results = [];
  for (const f of files) {
    const a = analyse(f);
    results.push(a);
    const flag = vocalSuspect(f) ? '  ⚠ possible vocal' : '';
    log(`  ${basename(f).slice(0, 46).padEnd(46)} ${fmtDuration(a.seconds).padStart(6)}  →  ${a.role.padEnd(5)}${flag}`);
    log(`      ${a.why.join(' · ')}`);
  }

  const counts = results.reduce((n, r) => ({ ...n, [r.role]: (n[r.role] || 0) + 1 }), {});
  ok(`theme ${counts.theme || 0} · sting ${counts.sting || 0} · bed ${counts.bed || 0}`);

  const vocals = results.filter((r) => vocalSuspect(r.file));
  if (vocals.length) {
    warn(`${vocals.length} filename(s) suggest vocals — pull these out by hand, a voice under a voice is unlistenable:`);
    for (const v of vocals) log(`      ${basename(v.file)}`);
  }

  if (!apply) { warn('nothing moved — re-run with --apply to file them'); return results; }

  for (const r of results) {
    const dest = join(MUSIC, r.role);
    mkdirSync(dest, { recursive: true });
    let target = join(dest, basename(r.file));
    let n = 1;
    while (existsSync(target)) {
      const e = extname(r.file);
      target = join(dest, `${basename(r.file, e)}-${n++}${e}`);
    }
    renameSync(r.file, target);
  }
  writeJSON(join(MUSIC, 'library.json'), {
    sorted_at: new Date().toISOString(),
    tracks: results.map(({ file, seconds, lufs, lra, centroid, role }) => ({
      name: basename(file), role, seconds: Math.round(seconds), lufs, lra,
      centroid: centroid === null ? null : Math.round(centroid),
    })),
  });
  ok(`filed ${results.length} track(s)`);
  return results;
}

if (isMain(import.meta.url)) {
  try {
    sortInbox({ apply: process.argv.includes('--apply') });
  } catch (e) {
    console.error(`\n\x1b[31m✖ ${e.message}\x1b[0m`);
    process.exit(1);
  }
}
