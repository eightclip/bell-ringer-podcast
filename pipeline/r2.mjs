// Storage, two ways.
//
// If S3 credentials are present we use the S3 API — that's what GitHub Actions
// will do, and it's the fast path for a week of audio.
//
// If they aren't, we shell out to `wrangler`, which authenticates with the
// OAuth login already on this machine. That means the pipeline is fully
// testable before anyone visits the Cloudflare dashboard, and a laptop that's
// already logged into wrangler never needs a second credential.

import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { need, log } from './lib.mjs';

// No default. A hardcoded bucket name here would silently point every fork at
// a bucket its owner does not control.
export const bucket = () => need('R2_BUCKET');
export const publicBase = () => (process.env.R2_PUBLIC_BASE || '').replace(/\/$/, '');

export const useS3 = () =>
  Boolean(process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_ACCOUNT_ID);

let _s3;
async function s3() {
  if (!_s3) {
    const { S3Client } = await import('@aws-sdk/client-s3');
    _s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${need('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: need('R2_ACCESS_KEY_ID'),
        secretAccessKey: need('R2_SECRET_ACCESS_KEY'),
      },
    });
  }
  return _s3;
}

function wrangler(args) {
  return execFileSync('wrangler', args, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
}

export async function putFile(key, path, contentType, { immutable = true } = {}) {
  if (useS3()) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await (await s3()).send(new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: readFileSync(path),
      ContentType: contentType,
      CacheControl: immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    }));
  } else {
    wrangler([
      'r2', 'object', 'put', `${bucket()}/${key}`,
      '--file', path,
      '--content-type', contentType,
      '--cache-control', immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      '--remote',
    ]);
  }
  return `${publicBase()}/${key}`;
}

export async function put(key, body, contentType, opts) {
  if (useS3()) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await (await s3()).send(new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: opts?.immutable === false ? 'public, max-age=300' : 'public, max-age=60',
    }));
    return `${publicBase()}/${key}`;
  }
  // wrangler only uploads from a file
  const dir = mkdtempSync(join(tmpdir(), 'br-'));
  const f = join(dir, basename(key));
  writeFileSync(f, body);
  return putFile(key, f, contentType, { immutable: false });
}

export async function list(prefix) {
  if (useS3()) {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const out = await (await s3()).send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix }));
    return (out.Contents || []).map((o) => o.Key);
  }
  // `wrangler r2 object` has no list; read the public index instead. Every
  // manifest we write is public, so listing by fetching is sufficient here.
  throw new Error(
    'Listing needs S3 credentials. Set R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY, ' +
    'or pass the weeks explicitly: node pipeline/feed.mjs 2026-08-17 2026-08-24',
  );
}

export async function getJSON(key) {
  if (useS3()) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const obj = await (await s3()).send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    return JSON.parse(await obj.Body.transformToString());
  }
  const res = await fetch(`${publicBase()}/${key}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET ${key} → ${res.status}`);
  return res.json();
}
