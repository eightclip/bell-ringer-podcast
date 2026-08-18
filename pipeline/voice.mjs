// Stage 3 — speak the scripts.
//
// Renders per chunk, not per episode, and caches by content hash. That means a
// single bad line is a four-second re-render instead of twenty-four minutes,
// and re-running the week after a script tweak only pays for what changed.

import { createHash } from 'node:crypto';
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getShow, segmentSpec, VOICE_MODE, VOICE_MODES, HUME_VOICES, OPENAI_VOICE, OPENAI_TTS_MODEL, VOICE_DIRECTION } from '../config/show.mjs';
import { currentWeek, currentShow, weekDir, readJSON, writeJSON, need, step, ok, warn, log, run, ffprobeDuration, fmtDuration, spokenOnly, isMain, ROOT } from './lib.mjs';

const CACHE = join(ROOT, 'build', '.voice-cache');
const MAX_CHARS = 1800; // well inside Hume's per-utterance ceiling; keeps retries cheap

// --- chunking -------------------------------------------------------------
// Split on explicit pauses first, then on sentence boundaries. Never split
// mid-sentence — a seam inside a sentence is audible, a seam between them is not.
export function chunk(text) {
  const parts = [];
  for (const piece of text.split(/(\[PAUSE\s+([\d.]+)s\])/i)) {
    if (!piece) continue;
    const pause = piece.match(/^\[PAUSE\s+([\d.]+)s\]$/i);
    if (pause) { parts.push({ kind: 'silence', seconds: Number(pause[1]) }); continue; }
    if (/^[\d.]+$/.test(piece)) continue; // the capture group from the split
    const clean = spokenOnly(piece);
    if (!clean) continue;

    let buf = '';
    for (const sentence of clean.match(/[^.!?]+[.!?]*\s*/g) || [clean]) {
      if (buf.length + sentence.length > MAX_CHARS && buf) { parts.push({ kind: 'speech', text: buf.trim() }); buf = ''; }
      buf += sentence;
    }
    if (buf.trim()) parts.push({ kind: 'speech', text: buf.trim() });
  }
  return parts;
}

// --- engines --------------------------------------------------------------
async function humeSay(text, voice, outPath, opts = {}, attempt = 1) {
  const res = await fetch('https://api.hume.ai/v0/tts/file', {
    method: 'POST',
    headers: { 'X-Hume-Api-Key': need('HUME_API_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({
      utterances: [{
        text,
        voice: { id: voice.id, provider: voice.provider },
        // Acting instructions. Octave applies `description` as direction when a
        // voice is already specified, which is how one clone covers a cold open
        // and an outro without sounding identical.
        ...(opts.direction ? { description: opts.direction } : {}),
        ...(opts.speed ? { speed: opts.speed } : {}),
        ...(opts.trailingSilence ? { trailing_silence: opts.trailingSilence } : {}),
      }],
      format: { type: 'mp3' },
    }),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    if (res.status >= 500 && attempt < 5) {
      const wait = attempt * 12;
      warn(`Hume ${res.status} — retrying in ${wait}s (${attempt}/4)`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      return humeSay(text, voice, outPath, opts, attempt + 1);
    }
    throw new Error(`Hume ${res.status}: ${body}`);
  }
  writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
}

async function openaiSay(text, role, outPath, attempt = 1, direction = null) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${need('OPENAI_API_KEY')}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice: OPENAI_VOICE,
      input: text,
      instructions: [VOICE_DIRECTION[role], direction].filter(Boolean).join(' '),
      response_format: 'mp3',
    }),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    if (res.status >= 500 && attempt < 5) {
      const wait = attempt * 8;
      warn(`OpenAI ${res.status} — retrying in ${wait}s (${attempt}/4)`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      return openaiSay(text, role, outPath, attempt + 1, direction);
    }
    throw new Error(`OpenAI TTS ${res.status}: ${body}`);
  }
  writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
}

async function say(text, { engine, role, direction, speed, trailingSilence }, outPath) {
  if (engine === 'openai') return openaiSay(text, role, outPath, 1, direction);
  const voice = HUME_VOICES[engine]?.();
  if (!voice?.id) throw new Error(`No Hume voice for engine "${engine}" — set HUME_VOICE_DAD / HUME_VOICE_HOST in .env`);
  return humeSay(text, voice, outPath, { direction, speed, trailingSilence });
}

// --- silence --------------------------------------------------------------
function silence(seconds, outPath) {
  run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(seconds), '-c:a', 'libmp3lame', '-b:a', '64k', outPath]);
}

