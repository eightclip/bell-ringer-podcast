// Stage 3 — speak the scripts.
//
// Renders per chunk, not per episode, and caches by content hash. That means a
// single bad line is a four-second re-render instead of twenty-four minutes,
// and re-running the week after a script tweak only pays for what changed.

import { createHash } from 'node:crypto';
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getShow, segmentSpec, VOICE_MODE, VOICE_MODES, HUME_VOICES, OPENAI_VOICE, OPENAI_TTS_MODEL, VOICE_DIRECTION, AUDIO } from '../config/show.mjs';
import { currentWeek, currentShow, weekDir, readJSON, writeJSON, need, step, ok, warn, log, run, ffprobeDuration, fmtDuration, spokenOnly, isMain, ROOT } from './lib.mjs';
import { scrubNames, privateNames } from './prosody.mjs';

const CACHE = join(ROOT, 'build', '.voice-cache');
const MAX_CHARS = 1800; // well inside Hume's per-utterance ceiling; keeps retries cheap

// --- chunking -------------------------------------------------------------
// Split on explicit pauses and music cues first, then on sentence boundaries.
// Never split mid-sentence — a seam inside a sentence is audible, a seam
// between them is not.
//
// Music cues are why this splits on markers rather than just stripping them.
// A cue's whole point is WHERE it lands: "the bed comes in on this line". Making
// it a chunk boundary is what turns a position in the text into a position in
// the finished audio, because every chunk before it has a measured duration.
// That is the same trick [PAUSE] already used; the cue just carries no audio.
export function chunk(text) {
  const parts = [];
  for (const piece of text.split(/(\[PAUSE\s+[\d.]+s\]|\[MUSIC[^\]]*\])/i)) {
    if (!piece) continue;
    const pause = piece.match(/^\[PAUSE\s+([\d.]+)s\]$/i);
    if (pause) { parts.push({ kind: 'silence', seconds: Number(pause[1]) }); continue; }
    const cue = piece.match(/^\[MUSIC\s+(in|out|swell)\b[^\]]*\]$/i);
    if (cue) { parts.push({ kind: 'cue', action: cue[1].toLowerCase() }); continue; }
    // Malformed cue: drop it rather than speak it — but say so. Dropping was
    // always right (nobody wants "bracket music up" read aloud); doing it
    // silently was not. The writer asked for music, the bed never arrives, and
    // the only evidence is an act that sounds dry.
    if (/^\[MUSIC/i.test(piece)) {
      warn(`dropped a malformed music cue ${piece.trim()} — only [MUSIC in|out|swell] is understood`);
      continue;
    }
    // Last line of defence. script.mjs already scrubbed this, but a scripts.json
    // written before that gate existed would otherwise be voiced as-is — which
    // is exactly how a name reached two published episodes. Cheap, and it makes
    // the guarantee hold for old build directories too.
    const { text: safe, hits } = scrubNames(piece);
    if (hits.length) warn(`name reached the voice stage and was removed — re-run: npm run script`);
    const clean = spokenOnly(safe);
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
  // Same rate and bitrate as everything else it will be concatenated with.
  run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi',
    '-i', `anullsrc=r=${AUDIO.sampleRate}:cl=mono`, '-t', String(seconds),
    '-c:a', 'libmp3lame', '-b:a', '160k', '-ar', String(AUDIO.sampleRate), outPath]);
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
      // Where each cue lands in the finished segment. A cue has no audio, so
      // its timestamp is simply how much audio precedes it — which is only
      // knowable here, after each preceding chunk has been rendered and
      // measured. Assembly turns these into a volume envelope.
      const cues = [];
      let elapsed = 0;

      for (const [i, p] of pieces.entries()) {
        if (p.kind === 'cue') {
          cues.push({ action: p.action, at: Number(elapsed.toFixed(3)) });
          continue;
        }
        const out = join(audioDir, `${seg.id}-${String(i).padStart(2, '0')}.mp3`);
        if (p.kind === 'silence') {
          silence(p.seconds, out);
          files.push(out);
          elapsed += p.seconds;
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
        elapsed += ffprobeDuration(out);
      }

      // Stitch this segment's chunks into one file.
      const segOut = join(audioDir, `${seg.id}.mp3`);
      if (files.length === 1) {
        writeFileSync(segOut, readFileSync(files[0]));
      } else {
        const listFile = join(audioDir, `${seg.id}.txt`);
        writeFileSync(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));

        // The concat FILTER, not the concat demuxer, and this matters.
        //
        // The demuxer requires every input to share stream parameters, and here
        // they never did: OpenAI returns 24 kHz mp3, generated silence was made
        // at 44.1 kHz, and Hume returns something else again. Splicing across
        // that parameter change put an audible click at every [PAUSE] — right
        // where a deliberate silence was supposed to make a line land, which is
        // the worst possible place for one. Trailing -ar on the encoder did not
        // help, because the damage happened at the demuxer before the encoder
        // ever saw it.
        //
        // The filter decodes each input separately, so aresample can bring them
        // to a common rate before they are joined. Encoding at 160k rather than
        // 64k because this is an intermediate: it is decoded again in assembly
        // and re-encoded to AUDIO.bitrate, and there is no reason to spend a
        // generation of lossy artefacts on a file nobody ever hears.
        const inputs = files.flatMap((f) => ['-i', f]);
        const chain = files
          .map((_, i) => `[${i}:a]aresample=${AUDIO.sampleRate},aformat=channel_layouts=mono[a${i}]`)
          .join(';');
        const joined = files.map((_, i) => `[a${i}]`).join('');
        run('ffmpeg', ['-y', '-v', 'error', ...inputs,
          '-filter_complex', `${chain};${joined}concat=n=${files.length}:v=0:a=1[out]`,
          '-map', '[out]',
          '-c:a', 'libmp3lame', '-b:a', '160k',
          '-ar', String(AUDIO.sampleRate), '-ac', String(AUDIO.channels), segOut]);
      }
      const dur = ffprobeDuration(segOut);
      segs.push({ id: seg.id, role: seg.role, engine, file: segOut, seconds: dur, cues });
      const cueNote = cues.length ? `  music: ${cues.map((c) => `${c.action}@${fmtDuration(c.at)}`).join(' ')}` : '';
      log(`  ${seg.id.padEnd(12)} ${fmtDuration(dur).padStart(6)}  ${engine}${cueNote}`);
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
