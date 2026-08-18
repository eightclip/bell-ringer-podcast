// Between the writer and the voice: make the text safe to say out loud.
//
// Two jobs, deliberately in one gate so neither can be skipped.
//
// 1. NAMES. No child's name goes into a script, a filename, or a feed. The
//    writer is told not to use them, but "told not to" is not a control. In
//    the show this came from, two episodes shipped opening with a child's name
//    before anyone noticed, because the instruction was guidance and nothing
//    checked it. This checks it.
//
//    The names themselves live in .env (PRIVATE_NAMES), never in the repo, so
//    the guard can be public while the thing it guards against is not.
//
// 2. PROSODY. A TTS engine reads punctuation as timing. Text written for the
//    eye — em dashes, semicolons, parentheticals, symbols, long clause chains —
//    lands flat, because the marks that carry the pause on a page do not carry
//    it in the ear. This rewrites the ones with reliable spoken equivalents and
//    reports the ones only a human can fix.

import { countWords, isMain, weekDir, currentShow, currentWeek, readJSON, writeJSON, ok, warn } from './lib.mjs';

// --- names ----------------------------------------------------------------

export function privateNames() {
  return (process.env.PRIVATE_NAMES || '')
    .split(',').map((n) => n.trim()).filter(Boolean);
}

const LISTENER_TERM = () => process.env.LISTENER_TERM || 'kiddo';

// Vocatives are the common case and each needs different punctuation repair:
// "Sam. The station" wants the sentence to start at "The", while
// "Morning, Sam." wants the comma to go with it. Handle the shapes, then
// fall back to a plain swap for anything left.
export function scrubNames(text, names = privateNames()) {
  if (!names.length) return { text, hits: [] };
  const hits = [];
  let out = text;

  for (const name of names) {
    const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const found = out.match(new RegExp(`\\b${n}\\b`, 'gi'));
    if (!found) continue;
    hits.push({ name, count: found.length });

    out = out
      // leading vocative: "Sam. The station is falling."
      .replace(new RegExp(`(^|\\n)\\s*${n}\\s*[.,!?]\\s*`, 'gi'), '$1')
      // trailing vocative: "Morning, Sam." / "Years, Sam."
      .replace(new RegExp(`\\s*,\\s*${n}\\b`, 'gi'), '')
      // dashed aside: "And Sam — the station"
      .replace(new RegExp(`\\b${n}\\s*—\\s*`, 'gi'), '')
      // anything left becomes a term of address
      .replace(new RegExp(`\\b${n}\\b`, 'gi'), LISTENER_TERM());
  }

  // Repair what removal left behind.
  out = out
    .replace(/(^|\n)\s*[,—]\s*/g, '$1')
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/([.!?])\s*\1+/g, '$1')
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/(^|\n)\s*And\s*\./g, '$1')
    .trim();

  return { text: out, hits };
}

// --- prosody rewrites -----------------------------------------------------
// Only changes with a reliable spoken equivalent. Anything ambiguous is left
// alone and reported instead — a wrong guess is worse than a warning.

const SYMBOLS = [
  [/(\d)\s*%/g, '$1 percent'],
  [/\$\s*(\d+(?:\.\d+)?)\s*(billion|million|trillion|thousand)/gi, '$1 $2 dollars'],
  [/\$\s*(\d+(?:\.\d+)?)/g, '$1 dollars'],
  [/(\d)\s*°\s*([CF])\b/g, (_, d, u) => `${d} degrees ${u === 'C' ? 'Celsius' : 'Fahrenheit'}`],
  [/(\d)\s*°/g, '$1 degrees'],
  [/\s*&\s*/g, ' and '],
  [/(\d)\s*[×x]\s*(\d)/g, '$1 times $2'],
  [/\s*\+\s*/g, ' plus '],
  [/(\d)\s*-\s*(\d)/g, '$1 to $2'],   // ranges read as "to", not "minus"
  [/\bvs\.?\b/gi, 'versus'],
  [/\be\.g\.\s*/gi, 'for example, '],
  [/\bi\.e\.\s*/gi, 'that is, '],
  [/\betc\.?/gi, 'and so on'],
];

