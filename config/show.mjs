import './env.mjs';

// Bell Ringer — show bible.
//
// One show per child, however many children there are. The earliest design put
// two kids in one 24-minute episode, which meant each of them sat through eight
// minutes about a subject he isn't taking. Separate feeds halve the runtime and
// double the relevance, and the cost of a second show is a second line on the
// roster below.
//
// A single show is a complete configuration — nothing here needs a second one,
// and nothing caps it at two. Everything downstream reads the roster: the feed
// workflow loops over it, the demo takes the first entry, and `npm run week`
// accepts any id it defines.

export const BRAND = {
  name: process.env.SHOW_BRAND_NAME || 'Bell Ringer',
  author: process.env.SHOW_AUTHOR || 'Set SHOW_AUTHOR in .env',
  language: 'en-us',
  category: 'Education',
  subcategory: 'Courses',
  explicit: false,
  siteUrl: process.env.SITE_URL || 'http://localhost:3000',

  // Who the PARENT voice is, in the writer's words. This lands in the brief
  // verbatim, so write it the way you'd describe yourself to a stranger:
  // 'their own father', 'their mum', 'a parent who drives them to school',
  // 'their uncle Ray'. It is never spoken aloud.
  parentIs: process.env.PARENT_IS || 'the parent driving them to school',

  // The single switch that decides whether this show is discoverable.
  //
  // false emits <itunes:block>Yes</itunes:block>, which tells Apple and every
  // directory that mirrors it not to list the show. The feed still works for
  // anyone holding the URL — that is what "unlisted" means here.
  //
  // Flipping this to true is the moment the show becomes public, and it is
  // not cleanly reversible: directories cache feeds, and a show that has been
  // indexed can be removed but not un-remembered. It lives here, on its own,
  // rather than buried in the feed generator, so that turning it on is a
  // deliberate and reviewable act.
  //
  // Do not flip it until your audio has moved off the rate-limited r2.dev
  // endpoint onto a custom domain — a feed URL submitted to Apple is expensive
  // to change later.
  //
  // Ships false. If you are making a show from a real child's real timetable,
  // consider carefully whether it should be in a public directory at all; an
  // unlisted feed does the same job for the family that actually listens.
  listed: process.env.SHOW_LISTED === 'true',
};

// --- Who is listening -----------------------------------------------------
// The writer's brief is generated from these, so setting them correctly is the
// difference between a show that sounds like it is for your kid and one that
// sounds like it is for a demographic.
//
// `pronouns` is 'they' by default. That is not a placeholder to be corrected —
// it is correct for a child whose pronouns you have not been told, and it is
// correct for a child who uses it. Set 'he' or 'she' if that is right for the
// listener. Every sentence in the brief agrees with whichever you choose,
// including the verbs.
export const PRONOUNS = {
  he:   { subject: 'he',   object: 'him',  possessive: 'his',   reflexive: 'himself',    be: 'is',  have: 'has',  s: 's' },
  she:  { subject: 'she',  object: 'her',  possessive: 'her',   reflexive: 'herself',    be: 'is',  have: 'has',  s: 's' },
  they: { subject: 'they', object: 'them', possessive: 'their', reflexive: 'themselves', be: 'are', have: 'have', s: '' },
};

export const pronounsFor = (showOrId) => {
  const show = typeof showOrId === 'string' ? getShow(showOrId) : showOrId;
  return PRONOUNS[show.listener?.pronouns] || PRONOUNS.they;
};

