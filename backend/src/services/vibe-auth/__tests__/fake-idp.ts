// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * In-process fake OpenID Provider for the single sign-on integration test.
 *
 * A port of Vibe-Auth/packages/client/test/fake-idp.ts by way of
 * trial-balance-app/test/fake-idp.mjs. The published package ships only
 * dist/ and sql/, so the fake provider has to live here; keep the behaviour
 * identical to upstream when re-syncing. It implements discovery, JWKS,
 * authorization (auto-consents the configured user), token (PKCE S256 +
 * client_secret_basic), userinfo, end-session, and mints back-channel
 * logout tokens.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from 'jose';

export interface FakeIdpUser {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  groups?: string[];
  roles?: string[];
  amr?: string[];
}

export interface FakeIdpOptions {
  clientId: string;
  clientSecret?: string;
  user: FakeIdpUser;
}

interface PendingCode {
  redirectUri: string;
  nonce: string;
  codeChallenge?: string;
}

function b64url(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function atHash(accessToken: string): string {
  return b64url(createHash('sha256').update(accessToken).digest().subarray(0, 16));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => resolve(d));
  });
}

export class FakeIdp {
  /** Swap between tests to sign in as somebody else. */
  user: FakeIdpUser;
  private server: Server | null = null;
  private port = 0;
  private priv: KeyLike | null = null;
  private pub: KeyLike | null = null;
  private readonly kid = 'test-key';
  private readonly codes = new Map<string, PendingCode>();
  private readonly accessTokens = new Map<string, string>();

  constructor(private readonly opts: FakeIdpOptions) {
    this.user = opts.user;
  }

  get issuer(): string {
    return `http://127.0.0.1:${this.port}/application/o/test/`;
  }

  async start(): Promise<this> {
    const kp = await generateKeyPair('RS256');
    this.priv = kp.privateKey;
    this.pub = kp.publicKey;
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  async stop(): Promise<void> {
    // Keep-alive sockets from the app's discovery/JWKS fetches would
    // otherwise hold close() open until they time out.
    this.server?.closeAllConnections?.();
    await new Promise<void>((r) => this.server?.close(() => r()));
  }

  /** The `sid` claim the IdP puts in this user's ID tokens. */
  get sid(): string {
    return `sid-${this.user.sub}`;
  }

  private async signIdToken(o: { nonce: string; accessToken: string }): Promise<string> {
    const u = this.user;
    const claims: Record<string, unknown> = {
      email: u.email,
      email_verified: u.email_verified,
      name: u.name,
      groups: u.groups,
      roles: u.roles,
      amr: u.amr ?? ['pwd'],
      sid: this.sid,
      nonce: o.nonce,
      at_hash: atHash(o.accessToken),
    };
    for (const k of Object.keys(claims)) if (claims[k] === undefined) delete claims[k];
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: this.kid })
      .setIssuer(this.issuer)
      .setSubject(u.sub)
      .setAudience(this.opts.clientId)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(this.priv!);
  }

  /** A back-channel logout token for the current user. */
  async logoutToken(o: { sub?: string; sid?: string }): Promise<string> {
    const j = new SignJWT({
      events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
      ...(o.sid ? { sid: o.sid } : {}),
    })
      .setProtectedHeader({ alg: 'RS256', kid: this.kid })
      .setIssuer(this.issuer)
      .setAudience(this.opts.clientId)
      .setIssuedAt()
      .setJti(randomUUID());
    if (o.sub) j.setSubject(o.sub);
    return j.sign(this.priv!);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
    const path = url.pathname;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (path.endsWith('/.well-known/openid-configuration')) {
      const iss = this.issuer;
      return send(200, {
        issuer: iss,
        authorization_endpoint: `${iss}authorize/`,
        token_endpoint: `${iss}token/`,
        userinfo_endpoint: `${iss}userinfo/`,
        jwks_uri: `${iss}jwks/`,
        end_session_endpoint: `${iss}end-session/`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        id_token_signing_alg_values_supported: ['RS256'],
        backchannel_logout_supported: true,
        backchannel_logout_session_supported: true,
      });
    }
    if (path.endsWith('/jwks/')) {
      const jwk = await exportJWK(this.pub!);
      return send(200, { keys: [{ ...jwk, kid: this.kid, use: 'sig', alg: 'RS256' }] });
    }
    if (path.endsWith('/authorize/')) {
      const q = url.searchParams;
      if (q.get('client_id') !== this.opts.clientId)
        return send(400, { error: 'unauthorized_client' });
      if (q.get('code_challenge_method') !== 'S256') return send(400, { error: 'invalid_request' });
      const redirectUri = q.get('redirect_uri') ?? '';
      const code = randomUUID();
      this.codes.set(code, {
        redirectUri,
        nonce: q.get('nonce') ?? '',
        ...(q.get('code_challenge') ? { codeChallenge: q.get('code_challenge')! } : {}),
      });
      const target = new URL(redirectUri);
      target.searchParams.set('code', code);
      target.searchParams.set('state', q.get('state') ?? '');
      res.writeHead(302, { location: target.toString() });
      return void res.end();
    }
    if (path.endsWith('/token/') && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      if (this.opts.clientSecret) {
        const expected =
          'Basic ' +
          Buffer.from(
            `${encodeURIComponent(this.opts.clientId)}:${encodeURIComponent(this.opts.clientSecret)}`,
          ).toString('base64');
        if (req.headers.authorization !== expected) return send(401, { error: 'invalid_client' });
      }
      const code = form.get('code') ?? '';
      const pc = this.codes.get(code);
      this.codes.delete(code);
      if (!pc) return send(400, { error: 'invalid_grant' });
      if (pc.redirectUri !== form.get('redirect_uri')) {
        return send(400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
      }
      if (pc.codeChallenge) {
        const expect = b64url(
          createHash('sha256')
            .update(form.get('code_verifier') ?? '')
            .digest(),
        );
        if (expect !== pc.codeChallenge) return send(400, { error: 'invalid_grant' });
      }
      const accessToken = `at-${randomUUID()}`;
      this.accessTokens.set(accessToken, this.user.sub);
      return send(200, {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 300,
        id_token: await this.signIdToken({ nonce: pc.nonce, accessToken }),
        scope: 'openid profile email',
      });
    }
    if (path.endsWith('/userinfo/')) {
      const t = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (!this.accessTokens.has(t)) return send(401, { error: 'invalid_token' });
      const u = this.user;
      return send(200, {
        sub: u.sub,
        email: u.email,
        email_verified: u.email_verified,
        name: u.name,
        groups: u.groups,
        roles: u.roles,
      });
    }
    send(404, { error: 'not_found', path });
  }
}
