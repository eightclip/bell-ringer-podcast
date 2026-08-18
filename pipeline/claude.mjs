import Anthropic from '@anthropic-ai/sdk';
import { need, warn } from './lib.mjs';
import { ALLOWED_DOMAINS } from '../config/sources.mjs';

export const MODEL = 'claude-opus-5';

// Verification is quote-matching, not reasoning: "does this sentence appear on
// this page and support this claim". Running that on the most expensive model
// available was most of the weekly bill. Haiku is a fifth the price and the
// task is well within it — and it still fails closed, so a wrong answer costs
// us a cut claim, never a false one on air.
export const VERIFY_MODEL = process.env.VERIFY_MODEL || 'claude-haiku-4-5';

// Older models don't take `effort`, don't take adaptive thinking, and need the
// pre-2026 server-tool variants. Getting any of those wrong is a 400, so the
// model choice drives the whole request shape rather than just the id.
const FRONTIER = /^claude-(opus-5|opus-4-[678]|sonnet-5|sonnet-4-6|fable-5|mythos-5)/;
export const isFrontier = (m) => FRONTIER.test(m);

let _client;
export function client() {
  if (!_client) _client = new Anthropic({ apiKey: need('ANTHROPIC_API_KEY'), timeout: 30 * 60 * 1000 });
  return _client;
}

// Budgets here are deliberately generous. `max_uses` is a poor governor: the
// model batches searches, and a single round of four parallel queries counts as
// eight uses — a budget of 5 was being exhausted before any result came back,
// leaving web_fetch with no URLs it was allowed to open (it can only fetch URLs
// that already appeared in context). Wall-clock `timeoutMs` is the real bound;
// these numbers just need to be high enough not to bite first.
//
// A count of 0 drops the tool entirely rather than declaring it with
// max_uses: 0 — the verifier wants fetch without search, so it can only ever
// read the page it was pointed at instead of going looking for a friendlier one.
// How much of any single fetched page is allowed into the context.
//
// This was unset, and web_fetch has no default limit — so one long PDF could
// land 125,000 tokens in the conversation, which at Opus input rates is about
// $0.63 for a single fetch, re-billed on every subsequent resume. That is most
// of where a $10 research week went.
//
// 20k is roughly an 80kB page: comfortably more than any of the encyclopaedia,
// museum or textbook pages this show actually cites, and the tool truncates
// rather than failing when a page runs longer. Raise it if claims start
// arriving thin.
export const MAX_FETCH_TOKENS = Number(process.env.MAX_FETCH_TOKENS || 20000);

export const webTools = ({ search = 8, fetch = 12, model = MODEL } = {}) => {
  // The dynamic-filtering variants only exist on the frontier models; asking
  // for them on Haiku is a 400.
  const s = isFrontier(model) ? 'web_search_20260209' : 'web_search_20250305';
  const f = isFrontier(model) ? 'web_fetch_20260209' : 'web_fetch_20250910';
  return [
    ...(search > 0 ? [{ type: s, name: 'web_search', allowed_domains: ALLOWED_DOMAINS, max_uses: search }] : []),
    ...(fetch > 0 ? [{
      type: f,
      name: 'web_fetch',
      allowed_domains: ALLOWED_DOMAINS,
      max_uses: fetch,
      max_content_tokens: MAX_FETCH_TOKENS,
    }] : []),
  ];
};

