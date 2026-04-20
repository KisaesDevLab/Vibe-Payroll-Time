#!/usr/bin/env node
/**
 * Dev-only license signer. Generates a keypair if one doesn't exist
 * yet, signs a license JWT with the configured claims, and prints:
 *   1. the PEM of the public key (for LICENSE_PUBKEY_PEM)
 *   2. the JWT (for uploading through the admin UI)
 *
 * NEVER use this to sign production licenses — kisaes-license-portal
 * is the only legitimate signer for real customers.
 *
 * Usage:
 *   node scripts/dev/sign-license.mjs \
 *     --appliance-id=local-dev \
 *     --company-slug=acme-plumbing \
 *     --tier=per_company_monthly \
 *     --employee-cap=50 \
 *     --days=30
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const ROOT = path.resolve(process.cwd());
const KEYS_DIR = path.join(ROOT, 'dev-keys');
const PRIV = path.join(KEYS_DIR, 'license-private.pem');
const PUB = path.join(KEYS_DIR, 'license-public.pem');

function ensureKeys() {
  if (fs.existsSync(PRIV) && fs.existsSync(PUB)) return;
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.writeFileSync(PRIV, kp.privateKey.export({ type: 'pkcs8', format: 'pem' }), {
    mode: 0o600,
  });
  fs.writeFileSync(PUB, kp.publicKey.export({ type: 'spki', format: 'pem' }));
  console.error(`[sign-license] generated new dev keypair in ${KEYS_DIR}/`);
}

function parseFlag(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.slice(`--${name}=`.length);
}

ensureKeys();

const claims = {
  iss: 'dev-license-signer',
  sub: 'vibept-appliance',
  appliance_id: parseFlag('appliance-id', 'local-dev'),
  company_slug: parseFlag('company-slug', 'acme'),
  tier: parseFlag('tier', 'per_company_monthly'),
  employee_count_cap:
    parseFlag('employee-cap', 'null') === 'null' ? null : Number(parseFlag('employee-cap', '50')),
  company_count_cap: null,
};

const days = Number(parseFlag('days', '30'));
const token = jwt.sign(claims, fs.readFileSync(PRIV, 'utf8'), {
  algorithm: 'RS256',
  expiresIn: `${days}d`,
});

const pub = fs.readFileSync(PUB, 'utf8');

process.stdout.write('# LICENSE_PUBKEY_PEM (copy into your .env)\n');
process.stdout.write(pub + '\n');
process.stdout.write('# License JWT (paste into the admin UI upload form)\n');
process.stdout.write(token + '\n');
