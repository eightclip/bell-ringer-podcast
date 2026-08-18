// Stage 4 — mix the show.
//
// Each segment is rendered to its own normalized WAV first, then concatenated.
// One monolithic filtergraph would be shorter and completely undebuggable when
// a single music bed comes out wrong.

import { existsSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { getShow, BRAND, SEGMENTS, AUDIO, VOICE_CHAIN, MASTER_CHAIN } from '../config/show.mjs';
import { currentWeek, currentShow, weekDir, readJSON, writeJSON, MUSIC, step, ok, warn, log, run, ffprobeDuration, fmtDuration, listMusic, pickTrack, isMain } from './lib.mjs';

const q = (s) => String(s).replace(/'/g, "'\\''");

// Integrated loudness of a file, or null if it can't be measured (silence).
// This is the measurement the whole mix hangs off: nothing gets a gain applied
// until we know what level it is actually at.
function measureI(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 1 << 26 });
  const out = `${r.stderr || ''}`;
  const tail = out.slice(out.lastIndexOf('Integrated loudness'));
  const m = tail.match(/I:\s*(-?[\d.]+)/);
  const i = m ? Number(m[1]) : null;
  // loudnorm reports -inf (or absurdly low) for silence; a gain toward the
  // anchor would then amplify noise by 60 dB.
  return i === null || !Number.isFinite(i) || i < -70 ? null : i;
}

// dB of static gain needed to bring `file` to `target` LUFS. Static, not
// dynamic: a compressor belongs in VOICE_CHAIN where it is deliberate, not
// smuggled in via the normaliser.
function gainTo(file, target) {
  const i = measureI(file);
  if (i === null) return null;
  return Math.round((target - i) * 10) / 10;
}

// Every intermediate is 32-bit float. The segments get a static gain applied
// after their own limiter, which can legitimately push a peak above 0 dBFS —
// in 16-bit that is hard clipping several stages before the master limiter
// ever sees it. Float costs disk in a scratch directory and nothing else.
const FLOAT = ['-c:a', 'pcm_f32le'];

// Cut the excerpt that will actually be used, at unity gain, so it can be
// measured. Measuring the source track instead is the bug this exists to
// avoid: the theme measured -10.5 LUFS over its full length but -22.4 across
// the fifteen seconds the show actually plays, so gaining it "to -23" put it
// at -40 and made it inaudible.
function cutExcerpt(track, seconds, out) {
  run('ffmpeg', ['-y', '-v', 'error',
    '-stream_loop', '-1', '-i', track,
    '-t', String(seconds),
    '-af', `aresample=${AUDIO.sampleRate}`,
    '-ac', String(AUDIO.channels), ...FLOAT, out]);
  return out;
}

// --- a gap between two spoken segments -----------------------------------
// Written as its own file rather than padded onto the end of a segment so the
// chapter offsets stay honest: the gap belongs between two chapters, not inside
// the one before it.
function renderGap(seconds, out) {
  run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-t', String(seconds), '-ac', String(AUDIO.channels), ...FLOAT, out]);
  return seconds;
}

// --- music-only segment (theme, stings) ----------------------------------
function renderMusicBed(track, seconds, out, { fadeIn = 1.2, fadeOut = 1.8, target } = {}) {
  if (!track) {
    // No music supplied yet — a beat of silence keeps the structure intact so
    // the episode is still listenable and correctly timed.
    run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
      '-t', String(seconds), '-ac', String(AUDIO.channels), ...FLOAT, out]);
    return;
  }
  const raw = cutExcerpt(track, seconds, out.replace(/\.wav$/, '.raw.wav'));
  const gain = gainTo(raw, target) ?? 0;
  run('ffmpeg', [
    '-y', '-v', 'error', '-i', raw,
    '-af', [
      `volume=${gain}dB`,
      `afade=t=in:st=0:d=${fadeIn}`,
      `afade=t=out:st=${Math.max(0, seconds - fadeOut)}:d=${fadeOut}`,
    ].join(','),
    '-ac', String(AUDIO.channels), ...FLOAT, out,
  ]);
}

