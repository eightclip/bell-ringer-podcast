// `npm run demo` — one episode, on your machine, from the bundled example
// curriculum. Nothing is uploaded and no feed is written.
//
// This exists because the honest first question about a repo like this is
// "what does it actually sound like?", and the honest answer costs money: the
// research stage reads real pages from real institutions and the voice stage
// bills per character. So the demo asks before it spends, renders one episode
// instead of five, and tells you where the file is.

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Only node builtins at module scope, on purpose. The pipeline modules pull in
// @anthropic-ai/sdk and @aws-sdk, so importing them up here would make
// `npm run demo` before `npm install` die with a module-resolution stack trace
// — which is exactly the first-run experience this file exists to prevent.
// Everything else is imported dynamically, after preflight has had its say.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SHOW = 'grade6';
const WEEK = '2026-09-07';   // first week of plans/example-year.json
const PART = 1;

// Measured on the reference show, not guessed: a five-episode week runs about
// $10 research + $1 scripts + $1.60 voice. One episode with the claim cap
// lowered is roughly a fifth of that, and the briefing does not get cheaper
// just because you only voice one part of it.
const ESTIMATE = '$2 to $4 of API credit (mostly Anthropic web research)';

function have(bin, args = ['-version']) {
  try { execFileSync(bin, args, { stdio: 'ignore' }); return true; } catch { return false; }
}

function preflight() {
  const problems = [];

  const [major] = process.versions.node.split('.').map(Number);
  if (major < 20) problems.push(`Node ${process.versions.node} — this needs Node 20 or newer.`);

  if (!process.env.ANTHROPIC_API_KEY)
    problems.push('ANTHROPIC_API_KEY is not set. Research and scripts need it. https://console.anthropic.com');

  const mode = process.env.VOICE_MODE || 'full-stock';
  if (mode === 'full-stock' && !process.env.OPENAI_API_KEY)
    problems.push('OPENAI_API_KEY is not set. https://platform.openai.com');
  if (mode !== 'full-stock' && !process.env.HUME_API_KEY)
    problems.push(`VOICE_MODE=${mode} needs HUME_API_KEY. Set VOICE_MODE=full-stock to use OpenAI only.`);

  if (!have('ffmpeg')) problems.push('ffmpeg not found on PATH.  macOS: brew install ffmpeg');
  if (!have('ffprobe')) problems.push('ffprobe not found on PATH (it ships with ffmpeg).');

  if (!existsSync(join(ROOT, 'plans', 'example-year.json')))
    problems.push('plans/example-year.json is missing — this is the demo curriculum.');

  const deps = Object.keys(
    JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).dependencies || {},
  );
  const missing = deps.filter((d) => !existsSync(join(ROOT, 'node_modules', d)));
  if (missing.length) problems.push(`Dependencies not installed (${missing.join(', ')}). Run: npm install`);

  if (!existsSync(join(ROOT, '.env')))
    console.log('\x1b[33m  ! no .env file — reading credentials from the environment instead\x1b[0m');

  return problems;
}

