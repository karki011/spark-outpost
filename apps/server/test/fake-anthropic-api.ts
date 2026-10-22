import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ModelRequest {
  tools: string[];
  system: string;
}

interface MessagesBody {
  model?: string;
  stream?: boolean;
  tools?: { name: string }[];
  system?: unknown;
}

const REPLY = 'Done.';

function events(model: string): string {
  const message = {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  const sent: [string, object][] = [
    ['message_start', { type: 'message_start', message }],
    [
      'content_block_start',
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ],
    [
      'content_block_delta',
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: REPLY } },
    ],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    [
      'message_delta',
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 1 },
      },
    ],
    ['message_stop', { type: 'message_stop' }],
  ];
  return sent.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

function whole(model: string): object {
  return {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: REPLY }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

async function bodyOf(request: IncomingMessage): Promise<MessagesBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as MessagesBody;
  } catch {
    return {};
  }
}

function json(response: ServerResponse, value: object): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

export async function startFakeAnthropicApi() {
  const requests: ModelRequest[] = [];
  const server = createServer(async (request, response) => {
    const body = await bodyOf(request);
    const path = request.url ?? '';
    if (path.includes('count_tokens')) return json(response, { input_tokens: 1 });
    if (!path.startsWith('/v1/messages')) return json(response, {});
    const tools = (body.tools ?? []).map((tool) => tool.name);
    if (tools.length > 0) requests.push({ tools, system: JSON.stringify(body.system ?? '') });
    const model = body.model ?? 'claude-opus-5-5';
    if (!body.stream) return json(response, whole(model));
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(events(model));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
