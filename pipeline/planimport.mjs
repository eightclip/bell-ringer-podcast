// Expand a block plan into a week-by-week plan.
//
// Waldorf schools teach in Main Lesson blocks: three to five weeks on one
// subject. That's the right shape for a class and the wrong shape for a daily
// show — four straight weeks of "Astronomy" would produce four versions of the
// same episode.
//
// So each week gets its own slice of the block's topic list. The researcher
// still sees the whole block for context, but it's told which facet is this
// week's, and which ones already aired.
//
//   node pipeline/planimport.mjs grade6

import { join } from 'node:path';
import { ROOT, readJSON, writeJSON, step, ok, log, warn, isMain, currentShow } from './lib.mjs';

const iso = (d) => d.toISOString().slice(0, 10);

function mondayOnOrAfter(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  const day = d.getDay();            // 0 Sun .. 6 Sat
  const delta = day === 1 ? 0 : (8 - day) % 7;
  d.setDate(d.getDate() + delta);
  return d;
}

function mondayOfWeekContaining(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

const overlapsBreak = (monday, breaks) => {
  const friday = new Date(monday); friday.setDate(friday.getDate() + 4);
  return breaks.find((b) => {
    const bs = new Date(`${b.start}T00:00:00`);
    const be = new Date(`${b.end}T23:59:59`);
    // Skip only if the break swallows most of the school week.
    let off = 0;
    for (let i = 0; i < 5; i++) {
      const d = new Date(monday); d.setDate(d.getDate() + i);
      if (d >= bs && d <= be) off++;
    }
    return off >= 3;
  });
};

// Deal the block's topics across its weeks: every week gets at least one, and
// the remainder spread from the front so early weeks carry the extra.
function dealTopics(topics, nWeeks) {
  const out = Array.from({ length: nWeeks }, () => []);
  if (!nWeeks) return out;
  const per = Math.floor(topics.length / nWeeks);
  const extra = topics.length % nWeeks;
  let i = 0;
  for (let w = 0; w < nWeeks; w++) {
    const take = per + (w < extra ? 1 : 0);
    out[w] = topics.slice(i, i + take);
    i += take;
  }
  // A block with fewer topics than weeks would leave a week empty; give those
  // weeks the whole block and let the researcher choose a fresh angle.
  return out.map((t) => (t.length ? t : topics));
}

export function expand(blocks) {
  const weeks = [];

  for (const b of blocks.blocks) {
    // First school week of the block, then every Monday until it ends.
    const first = mondayOfWeekContaining(b.start);
    const last = new Date(`${b.end}T12:00:00`);
    const mondays = [];
    for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 7)) {
      const m = new Date(d);
      const skipped = overlapsBreak(m, blocks.breaks);
      if (skipped) { log(`  skipping ${iso(m)} — ${skipped.name}`); continue; }
      mondays.push(m);
    }
    if (!mondays.length) { warn(`block ${b.n} "${b.title}" produced no weeks`); continue; }

    const slices = dealTopics(b.topics, mondays.length);
    const reader = blocks.readers.find((r) => r.blocks.includes(b.n));

    mondays.forEach((m, i) => {
      const focus = slices[i];
      const covered = slices.slice(0, i).flat();
      weeks.push({
        week: iso(m),
        block: b.n,
        block_title: b.title,
        week_of_block: i + 1,
        weeks_in_block: mondays.length,
        subject: b.title,
        essential_question: b.essential_question,
        focus,
        already_covered: covered,
        vocabulary: b.vocabulary,
        reader: reader ? reader.title : null,
        unit: [
          `Main Lesson block ${b.n}: ${b.title} (week ${i + 1} of ${mondays.length}).`,
          `The block's essential question: ${b.essential_question}`,
          '',
          `THIS WEEK'S FOCUS — build the five episodes around these:`,
          ...focus.map((t) => `  • ${t}`),
          covered.length ? `\nAlready covered in earlier weeks of this block — do not repeat:\n${covered.map((t) => `  • ${t}`).join('\n')}` : '',
          `\nVocabulary the class is using: ${b.vocabulary.join(', ')}`,
          reader ? `\nThe class is reading "${reader.title}" alongside this block. ${reader.about}` : '',
        ].filter(Boolean).join('\n'),
      });
    });
  }

  return weeks.sort((a, b) => (a.week < b.week ? -1 : 1));
}

export function buildPlan(showId) {
  const src = join(ROOT, 'plans', `${showId}-blocks.json`);
  const blocks = readJSON(src);
  if (!blocks) throw new Error(`No block plan at ${src}`);

  step(`Expanding ${blocks.blocks.length} blocks into weeks`);
  const weeks = expand(blocks);

  const out = join(ROOT, 'plans', `${showId}-year.json`);
  writeJSON(out, {
    show: showId,
    source: blocks.source,
    school_year: blocks.school_year,
    generated_at: new Date().toISOString(),
    weeks,
  });

  ok(`${weeks.length} weeks → plans/${showId}-year.json`);
  return weeks;
}

if (isMain(import.meta.url)) {
  try {
    const weeks = buildPlan(currentShow());
    console.log();
    let block = null;
    for (const w of weeks) {
      if (w.block !== block) {
        block = w.block;
        console.log(`\x1b[1mBlock ${w.block} — ${w.block_title}\x1b[0m`);
      }
      console.log(`  ${w.week}  wk ${w.week_of_block}/${w.weeks_in_block}  ${w.focus[0].slice(0, 68)}`);
    }
  } catch (e) {
    console.error(`\n\x1b[31m✖ ${e.message}\x1b[0m`);
    process.exit(1);
  }
}
