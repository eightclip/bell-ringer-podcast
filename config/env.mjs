// Load .env before anything reads process.env.
//
// This lives on its own, and both config/show.mjs and pipeline/lib.mjs import
// it, because the alternative is a load-order trap: show.mjs reads VOICE_MODE
// at module scope, and it only saw the right value because lib.mjs happened to
// be imported first and ran the loader as a side effect. Change an import order
// anywhere and the pipeline silently falls back to defaults.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let loaded = false;
export function loadEnv() {
  if (loaded) return;
  loaded = true;
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k]) continue; // a real env var always wins
    process.env[k] = raw.replace(/^["']|["']$/g, '');
  }
}

loadEnv();
