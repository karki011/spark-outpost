import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeMcpAuth {
  baseUrl: string;
  serverUrl: string;
  registrations: { redirect_uris: string[] }[];
  refreshTokens: string[];
  tokenRequests: URLSearchParams[];
  expiresIn: number;
  rotate: boolean;
  refuseRefresh(): void;
  goOffline(): void;
  accepts(bearer: string | undefined): boolean;
  authorize(authorizeUrl: string): Promise<void>;
  close(): Promise<void>;
}

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function fakeMcpAuth(): Promise<FakeMcpAuth> {
  let issued = 0;
  let access = '';
  let refresh = '';
  let refusing = false;
  let offline = false;
  const codes = new Map<string, { challenge: string; redirect: string }>();

  const listening: Server[] = [];
  const fake: FakeMcpAuth = {
    baseUrl: '',
    serverUrl: '',
    registrations: [],
    refreshTokens: [],
    tokenRequests: [],
    expiresIn: 3600,
    rotate: true,
    refuseRefresh: () => {
      refusing = true;
    },
    goOffline: () => {
      offline = true;
    },
    accepts: (bearer) => bearer === `Bearer ${access}`,
    authorize: async (authorizeUrl) => {
      await fetch(authorizeUrl);
    },
    close: () =>
      new Promise<void>((resolve) => {
        listening[0]?.closeAllConnections();
        listening[0]?.close(() => resolve());
      }),
  };

  const issue = () => {
    issued += 1;
    access = `access-${issued}`;
    if (fake.rotate || !refresh) {
      refresh = `refresh-${issued}`;
      fake.refreshTokens.push(refresh);
    }
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: fake.expiresIn,
      refresh_token: refresh,
    };
  };

  const token = (form: URLSearchParams): [number, unknown] => {
    fake.tokenRequests.push(form);
    if (form.get('grant_type') === 'authorization_code') {
      const code = codes.get(form.get('code') ?? '');
      const verifier = form.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (!code || code.challenge !== challenge || code.redirect !== form.get('redirect_uri')) {
        return [400, { error: 'invalid_grant' }];
      }
      codes.delete(form.get('code')!);
      return [200, issue()];
    }
    if (refusing || form.get('refresh_token') !== refresh) return [400, { error: 'invalid_grant' }];
    return [200, issue()];
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', fake.baseUrl);
    const send = (status: number, value: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    if (offline) return void request.socket.destroy();
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      return send(200, { resource: fake.serverUrl, authorization_servers: [fake.baseUrl] });
    }
    if (url.pathname.startsWith('/.well-known/oauth-authorization-server')) {
      return send(200, {
        issuer: fake.baseUrl,
        authorization_endpoint: `${fake.baseUrl}/authorize`,
        token_endpoint: `${fake.baseUrl}/token`,
        registration_endpoint: `${fake.baseUrl}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
    }
    if (url.pathname === '/register') {
      const asked = JSON.parse(await bodyOf(request)) as { redirect_uris: string[] };
      fake.registrations.push(asked);
      return send(201, { ...asked, client_id: `client-${fake.registrations.length}` });
    }
    if (url.pathname === '/authorize') {
      const code = `code-${codes.size + issued + 1}`;
      const redirect = url.searchParams.get('redirect_uri') ?? '';
      codes.set(code, { challenge: url.searchParams.get('code_challenge') ?? '', redirect });
      const back = new URL(redirect);
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      response.writeHead(302, { location: back.toString() }).end();
      return;
    }
    if (url.pathname === '/token') {
      const [status, value] = token(new URLSearchParams(await bodyOf(request)));
      return send(status, value);
    }
    send(404, {});
  });
  listening.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  fake.baseUrl = baseUrl;
  fake.serverUrl = `${baseUrl}/mcp`;
  return fake;
}
