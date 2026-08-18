// The whole week, one command.
//
//   npm run week              -> next Monday
//   npm run week 2026-08-17   -> that week
//   npm run week -- --dry-run -> everything except the R2 upload
//
// Each stage is resumable on its own; this just chains them and reports what
// the week cost.

import { join } from 'node:path';
import { research } from './research.mjs';
import { writeScripts } from './script.mjs';
import { voiceWeek } from './voice.mjs';
import { makeWeekArt } from './art.mjs';
import { assembleWeek } from './assemble.mjs';
import { publishWeek } from './publish.mjs';
import { refreshFeed } from './feed.mjs';
import { currentWeek, currentShow, weekDir, readJSON, writeJSON, step, ok, warn, log, fmtDuration, isMain } from './lib.mjs';
import { loadPlan, planWeek } from './plan.mjs';
import { getJSON, put } from './r2.mjs';
import { getShow, showIds } from '../config/show.mjs';

const has = (f) => process.argv.includes(f);

export async function runWeek(showId, week) {
  const show = getShow(showId);
  const dryRun = has('--dry-run');
  const dir = weekDir(showId, week);
  const t0 = Date.now();
  console.log(`\n\x1b[1m${show.title} — week of ${week}\x1b[0m${dryRun ? ' \x1b[33m(dry run)\x1b[0m' : ''}`);

  // Each stage skips if its output already exists, so a failed run resumes
  // instead of paying for the research again.
  const skip = (name, file) => {
    if (has('--force')) return false;
    const exists = readJSON(join(dir, file));
    if (exists) { log(`  ${name}: reusing ${file} (--force to redo)`); return true; }
    return false;
  };

  if (!skip('research', 'research.json')) await research(showId, week);
  if (!skip('scripts', 'scripts.json')) await writeScripts(showId, week);
  if (!skip('voice', 'voice.json')) await voiceWeek(showId, week);
  // Artwork is not allowed to take the week down — episodes with no cover still
  // play — but it must not fail quietly either, because a silent skip is only
  // discovered when the show looks broken in someone's podcast app. It is
  // retried once and then reported loudly, and `npm run verify` checks the art
  // actually landed rather than trusting this.
  if (!skip('artwork', 'art.json')) {
    await makeWeekArt(showId, week).catch(async (e) => {
      warn(`artwork failed (${e.message}) — retrying once`);
      await makeWeekArt(showId, week).catch((e2) => {
        warn(`ARTWORK MISSING for ${showId} ${week}: ${e2.message}`);
        warn('episodes will publish without cover art — re-run: npm run art ' + showId + ' ' + week);
      });
    });
  }
  if (!skip('assembly', 'episodes.json')) await assembleWeek(showId, week);

  await publishWeek(showId, week, { dryRun });
  if (!dryRun) await refreshFeed(showId);

  // --- what did the week cost? -------------------------------------------
  const r = readJSON(join(dir, 'research.json'));
  const s = readJSON(join(dir, 'scripts.json'));
  const v = readJSON(join(dir, 'voice.json'));
  const e = readJSON(join(dir, 'episodes.json'));

  const claude = (r?.cost_usd || 0) + (s?.cost_usd || 0);
  const voiceChars = v?.chars_rendered || 0;
  const voiceCost = (voiceChars / 1000) * 0.12;
  const runtime = e?.episodes.reduce((n, x) => n + x.seconds, 0) || 0;

  // Written to disk and shipped to R2 next to the manifest. The console line
  // below only lives in a CI log that expires, and "what does this actually
  // cost to run" is a question worth being able to answer in six months.
  const t = r?.tokens;
  const ledger = {
    show: showId, week, built_at: new Date().toISOString(),
    research_usd: Number((r?.cost_usd || 0).toFixed(4)),
    scripts_usd: Number((s?.cost_usd || 0).toFixed(4)),
    voice_usd: Number(voiceCost.toFixed(4)),
    total_usd: Number((claude + voiceCost).toFixed(4)),
    voice_chars: voiceChars,
    voice_mode: v?.mode,
    episodes: e?.episodes.length || 0,
    seconds: Math.round(runtime),
    claims: r?.claims.length || 0,
    claims_cut: r?.rejected.length || 0,
    tokens: t || null,
  };
  writeJSON(join(dir, 'cost.json'), ledger);
  if (!dryRun) {
    await put(`cost/${showId}/${week}.json`, JSON.stringify(ledger), 'application/json', { immutable: false })
      .catch((err) => warn(`cost ledger not uploaded: ${err.message}`));
  }

  step('Week complete');
  console.log(`  episodes    ${e?.episodes.length || 0} · ${fmtDuration(runtime)} total`);
  console.log(`  verified    ${r?.claims.length || 0} claims (${r?.rejected.length || 0} cut)`);
  console.log(`  topic       ${r?.topic?.title || '?'}`);
  console.log(`  research    $${(r?.cost_usd || 0).toFixed(2)}${t ? `  (${(t.cache_read / 1000).toFixed(0)}k cached reads)` : ''}`);
  console.log(`  scripts     $${(s?.cost_usd || 0).toFixed(2)}`);
  console.log(`  voice       $${voiceCost.toFixed(2)} (${voiceChars.toLocaleString()} chars, ${v?.mode})`);
  console.log(`  \x1b[1mtotal       $${(claude + voiceCost).toFixed(2)}\x1b[0m`);
  console.log(`  wall clock  ${fmtDuration((Date.now() - t0) / 1000)}`);
}