// --- main -----------------------------------------------------------------
export async function voiceWeek(showId, week) {
  const show = getShow(showId);
  const dir = weekDir(showId, week);
  const { episodes } = readJSON(join(dir, 'scripts.json')) || {};
  if (!episodes) throw new Error(`No scripts.json for ${showId} ${week} — run: npm run script ${showId} ${week}`);

  mkdirSync(CACHE, { recursive: true });
  const modeRoles = VOICE_MODES[VOICE_MODE];
  log(`voice mode: ${VOICE_MODE} (dad=${modeRoles.dad}, host=${modeRoles.host})`);

  let chars = 0, cached = 0, rendered = 0;
  const byEngine = {};
  const manifest = [];

  // --part N renders one episode instead of the week. Useful for hearing a
  // change without paying to re-voice four episodes that didn't change.
  const onlyPart = Number(process.argv.find((a, i) => process.argv[i - 1] === '--part')) || null;
  const todo = onlyPart ? episodes.filter((e) => e.arc.part === onlyPart) : episodes;
  if (onlyPart) log(`rendering part ${onlyPart} only`);

  for (const ep of todo) {
    step(`Voicing ${ep.arc.day} — ${ep.title}`);
    const audioDir = join(dir, 'audio', `part${ep.arc.part}`);
    mkdirSync(audioDir, { recursive: true });
    const segs = [];

    for (const seg of ep.segments) {
      const engine = modeRoles[seg.role];
      const spec = segmentSpec(seg.id) || {};
      const pieces = chunk(seg.text);
      const files = [];

      for (const [i, p] of pieces.entries()) {
        const out = join(audioDir, `${seg.id}-${String(i).padStart(2, '0')}.mp3`);
        if (p.kind === 'silence') {
          silence(p.seconds, out);
          files.push(out);
          continue;
        }
        // Cache key covers the text AND the voice, so switching modes re-renders.
        const key = createHash('sha256').update(`${engine}|${seg.role}|${OPENAI_VOICE}|${JSON.stringify(HUME_VOICES[engine]?.() || '')}|${spec.direction || ''}|${spec.speed || ''}|${p.text}`).digest('hex').slice(0, 24);
        const cachePath = join(CACHE, `${key}.mp3`);
        if (existsSync(cachePath)) {
          writeFileSync(out, readFileSync(cachePath));
          cached++;
        } else {
          await say(p.text, { engine, role: seg.role, direction: spec.direction, speed: spec.speed, trailingSilence: spec.trailingSilence }, out);
          writeFileSync(cachePath, readFileSync(out));
          chars += p.text.length;
          byEngine[engine] = (byEngine[engine] || 0) + p.text.length;
          rendered++;
        }
        files.push(out);
      }

      // Stitch this segment's chunks into one file.
      const segOut = join(audioDir, `${seg.id}.mp3`);
      if (files.length === 1) {
        writeFileSync(segOut, readFileSync(files[0]));
      } else {
        const listFile = join(audioDir, `${seg.id}.txt`);
        writeFileSync(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
        // Re-encode rather than stream-copy. Concatenating MP3s with -c copy
        // splices frame headers whose timestamps don't line up, which ffmpeg
        // reports as non-monotonic DTS and which can audibly glitch at the
        // seam. One re-encode per segment is cheap insurance.
        run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
          '-c:a', 'libmp3lame', '-b:a', '64k', '-ar', '44100', '-ac', '1', segOut]);
      }
      const dur = ffprobeDuration(segOut);
      segs.push({ id: seg.id, role: seg.role, engine, file: segOut, seconds: dur });
      log(`  ${seg.id.padEnd(12)} ${fmtDuration(dur).padStart(6)}  ${engine}`);
    }

    const total = segs.reduce((n, s) => n + s.seconds, 0);
    ok(`${ep.arc.day}: ${fmtDuration(total)} of speech`);
    manifest.push({ part: ep.arc.part, day: ep.arc.day, title: ep.title, teaser: ep.teaser, segments: segs, speech_seconds: total });
  }

  // Hume bills per character (~$0.12/1k on Creator); OpenAI per audio token,
  // which works out around a fifth of that. Reporting one blended number was
  // misleading in hybrid mode, where most characters go to the cheap engine.
  const RATE = { hume: 0.12 / 1000, 'hume-host': 0.12 / 1000, openai: 0.025 / 1000 };
  const est = Object.entries(byEngine).reduce((n, [e, c]) => n + c * (RATE[e] ?? 0.12 / 1000), 0);
  const split = Object.entries(byEngine).map(([e, c]) => `${e} ${c.toLocaleString()}`).join(', ') || 'none';
  // Merge into any existing manifest so a single-part render doesn't discard
  // the episodes that were already voiced.
  const prev = readJSON(join(dir, 'voice.json'))?.episodes ?? [];
  const merged = onlyPart
    ? [...prev.filter((e) => !manifest.some((m) => m.part === e.part)), ...manifest].sort((a, b) => a.part - b.part)
    : manifest;

  writeJSON(join(dir, 'voice.json'), { show: showId, week, mode: VOICE_MODE, chars_rendered: chars, chunks_rendered: rendered, chunks_cached: cached, episodes: merged });
  ok(`${rendered} rendered, ${cached} cached — ${split} chars (~$${est.toFixed(2)})`);
  return manifest;
}

if (isMain(import.meta.url)) {
  voiceWeek(currentShow(), currentWeek()).catch((e) => {
    console.error(`\n\x1b[31m✖ ${e.message}\x1b[0m`);
    process.exit(1);
  });
}
