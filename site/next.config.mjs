// Next config — output mode and the Content-Security-Policy.
//
// The CSP was added 2026-09-24, after an audit found the deployed site
// carrying HSTS, X-Frame-Options, X-Content-Type-Options and Referrer-Policy
// but no CSP at all. Those four are static and are set in the deployed repo's
// site/vercel.json; this one lives here because it has to be *computed* — the
// media origin is whatever R2_PUBLIC_BASE points at, which differs per install
// and is a secret in the private repo, so it cannot be a literal in a static
// JSON file.
//
// THIS FILE IS THE SAME IN BOTH REPOSITORIES (eightclip/Bell-Ringer, the
// deployed private copy, and eightclip/bell-ringer-podcast, the public one).
// Keep it that way: every origin below is derived from environment, so the
// file has no per-install content to drift over.

/** Origin only — the policy takes a scheme+host, never a path. */
function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

// Cover art and audio come from the R2 bucket's public base. If the build
// cannot see R2_PUBLIC_BASE we fall back to `https:` rather than omitting the
// origin: a CSP that silently blanks the covers is a worse outcome than a
// loose img-src, and this is the one value a fork is guaranteed to change.
const R2 = originOf(process.env.R2_PUBLIC_BASE) || 'https:';

// PostHog, and only when a key is actually configured. lib/analytics.js loads
// the pinned array.js from the *-assets host and posts events to the api host,
// so both are needed, and it derives the assets host by exactly this swap.
const PH_HOST = process.env.NEXT_PUBLIC_POSTHOG_KEY
  ? originOf(process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com')
  : '';
const PH_ASSETS = PH_HOST ? PH_HOST.replace('.i.posthog.com', '-assets.i.posthog.com') : '';

const dev = process.env.NODE_ENV === 'development';

// 'unsafe-inline' on script-src is deliberate and is the one real weakness
// here. Next's App Router ships the Flight payload as inline <script>
// self.__next_f.push(...) blocks, and the layout renders an inline ld+json.
// The strict alternative is a per-request nonce from middleware, which forces
// every route to render dynamically — this page is ISR with a 15-minute
// revalidate and giving that up to harden against an injection on a site with
// no user-generated content anywhere is a bad trade. Revisit if that changes.
//
// 'unsafe-eval' and the websocket are dev only: webpack's HMR runtime needs
// both and production needs neither.
function csp() {
  const directives = [
    ['default-src', ["'self'"]],
    ['base-uri', ["'self'"]],
    ['object-src', ["'none'"]],
    ['frame-ancestors', ["'self'"]],
    ['frame-src', ["'none'"]],
    ['form-action', ["'self'"]],
    ['script-src', ["'self'", "'unsafe-inline'", dev && "'unsafe-eval'", PH_ASSETS]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['font-src', ["'self'"]],
    ['img-src', ["'self'", 'data:', R2]],
    ['media-src', ["'self'", R2]],
    ['connect-src', ["'self'", PH_HOST, PH_ASSETS, dev && 'ws:']],
    ['manifest-src', ["'self'"]],
    ['worker-src', ["'self'", 'blob:']],
  ];

  const policy = directives
    .map(([name, values]) => [name, [...new Set(values.filter(Boolean))].join(' ')])
    .map(([name, values]) => `${name} ${values}`);

  // Not in dev: it would rewrite http://localhost to https and break the
  // local server outright.
  if (!dev) policy.push('upgrade-insecure-requests');

  return policy.join('; ');
}

export default {
  output: 'standalone',
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: csp() }] }];
  },
};
