// Feed refresh — runs every weekday morning, not just on render night.
//
// The whole week is rendered on Sunday, but the feed only ever exposes episodes
// whose air date has passed. That's what makes it a daily show rather than five
// files dumped at once, and it means Friday's quiz can't be spoiled on Monday.
//
// The feed is a plain file on R2 at an unguessable path — no server, no
// framework, nothing to keep running.

import { buildFeed } from './publish.mjs';
import { put, list, getJSON, publicBase, useS3 } from './r2.mjs';
import { need, step, ok, log, warn, isMain, currentShow } from './lib.mjs';
import { getShow } from '../config/show.mjs';

// One feed per show, each behind the same unguessable token — so a single
// leaked URL exposes one boy's show, not both.
export const feedPath = (showId) => `feed/${need('FEED_TOKEN')}/${showId}.xml`;
export const feedUrl = (showId) => `${publicBase()}/${feedPath(showId)}`;

export async function refreshFeed(showId, { all = false, weeks = [] } = {}) {
  const show = getShow(showId);
  step(`Rebuilding feed — ${show.title}`);

  // Prefer listing every manifest. Without S3 credentials there's no list API,
  // so accept the weeks on the command line instead of failing.
  let keys;
  if (weeks.length) {
    keys = weeks.map((w) => `manifest/${showId}/${w}.json`);
    log(`  using ${keys.length} week(s) given on the command line`);
  } else {
    keys = (await list(`manifest/${showId}/`)).filter((k) => k.endsWith('.json'));
  }
  if (!keys.length) { warn('no manifests on R2 yet — nothing to publish'); return null; }

  const manifests = [];
  for (const key of keys) {
    try {
      manifests.push(await getJSON(key));
    } catch (e) {
      warn(`skipping ${key}: ${e.message}`);
    }
  }
  if (!manifests.length) { warn('no readable manifests'); return null; }

  const now = new Date();
  const xml = buildFeed(showId, manifests, { all, now, coverUrl: `${publicBase()}/art/cover-${showId}.jpg` });

  const live = (xml.match(/<item>/g) || []).length;
  const total = manifests.reduce((n, m) => n + m.episodes.length, 0);
  log(`  ${live} of ${total} episodes are live as of ${now.toDateString()}`);

  // Short cache: podcast apps poll this, and a new episode should appear within
  // minutes of its air time, not hours.
  await put(feedPath(showId), xml, 'application/rss+xml; charset=utf-8', { immutable: false });
  ok(`feed → ${feedUrl(showId)}`);
  log(`  storage: ${useS3() ? 'S3 API' : 'wrangler CLI'}`);
  return feedUrl(showId);
}

if (isMain(import.meta.url)) {
  const weeks = process.argv.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  refreshFeed(currentShow(), { all: process.argv.includes('--all'), weeks }).catch((e) => {
    console.error(`\n\x1b[31m✖ ${e.message}\x1b[0m`);
    process.exit(1);
  });
}
