// The factuality mechanism.
//
// Every claim in every script must trace to one of these domains. This list is
// passed to Claude's web_search / web_fetch tools as `allowed_domains`, which
// means the model *cannot* reach anything else — it is not a guideline the
// model is asked to follow, it is a wall it cannot walk through.
//
// Rule for adding a domain: it must be a government agency, a museum or
// national library, a university, a peer-reviewed textbook project, or a
// reference work with a named editorial board. No content farms, no "kids
// facts" sites, no blogs, no AI-generated encyclopedias.

export const ALLOWED_DOMAINS = [
  // --- US federal science & data ---
  'nasa.gov',
  'jpl.nasa.gov',
  'science.nasa.gov',
  'noaa.gov',
  'weather.gov',
  // NOAA serves JetStream off numbered subdomains and the allowlist matcher
  // did not accept them via the parent domain — 19 good claims were cut as
  // "source_unreachable" purely because w2.weather.gov was refused.
  'w1.weather.gov',
  'w2.weather.gov',
  'forecast.weather.gov',
  'usgs.gov',
  'nps.gov',
  'energy.gov',
  'nist.gov',
  'epa.gov',

  // --- Health & life science ---
  'nih.gov',
  'medlineplus.gov',
  'genome.gov',
  'cdc.gov',

  // --- History, civics, primary sources ---
  'loc.gov',
  'archives.gov',
  'docsteach.org',
  'senate.gov',
  'house.gov',
  'supremecourt.gov',
  'monticello.org',
  'mountvernon.org',

  // --- Museums & institutions ---
  'si.edu',
  'americanhistory.si.edu',
  'naturalhistory.si.edu',
  'airandspace.si.edu',
  'amnh.org',
  'fieldmuseum.org',
  'mos.org',
  'exploratorium.edu',
  'metmuseum.org',
  'getty.edu',

  // --- Reference with editorial boards ---
  'britannica.com',
  'nationalgeographic.org',

  // --- Open, peer-reviewed curriculum ---
  'openstax.org',
  'ck12.org',
  'khanacademy.org',
  'pbslearningmedia.org',
  'pbs.org',

  // --- Standards (used to align, not to cite as fact) ---
  'nextgenscience.org',
  'corestandards.org',
  'ed.gov',

  // --- Math ---
  'mathworld.wolfram.com',
  'ams.org',

  // --- University extension / .edu outreach ---
  'mit.edu',
  'harvard.edu',
  'stanford.edu',
  'berkeley.edu',
  'cornell.edu',
  'colostate.edu',
  'wisc.edu',
];

// Sources that are *never* acceptable even if somehow reachable. Belt and
// suspenders — the allowlist already excludes these, but this list is checked
// again at verification time in case a domain is ever added upstream.
export const BLOCKED_DOMAINS = [
  'wikipedia.org', // fine for orientation, not for a cited claim
  'ducksters.com',
  'study.com',
  'coursehero.com',
  'quizlet.com',
  'chegg.com',
  'medium.com',
  'substack.com',
  'reddit.com',
  'quora.com',
  'answers.com',
];

// A claim is only allowed into a script if it carries a source_url on this
// list AND a verbatim quote from that page that supports it.
export function isAllowedSource(url) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return false;
  }
  if (BLOCKED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return false;
  return ALLOWED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}