// A show with no lesson plan for this week isn't a failure, it just isn't
// running yet — grade 7 has no plan file at all. Saying so plainly is the
// difference between a workflow that means something and one that is red every
// week for a known reason.
function plannedFor(showId, week) {
  const plan = loadPlan(getShow(showId));
  return Boolean(plan && planWeek(plan, week));
}

// Has this week already been rendered and published?
//
// The stage-skipping inside runWeek only helps when build/ is still on disk,
// and on a GitHub runner it never is — only the voice cache is restored, so a
// re-run redoes the research from scratch and pays for it again. R2 is the
// only durable record of what has actually shipped, so ask it. Without this,
// triggering a render manually and then letting the Sunday cron fire buys the
// same week twice, and the second copy quietly overwrites the first with
// different audio.
async function alreadyPublished(showId, week) {
  try {
    return Boolean(await getJSON(`manifest/${showId}/${week}.json`));
  } catch {
    return false; // can't reach R2 — let the run proceed and fail honestly later
  }
}

if (isMain(import.meta.url)) {
  // `--all-shows` runs every show for the week, which is what the Sunday cron
  // wants. Shows are isolated from each other on purpose: one failing must not
  // stop the others, and — more importantly — must not make a successful run
  // look like a failed one. A workflow that goes red every week for a reason
  // you already know is a workflow you stop reading, and then a real failure
  // arrives looking exactly like the noise.
  const week = currentWeek();
  const all = has('--all-shows');
  const shows = all ? showIds() : [currentShow()];

  (async () => {
    const done = [], failed = [], unplanned = [], published = [];

    for (const id of shows) {
      if (all && !plannedFor(id, week)) {
        warn(`${id}: no lesson plan for week of ${week} — skipping`);
        unplanned.push(id);
        continue;
      }
      if (!has('--force') && await alreadyPublished(id, week)) {
        ok(`${id}: week of ${week} is already published — skipping (--force to rebuild)`);
        published.push(id);
        continue;
      }
      try {
        await runWeek(id, week);
        done.push(id);
      } catch (err) {
        console.error(`\n\x1b[31m✖ ${id}: ${err.message}\x1b[0m`);
        failed.push(id);
        if (!all) throw err;
      }
    }

    if (all) {
      console.log(`\n\x1b[1mweek of ${week}\x1b[0m`);
      if (done.length) ok(`rendered: ${done.join(', ')}`);
      if (published.length) log(`  already published: ${published.join(', ')}`);
      if (unplanned.length) log(`  no plan yet: ${unplanned.join(', ')}`);
      if (failed.length) console.error(`\x1b[31m  failed: ${failed.join(', ')}\x1b[0m`);

      // Only a show that was actually attempted can fail the job. The two skip
      // reasons are both success: a show with no plan is the steady state until
      // grade 7 has one, and a week that is already published is exactly what
      // a re-run should do. Failing on either would make the workflow red for
      // reasons that are entirely correct, which is how you end up not reading
      // it. The one genuine failure is having nothing to do AND no reason.
      if (failed.length) process.exit(1);
      if (!done.length && !published.length && !unplanned.length) {
        warn('no shows were run at all — check the show configuration');
        process.exit(1);
      }
    }
  })().catch((err) => {
    console.error(`\n\x1b[31m✖ ${err.message}\x1b[0m`);
    process.exit(1);
  });
}
