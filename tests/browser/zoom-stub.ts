import type { IncomingMessage, ServerResponse } from 'node:http';
import { fakeZoom, type FakeZoom } from '../../apps/server/test/fake-zoom.ts';

let zoom: FakeZoom = fakeZoom('http://stub');

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

export function handlesZoom(path: string): boolean {
  return path.startsWith('/zoom/') || path.startsWith('/zoom-test/');
}

export async function handleZoom(req: IncomingMessage, res: ServerResponse, path: string) {
  const url = new URL(req.url ?? '', 'http://stub');
  if (path === '/zoom-test/reset') {
    zoom = fakeZoom('http://stub');
    return send(res, 200, { ok: true });
  }
  if (path === '/zoom-test/meetings') {
    return send(res, 200, { meetings: [...zoom.meetings.values()], revoked: zoom.revoked.length });
  }
  const rest = path.slice('/zoom'.length);
  if (rest === '/oauth/authorize') {
    const back = new URL(url.searchParams.get('redirect_uri') ?? '');
    back.searchParams.set('code', zoom.code());
    back.searchParams.set('state', url.searchParams.get('state') ?? '');
    res.writeHead(302, { location: back.toString() }).end();
    return;
  }
  const sent = req.method === 'POST' ? await body(req) : null;
  const answer = await zoom.fetch(`http://stub${rest}${url.search}`, {
    method: req.method ?? 'GET',
    ...(sent ? { body: sent } : {}),
    headers: { authorization: req.headers.authorization ?? '' },
  });
  res.writeHead(answer.status, { 'content-type': 'application/json' });
  res.end(await answer.text());
}
