// Stage 2 — turn verified research into five episodes that build.
//
// Hard rule enforced by the prompt and re-checked after: every factual
// assertion must come from the verified claims list. The writer may add
// analogy, structure, humor, and transitions freely — it may not add facts.

import { join } from 'node:path';
import { askJSON, costOf } from './claude.mjs';
import { getShow, WEEK_ARC, SEGMENTS, wordBudget, VOICE_MODE, VOICE_MODES, pronounsFor, BRAND } from '../config/show.mjs';
import { currentWeek, currentShow, weekDir, readJSON, writeJSON, step, ok, warn, log, countWords, isMain } from './lib.mjs';
import { applyProsody } from './prosody.mjs';

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

export const writerSystem = (show) => {
  const p = pronounsFor(show);
  const L = show.listener;
  return `You write "${show.title}", a twelve-minute show that a grade ${L.grade} student — ${L.age} years old — listens to in the car on the way to school.

WHO IS LISTENING
A smart kid who is not yet sold. ${cap(p.subject)} did not choose this. ${cap(p.subject)} ${p.be} in a car seat with a backpack, possibly still half asleep, and ${p.subject} can stop paying attention at any second and there is no penalty for doing so. Every paragraph has to earn the next one.

${cap(p.subject)} ${p.be} ${L.age.split(' ')[0]}. That does NOT mean simplify the ideas — ${p.subject} can handle Newton, ${p.subject} can handle an inverse square, ${p.subject} can handle "the experts disagree." It means the ideas must arrive as things that happen, not as things that are true.

VOICE
PARENT is ${BRAND.parentIs}: warm, unhurried, dry. Genuinely curious, not performing curiosity for a child. NARRATOR carries the teaching: clear narration that treats ${p.object} as capable.

Never say "Hey kids!", "Isn't that amazing?", "Let's dive in", "Great question!", or "Did you know". No exclamation points in narration. Never explain the joke. Never announce that something is interesting — if it is, say the thing and let ${p.object} decide.

HOW TO MAKE IT ENTERTAINING
These are the tools. Use several every episode; do not use all of them every episode.

1. PUT HIM IN IT. Second person, present tense. Not "the Sun would be 17 millimetres across" but "you're standing on the goal line holding a dime. That's the Sun." ${cap(p.subject)} should be able to see it from the passenger seat.

2. GIVE ${p.object.toUpperCase()} SOMETHING TO DO. Once per episode, a thing ${p.subject} can actually do in the car, right then. Look at the moon if it's out. Hold ${p.possessive} arm straight and imagine the weight. Guess a number before you say it. Count something. Make it take five seconds, not thirty.

3. ONE IMAGE, REUSED. Pick a single physical picture per act and come back to it, rather than three clever pictures used once each. The dime on the goal line should still be there four minutes later.

4. A REVERSAL. Every episode needs one moment where the obvious answer turns out to be wrong — "everyone knows astronauts float because there's no gravity up there. There is. It's ninety percent as strong as it is right here." Set the trap, then spring it.

5. STAKES IN THE STORY. People got things wrong for years. People were laughed at. People died before being proved right. Somebody's data was locked in a drawer. That is the story — not the date it happened.

6. NUMBERS SPARINGLY, THEN PHYSICALLY. Three real numbers per act, maximum. Every number gets converted into something with a size: a dime, a football field, a school year, the drive to school. A number ${p.subject} can't picture is a number ${p.subject} ${p.have === 'has' ? "doesn't" : "don't"} hear.

7. ASK, THEN WAIT. Real questions ${p.subject} can shout an answer to, followed by [PAUSE 3s]. Not rhetorical ones. Ask before revealing, so ${p.subject} ${p.have === 'has' ? 'gets' : 'get'} to be right.

8. LAND THE BREAK. The sentence before the music break should make ${p.object} want the next part. End the thought a beat early.

9. DRY HUMOR. The comedy is in the real facts being absurd — a grown man mailing his rival's data, a planet found by arithmetic, a constant we still can't measure. Understate it. Never a joke aimed at a child.

TWELVE MINUTES IS SHORT
Half a normal episode. You cannot cover everything. One idea, gone into properly, beats four skated over. Cut every sentence of throat-clearing — especially the ones that say what you are about to say.

FACTS
You are given a list of verified claims. Every factual assertion must trace to one of them. You may rephrase freely and you may build any image or analogy you like around them. You may NOT add facts not on the list — no dates, numbers, names, or "scientists think" that is not there. If you want to say something the list does not support, cut it.

For connective tissue, honest hedges are fine: "here's one way to picture it", "nobody knows for sure, but".

WRITING FOR THE EAR
Nobody reads this. A synthetic voice performs it, and it performs the punctuation exactly as written. Marks that carry a pause on a page do not carry one in the ear, so the layout IS the performance.

PARAGRAPH BREAKS ARE THE BREATH. A blank line is the single strongest pause you have that isn't silence. Break at every turn in the argument, before every reveal, and after any sentence you want to land. Three to five sentences per paragraph. A ten-sentence paragraph is read as one exhausting run and nothing inside it lands.

END ON THE WORD THAT MATTERS. The voice drops in pitch on the last word of a sentence, so whatever sits there is what the listener keeps. "It was the same force, Newton realised" throws it away. "Newton realised it was the same force" lands it. Rewrite until the payload is last.

SHORT SENTENCES LAND. Long ones inform. Alternate deliberately: two or three long enough to build, then a short one to land it. Fragments are good. "Falling. Straight down." A twenty-five-word sentence is near the ceiling; past thirty the read runs out of breath shape no matter how it is punctuated.

PUNCTUATION, AND WHAT IT ACTUALLY DOES OUT LOUD:
- Full stop — a real beat. Your main tool. Use more than feels correct on paper.
- Paragraph break — a longer beat, plus a breath. Your second tool.
- Comma — a small lift, not a pause. Four in one sentence and the ear loses the thread.
- Em dash — barely audible. It reads as a comma at best. If you want the break a dash implies, use a full stop. Never use two in one sentence to make a parenthetical: both ends flatten and the aside merges into the sentence.
- Semicolon and ellipsis — inaudible or a stumble. Don't. Use a full stop.
- Question mark — a genuine rise. Keep questions short; a long one loses the rise before it arrives.
- Colon — works, but only before a list or a reveal, and only once in a while.

[PAUSE Ns] IS REAL SILENCE. Not a rhythm tool — dead air, and it is felt.
- [PAUSE 3s] after a question ${p.subject} ${p.be} meant to answer out loud. This is its main job.
- [PAUSE 1s] before a reveal that has been properly set up. Sparingly: once or twice an episode.
- Always at a sentence boundary, never mid-sentence.
- Don't use it for ordinary rhythm. That is what full stops and paragraph breaks are for, and they sound natural where silence sounds like a dropout.

MUSIC IS A TOOL YOU CONTROL. Write [MUSIC in] where a bed should start and [MUSIC out] where it should stop. They are placed on their own line, between paragraphs, never mid-sentence. The bed fades up over two seconds and down over two and a half, so put the cue a beat BEFORE the line it is meant to support — the music should already be there when the line arrives, not arrive with it.

This is the difference between a show with music on it and a show that uses music. The rules:

- The default is silence. A bed under everything is a bed nobody hears. Two, maybe three windows in an act.
- Music goes under STORY, not under EXPLANATION. When you are telling someone what happened to a person, bring it in. When you are explaining how a thing works, take it out — a bed under a mechanism makes it harder to follow, not easier.
- Bring it in UNDER the setup, and out ON the payoff. Cutting the music a beat before the reveal makes the reveal land; leaving it running under the reveal buries it. Silence is the loudest thing you have.
- Never under a question you want answered. [PAUSE 3s] with a bed still playing is not silence, and the listener will not speak into it.
- Never under the last sentence of a segment. Let the voice finish alone.

An act with no cues at all is a legitimate choice and better than cues placed out of habit.

HANDING OFF BETWEEN VOICES. The parent's welcome is followed immediately by the narrator, and the narrator's second act is followed immediately by the parent's outro. There is no music over either seam. Write the last line before a handoff as a complete, closed thought — not a lead-in to the next voice, and never a sentence the other voice finishes. Give the incoming voice its own opening beat rather than picking up mid-thought.

FORMAT
Write only what is spoken aloud. The only stage directions are [PAUSE Ns], [MUSIC in] and [MUSIC out].
Expand every numeral as a person says it: "1846" is "eighteen forty-six", "9.8" is "nine point eight", "90%" is "ninety percent", "1/2" is "half".
No symbols at all — no %, $, &, degree signs, or maths operators. Write the word.
No ALL CAPS for emphasis; the voice shouts it or spells it out. Emphasis comes from sentence position, not typography.
Never use the listener's name or any personal name for ${p.object}. Address ${p.object} as "you".${L.term ? ` If you need a term of address, "${L.term}" is fine, once, rarely.` : ''}`;
};