// --- speech, optionally over a bed ---------------------------------------
//
// Rendered in two passes on purpose. The voice chain runs first, the result is
// measured, and only then is a static gain applied to land the segment on
// AUDIO.speechAnchor. Measuring after the chain rather than before it means the
// compressor's own makeup gain is accounted for, and — the point of the whole
// exercise — a voice clone and a library voice come out of it at the same
// loudness instead of 4.5 dB apart.
// Turn music cues into a gain envelope for the bed.
//
// One trapezoid per in/out pair — up over FADE_IN, hold, down over FADE_OUT —
// and the overall gain is the maximum across them, so overlapping or adjacent
// cues merge instead of fighting. An `in` with no matching `out` runs to the
// end of the segment, which is what a writer means by "and let it play out".
//
// This has to be one expression rather than a chain of afade filters: afade
// t=in silences everything before its start, so a second fade-in would erase
// the first window rather than following it.
const FADE_IN = 2.0;
const FADE_OUT = 2.5;

function cueEnvelope(cues, dur) {
  const windows = [];
  let open = null;
  for (const c of cues) {
    if (c.action === 'in' || c.action === 'swell') {
      if (open === null) open = c.at;
    } else if (c.action === 'out' && open !== null) {
      windows.push([open, c.at]);
      open = null;
    }
  }
  if (open !== null) windows.push([open, dur]);
  if (!windows.length) return null;

  // No backslash-escaping of the commas: the expression is wrapped in single
  // quotes in the filtergraph below, which is what protects them. Escaping as
  // well passes literal backslashes to the evaluator and it rejects the lot.
  const trapezoid = ([t0, t1]) =>
    `max(0,min(1,min((t-${t0.toFixed(2)})/${FADE_IN},(${(t1 + FADE_OUT).toFixed(2)}-t)/${FADE_OUT})))`;
  return windows.map(trapezoid).reduce((acc, w) => (acc ? `max(${acc},${w})` : w), '');
}

function renderSpeech(speechFile, out, { bed = null, cues = [] } = {}) {
  const dur = ffprobeDuration(speechFile);
  const dry = out.replace(/\.wav$/, '.dry.wav');

  run('ffmpeg', ['-y', '-v', 'error', '-i', speechFile,
    '-af', `${VOICE_CHAIN},aresample=${AUDIO.sampleRate}`,
    '-ac', String(AUDIO.channels), ...FLOAT, dry]);

  const gain = gainTo(dry, AUDIO.speechAnchor) ?? 0;

  if (!bed) {
    run('ffmpeg', ['-y', '-v', 'error', '-i', dry,
      '-af', `volume=${gain}dB`, '-ac', String(AUDIO.channels), ...FLOAT, out]);
    return dur;
  }

  // Bed ducked under the voice, fading up at the head and out under the tail.
  // Measured on the excerpt, for the same reason the theme is — and gained
  // against the anchor, so "-18 dB under speech" finally means -18 dB under
  // speech rather than -18 dB under whatever that track shipped at.
  const bedRaw = cutExcerpt(bed, dur, out.replace(/\.wav$/, '.bed.wav'));
  const bedGain = gainTo(bedRaw, AUDIO.speechAnchor + AUDIO.musicBedGain) ?? AUDIO.musicBedGain;

  // With cues, the bed follows the script. Without them it runs under the whole
  // segment, which is right for a welcome or an outro and wrong for a five
  // minute act — music that never stops stops being heard.
  const env = cueEnvelope(cues, dur);
  const bedShape = env
    ? `volume=${bedGain}dB,volume='${env}':eval=frame`
    : `volume=${bedGain}dB,afade=t=in:st=0:d=1.5,afade=t=out:st=${Math.max(0, dur - 2)}:d=2`;

  run('ffmpeg', [
    '-y', '-v', 'error',
    '-i', dry,
    '-i', bedRaw,
    '-filter_complex',
    `[1:a]${bedShape}[bed];` +
    `[0:a]volume=${gain}dB[v];` +
    `[v][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]`,
    '-map', '[out]',
    '-ac', String(AUDIO.channels), ...FLOAT,
    out,
  ]);
  return dur;
}