async function confirm() {
  if (process.argv.includes('--yes') || process.argv.includes('-y')) return true;
  if (!stdin.isTTY) {
    console.log('\x1b[33m  ! not a terminal — re-run with --yes to confirm the spend non-interactively\x1b[0m');
    return false;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  const a = (await rl.question(`\nThis will spend about ${ESTIMATE}. Continue? [y/N] `)).trim().toLowerCase();
  rl.close();
  return a === 'y' || a === 'yes';
}

export async function demo() {
  console.log('\n\x1b[1mBell Ringer — demo\x1b[0m');
  console.log('One episode, built locally from the bundled example curriculum.');
  console.log('Nothing is uploaded. No feed is written. No real child is involved.\n');

  const problems = preflight();
  if (problems.length) {
    console.log('\x1b[31mNot ready yet:\x1b[0m');
    for (const p of problems) console.log(`  • ${p}`);
    console.log('\nCopy .env.example to .env and fill in what is missing, then run this again.');
    process.exitCode = 1;
    return;
  }
  console.log('\x1b[32m  ✔ preflight passed\x1b[0m');

  if (!have('magick', ['-version']) && !have('convert', ['-version'])) {
    console.log('\x1b[33m  ! ImageMagick not found — skipping cover art. The audio is unaffected.\x1b[0m');
  }

  if (!(await confirm())) { console.log('Nothing spent. Exiting.'); return; }

  // Safe to load the pipeline now: dependencies are present and keys are set.
  const [{ research }, { writeScripts }, { voiceWeek }, { assembleWeek }, lib] =
    await Promise.all([
      import('./research.mjs'), import('./script.mjs'), import('./voice.mjs'),
      import('./assemble.mjs'), import('./lib.mjs'),
    ]);
  const { weekDir, readJSON, step, ok: okLog, warn: warnLog, log } = lib;

  // Keep the demo cheap: verification cost scales with the claim count, and
  // eight verified claims is plenty to show the mechanism working.
  process.env.MAX_CLAIMS ||= '8';

  // voiceWeek reads --part from argv; make sure it renders one episode even
  // when the caller did not pass the flag.
  if (!process.argv.includes('--part')) process.argv.push('--part', String(PART));

  const dir = weekDir(SHOW, WEEK);
  const reuse = (label, file) => {
    if (readJSON(join(dir, file))) { log(`${label}: reusing ${file}`); return true; }
    return false;
  };

  if (!reuse('research', 'research.json')) await research(SHOW, WEEK);
  if (!reuse('scripts', 'scripts.json')) await writeScripts(SHOW, WEEK);
  if (!reuse('voice', 'voice.json')) await voiceWeek(SHOW, WEEK);
  await assembleWeek(SHOW, WEEK);

  const episodes = readJSON(join(dir, 'episodes.json'));
  const first = episodes?.episodes?.[0];

  // Write the same ledger a full render writes, so the `npm run costs` we point
  // at below actually has something to report.
  const researchDoc = readJSON(join(dir, 'research.json'));
  const scriptsDoc = readJSON(join(dir, 'scripts.json'));
  const voiceDoc = readJSON(join(dir, 'voice.json'));
  const VOICE_RATE = 0.025 / 1000; // OpenAI; the demo is always full-stock
  const voiceUsd = (voiceDoc?.chars_rendered || 0) * VOICE_RATE;
  const ledger = {
    show: SHOW, week: WEEK, demo: true,
    research_usd: researchDoc?.cost_usd || 0,
    scripts_usd: scriptsDoc?.cost_usd || 0,
    voice_usd: Number(voiceUsd.toFixed(4)),
    total_usd: Number(((researchDoc?.cost_usd || 0) + (scriptsDoc?.cost_usd || 0) + voiceUsd).toFixed(4)),
    voice_mode: voiceDoc?.mode,
    episodes: episodes?.episodes?.length || 0,
    claims: researchDoc?.claims?.length || 0,
    claims_cut: researchDoc?.rejected?.length || 0,
    tokens: researchDoc?.tokens || null,
  };
  lib.writeJSON(join(dir, 'cost.json'), ledger);

  step('Done');
  if (first?.file) {
    okLog(`Episode: ${first.file}`);
    console.log(`\n  Play it:      open "${first.file}"`);
  } else {
    warnLog(`No episode file recorded — look in ${join(dir, 'episodes')}`);
  }
  console.log(`  Sources:      ${join(dir, 'sources.json')}`);
  console.log(`  What it cost: npm run costs\n`);
  console.log('  To make this yours: docs/SETUP.md\n');
}

// Inlined rather than imported from lib.mjs so this file stays dependency-free
// until preflight runs. Compares resolved paths because a space in the
// directory name makes the naive `file://` + argv[1] comparison fail silently.
const isMain = (url) => resolve(fileURLToPath(url)) === resolve(process.argv[1] || '');

if (isMain(import.meta.url)) {
  demo().catch((e) => {
    console.error(`\n\x1b[31m✖ ${e.message}\x1b[0m`);
    process.exit(1);
  });
}
