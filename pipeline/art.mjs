// Stage 5 — artwork.
//
// Unsplash photo keyed to the week's topic → high-contrast black and white →
// a single colour wash → title. The show cover stays constant so the show is
// recognisable; each episode gets its own image so the shelf reads as a run of
// related things rather than twenty identical squares.
//
// Unsplash's API terms require crediting the photographer and pinging their
// download endpoint, so both happen here and the credit lands in the show notes.

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getShow, BRAND, ART, paletteFor } from '../config/show.mjs';
import { currentWeek, currentShow, weekDir, readJSON, writeJSON, need, ROOT, ASSETS, step, ok, warn, log, magick, isMain } from './lib.mjs';

function font() {
  for (const f of [ART.titleFont, ...ART.fallbackFonts]) {
    const p = join(ASSETS, 'fonts', f);
    if (existsSync(p)) return p;
  }
  warn('no vendored font found — falling back to a system font, output may differ in CI');
  return 'Helvetica-Bold';
}

// --- Unsplash -------------------------------------------------------------
async function findPhoto(query) {
  const key = need('UNSPLASH_ACCESS_KEY');
  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', query);
  url.searchParams.set('orientation', 'squarish');
  url.searchParams.set('per_page', '12');
  url.searchParams.set('content_filter', 'high'); // this is a kids' show

  const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' } });
  if (!res.ok) throw new Error(`Unsplash ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { results } = await res.json();
  if (!results?.length) return null;

  // Prefer something big enough that a 3000px square isn't an upscale.
  const big = results.filter((p) => Math.min(p.width, p.height) >= ART.size);
  const pick = (big.length ? big : results)[0];

  // Required by the Unsplash API guidelines: registering the download is what
  // credits the photographer's stats. Not optional, and not the same as
  // fetching the image itself.
  fetch(pick.links.download_location, { headers: { Authorization: `Client-ID ${key}` } }).catch(() => {});

  return {
    id: pick.id,
    url: `${pick.urls.raw}&w=${ART.size}&h=${ART.size}&fit=crop&q=90`,
    credit: {
      photographer: pick.user.name,
      photographer_url: `${pick.user.links.html}?utm_source=bell_ringer&utm_medium=referral`,
      unsplash_url: `${pick.links.html}?utm_source=bell_ringer&utm_medium=referral`,
    },
  };
}

async function download(url, out) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`photo download ${res.status}`);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
}

// --- treatment ------------------------------------------------------------
// Grayscale, normalised, then pushed hard with a sigmoidal curve — that keeps
// midtone detail while crushing toward true black and white, which is what
// makes the colour wash read as a wash rather than a tint.
export function treat(src, out, palette, { title = null, kicker = null } = {}) {
  const S = ART.size;

  magick([
    src,
    '-resize', `${S}x${S}^`, '-gravity', 'center', '-extent', `${S}x${S}`,
    '-colorspace', 'Gray', '-normalize', '-sigmoidal-contrast', ART.contrast,
    // Back to sRGB first — +level-colors is a no-op while the image is still
    // in Gray colorspace, and the result silently stays black and white.
    '-colorspace', 'sRGB', '-type', 'TrueColor',
    '+level-colors', `${palette.shadow},${palette.highlight}`,
    // The scrim exists only to keep type legible. With no type it just darkens
    // the bottom third of a picture that was doing fine on its own.
    ...(title || kicker
      ? ['(', '-size', `${S}x${Math.round(S * 0.55)}`, 'gradient:none-black', ')',
         '-gravity', 'south', '-compose', 'over', '-composite']
      : []),
    out,
  ]);

  // Episode art carries no type at all. The picture is the design — a podcast
  // app already prints the episode title next to it, so a slab of Anton over
  // the top is redundant and covers the thing worth looking at.
  if (!title && !kicker) return out;

  // Type is fitted to a box, not set at a fixed point size. A hardcoded size is
  // tuned to one typeface and one string: swapping the display face for a
  // considerably wider one pushed "BELL RINGER" off both edges of the canvas.
  // `-size WxH label:` scales the face to fill the box instead, so any font
  // and any title behave. This is what lets you change titleFont safely.
  const layer = (text, boxW, boxH, kerning) => {
    const f = join(ASSETS, '_type.png');
    magick([
      '-background', 'none', '-fill', 'white', '-font', font(),
      '-kerning', String(kerning),
      '-size', `${Math.round(boxW)}x${Math.round(boxH)}`,
      `label:${text}`, f,
    ]);
    return f;
  };

  // Type is small and set low, deliberately. These covers are photographs
  // worth looking at; the wordmark is a caption on the picture, not a banner
  // across it. The name still reads at thumbnail size because the face is
  // heavy and the letter-spacing is open.
  const t = layer(title.toUpperCase(), S * 0.42, S * 0.055, Math.round(S * 0.004));
  magick([out, t, '-gravity', 'south', '-geometry', `+0+${Math.round(S * 0.085)}`, '-composite', out]);

  if (kicker) {
    const k = layer(kicker.toUpperCase(), S * 0.16, S * 0.022, Math.round(S * 0.006));
    magick([out, k, '-gravity', 'south', '-geometry', `+0+${Math.round(S * 0.052)}`, '-composite', out]);
  }
  return out;
}


function wrap(text, perLine) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > perLine) { lines.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

function colorForWeek(week, offset = 0) {
  let h = 0;
  for (const c of week) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ART.overlays[(h + offset) % ART.overlays.length];
}

// --- show cover (constant) ------------------------------------------------
export async function makeCover(showId) {
  const show = getShow(showId);
  const out = join(ASSETS, `cover-${showId}.jpg`);
  const src = join(ASSETS, `cover-source-${showId}.jpg`);
  step(`Building cover — ${show.title}`);

  if (!existsSync(src)) {
    const photo = await findPhoto('school bus morning light empty road');
    if (!photo) throw new Error('no cover photo found');
    await download(photo.url, src);
    writeJSON(join(ASSETS, `cover-credit-${showId}.json`), photo.credit);
    log(`  photo by ${photo.credit.photographer}`);
  }

  treat(src, out, paletteFor(showId), { title: BRAND.name, kicker: show.label });
  ok(`cover → ${out}`);
  return out;
}

// --- per-episode ----------------------------------------------------------
export async function makeWeekArt(showId, week) {
  const show = getShow(showId);
  const dir = weekDir(showId, week);
  const research = readJSON(join(dir, 'research.json'));
  const episodes = readJSON(join(dir, 'episodes.json'))?.episodes
    || readJSON(join(dir, 'scripts.json'))?.episodes;
  if (!research || !episodes) throw new Error(`Need research.json and scripts.json for ${showId} ${week}`);

  const artDir = join(dir, 'art');
  mkdirSync(artDir, { recursive: true });

  // One photo for the week, keyed to the topics, so the five episodes read as
  // a set. The colour rotates per week so consecutive weeks don't blur.
  const query = research.topic.title;
  step(`Artwork for "${query}"`);
  const photo = await findPhoto(query) || await findPhoto(research.topic.subject || 'classroom');
  if (!photo) { warn('no photo found — episodes will use the show cover'); return []; }

  const src = join(artDir, 'source.jpg');
  await download(photo.url, src);
  const color = paletteFor(showId);
  log(`  ${color.name} · photo by ${photo.credit.photographer}`);

  const made = [];
  for (const ep of episodes) {
    const part = ep.part ?? ep.arc?.part;
    const day = ep.day ?? ep.arc?.day;
    const title = ep.title;
    const out = join(artDir, `part${part}.jpg`);
    treat(src, out, color); // no type — the image is the design
    made.push({ part, file: out });
  }

  writeJSON(join(dir, 'art.json'), {
    show: showId, week, color: color.name, query,
    credit: photo.credit,
    credit_line: `Cover photo by ${photo.credit.photographer} on Unsplash.`,
    episodes: made,
  });
  ok(`${made.length} episode images → ${artDir}`);
  return made;
}

if (isMain(import.meta.url)) {
  const wantCover = process.argv.includes('--cover');
  (wantCover ? makeCover(currentShow()) : makeWeekArt(currentShow(), currentWeek())).catch((e) => {
    console.error(`\n\x1b[31m✖ ${e.message}\x1b[0m`);
    process.exit(1);
  });
}