// ffmpeg's loudnorm in one pass is a dynamic normaliser and lands a decibel or
// two off target — a mix asking for -16 LUFS measured -17.8. Two-pass measures
// the programme first and then applies a linear gain, which hits the number
// exactly. That matters here because these play in a car against road noise.
function loudnormFilter(input) {
  const probe = `loudnorm=I=${AUDIO.loudnessTarget}:TP=${AUDIO.truePeak}:LRA=11:print_format=json`;
  // ffmpeg prints the loudnorm JSON to stderr and still exits 0, so
  // execFileSync (which returns stdout only) sees nothing. spawnSync gives us
  // both streams.
  let measured = null;
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', input, '-af', probe, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 1 << 26 });
  const blob = `${r.stderr || ''}${r.stdout || ''}`;
  const start = blob.lastIndexOf('{');
  if (start !== -1) { try { measured = JSON.parse(blob.slice(start, blob.lastIndexOf('}') + 1)); } catch {} }
  if (!measured?.input_i) {
    warn('two-pass loudness measurement failed — falling back to single pass');
    return `loudnorm=I=${AUDIO.loudnessTarget}:TP=${AUDIO.truePeak}:LRA=11`;
  }
  return [
    `loudnorm=I=${AUDIO.loudnessTarget}`,
    `TP=${AUDIO.truePeak}`,
    'LRA=11',
    `measured_I=${measured.input_i}`,
    `measured_LRA=${measured.input_lra}`,
    `measured_TP=${measured.input_tp}`,
    `measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}`,
    'linear=true',
    'print_format=summary',
  ].join(':');
}