export function normalizeForSpeech(text) {
  let out = text;
  for (const [re, to] of SYMBOLS) out = out.replace(re, to);

  return out
    // Curly punctuation is fine to say but noisy to diff; normalise it.
    .replace(/[""]/g, '"').replace(/['']/g, "'")
    // A semicolon is a page mark. Spoken, it is a full stop.
    .replace(/;\s*/g, '. ')
    // Ellipsis gets swallowed or read as a stumble. A full stop is the beat.
    .replace(/\s*\.{3,}\s*/g, '. ')
    .replace(/\s*…\s*/g, '. ')
    // Those two just created new sentences, so the next word has to be
    // capitalised. Without this, "as strong; three times" became "as strong.
    // three times" — which reads to the engine as a sentence starting on a
    // lowercase word and flattens the very beat the full stop was added for.
    .replace(/([.!?]\s+)([a-z])/g, (_, p, c) => p + c.toUpperCase())
    // Double hyphen for a dash — make it a real one so the dash rules apply.
    .replace(/\s*--\s*/g, ' — ')
    // ALL CAPS is read as shouting by one engine and spelled out by another.
    // Only long runs, though: acronyms are almost always six letters or fewer
    // and are pronounced correctly as-is, while emphasis-shouting tends to be
    // ordinary words. Lowercasing NIST to "Nist" is a worse outcome than
    // leaving a shouted word alone, so the heuristic errs that way.
    .replace(/\b[A-Z]{7,}\b/g, (w) => w[0] + w.slice(1).toLowerCase())
    .replace(/[^\S\n]{2,}/g, ' ')
    .trim();
}

// --- lint -----------------------------------------------------------------
// Reported, not rewritten. These need a writer, not a regex.

const sentencesOf = (t) =>
  t.replace(/\[[^\]]*\]/g, ' ').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

export function lintProsody(text, { label = '' } = {}) {
  const notes = [];
  const at = label ? `${label}: ` : '';

  for (const s of sentencesOf(text)) {
    const w = countWords(s);
    // Past about 30 words a synthesised read runs out of breath shape and the
    // sentence stops landing, regardless of how well it is punctuated.
    if (w > 30) notes.push(`${at}${w}-word sentence — split it: "${s.slice(0, 60)}…"`);
    // Commas are the only breath inside a sentence; four of them is a list the
    // ear cannot hold.
    if ((s.match(/,/g) || []).length >= 4) notes.push(`${at}four+ commas in one sentence: "${s.slice(0, 60)}…"`);
    // Two dashes make a parenthetical, and TTS flattens both ends of it.
    if ((s.match(/—/g) || []).length >= 2) notes.push(`${at}dashed aside will flatten: "${s.slice(0, 60)}…"`);
  }

  const paras = text.split(/\n\s*\n/).filter((p) => p.trim());
  if (paras.length === 1 && countWords(text) > 90)
    notes.push(`${at}one paragraph, ${countWords(text)} words — add breaks; they are the breath`);
  for (const p of paras) {
    if (sentencesOf(p).length > 7) notes.push(`${at}paragraph of ${sentencesOf(p).length} sentences — break it up`);
  }

  // A pause mid-sentence splits the clause across two TTS calls and the seam
  // is audible in a way a between-sentence seam is not.
  if (/[a-z,]\s*\[PAUSE/i.test(text)) notes.push(`${at}[PAUSE] mid-sentence — move it to a sentence boundary`);

  // Digits the writer forgot to spell out get read inconsistently between
  // engines; four-digit years are the usual offender.
  const digits = text.replace(/\[[^\]]*\]/g, '').match(/\b\d[\d,.]*\b/g);
  if (digits) notes.push(`${at}unexpanded numerals (${[...new Set(digits)].slice(0, 5).join(', ')}) — write them as words`);

  return notes;
}

// --- the gate -------------------------------------------------------------

export function applyProsody(text, { label = '' } = {}) {
  const { text: named, hits } = scrubNames(text);
  const out = normalizeForSpeech(named);
  return { text: out, nameHits: hits, notes: lintProsody(out, { label }) };
}

// --- CLI ------------------------------------------------------------------
// `npm run prosody <show> <week>` re-applies this gate to a scripts.json that
// was written before the gate existed, without paying the writer again. It
// rewrites in place and reports what changed; re-voice afterwards.

if (isMain(import.meta.url)) {
  const { join } = await import('node:path');
  const dir = weekDir(currentShow(), currentWeek());
  const file = join(dir, 'scripts.json');
  const doc = readJSON(file);
  if (!doc) { console.error(`No scripts.json at ${file}`); process.exit(1); }

  let changed = 0, names = 0;
  const allNotes = [];
  for (const ep of doc.episodes) {
    for (const seg of ep.segments) {
      const { text, nameHits, notes } = applyProsody(seg.text, { label: `part${ep.arc.part}/${seg.id}` });
      if (nameHits.length) { names += nameHits.reduce((n, h) => n + h.count, 0); }
      if (text !== seg.text) { seg.text = text; changed++; }
      allNotes.push(...notes);
    }
  }

  doc.prosody_applied_at = new Date().toISOString();
  writeJSON(file, doc);
  ok(`${changed} segment(s) rewritten, ${names} private name(s) removed`);
  if (allNotes.length) {
    warn(`${allNotes.length} thing(s) only a rewrite can fix:`);
    for (const n of allNotes.slice(0, 15)) console.log(`   · ${n}`);
    if (allNotes.length > 15) console.log(`   … and ${allNotes.length - 15} more`);
  }
  console.log(`\nRe-voice the affected parts, then re-assemble and publish.`);
}