function textOf(msg) {
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * One turn, with the server-side tool loop driven to completion.
 *
 * Server tools (web_search / web_fetch) run on Anthropic's side, but the
 * server caps its own sampling loop at 10 iterations and then returns
 * `pause_turn`. Re-sending the conversation resumes it — do NOT append a
 * "continue" user message, the API detects the trailing server_tool_use and
 * picks up where it left off.
 */
export async function ask({
  system,
  prompt,
  tools = [],
  maxTokens = 16000,
  effort = 'high',
  format = null,
  maxResumes = 6,
  timeoutMs = 8 * 60 * 1000,
  model = MODEL,
}) {
  const messages = [{ role: 'user', content: prompt }];

  // Prompt caching, which is the whole ballgame for a paused research turn.
  //
  // Every resume re-sends the entire conversation — including every page the
  // model has fetched so far — and without a cache breakpoint all of it is
  // re-billed at full input price on each of up to seven requests. Cached
  // reads are a tenth of that.
  //
  // Two breakpoints only: the system prompt, and the most recent assistant
  // turn. The API caps breakpoints at four, so the older one is stripped as
  // each new one is placed rather than accumulating one per resume.
  let cacheable = true;
  const stripBreakpoints = () => {
    for (const m of messages) {
      if (!Array.isArray(m.content)) continue;
      for (const b of m.content) delete b.cache_control;
    }
  };
  const markLatest = (content) => {
    const blocks = content.map((b) => ({ ...b }));
    if (cacheable && blocks.length) {
      stripBreakpoints();
      blocks[blocks.length - 1].cache_control = { type: 'ephemeral' };
    }
    return blocks;
  };
  // `effort` is rejected outright by Haiku 4.5, and adaptive thinking isn't a
  // thing there either — so the whole output_config collapses to the format.
  const output_config = isFrontier(model)
    ? { effort, ...(format ? { format } : {}) }
    : (format ? { format } : undefined);

  // A hard wall-clock ceiling on the whole turn, resumes included. Without it a
  // research call that keeps finding one more thing to check will happily run
  // for half an hour. Whatever it has when the clock runs out is what we use.
  const deadline = Date.now() + timeoutMs;

  // Every resume is a separate billed request that re-sends the whole
  // conversation, so usage has to be summed across them. Returning only the
  // final message's usage — which is what this did — undercounted a research
  // turn by however many times it paused, and a paused turn is the expensive
  // case by definition.
  const total = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    requests: 0,
  };
  const tally = (u) => {
    if (!u) return;
    total.requests += 1;
    total.input_tokens += u.input_tokens || 0;
    total.output_tokens += u.output_tokens || 0;
    total.cache_read_input_tokens += u.cache_read_input_tokens || 0;
    total.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
  };

  let msg;
  let attempt = 0;
  for (let i = 0; i <= maxResumes; i++) {
    // Streamed, not awaited whole. A research turn does a dozen page fetches
    // server-side and can run many minutes; a non-streaming request that long
    // is racing the HTTP timeout for no reason. Streaming also lets us show
    // which sources it's actually reading.
    const left = deadline - Date.now();
    if (left <= 0) { warn(`turn hit its ${Math.round(timeoutMs / 60000)}min ceiling — using what it has`); break; }

    const stream = client().messages.stream({
      model,
      max_tokens: maxTokens,
      ...(system
        ? { system: cacheable ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system }
        : {}),
      messages,
      ...(output_config ? { output_config } : {}),
      ...(tools.length ? { tools } : {}),
    }, { timeout: left });

    stream.on('streamEvent', (ev) => {
      if (ev.type !== 'content_block_start') return;
      const b = ev.content_block;
      if (b?.type === 'server_tool_use') process.stdout.write(`\x1b[2m  ·\x1b[0m ${b.name}\n`);
      if (b?.type === 'web_search_tool_result' || b?.type === 'web_fetch_tool_result') {
        const err = b.content?.error_code;
        if (err) process.stdout.write(`\x1b[33m    ! ${b.type.replace('_tool_result', '')}: ${err}\x1b[0m\n`);
      }
    });

    // A long server-tool turn can sit quiet for minutes while code execution
    // filters search results, and the connection sometimes dies ("terminated").
    // That's transient — retry the turn rather than losing the whole week.
    try {
      msg = await stream.finalMessage();
    } catch (err) {
      // Caching is an optimisation, never a reason to lose a week's research.
      // If the API objects to a breakpoint — most likely on some block type it
      // won't cache — drop caching entirely and retry the turn uncached.
      if (cacheable && /cache_control|cache breakpoint/i.test(err.message || '')) {
        warn(`prompt caching rejected (${err.message.slice(0, 80)}) — continuing uncached`);
        cacheable = false;
        stripBreakpoints();
        i--;
        continue;
      }
      const transient = /terminated|ECONNRESET|socket hang up|aborted|fetch failed|timeout/i.test(err.message || '');
      if (transient && attempt < 3) {
        attempt++;
        const wait = attempt * 20;
        warn(`connection ${err.message} — retrying turn in ${wait}s (${attempt}/3)`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        i--; // this turn didn't count against the resume budget
        continue;
      }
      throw err;
    }

    tally(msg.usage);

    if (msg.stop_reason === 'refusal') {
      throw new Error(
        `Model declined this request (${msg.stop_details?.category ?? 'no category'}). ` +
        `This usually means a lesson-plan topic tripped a safety classifier — check input.json.`,
      );
    }
    if (msg.stop_reason === 'max_tokens') {
      warn('hit max_tokens — output may be truncated; raising maxTokens is the fix');
    }
    if (msg.stop_reason !== 'pause_turn') break;

    // Resume the paused server-tool turn.
    messages.push({ role: 'assistant', content: markLatest(msg.content) });
    if (i === maxResumes) warn(`still paused after ${maxResumes} resumes — returning what we have`);
  }

  if (!msg) throw new Error(`turn produced nothing before its ${Math.round(timeoutMs / 60000)}min ceiling`);
  if (total.requests > 1) {
    log(`  ${total.requests} requests · ${(total.input_tokens / 1000).toFixed(0)}k in` +
        (total.cache_read_input_tokens ? ` · ${(total.cache_read_input_tokens / 1000).toFixed(0)}k cached` : ''));
  }
  return { text: textOf(msg), usage: total, raw: msg };
}

/** Ask for JSON matching a schema. Pass `tools` when the turn needs to go and look at something. */
export async function askJSON({ system, prompt, schema, tools = [], maxTokens = 16000, effort = 'high', maxResumes = 4, model = MODEL, timeoutMs }) {
  const { text, usage } = await ask({
    system,
    prompt,
    tools,
    maxTokens,
    effort,
    maxResumes,
    model,
    ...(timeoutMs ? { timeoutMs } : {}),
    format: { type: 'json_schema', schema },
  });
  try {
    return { data: JSON.parse(text), usage };
  } catch (e) {
    // Almost always truncation rather than malformed output: a rich week
    // produces a big object and the response hits max_tokens mid-string. Give
    // it room once rather than throwing away the research that fed it.
    const truncated = /Unterminated|Unexpected end of (JSON|input)/i.test(e.message);
    if (truncated && maxTokens < 64000) {
      const bigger = Math.min(maxTokens * 2, 64000);
      warn(`JSON truncated at ${text.length.toLocaleString()} chars — retrying with max_tokens ${bigger.toLocaleString()}`);
      return askJSON({ system, prompt, schema, tools, maxTokens: bigger, effort, maxResumes, model, timeoutMs });
    }
    throw new Error(`Model returned unparseable JSON: ${e.message}\n---\n${text.slice(0, 800)}`);
  }
}

// Rough running cost, so the pipeline can print what a week actually cost.
const PRICES = {
  'claude-opus-5':   { in: 5 / 1e6,  out: 25 / 1e6 },
  'claude-sonnet-5': { in: 3 / 1e6,  out: 15 / 1e6 },
  'claude-haiku-4-5':{ in: 1 / 1e6,  out: 5 / 1e6  },
};

export function costOf(usage, model = MODEL) {
  if (!usage) return 0;
  const p = PRICES[model] || PRICES['claude-opus-5'];
  return (
    (usage.input_tokens || 0) * p.in +
    (usage.output_tokens || 0) * p.out +
    (usage.cache_read_input_tokens || 0) * (p.in / 10) +
    (usage.cache_creation_input_tokens || 0) * (p.in * 1.25)
  );
}
