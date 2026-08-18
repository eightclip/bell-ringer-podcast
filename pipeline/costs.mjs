// What this show actually costs to run.
//
//   npm run costs            every week that has ever been rendered
//   npm run costs grade6     one show
//
// Reads the ledgers written next to each manifest in R2, so it survives the
// CI logs expiring and works from any machine. The point is to be able to
// answer "is this getting cheaper or more expensive" with data rather than
// with a memory of one run.

import { list, getJSON } from './r2.mjs';
import { step, ok, log, warn, isMain } from './lib.mjs';
import { showIds } from '../config/show.mjs';

const usd = (n) => `$${n.toFixed(2)}`;

export async function ledgers(showFilter = null) {
  const shows = showFilter ? [showFilter] : showIds();
  const out = [];
  for (const id of shows) {
    const keys = (await list(`cost/${id}/`)).filter((k) => k.endsWith('.json'));
    for (const k of keys) {
      const j = await getJSON(k);
      if (j) out.push(j);
    }
  }
  return out.sort((a, b) => (a.week < b.week ? -1 : 1));
}

export async function report(showFilter = null) {
  const rows = await ledgers(showFilter);
  if (!rows.length) {
    warn('no cost ledgers in R2 yet — they are written from the next render onward');
    return null;
  }

  step(`Cost per week — ${rows.length} week(s) rendered`);
  console.log(`  ${'week'.padEnd(12)}${'show'.padEnd(9)}${'research'.padStart(9)}${'scripts'.padStart(9)}${'voice'.padStart(8)}${'total'.padStart(9)}   cache`);

  for (const r of rows) {
    const t = r.tokens;
    // The share of input tokens that came from cache rather than being paid
    // for fresh. Low here means the caching stopped working, which is the
    // single thing most likely to make this expensive again.
    const hit = t && (t.cache_read + t.cache_write + t.input)
      ? `${Math.round((t.cache_read / (t.cache_read + t.cache_write + t.input)) * 100)}%`
      : '—';
    console.log(
      `  ${r.week.padEnd(12)}${r.show.padEnd(9)}` +
      `${usd(r.research_usd).padStart(9)}${usd(r.scripts_usd).padStart(9)}` +
      `${usd(r.voice_usd).padStart(8)}${usd(r.total_usd).padStart(9)}   ${hit}`,
    );
  }

  const sum = (f) => rows.reduce((n, r) => n + (r[f] || 0), 0);
  const total = sum('total_usd');
  const perWeek = total / rows.length;

  console.log('');
  ok(`${usd(total)} across ${rows.length} week(s) — ${usd(perWeek)} per week`);
  log(`  research ${usd(sum('research_usd'))} · scripts ${usd(sum('scripts_usd'))} · voice ${usd(sum('voice_usd'))}`);
  // A school year is about 37 teaching weeks, which is what the year plan holds.
  log(`  at this rate: ${usd(perWeek * 4.33)}/month · ${usd(perWeek * 37)} for a 37-week school year`);
  return { rows, total, perWeek };
}

if (isMain(import.meta.url)) {
  const show = process.argv.slice(2).find((a) => showIds().includes(a.toLowerCase()));
  report(show || null).catch((e) => {
    console.error(`\n\x1b[31m✖ ${e.message}\x1b[0m`);
    process.exit(1);
  });
}