// --- the roster -----------------------------------------------------------
// One entry per child. One is a complete configuration; there is nothing here
// that needs a second, and nothing that stops you having five.
//
// A grade is the only thing you must supply. Everything a grade can imply —
// the id, the title, the label, how old the listener is, the ordinal the
// writer's brief uses — is derived below rather than typed out, because those
// are the fields that go stale silently. Hand-written, "7th Grade" outlives the
// year the child was in it, and the mismatch is invisible until somebody reads
// a feed and finds a fourteen-year-old being addressed as twelve.
//
// So next September this list changes by one digit per child and the whole
// pipeline follows: new ids, new feed paths, new age in the brief, new ordinal
// in the description. Nothing else in the repository names a grade.
//
// Shows are keyed by grade, not by name. The id reaches the outside world — it
// is in the feed URL, every audio path and every artwork filename — so a name
// here would put a child's name on a public URL for no benefit. Nothing in
// `listener` is ever spoken: the scripts address the listener as "you".
export const ROSTER = [
  {
    grade: 6,
    pronouns: 'they',     // 'he' | 'she' | 'they'
    term: 'kiddo',        // rare direct address; '' for none
    accent: 'sunsets',    // a name from ART.overlays, below
    // A full-year block plan, so weeks come from a calendar rather than from
    // someone remembering to paste an email. null means paste each week in at
    // /admin on your site instead.
    planFile: 'plans/example-year.json',
  },
  {
    grade: 7,
    pronouns: 'they',
    term: 'kiddo',
    accent: 'deepsea',
    planFile: null,
  },
];

// --- what a grade implies -------------------------------------------------
// US convention: a child in grade G turns G+6 during that school year, so the
// year is spent G+5 or G+6. Kindergarten is grade 0 and works the same way.
// If your school system counts differently, override `age` on the roster entry
// — every derived field below can be overridden that way.
const NUMBER_WORD = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const ORDINAL_WORD = [
  'kindergarten', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
  'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth',
];