export async function assembleWeek(showId, week) {
  const show = getShow(showId);
  const dir = weekDir(showId, week);
  const voice = readJSON(join(dir, 'voice.json'));
  const scripts = readJSON(join(dir, 'scripts.json'));
  if (!voice) throw new Error(`No voice.json for ${showId} ${week} — run: npm run voice ${showId} ${week}`);

  const haveMusic = ['theme', 'sting', 'bed'].some((k) => listMusic(k).length);
  if (!haveMusic) {
    warn(`no music in ${MUSIC}/{theme,sting,bed} — rendering with silent breaks so timing stays correct`);
    warn(`drop tracks in those folders and re-run assemble; nothing else needs to change`);
  }

  const outDir = join(dir, 'episodes');
  mkdirSync(outDir, { recursive: true });
  const built = [];

  for (const ep of voice.episodes) {
    step(`Mixing ${ep.day} — ${ep.title}`);
    const work = join(dir, 'audio', `part${ep.part}`, 'mix');
    mkdirSync(work, { recursive: true });

    // One track per week for the theme, so the week sounds like a set; stings
    // rotate per episode so the breaks don't get monotonous.
    const theme = pickTrack('theme', week);
    const bed = pickTrack('bed', week, 7);
    const parts = [];
    let cursor = 0;
    const chapters = [];

    let prevSpoken = null;   // the last segment that had a voice

    for (const spec of SEGMENTS) {
      const wav = join(work, `${spec.id}.wav`);
      let seconds;

      // Adjacent spoken segments need air between them. A change of voice gets
      // a real beat; the same voice starting a new movement gets a short one.
      // Music segments reset this, because a theme or a sting already separates
      // what is either side of it.
      if (spec.voice && prevSpoken) {
        const gap = prevSpoken.voice === spec.voice ? AUDIO.sameVoiceGap : AUDIO.voiceChangeGap;
        if (gap > 0) {
          const gapFile = join(work, `gap-${prevSpoken.id}-${spec.id}.wav`);
          cursor += renderGap(gap, gapFile);
          parts.push(gapFile);
        }
      }

      if (!spec.voice) {
        const track = spec.music === 'theme' ? theme : pickTrack('sting', week, spec.id.length + ep.part);
        seconds = spec.seconds;
        const solo = { target: AUDIO.speechAnchor + AUDIO.musicSoloGain };
        renderMusicBed(track, seconds, wav,
          spec.music === 'theme' ? solo : { ...solo, fadeIn: 0.6, fadeOut: 1.0 });
      } else {
        const seg = ep.segments.find((s) => s.id === spec.id);
        if (!seg) { warn(`no audio for ${spec.id} — skipping`); continue; }
        // A cue in the script is itself a request for music, so it supplies a
        // bed to segments that carry none by default — which is every act.
        const segCues = seg.cues || [];
        const wantsBed = spec.music === 'under_soft' || segCues.length > 0;
        seconds = renderSpeech(seg.file, wav, { bed: wantsBed ? bed : null, cues: segCues });
      }

      chapters.push({ id: spec.id, label: spec.label, start: cursor, seconds });
      cursor += seconds;
      parts.push(wav);
      prevSpoken = spec.voice ? spec : null;
    }

    // Concat, then loudness-normalise the whole show in one pass so levels are
    // consistent across segments rather than per-segment.
    const listFile = join(work, 'concat.txt');
    writeFileSync(listFile, parts.map((p) => `file '${q(p)}'`).join('\n'));

    // Flatten to one file first so loudness is measured across the whole
    // programme — music, speech and silence together — rather than per segment.
    const flat = join(work, 'flat.wav');
    run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-ac', String(AUDIO.channels), '-ar', String(AUDIO.sampleRate), ...FLOAT, flat]);

    const mp3 = join(outDir, `part${ep.part}-${ep.day.toLowerCase()}.mp3`);
    run('ffmpeg', [
      '-y', '-v', 'error',
      '-i', flat,
      '-af', `${loudnormFilter(flat)},${MASTER_CHAIN},aresample=${AUDIO.sampleRate}`,
      '-ac', String(AUDIO.channels),
      '-c:a', 'libmp3lame', '-b:a', AUDIO.bitrate,
      '-metadata', `title=${ep.title}`,
      '-metadata', `artist=${BRAND.author}`,
      '-metadata', `album=${show.title}`,
      '-metadata', `date=${week}`,
      '-metadata', `track=${ep.part}`,
      '-metadata', `genre=Podcast`,
      '-metadata', `comment=${ep.teaser}`,
      mp3,
    ]);

    const dur = ffprobeDuration(mp3);
    const bytes = (await import('node:fs')).statSync(mp3).size;
    ok(`${ep.day}: ${fmtDuration(dur)}  ${(bytes / 1e6).toFixed(1)} MB`);
    if (dur < 420) warn(`under 7 minutes — shorter than intended`);
    if (dur > 960) warn(`over 16 minutes — longer than the drive allows`);

    built.push({
      part: ep.part, day: ep.day, title: ep.title, teaser: ep.teaser,
      file: mp3, seconds: dur, bytes, chapters,
      script: scripts?.episodes.find((e) => e.arc.part === ep.part) || null,
    });
  }

  writeJSON(join(dir, 'episodes.json'), { show: showId, week, title: show.title, built_at: new Date().toISOString(), episodes: built });
  const total = built.reduce((n, e) => n + e.seconds, 0);
  ok(`week assembled — ${built.length} episodes, ${fmtDuration(total)} total`);
  return built;
}

if (isMain(import.meta.url)) {
  assembleWeek(currentShow(), currentWeek()).catch((e) => {
    console.error(`\n\x1b[31m✖ ${e.message}\x1b[0m`);
    process.exit(1);
  });
}
