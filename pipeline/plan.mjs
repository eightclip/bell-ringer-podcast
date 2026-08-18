// Where a week's subject comes from.
//
// Two shows, two answers. One teacher published the whole year, so those
// weeks come from a calendar and the show runs without anyone remembering to
// do anything. The other's arrive by email, so they come from the paste-in page.
//
// A year plan is the difference between a system and a chore.

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { ROOT, readJSON, log, warn } from './lib.mjs';

// --- year plan ------------------------------------------------------------
// plans/<show>-year.json:
// {
//   "show": "grade6",
//   "source": "6th Grade Class Resources.pdf",
//   "weeks": [ { "week": "2026-08-17", "subject": "...", "unit": "...", "notes": "..." } ]
// }
export function loadPlan(show) {
  if (!show.planFile) return null;
  const p = join(ROOT, show.planFile);
  if (!existsSync(p)) {
    warn(`${show.kid.name} has a year plan configured (${show.planFile}) but the file is missing`);
    return null;
  }
  return readJSON(p);
}

// Exact week match first; otherwise the most recent entry that has started, so
// a multi-week unit keeps running rather than the show going silent.
export function planWeek(plan, week) {
  if (!plan?.weeks?.length) return null;
  const exact = plan.weeks.find((w) => w.week === week);
  if (exact) return exact;

  const started = plan.weeks
    .filter((w) => w.week <= week)
    .sort((a, b) => (a.week < b.week ? 1 : -1));
  if (!started.length) return null;

  const carried = started[0];
  // Don't carry a unit forward indefinitely — a stale plan should fail loudly
  // rather than quietly rerunning September in March.
  const days = (new Date(week) - new Date(carried.week)) / 86400000;
  if (days > 21) return null;
  return { ...carried, carried_from: carried.week };
}

function describe(entry) {
  return [
    entry.subject ? `Subject: ${entry.subject}` : null,
    entry.unit,
    entry.notes,
  ].filter(Boolean).join('\n\n');
}

// --- pasted input ---------------------------------------------------------
async function pastedUnit(show, week, dir) {
  const local = readJSON(join(dir, 'input.json'));
  if (local?.[show.kid.id]) return local[show.kid.id];

  // The site writes to R2; pull it down so a laptop and a CI runner behave the
  // same way without anyone syncing files by hand.
  try {
    const { getJSON } = await import('./r2.mjs');
    const remote = await getJSON(`input/${week}.json`);
    if (remote?.[show.kid.id]) {
      log(`  pulled ${show.kid.name}'s lesson plan from R2`);
      return remote[show.kid.id];
    }
  } catch {
    // No R2 configured, or nothing pasted yet — not an error on its own.
  }
  return null;
}

/** The week's subject for this show, however it arrives. */
export async function unitFor(show, week, dir) {
  const plan = loadPlan(show);
  if (plan) {
    const entry = planWeek(plan, week);
    if (entry) {
      if (entry.carried_from) log(`  carrying forward the unit that began ${entry.carried_from}`);
      return describe(entry);
    }
    warn(`${show.kid.name}'s year plan has nothing for ${week} — falling back to pasted input`);
  }
  return pastedUnit(show, week, dir);
}

/** Every week the plan covers, for scheduling and sanity-checking. */
export function planWeeks(show) {
  const plan = loadPlan(show);
  return plan?.weeks?.map((w) => w.week).sort() ?? [];
}
