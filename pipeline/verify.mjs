// Is next week actually ready to air?
//
//   npm run verify                 the upcoming week, every show
//   npm run verify grade6          one show
//   npm run verify grade6 2026-08-31
//
// This is the Sunday check. The render workflow going green means the job
// finished, not that five listenable episodes with artwork are sitting in a
// feed — artwork is allowed to fail without taking the week down, an upload
// can half-land, and a feed can be valid while pointing at a file that 404s.
// So this asks the questions a listener's podcast app will ask, over the
// public internet, using only the published URLs.

import { getJSON } from './r2.mjs';
import { currentWeek, mondayOf, step, ok, warn, log, isMain, fmtDuration } from './lib.mjs';
import { getShow, showIds, BRAND } from '../config/show.mjs';
import { loadPlan, planWeek } from './plan.mjs';

const base = () => (process.env.R2_PUBLIC_BASE || '').replace(/\/$/, '');
const feedUrl = (id) => `${base()}/feed/${process.env.FEED_TOKEN}/${id}.xml`;

// HEAD, because these are 7MB files and we only care that they are there and
// the right size. Range support matters too: without it a podcast app cannot
// resume or seek, which is the difference between a show that works in a car
// and one that restarts every time the signal drops.
async function head(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20000) });
    return { ok: r.ok, status: r.status, length: Number(r.headers.get('content-length') || 0),
             type: r.headers.get('content-type') || '', ranges: r.headers.get('accept-ranges') || '' };
  } catch (e) {
    return { ok: false, status: 0, error: e.message, length: 0, type: '', ranges: '' };
  }
}

export async function verifyWeek(showId, week) {
  const show = getShow(showId);
  const problems = [];
  const note = (m) => { problems.push(m); warn(`  ${m}`); };

  step(`${show.title} — week of ${week}`);

  const plan = loadPlan(show);
  if (!plan || !planWeek(plan, week)) {
    log('  no lesson plan for this week — nothing expected');
    return { showId, week, skipped: true, problems: [] };
  }

  // getJSON throws on a missing key rather than returning null, and "this week
  // has not been rendered yet" is the single most likely thing to be checking
  // for. It must report, not crash.
  const manifest = await getJSON(`manifest/${showId}/${week}.json`).catch(() => null);
  if (!manifest) {
    note('NOT RENDERED — no manifest in R2');
    return { showId, week, problems };
  }

  const eps = manifest.episodes || [];
  if (eps.length !== 5) note(`${eps.length} episodes, expected 5`);

  // Every episode: audio reachable, size matches what the feed promises,
  // ranges supported, artwork present.
  let totalSeconds = 0;
  for (const e of eps) {
    const a = await head(e.audioUrl);
    totalSeconds += e.seconds || 0;
    if (!a.ok) note(`part${e.part} audio ${a.status || a.error}`);
    else {
      if (a.length !== e.bytes) note(`part${e.part} audio is ${a.length}B but the feed says ${e.bytes}B`);
      if (!/audio\/mpeg/.test(a.type)) note(`part${e.part} audio content-type is ${a.type}`);
      if (!/bytes/.test(a.ranges)) note(`part${e.part} audio does not support Range — apps cannot seek or resume`);
    }
    if (!e.artUrl) note(`part${e.part} has NO artwork`);
    else {
      const art = await head(e.artUrl);
      if (!art.ok) note(`part${e.part} artwork ${art.status || art.error}`);
    }
  }

  // Show cover — Apple requires it and rejects a feed whose cover 404s.
  const cover = await head(`${base()}/art/cover-${showId}.jpg`);
  if (!cover.ok) note(`show cover ${cover.status || cover.error}`);

  // The feed itself, fetched publicly the way a podcast app would.
  const fr = await fetch(feedUrl(showId), { signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!fr?.ok) note(`feed ${fr?.status || 'unreachable'}`);
  else {
    const xml = await fr.text();
    if (BRAND.listed && /<itunes:block>/.test(xml)) note('feed still carries itunes:block while the show is meant to be listed');
    for (const e of eps) {
      // Present in the feed *file* is what matters; the date gate decides when
      // each becomes visible, and that is checked below.
      if (!xml.includes(e.guid)) {
        const due = new Date(e.pubDateISO) <= new Date();
        if (due) note(`part${e.part} is due but missing from the feed`);
      }
    }
  }

  // When each one actually appears, so a wrong air date is visible before
  // Monday rather than after it.
  log(`  ${eps.length} episodes · ${fmtDuration(totalSeconds)} · airs:`);
  for (const e of eps) {
    const d = new Date(e.pubDateISO);
    log(`    part${e.part}  ${d.toUTCString().slice(0, 16)}  ${e.duration}  ${e.title}`);
  }

  if (!problems.length) ok('  ready to air');
  return { showId, week, problems };
}

export async function verify(showFilter = null, week = null) {
  const wk = week || mondayOf();
  const shows = showFilter ? [showFilter] : showIds();
  const results = [];
  for (const id of shows) results.push(await verifyWeek(id, wk));

  const bad = results.filter((r) => r.problems.length);
  console.log('');
  if (bad.length) {
    warn(`${bad.length} show(s) not ready — ${bad.reduce((n, r) => n + r.problems.length, 0)} problem(s)`);
    return false;
  }
  ok(`week of ${wk} is ready`);
  return true;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const show = args.find((a) => showIds().includes(a.toLowerCase()));
  const week = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  verify(show || null, week || null)
    .then((okAll) => process.exit(okAll ? 0 : 1))
    .catch((e) => { console.error(`\n\x1b[31m✖ ${e.message}\x1b[0m`); process.exit(1); });
}