// 1st, 2nd, 3rd, 4th… the suffix is irregular for 11-13, which is why this is
// a function and not `n + 'th'`.
export function ordinalSuffix(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

const words = (n) => NUMBER_WORD[n] || String(n);

export function gradeLabel(grade) {
  return grade === 0 ? 'Kindergarten' : `${ordinalSuffix(grade)} Grade`;
}

// "sixth grader", "kindergartener" — how the brief and the description name the
// listener in prose.
export function gradeWord(grade) {
  return ORDINAL_WORD[grade] || `grade ${grade}`;
}

export function defaultAge(grade) {
  return `${words(grade + 5)} or ${words(grade + 6)}`;
}

// Fill in everything a grade implies, then let the roster entry override any
// of it. Deriving first and spreading second is what makes the override work
// without the defaults having to know which fields might be replaced.
export function defineShow(entry) {
  const { grade, id: fixedId, pronouns = 'they', term = 'kiddo', accent, planFile = null, ...rest } = entry;
  if (!Number.isInteger(grade) || grade < 0 || grade > 12) {
    throw new Error(`Roster entry needs an integer grade 0-12, got ${JSON.stringify(grade)}`);
  }
  // The id defaults to the grade, and that is the right default for one year.
  // It is the wrong one for the second, and the bill arrives in September.
  //
  // The id is in the feed URL, every audio key and every manifest key. So
  // incrementing a grade renames all three: the subscriber's app keeps polling
  // a feed that will never gain another episode, and the back catalogue is
  // stranded under the old id while the new one starts empty. Nothing errors.
  // The show simply stops arriving, and the first person to notice is a child
  // in a car.
  //
  // Setting `id` fixes it: a stable, meaningless handle that outlives the
  // grade. Meaningless on purpose — it lands in a public URL, so it must not be
  // a name. `blue`, `north`, `apollo`. The grade still drives the title, the
  // age and the writer's brief; only the plumbing stops moving.
  //
  // Pick one before you publish. Changing it later has the same cost as not
  // having had one.
  const id = fixedId || (grade === 0 ? 'kindergarten' : `grade${grade}`);
  if (!/^[a-z0-9-]+$/.test(id)) {
    throw new Error(`Show id "${id}" must be lowercase letters, numbers and hyphens — it goes in a URL`);
  }
  const label = gradeLabel(grade);
  const word = gradeWord(grade);
  // "an eighth grader", "an eleventh grader". Spelling does not decide this —
  // sound does, and only these two ordinals start with a vowel sound.
  const article = ['eighth', 'eleventh'].includes(word) ? 'an' : 'a';
  return {
    id,
    slug: id,
    label,
    title: `${BRAND.name} — ${label}`,
    listener: { grade, age: defaultAge(grade), pronouns, term },
    tagline: `${word.charAt(0).toUpperCase()}${word.slice(1)}${grade === 0 ? '' : ' grade'}, on the way to school.`,
    description:
      `A daily twelve-minute ride-to-school show built from what ${article} ${word} ` +
      `${grade === 0 ? 'student' : 'grader'} is actually studying that week. Researched from ` +
      'museums, national labs, and university sources — every fact traceable to a named page.',
    planFile,
    accent,
    ...rest,
  };
}

export const SHOWS = Object.fromEntries(
  ROSTER.map(defineShow).map((show) => [show.id, show]),
);

export const showIds = () => Object.keys(SHOWS);

export function getShow(id) {
  const s = SHOWS[id];
  if (!s) throw new Error(`Unknown show "${id}". Known: ${showIds().join(', ')}`);
  return s;
}

// --- The week's arc -------------------------------------------------------
// Five episodes that build, not five arbitrary slices. Unchanged by the split
// — it was always the strongest part of the format.

export const WEEK_ARC = [
  {
    day: 'Monday',
    part: 1,
    beat: 'The Question',
    brief:
      'What are we actually asking this week, and why did anyone care enough ' +
      'to go find out? Open the loop. Do not resolve it. End on the question ' +
      'restated, sharper than it was at the top.',
  },
  {
    day: 'Tuesday',
    part: 2,
    beat: 'The Story',
    brief:
      'The people and the history. Who was in the room, what did they get ' +
      'wrong first, what did it cost them. Narrative over exposition — this is ' +
      'the episode that should feel like a story, not a lesson.',
  },
  {
    day: 'Wednesday',
    part: 3,
    beat: 'The Mechanism',
    brief:
      'How it actually works. The hard part. Go slower here than feels ' +
      'necessary, use one concrete analogy per concept and reuse it rather ' +
      'than piling on new ones. This is the episode that earns the week.',
  },
  {
    day: 'Thursday',
    part: 4,
    beat: 'The Argument',
    brief:
      'Where experts genuinely disagree, or the edge cases that break the ' +
      'simple version they were taught. Model intellectual honesty: name the ' +
      'strongest version of each side. Never manufacture a controversy that ' +
      'the sources do not support.',
  },
  {
    day: 'Friday',
    part: 5,
    beat: 'The Recap + Quiz',
    brief:
      'Pull the week together, then a five-question quiz — asked out loud with ' +
      'a real pause before each answer, so he can shout it in the car. Close ' +
      'with a one-line tease of next week.',
  },
];

// --- Episode structure ----------------------------------------------------
// Target ~11 minutes. Half the drive, so it ends before the drop-off rather
// than getting cut off mid-sentence — and a 12-year-old will actually finish it.
//
// One kid means one subject, so the two acts are now a teach and a turn rather
// than one act per brother.

// `direction` is sent to Octave as acting instructions. With a voice already
// specified, the description steers the performance rather than inventing a
// new voice — so the same clone can open cold and land an outro differently.
// `speed` is Octave's non-linear rate (0.5 slow — 2.0 fast); 1.0 is normal.
export const SEGMENTS = [
  { id: 'cold_open',   seconds: 20,  voice: 'parent',  music: null,         label: 'Cold open — the hook',
    direction: 'Quiet and close, like the first thing said after the radio goes off. Land the first sentence and let it sit. Curious, not dramatic — never announce.',
    speed: 0.94, trailingSilence: 0.6 },
  { id: 'theme',       seconds: 15,  voice: null,   music: 'theme',      label: 'Theme' },
  { id: 'welcome',     seconds: 30,  voice: 'parent',  music: 'under_soft', label: "Welcome + today's map",
    direction: 'Easy and offhand, the way you talk while pulling out of the driveway. Warm, slightly amused, unhurried.',
    speed: 1.0, trailingSilence: 0.4 },
  { id: 'act_one',     seconds: 300, voice: 'narrator', music: null,         label: 'Act One — the teach',
    direction: 'Clear documentary narration. Even and unhurried, letting the facts carry weight. Never bright or salesy. Leave real space at the end of each sentence.',
    speed: 1.0, trailingSilence: 0.3 },
  { id: 'break_one',   seconds: 15,  voice: null,   music: 'sting',      label: 'Music break' },
  { id: 'act_two',     seconds: 210, voice: 'narrator', music: null,         label: 'Act Two — the turn',
    direction: 'Same narration, a shade more urgency — this is the complication. Still calm; the tension is in the material, not the delivery. Leave real space at the end of each sentence.',
    speed: 1.0, trailingSilence: 0.3 },
  { id: 'outro',       seconds: 40,  voice: 'parent',  music: 'under_soft', label: 'Tomorrow on the show + outro',
    direction: 'Wrapping up as you pull into the drop-off line. Affectionate and a little dry. The tease is thrown away, not sold.',
    speed: 0.98, trailingSilence: 0.8 },
  { id: 'outro_music', seconds: 25,  voice: null,   music: 'theme',      label: 'Outro music' },
];

export const segmentSpec = (id) => SEGMENTS.find((s) => s.id === id);

export const TARGET_SECONDS = SEGMENTS.reduce((n, s) => n + s.seconds, 0); // 655s ≈ 10:55

// Spoken-word pacing, measured rather than assumed — the two voices are not
// close. A first full render clocked the clone at 160 wpm and the library
// narrator at 215, so a single figure wrote the acts a third too short.
//
// Octave's `speed` turned out to be a weak lever on the library voice —
// 1.00, 0.85, 0.78 and 0.70 measured 182, 200, 181 and 172 wpm, which is mostly
// noise around 180. Rather than fight it, the host moved to OpenAI, which
// narrates at 155-164 wpm without being asked and costs a fifth as much.
// The parent voice stays on the clone. Re-measure if either voice changes.
export const WORDS_PER_MINUTE = { parent: 160, narrator: 157 };

export function wordBudget(seconds, role = 'narrator') {
  const wpm = WORDS_PER_MINUTE[role] ?? 165;
  return Math.round((seconds / 60) * wpm);
}

// --- Voice ----------------------------------------------------------------
// Two voices is not a nicety — even eleven minutes of one synthetic voice is
// wearing. The PARENT voice opens and closes; the NARRATOR carries the teach.
//
// The roles are named for their job, not for who fills them. The parent voice
// is whoever is doing the school run — clone your own voice, or use a stock one.
//
// full-stock — both roles on OpenAI. One API key, cheapest, and the default.
// hybrid     — your cloned voice as the parent, stock narrator. ~$1.30/week.
// duo-hume   — two Hume voices.
// full-hume  — everything on Hume. Roughly 3.5x full-stock.

export const VOICE_MODES = {
  'full-stock': { parent: 'openai', narrator: 'openai' },      // no Hume account needed
  hybrid:       { parent: 'hume',   narrator: 'openai' },      // your voice hosts, stock narrates
  'duo-hume':   { parent: 'hume',   narrator: 'hume-narrator' },
  'full-hume':  { parent: 'hume',   narrator: 'hume' },
};

// Each voice carries its own provider: a cloned voice is CUSTOM_VOICE, one from
// Hume's library is HUME_AI. Sending the wrong provider is a 404 that reads
// like the voice was deleted.
export const HUME_VOICES = {
  hume: () => ({
    id: process.env.HUME_VOICE_PARENT || process.env.HUME_VOICE_ID,
    provider: process.env.HUME_VOICE_PARENT_PROVIDER || 'CUSTOM_VOICE',
  }),
  'hume-narrator': () => ({
    id: process.env.HUME_VOICE_NARRATOR || process.env.HUME_VOICE_PARENT,
    provider: process.env.HUME_VOICE_NARRATOR_PROVIDER || process.env.HUME_VOICE_PARENT_PROVIDER || 'CUSTOM_VOICE',
  }),
};

// full-stock is the default: it needs one API key and no cloned voice, so a
// fresh clone works before anyone has signed up for anything else.
export const VOICE_MODE = process.env.VOICE_MODE || 'full-stock';

export function voiceEngineFor(role) {
  const mode = VOICE_MODES[VOICE_MODE];
  if (!mode) throw new Error(`Unknown VOICE_MODE "${VOICE_MODE}". Use one of: ${Object.keys(VOICE_MODES).join(', ')}`);
  return mode[role];
}

export const OPENAI_VOICE = process.env.OPENAI_VOICE || 'sage';
// Optional second stock voice, so full-stock mode isn't one voice for eleven
// minutes. Falls back to the same voice, which still works — it just reads as
// one narrator rather than two people.
export const OPENAI_VOICE_FOR = (role) =>
  (role === 'narrator' && process.env.OPENAI_VOICE_NARRATOR) || OPENAI_VOICE;
export const OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';

export const VOICE_DIRECTION = {
  parent: 'Warm, unhurried, talking to your own kid in the car. Dry humor, never ' +
          'cutesy. You are genuinely interested in this, not performing interest.',
  narrator: 'Clear and engaging documentary narration for a smart twelve-year-old. ' +
            'Never talk down. Let the facts carry the weight; do not oversell.',
};

// --- Audio ----------------------------------------------------------------
export const AUDIO = {
  loudnessTarget: -16,   // LUFS, mono podcast standard
  // loudnorm's OWN ceiling, and deliberately loose. In linear mode loudnorm
  // applies one flat gain and quietly reduces it whenever that gain would
  // breach TP — so a tight number here doesn't buy headroom, it buys a quieter
  // show. Asking for -4.5 landed the week at -17.8 LUFS instead of -16.
  // Loudness is set here; the ceiling is enforced downstream by the limiter.
  truePeak: -1.0,        // dBTP
  // The ceiling that actually matters, enforced by MASTER_CHAIN after
  // normalisation. Sized for the encoder, measured rather than guessed: at
  // 64kbps the decoder reconstructs samples ~3.3 dB above what it was handed
  // (a mix ceilinged at -3.0 came back at +0.3 dBFS). At 96kbps that collapses
  // to ~0.4 dB, which is the main reason the bitrate went up.
  masterCeiling: -2.0,   // dBFS, pre-encode
  // 96k, not 64k. Storage on R2 is $0.015/GB-month and egress is free, so a
  // year of both shows costs pennies more — while 64kbps was both audibly
  // crunchy on the music and the sole reason the master needed 4 dB of
  // headroom it couldn't spare.
  bitrate: '96k',
  sampleRate: 44100,
  channels: 1,

  // --- handing off between voices ------------------------------------------
  // Two places in the show cut straight from one voice to another with no music
  // in between: welcome (parent) into act one (narrator), and act two back into
  // the outro (parent). Both were butt-joined, and the second is the worst
  // place in the show for it — the narrator's last word and the parent's first
  // arrived back to back, so the turn landed like an edit rather than a
  // handover.
  //
  // Segment `trailingSilence` did not cover this: it is a Hume parameter, so it
  // applied to the parent and was ignored on the OpenAI-voiced acts. Putting
  // the gap here instead makes it engine-independent — it is an edit decision,
  // not a synthesis one, and it belongs with the other edit decisions.
  //
  // These are gaps between ADJACENT SPOKEN segments only; anywhere music sits
  // between two segments it already does this job.
  voiceChangeGap: 0.75,  // seconds — a different person starts talking
  sameVoiceGap: 0.25,    // seconds — same person, new movement

  // Every element is normalised to a known loudness BEFORE the gains below are
  // applied — otherwise "-18 dB under speech" means nothing, because it is
  // -18 dB under whatever level that particular library track happened to
  // ship at. That bug put the theme 15 dB too quiet (-33.9 LUFS against speech
  // at -19) and let the voice-clone segments run 4.5 dB hotter than the host.
  speechAnchor: -19,     // LUFS, per speech segment, after VOICE_CHAIN
  musicBedGain: -18,     // dB relative to speechAnchor, under a voice
  musicSoloGain: -4,     // dB relative to speechAnchor, playing alone
  crossfade: 1.5,        // seconds
};

// The voice chain — what makes it sound like radio rather than a text-to-speech
// demo. Applied to speech only, never to music, and always before the mix so
// the bed ducks under a already-even voice.
//
// Order matters and this is the broadcast order:
//   1. highpass   strip rumble and breath thumps below the voice
//   2. de-mud     a narrow cut around 200Hz; TTS piles up there and it reads
//                 as "boxy" on car speakers
//   3. compress   the actual point. 3.5:1 with a soft knee pulls the quiet
//                 ends of sentences up to meet the loud middles, which is why
//                 broadcast voices stay intelligible over road noise
//   4. presence   a gentle lift around 3kHz for consonants and diction
//   5. limiter    catches the plosives the compressor let through
//
// Deliberately moderate. Over-compressed voice is fatiguing over twelve
// minutes, and the boys are hearing this five mornings a week.
export const VOICE_CHAIN = [
  'highpass=f=75',
  'equalizer=f=200:t=q:w=1.1:g=-2.5',
  'acompressor=threshold=-20dB:ratio=3.5:attack=8:release=160:knee=6:makeup=3',
  'equalizer=f=3200:t=q:w=1.4:g=2.5',
  'alimiter=limit=0.92:attack=4:release=60',
].join(',');

// The real ceiling, applied AFTER loudnorm has set the level. This is doing
// genuine work — a few dB off the plosives so the encoder has room — which is
// why it has to come second: loudnorm decides how loud, the limiter decides how
// tall, and neither can do the other's job.
//
// Note `level=disabled`. ffmpeg's alimiter auto-levels the signal UP to its
// limit by default, so adding it "for safety" after loudnorm pushed the peaks
// back toward full scale and the encoder then clipped them.
const dbToLinear = (db) => Math.round(10 ** (db / 20) * 1000) / 1000;
export const MASTER_CHAIN =
  `alimiter=limit=${dbToLinear(AUDIO.masterCeiling)}:level=disabled:attack=5:release=80`;

// --- Artwork --------------------------------------------------------------
export const ART = {
  size: 3000,
  // Duotone, not a tint: the photo goes to high-contrast black and white, then
  // shadows map to `shadow` and highlights to `highlight`. A flat colorize wash
  // reads pastel at thumbnail size; mapping the endpoints keeps blacks black,
  // which is what makes it look printed.
  //
  // Each show has a fixed accent so the two feeds never look alike in a
  // library, and the week rotates within a family of tints on that accent.
  overlays: [
    { name: 'sunsets', label: 'Sunsets Through Windows', shadow: '#160C06', highlight: '#E68A58' },
    { name: 'deepsea', label: 'Jarred Deep Sea', shadow: '#091013', highlight: '#4482A3' },
    { name: 'olive', label: 'Olives Before Dinner', shadow: '#11120A', highlight: '#818546' },
    { name: 'wood', label: 'Fresh Cut Wood', shadow: '#150B07', highlight: '#884529' },
    { name: 'ocean', label: 'Ocean Wave Break', shadow: '#0C100D', highlight: '#99B7A4' },
    { name: 'horsing', label: 'Horsing Around', shadow: '#141008', highlight: '#C3A05B' },
    { name: 'sky', label: 'Sky to a Bird', shadow: '#0A1012', highlight: '#9BC0CC' },
    { name: 'berry', label: 'Blended Strawberries', shadow: '#160608', highlight: '#F5B1B8' },
    { name: 'snow', label: 'Day Old Snow', shadow: '#160C06', highlight: '#FFE4D2' },
  ],

  contrast: '12x42%',
  // Anton is the shipped default because it is SIL Open Font License — this
  // repo can redistribute it. A hand-drawn, slightly irregular display face
  // sits better with archival source photography, so if you own one, drop the
  // file in assets/fonts/ and name it here. Any fallback below is used if the
  // named file is missing, so a bad name degrades instead of crashing.
  titleFont: 'Anton-Regular.ttf',
  fallbackFonts: ['ArchivoBlack-Regular.ttf'],
};

export function paletteFor(showId) {
  const show = getShow(showId);
  return ART.overlays.find((o) => o.name === show.accent) || ART.overlays[0];
}
