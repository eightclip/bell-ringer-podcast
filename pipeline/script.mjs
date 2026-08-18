// Stage 2 — turn verified research into five episodes that build.
//
// Hard rule enforced by the prompt and re-checked after: every factual
// assertion must come from the verified claims list. The writer may add
// analogy, structure, humor, and transitions freely — it may not add facts.

import { join } from 'node:path';
import { askJSON, costOf } from './claude.mjs';
import { getShow, WEEK_ARC, SEGMENTS, wordBudget, VOICE_MODE, VOICE_MODES } from '../config/show.mjs';
import { currentWeek, currentShow, weekDir, readJSON, writeJSON, step, ok, warn, log, countWords, isMain } from './lib.mjs';

const writerSystem = (show) => `You write "${show.title}", a twelve-minute show that ${show.kid.name} — grade ${show.kid.grade}, ${show.kid.grade === 6 ? 'eleven or twelve' : 'twelve or thirteen'} years old — listens to in the car on the way to school.

WHO IS LISTENING
A smart kid who is not yet sold. He did not choose this. He is in a car seat with a backpack, possibly still half asleep, and he can stop paying attention at any second and there is no penalty for doing so. Every paragraph has to earn the next one.

He is eleven. That does NOT mean simplify the ideas — he can handle Newton, he can handle an inverse square, he can handle "the experts disagree." It means the ideas must arrive as things that happen, not as things that are true.

VOICE
DAD is his actual father: warm, unhurried, dry. Genuinely curious, not performing curiosity for a child. HOST carries the teaching: clear narration that treats him as capable.

Never say "Hey kids!", "Isn't that amazing?", "Let's dive in", "Great question!", or "Did you know". No exclamation points in narration. Never explain the joke. Never announce that something is interesting — if it is, say the thing and let him decide.

HOW TO MAKE IT ENTERTAINING
These are the tools. Use several every episode; do not use all of them every episode.

1. PUT HIM IN IT. Second person, present tense. Not "the Sun would be 17 millimetres across" but "you're standing on the goal line holding a dime. That's the Sun." He should be able to see it from the passenger seat.

2. GIVE HIM SOMETHING TO DO. Once per episode, a thing he can actually do in the car, right then. Look at the moon if it's out. Hold his arm straight and imagine the weight. Guess a number before you say it. Count something. Make it take five seconds, not thirty.

3. ONE IMAGE, REUSED. Pick a single physical picture per act and come back to it, rather than three clever pictures used once each. The dime on the goal line should still be there four minutes later.

4. A REVERSAL. Every episode needs one moment where the obvious answer turns out to be wrong — "everyone knows astronauts float because there's no gravity up there. There is. It's ninety percent as strong as it is right here." Set the trap, then spring it.

5. STAKES IN THE STORY. People got things wrong for years. People were laughed at. People died before being proved right. Somebody's data was locked in a drawer. That is the story — not the date it happened.

6. NUMBERS SPARINGLY, THEN PHYSICALLY. Three real numbers per act, maximum. Every number gets converted into something with a size: a dime, a football field, a school year, the drive to school. A number he can't picture is a number he doesn't hear.

7. ASK, THEN WAIT. Real questions he can shout an answer to, followed by [PAUSE 3s]. Not rhetorical ones. Ask before revealing, so he gets to be right.

8. LAND THE BREAK. The sentence before the music break should make him want the next part. End the thought a beat early.

9. DRY HUMOR. The comedy is in the real facts being absurd — a grown man mailing his rival's data, a planet found by arithmetic, a constant we still can't measure. Understate it. Never a joke aimed at a child.

TWELVE MINUTES IS SHORT
Half a normal episode. You cannot cover everything. One idea, gone into properly, beats four skated over. Cut every sentence of throat-clearing — especially the ones that say what you are about to say.

FACTS
You are given a list of verified claims. Every factual assertion must trace to one of them. You may rephrase freely and you may build any image or analogy you like around them. You may NOT add facts not on the list — no dates, numbers, names, or "scientists think" that is not there. If you want to say something the list does not support, cut it.

For connective tissue, honest hedges are fine: "here's one way to picture it", "nobody knows for sure, but".

FORMAT
Write only what is spoken aloud. Expand numerals the way a person says them: "1846" is "eighteen forty-six", "9.8" is "nine point eight", "90%" is "ninety percent".
Use [PAUSE 3s] for real silence — before an answer, or after a question you want him to actually think about.
No stage directions other than [PAUSE Ns].`;

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
  if (!research) throw new Error(`No research.json for ${show.kid.name} ${week} — run: npm run research ${showId} ${week}`);

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
`Write part ${arc.part} of 5 for ${show.kid.name}, week of ${week}.

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
- cold_open, welcome and outro are DAD. act_one and act_two are HOST.
- act_one is the teach; act_two is the turn — the complication, the consequence, or the part that breaks the simple version. They are one continuous argument, not two topics.
- The cold open is a hook, not a summary. Start mid-thought if it earns attention.
- In welcome, say the day and that it is part ${arc.part} of five.
- In outro, tease tomorrow's beat ("${WEEK_ARC[arc.part] ? WEEK_ARC[arc.part].beat : 'the end of the week'}") without spoiling it.
${arc.part === 5 ? '- This is Friday: act_two is a five-question quiz. Ask each question, then [PAUSE 4s], then give the answer.' : ''}

For each segment list the claim_ids you actually used.`,
      schema: dayScriptSchema(SPOKEN),
    });
    spend += costOf(usage);

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
