import type { McpTransport } from '@spark-outpost/contracts';
import { joinCommandLine } from './mcp-command-line.ts';

export interface PastedServer {
  name: string | null;
  transport: McpTransport;
  commandLine: string;
  url: string;
  values: { name: string; value: string }[];
}

export type PasteResult = { ok: true; server: PastedServer } | { ok: false; error: string };

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isServer = (value: unknown): value is Json =>
  isRecord(value) && (typeof value.command === 'string' || typeof value.url === 'string');

function parseJson(text: string): unknown {
  for (const candidate of [text, `{${text}}`]) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  return undefined;
}

function pickServer(root: Json): [string | null, Json] | null {
  const nested = root.mcpServers ?? root.servers ?? (isRecord(root.mcp) ? root.mcp.servers : null);
  const named = isRecord(nested) ? nested : root;
  const first = Object.entries(named).find(([, value]) => isServer(value));
  if (first) return [first[0], first[1] as Json];
  return isServer(root) ? [null, root] : null;
}

function stringEntries(value: unknown): { name: string; value: string }[] {
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, text]) => ({ name, value: text }));
}

export function parsePastedServer(text: string): PasteResult {
  const root = parseJson(text.trim());
  if (!isRecord(root)) return { ok: false, error: 'Paste the JSON from the server’s README.' };
  const picked = pickServer(root);
  if (!picked) return { ok: false, error: 'No server with a command or URL in that JSON.' };
  const [name, server] = picked;
  if (typeof server.url === 'string') {
    return {
      ok: true,
      server: {
        name,
        transport: server.type === 'sse' ? 'sse' : 'http',
        commandLine: '',
        url: server.url,
        values: stringEntries(server.headers),
      },
    };
  }
  const args = Array.isArray(server.args)
    ? server.args.filter((arg): arg is string => typeof arg === 'string')
    : [];
  return {
    ok: true,
    server: {
      name,
      transport: 'stdio',
      commandLine: joinCommandLine([String(server.command), ...args]),
      url: '',
      values: stringEntries(server.env),
    },
  };
}