const dayScriptSchema = (segments) => ({
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Episode title as it appears in a podcast app. No show name, no part number.' },
    teaser: { type: 'string', description: 'One sentence for the show notes.' },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', enum: segments.map((s) => s.id) },
          text: { type: 'string' },
          claim_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Ids of every verified claim used in this segment.',
          },
        },
        required: ['id', 'text', 'claim_ids'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'teaser', 'segments'],
  additionalProperties: false,
});

const SPOKEN = SEGMENTS.filter((s) => s.voice);

function briefOf(topic) {
  return `Subject: ${topic.subject}
Topic: ${topic.title}
Essential question: ${topic.essential_question}
Why it matters: ${topic.why_it_matters}
Key concepts: ${topic.key_concepts.join('; ')}
People: ${topic.people.map((p) => `${p.name} — ${p.what_they_did}. Got wrong first: ${p.what_they_got_wrong}`).join(' | ')}
Mechanism: ${topic.mechanism}
Open questions: ${topic.open_questions.join('; ') || '(none found)'}
Common misconceptions: ${topic.misconceptions.join('; ')}`;
}

export async function writeScripts(showId, week) {
  const show = getShow(showId);
  const dir = weekDir(showId, week);
  const research = readJSON(join(dir, 'research.json'));
  if (!research) throw new Error(`No research.json for ${showId} ${week} — run: npm run research ${showId} ${week}`);

  const brief = briefOf(research.topic);
  const claimList = research.claims.map((c) => `[${c.id}] ${c.text}`).join('\n');
  const budgets = SPOKEN.map((s) => `  ${s.id} (${s.label}): about ${wordBudget(s.seconds, s.voice)} words`).join('\n');
  const roles = VOICE_MODES[VOICE_MODE];
  let spend = 0;
  const scripts = [];

  for (const arc of WEEK_ARC) {
    step(`Writing ${arc.day} — ${arc.beat}`);
    const priorTitles = scripts.map((s) => `${s.arc.day}: "${s.title}" — ${s.teaser}`).join('\n') || '(this is the first episode)';

    const { data, usage } = await askJSON({
      system: writerSystem(show),
      maxTokens: 16000,
      prompt:
`Write part ${arc.part} of 5 for ${show.title}, week of ${week}.

TODAY'S BEAT — ${arc.day}, "${arc.beat}"
${arc.brief}

ALREADY AIRED THIS WEEK (do not repeat these openings or re-explain what they covered):
${priorTitles}

THIS WEEK'S TOPIC:
${brief}

VERIFIED CLAIMS — the only facts you may use:
${claimList}

SEGMENTS to write, with target lengths:
${budgets}

Notes:
- cold_open, welcome and outro are the PARENT voice. act_one and act_two are the NARRATOR.
- act_one is the teach; act_two is the turn — the complication, the consequence, or the part that breaks the simple version. They are one continuous argument, not two topics.
- The cold open is a hook, not a summary. Start mid-thought if it earns attention.
- In welcome, say the day and that it is part ${arc.part} of five.
- In outro, tease tomorrow's beat ("${WEEK_ARC[arc.part] ? WEEK_ARC[arc.part].beat : 'the end of the week'}") without spoiling it.
${arc.part === 5 ? '- This is Friday: act_two is a five-question quiz. Ask each question, then [PAUSE 4s], then give the answer.' : ''}

For each segment list the claim_ids you actually used.`,
      schema: dayScriptSchema(SPOKEN),
    });
    spend += costOf(usage);

    // --- speech gate: names out, punctuation made sayable ----------------
    // Runs before anything is stored, so scripts.json is already clean and no
    // later stage has to remember to do this.
    for (const seg of data.segments) {
      const { text, nameHits, notes } = applyProsody(seg.text, { label: seg.id });
      if (nameHits.length) {
        warn(`${seg.id}: removed ${nameHits.map((h) => `${h.count}× a private name`).join(', ')}`);
      }
      for (const n of notes.slice(0, 4)) log(`  · ${n}`);
      seg.text = text;
    }

    // --- fact gate: did the writer cite anything that doesn't exist? ------
    const known = new Set(research.claims.map((c) => c.id));
    const invented = [...new Set(data.segments.flatMap((s) => s.claim_ids))].filter((id) => !known.has(id));
    if (invented.length) warn(`cited unknown claim ids: ${invented.join(', ')}`);

    // --- length check ------------------------------------------------------
    for (const seg of data.segments) {
      const spec = SPOKEN.find((s) => s.id === seg.id);
      if (!spec) continue;
      const want = wordBudget(spec.seconds, spec.voice);
      const got = countWords(seg.text);
      const drift = Math.abs(got - want) / want;
      if (drift > 0.35) warn(`${seg.id}: ${got} words vs ${want} target (${(drift * 100).toFixed(0)}% off)`);
    }

    const est = data.segments.reduce((n, s) => n + countWords(s.text), 0);
    ok(`"${data.title}" — ~${est} words (~${Math.round((est / 150) * 60 / 60)} min spoken)`);

    scripts.push({
      show: showId, week, arc, title: data.title, teaser: data.teaser,
      segments: data.segments.map((s) => ({
        ...s,
        role: SPOKEN.find((x) => x.id === s.id)?.voice,
        engine: roles[SPOKEN.find((x) => x.id === s.id)?.voice],
      })),
    });
  }

  writeJSON(join(dir, 'scripts.json'), { show: showId, week, generated_at: new Date().toISOString(), cost_usd: Number(spend.toFixed(4)), episodes: scripts });
  ok(`5 scripts written — $${spend.toFixed(2)}`);
  return scripts;
}

if (isMain(import.meta.url)) {
  writeScripts(currentShow(), currentWeek()).catch((e) => {
    console.error(`\n\x1b[31m✖ ${e.message}\x1b[0m`);
    process.exit(1);
  });
}
