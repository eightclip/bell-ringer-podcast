// Aliased: this file already has its own getShow(), which fetches a show's
// published manifest from R2. Different job, same obvious name.
import { showIds, getShow as showConfig, paletteFor } from '../../config/show.mjs';

// The public face.
//
// Deliberately impersonal: shows are named by grade, never by child. The feeds
// carry itunes:block and this page is noindex, so "unlisted" still means
// something — but anyone holding this URL can subscribe, which is the point of
// having a front door at all.

export const revalidate = 900;

// Each show carries its own accent, taken from the duotone its artwork is
// built from, so the page and the cover agree without anyone maintaining two
// copies of the colour.
// Read from the roster rather than repeated here. Hardcoded, this page kept
// advertising grade6 and grade7 after somebody configured the repo for their
// own child — tiles linking to feeds that do not exist, which is a worse
// failure than no page at all. This is a server component, so importing the
// pipeline's config is free; nothing here reaches the browser but the strings.
const SHOWS = showIds().map((id) => {
  const show = showConfig(id);
  return {
    id,
    label: show.label,
    cat: `G-${String(show.listener.grade).padStart(2, '0')}`,
    tint: paletteFor(id).highlight,
  };
});

const CLAIMS = [
  'Every fact checked twice, against the page it came from',
  'No advertising, no sponsor, nothing to sell',
  'Made at the kitchen table',
];

const WEEK = [
  { dow: 'Mon', beat: 'The Question', blurb: 'What are we actually asking — and who first cared enough to go and find out?' },
  { dow: 'Tue', beat: 'The Story', blurb: 'The people. What they got wrong first, and what it cost them.' },
  { dow: 'Wed', beat: 'The Mechanism', blurb: 'How it actually works. The hard part, taken slowly.' },
  { dow: 'Thu', beat: 'The Argument', blurb: 'Where experts still disagree, or where the simple version breaks.' },
  { dow: 'Fri', beat: 'The Recap', blurb: 'Pull it together, then five questions to shout answers at.' },
];

const base = () => (process.env.R2_PUBLIC_BASE || '').replace(/\/$/, '');
const isConfigured = () => Boolean(process.env.R2_PUBLIC_BASE && process.env.FEED_TOKEN);
const feedUrl = (id) => `${base()}/feed/${process.env.FEED_TOKEN}/${id}.xml`;

// Parse just enough RSS to list episodes. A dependency for four fields would be
// a dependency to keep patched forever.
function parseFeed(xml) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const pick = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim() : '';
  };
  return items.map((b) => ({
    title: pick(b, 'title'),
    duration: pick(b, 'itunes:duration'),
    episode: pick(b, 'itunes:episode'),
  }));
}

async function getShow(show) {
  // Without R2 config the URL is malformed and the fetch hangs, which during a
  // build means the page never prerenders. Bail before asking, and cap the
  // request so a slow bucket can't do the same.
  if (!isConfigured()) return { ...show, episodes: [], live: false };
  try {
    const res = await fetch(feedUrl(show.id), { next: { revalidate: 900 }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ...show, episodes: [], live: false };
    return { ...show, episodes: parseFeed(await res.text()), live: true };
  } catch {
    return { ...show, episodes: [], live: false };
  }
}

export default async function Home() {
  const shows = await Promise.all(SHOWS.map(getShow));
  const configured = isConfigured();

  return (
    <main>
      <section className="masthead">
        <div className="slug eyebrow">
          <span>Twelve minutes · Five mornings · One idea at a time</span>
          <span>Weekdays</span>
        </div>

        <h1 className="wordmark">Bell&nbsp;Ringer</h1>

        <div className="intro">
          <p className="lede">
            There are twenty minutes in the car every school morning and nothing to do
            with them. This is a show for those twenty minutes — built each week from
            what they are <em>actually studying in class</em>, so it lands the same week
            the lesson does.
          </p>
          <ul className="claims">
            {CLAIMS.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      </section>

      <section className="shows">
        {shows.map((s) => (
          <article className="show" key={s.id} style={{ '--tint': s.tint }}>
            {configured && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${base()}/art/cover-${s.id}.jpg`} alt={`Bell Ringer — ${s.label}`} />
            )}
            <h2>{s.label}</h2>
            <span className="meta eyebrow">Cat. {s.cat} · Twelve min · Mon&ndash;Fri</span>

            {s.episodes.length > 0 ? (
              <ol className="eps">
                {s.episodes.slice(0, 5).map((e, i) => (
                  <li key={i}>
                    <span className="n">{String(e.episode || i + 1).padStart(2, '0')}</span>
                    <span className="t">{e.title}</span>
                    <span className="d">{e.duration}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="soon">
                {s.live ? 'First episode airs Monday morning.' : 'Not in production yet.'}
              </p>
            )}

            {/* Only offer the feed once there is one. Grade 7 has no episodes
                yet, so its feed 404s and subscribing would just fail quietly
                inside someone's podcast app. */}
            {configured && s.live && (
              <a className="subscribe" href={feedUrl(s.id)}>Subscribe by RSS</a>
            )}
          </article>
        ))}
      </section>

      <section className="band">
        <h3>
          How it gets made
          <span className="qualifier">…and why you can trust a word of it</span>
        </h3>

        <div className="steps">
          <div className="step">
            <span className="num eyebrow">01</span>
            <h4>Start with the actual lesson</h4>
            <p>
              Not a topic someone guessed at. The teacher&rsquo;s own plan for that week —
              the unit, the vocabulary, the essential question she wrote herself.
            </p>
          </div>
          <div className="step">
            <span className="num eyebrow">02</span>
            <h4>Read only serious sources</h4>
            <p>
              Research runs against a fixed list — NASA, NIST, OpenStax, the Library of
              Congress, the Smithsonian — and cannot reach anything outside it. No blogs,
              no content farms, no encyclopedias anyone can edit.
            </p>
          </div>
          <div className="step">
            <span className="num eyebrow">03</span>
            <h4>Check every claim again</h4>
            <p>
              Each fact is taken back to the page it came from, and survives only if a
              sentence there actually supports it. The ones that don&rsquo;t are cut, not
              softened. Sources are listed in every episode.
            </p>
          </div>
        </div>
      </section>

      <section className="band">
        <h3>The shape of a week</h3>
        <div className="days">
          {WEEK.map((d) => (
            <div className="day" key={d.dow}>
              <span className="eyebrow">{d.dow}</span>
              <strong>{d.beat}</strong>
              <p>{d.blurb}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="eyebrow">
        <span>Bell Ringer · Recorded at home</span>
        <span><a href="/admin">Admin</a></span>
      </footer>
    </main>
  );
}
