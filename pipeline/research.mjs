// Stage 1 — research one show's week, then prove it.
//
// Two things happen here, and the second one is the point:
//
//   1. Claude researches the week's topic using web search + web fetch that are
//      hard-restricted to config/sources.mjs. It cannot reach a content farm.
//   2. Every factual claim it wants to put on air is re-checked against its
//      own cited page. A claim survives only if a verbatim quote from that page
//      actually supports it. Claims that fail are CUT, not softened.
//
// One kid per show now, so there is one topic and no bridge to find — which
// makes this both simpler and cheaper than the combined version.

import { join } from 'node:path';
import { ask, askJSON, costOf, webTools, MODEL, VERIFY_MODEL } from './claude.mjs';
import { isAllowedSource } from '../config/sources.mjs';
import { getShow, WEEK_ARC, BRAND } from '../config/show.mjs';
import { unitFor } from './plan.mjs';
import { currentWeek, currentShow, weekDir, readJSON, writeJSON, step, ok, warn, log, isMain } from './lib.mjs';

const researchSystem = (show) => `You are the researcher for "${show.title}", an education podcast for ${show.kid.name}, who is in grade ${show.kid.grade}.

Your sources are hard-restricted to museums, national laboratories, government agencies, national libraries, universities, and peer-reviewed open textbooks. You physically cannot reach anything else, so do not try — search within what you have.

What good research looks like here:
- Go to primary and institutional sources. A NASA page on how a spectrometer works beats a summary of that page.
- Find the specific over the general. "The 1854 Broad Street pump" is a show; "disease spreads through water" is a worksheet.
- Find the human beings. Who was in the room, what did they get wrong first, what did it cost them.
- Find where the simple version taught in school breaks down. That is Thursday's episode and it is usually the most interesting one.
- Note genuine expert disagreement where it exists. Never manufacture a controversy the sources do not support.

Do not write a script. Do not write for children yet. Produce a dense, accurate briefing that a writer will turn into five short episodes.

Write about the SUBJECT, never about the sources. Nobody listening cares what a museum's exhibition "explores" or that an agency publishes a free curriculum — they care how the thing works and what happened. Never describe a page; teach what is on it.

Every factual claim you make must be attributable to a page you actually fetched, and you must be able to quote the sentence that supports it.`;

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    topic: {
      type: 'object',
      properties: {
        subject: { type: 'string' },
        title: { type: 'string', description: 'The topic as a listener would say it' },
        essential_question: {
          type: 'string',
          description: "The single question the week is really asking. Monday's cold open uses it.",
        },
        why_it_matters: { type: 'string' },
        key_concepts: { type: 'array', items: { type: 'string' } },
        people: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              what_they_did: { type: 'string' },
              what_they_got_wrong: { type: 'string' },
            },
            required: ['name', 'what_they_did', 'what_they_got_wrong'],
            additionalProperties: false,
          },
        },
        mechanism: {
          type: 'string',
          description: 'How the thing actually works, in technically correct detail. Wednesday leans on this.',
        },
        open_questions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Genuine expert disagreement or edge cases. Thursday leans on this. Empty if none exist.',
        },
        misconceptions: { type: 'array', items: { type: 'string' } },
      },
      required: [
        'subject', 'title', 'essential_question', 'why_it_matters',
        'key_concepts', 'people', 'mechanism', 'open_questions', 'misconceptions',
      ],
      additionalProperties: false,
    },
    claims: {
      type: 'array',
      description: 'Every checkable factual assertion. Anything a listener could look up and find wrong.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          text: { type: 'string', description: 'The claim, stated plainly and standalone' },
          source_url: { type: 'string' },
          quote: {
            type: 'string',
            description: 'Verbatim sentence(s) from that exact page which support the claim. Copied, not paraphrased.',
          },
        },
        required: ['id', 'text', 'source_url', 'quote'],
        additionalProperties: false,
      },
    },
  },
  required: ['topic', 'claims'],
  additionalProperties: false,
};

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['supported', 'partially_supported', 'not_supported', 'source_unreachable'] },
          reason: { type: 'string' },
          corrected_text: {
            type: 'string',
            description: 'If partially_supported, the version of the claim the page DOES support. Else empty.',
          },
        },
        required: ['id', 'verdict', 'reason', 'corrected_text'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

const countSources = (text) =>
  new Set((text.match(/https?:\/\/[^\s)"'\]]+/g) || []).map((u) => u.replace(/[.,;]+$/, ''))).size;

// The model is honest when it couldn't read enough — it says so in the prose
// rather than quietly inventing. Cheaper to read that admission than to pay for
// extraction and verification on a briefing with nothing behind it.
function looksThin(text) {
  const admits = /(cut off|only .{0,20}(one|a single) (page|source)|was not (accessible|sourced)|not sourced this session|must be verified|plan for what to fetch|could not (fetch|access|open))/i.test(text);
  return admits || countSources(text) < 3;
}

async function researchTopic(show, week, unit, { big = false } = {}) {
  return ask({
    system: researchSystem(show),
    tools: webTools({ search: big ? 25 : 20, fetch: big ? 20 : 15 }),
    maxTokens: 12000,
    effort: 'medium',
    maxResumes: big ? 2 : 2,
    timeoutMs: (big ? 7 : 6) * 60 * 1000,
    prompt:
`This is what ${show.kid.name} (grade ${show.kid.grade}) is studying the week of ${week}:

${unit}

Research this ONE topic. Fetch the actual pages — do not rely on search snippets.${big ? '\n\nA previous attempt read too few pages. Fetch at least FOUR different pages from different institutions before you write anything, and build the briefing only from what you actually read. If a fetch fails, search again and fetch a different page rather than writing from memory.' : ''}

I need: the essential question, the mechanism in technically correct detail, the people and what they got wrong first, the genuine open questions, and the common misconceptions.

This becomes five twelve-minute episodes, so depth on one idea beats breadth across ten.

Write dense prose with the source URL inline after each factual claim.`,
  });
}

export async function research(showId, week) {
  const show = getShow(showId);
  const dir = weekDir(showId, week);

  // Where the week's subject comes from: a year plan if the show has one,
  // otherwise whatever was pasted in for that week.
  const unit = await unitFor(show, week, dir);
  if (!unit) {
    throw new Error(
      `No topic for ${show.kid.name}, week of ${week}. ` +
      (show.planFile
        ? `Expected it in ${show.planFile} — check the week is inside the school year.`
        : `Paste it at ${BRAND.siteUrl}, or write ${join(dir, 'input.json')} by hand.`),
    );
  }

  let spend = 0;
  // Tokens alongside dollars, because the dollar figure alone can't tell you
  // whether caching is working — and caching is where the cost of this stage
  // now lives or dies.
  const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0, requests: 0 };
  const meter = (u) => {
    if (!u) return;
    tokens.input += u.input_tokens || 0;
    tokens.output += u.output_tokens || 0;
    tokens.cache_read += u.cache_read_input_tokens || 0;
    tokens.cache_write += u.cache_creation_input_tokens || 0;
    tokens.requests += u.requests || 1;
  };

  step(`Researching ${show.kid.name} — week of ${week}`);
  log(`  unit: ${String(unit).slice(0, 120).replace(/\s+/g, ' ')}…`);

  // Briefings are the expensive part. Cache so a failure downstream doesn't buy
  // them twice.
  const briefsPath = join(dir, 'brief.json');
  const cached = process.argv.includes('--force') ? null : readJSON(briefsPath);
  let briefText;

  if (cached) {
    briefText = cached.text;
    ok(`reusing cached briefing (${briefText.length.toLocaleString()} chars) — --force to re-research`);
  } else {
    const first = await researchTopic(show, week, unit);
    spend += costOf(first.usage, MODEL); meter(first.usage);
    briefText = first.text;
    log(`  ${countSources(briefText)} sources, ${briefText.length.toLocaleString()} chars`);

    if (looksThin(briefText)) {
      warn('briefing is under-sourced — researching again with a larger budget');
      try {
        const retry = await researchTopic(show, week, unit, { big: true });
        spend += costOf(retry.usage, MODEL); meter(retry.usage);
        const before = countSources(briefText);
        const after = countSources(retry.text);
        // Judge the retry on sources read, not length. A shorter briefing built
        // from four pages beats a longer one built from one page and a plan.
        if (after > before) { briefText = retry.text; ok(`re-researched — ${before} → ${after} sources`); }
        else warn(`retry found no more sources (${before} → ${after}), keeping the original`);
      } catch (e) {
        warn(`retry failed: ${e.message}`);
      }
    }
    writeJSON(briefsPath, { show: showId, week, unit, text: briefText });
  }

  // --- extract -----------------------------------------------------------
  step('Extracting claims');
  const extracted = await askJSON({
    system: 'You convert a research briefing into strict JSON. Never invent a source URL or a quote. If the briefing does not contain a verbatim quote for a claim, drop that claim entirely.',
    schema: EXTRACT_SCHEMA,
    maxTokens: 32000,
    prompt:
`Convert this briefing into the schema. Preserve source URLs exactly as written.

Extract every checkable factual assertion as a claim with the verbatim supporting quote. Give each claim a short stable id like "c1", "c2".

Return AT MOST 30 claims, and fewer if the material doesn't support that many. Every claim costs a page re-read to verify, and five twelve-minute episodes cannot carry more than about thirty facts. Choose the load-bearing ones: the numbers, dates, names, and mechanisms an episode would collapse without.

Claims must be about the SUBJECT, not about the sources. "Wind is diverted around a tall island, shedding alternating vortices downwind" is a claim. "NOAA places no usage restrictions on this material" is not — discard anything describing what a website or curriculum contains.

Briefing:

${briefText}`,
  });
  spend += costOf(extracted.usage, MODEL); meter(extracted.usage);
  const data = extracted.data;
  ok(`${data.claims.length} claims — "${data.topic.title}"`);

  // --- domain gate --------------------------------------------------------
  const offDomain = data.claims.filter((c) => !isAllowedSource(c.source_url));
  if (offDomain.length) warn(`${offDomain.length} claim(s) cited a domain outside the allowlist — cutting`);
  let claims = data.claims.filter((c) => isAllowedSource(c.source_url));

  const CAP = Number(process.env.MAX_CLAIMS || 30);
  if (claims.length > CAP) {
    warn(`keeping ${CAP} of ${claims.length} claims to bound verification cost`);
    claims = claims.slice(0, CAP);
  }

  // --- verify against the actual pages ------------------------------------
  step(`Verifying ${claims.length} claims`);
  const byUrl = new Map();
  for (const c of claims) {
    if (!byUrl.has(c.source_url)) byUrl.set(c.source_url, []);
    byUrl.get(c.source_url).push(c);
  }
  log(`  ${byUrl.size} unique source page(s) to re-read`);

  const verdicts = new Map();
  for (const [url, group] of byUrl) {
    const res = await askJSON({
      system:
        'You are a fact-checker. You re-read a source page and judge whether it actually supports each claim. ' +
        'You are deliberately hard to convince. If the page is merely consistent with the claim but does not state it, that is not_supported. ' +
        'If the page supports a narrower version, that is partially_supported and you give the narrower version.',
      maxTokens: 8000,
      model: VERIFY_MODEL,
      schema: VERIFY_SCHEMA,
      // Fetch but not search: it can only ever read the page it was pointed at,
      // never go looking for a friendlier source.
      tools: webTools({ search: 0, fetch: 3, model: VERIFY_MODEL }),
      prompt:
`Fetch this page and check each claim against it: ${url}

${group.map((c) => `[${c.id}] CLAIM: ${c.text}\n      QUOTED AS: "${c.quote}"`).join('\n\n')}

For each claim: does this page state or directly support it? Is the quoted text actually present on the page?`,
    }).catch((e) => {
      warn(`could not verify ${url}: ${e.message}`);
      return { data: { results: group.map((c) => ({ id: c.id, verdict: 'source_unreachable', reason: e.message, corrected_text: '' })) }, usage: null };
    });
    spend += costOf(res.usage, VERIFY_MODEL); meter(res.usage);
    for (const r of res.data.results) verdicts.set(r.id, r);
  }

  const verified = [];
  const rejected = [];
  for (const c of claims) {
    const v = verdicts.get(c.id) || { verdict: 'not_supported', reason: 'no verdict returned', corrected_text: '' };
    if (v.verdict === 'supported') verified.push({ ...c, verdict: v.verdict });
    else if (v.verdict === 'partially_supported' && v.corrected_text) verified.push({ ...c, text: v.corrected_text, verdict: v.verdict, original_text: c.text });
    else rejected.push({ ...c, verdict: v.verdict, reason: v.reason });
  }
  ok(`${verified.length} verified, ${rejected.length + offDomain.length} cut`);
  if (verified.length < 8) warn(`only ${verified.length} verified claims — the week will be thin`);

  const out = {
    show: showId, week, unit,
    generated_at: new Date().toISOString(),
    topic: data.topic,
    claims: verified,
    rejected: [...rejected, ...offDomain.map((c) => ({ ...c, verdict: 'off_allowlist', reason: 'domain not on allowlist' }))],
    arc: WEEK_ARC,
    cost_usd: Number(spend.toFixed(4)),
    tokens,
  };

  writeJSON(join(dir, 'research.json'), out);
  writeJSON(join(dir, 'sources.json'), {
    show: showId, week,
    sources: [...new Set(verified.map((c) => c.source_url))].sort(),
    claims: verified.map(({ id, text, source_url, quote, verdict }) => ({ id, text, source_url, quote, verdict })),
    cut: out.rejected.map(({ id, text, source_url, verdict, reason }) => ({ id, text, source_url, verdict, reason })),
  });

  // Cached reads bill at a tenth of fresh input, so quoting what the same
  // tokens would have cost uncached is the only way to see whether the caching
  // is actually earning its keep.
  const hit = tokens.cache_read + tokens.cache_write
    ? Math.round((tokens.cache_read / (tokens.cache_read + tokens.cache_write + tokens.input)) * 100)
    : 0;
  log(`  tokens: ${(tokens.input / 1000).toFixed(0)}k fresh · ${(tokens.cache_read / 1000).toFixed(0)}k cached (${hit}% hit) · ${tokens.requests} requests`);
  ok(`research complete — $${spend.toFixed(2)}`);
  return out;
}

if (isMain(import.meta.url)) {
  research(currentShow(), currentWeek()).catch((e) => {
    console.error(`\n\x1b[31m✖ ${e.message}\x1b[0m`);
    process.exit(1);
  });
}
