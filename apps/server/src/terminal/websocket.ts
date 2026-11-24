import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  API_TOKEN_HEADER,
  TERMINAL_INPUT_MAX_LENGTH,
  terminalClientMessageSchema,
} from '@spark-outpost/contracts';
import { launchTokenCheck } from '../api/launch-token.ts';
import { createOutputFlow, type OutputFlow } from './output-flow.ts';
import { TerminalAuthError, type AttachedTerminal, type TerminalSessions } from './sessions.ts';

const STREAM_PATH = /^\/api\/terminal\/sessions\/([0-9a-f-]{36})\/stream$/;
const MAX_MESSAGE_BYTES = 64 * 1024;
const DEFAULT_SIZE = { cols: 100, rows: 24 };

export interface TerminalSocketOptions {
  port: number;
  allowedOrigins: readonly string[];
  apiToken: string;
}

function reject(socket: Duplex, status: number, message: string) {
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
}

function requestedSize(url: URL) {
  const cols = Number(url.searchParams.get('cols'));
  const rows = Number(url.searchParams.get('rows'));
  return Number.isInteger(cols) && Number.isInteger(rows) && cols >= 10 && rows >= 4
    ? { cols: Math.min(cols, 500), rows: Math.min(rows, 200) }
    : DEFAULT_SIZE;
}

const MAX_FRAME_BYTES = 64 * 1024;

function outputBatcher(ws: WebSocket, onSent: (bytes: number) => void) {
  let pending: string[] = [];
  let size = 0;
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    if (pending.length === 0 || ws.readyState !== ws.OPEN) return;
    const frame = Buffer.from(pending.join(''), 'utf8');
    pending = [];
    size = 0;
    ws.send(frame, { binary: true });
    onSent(frame.length);
  };
  const write = (data: string) => {
    pending.push(data);
    size += data.length;
    if (size >= MAX_FRAME_BYTES) flush();
    else if (!scheduled) {
      scheduled = true;
      setImmediate(flush);
    }
  };
  return { write, flush };
}

function forwardClientMessages(ws: WebSocket, terminal: AttachedTerminal, flow: OutputFlow) {
  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      const data = Buffer.isBuffer(raw)
        ? raw.toString('utf8')
        : Buffer.from(raw as ArrayBuffer).toString('utf8');
      if (data.length <= TERMINAL_INPUT_MAX_LENGTH) terminal.input(data);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      return;
    }
    const message = terminalClientMessageSchema.safeParse(parsed);
    if (!message.success) return;
    if (message.data.type === 'resize') terminal.resize(message.data.cols, message.data.rows);
    if (message.data.type === 'colors') terminal.colors(message.data.colors);
    if (message.data.type === 'ack') flow.acked(message.data.bytes);
    if (message.data.type === 'close') terminal.close();
  });
  ws.on('close', () => {
    flow.stop();
    terminal.disconnect();
  });
}

export function attachTerminalSockets(
  server: Server,
  sessions: TerminalSessions,
  options: TerminalSocketOptions,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const hosts = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`]);
  const origins = new Set(options.allowedOrigins);
  const launchTokenMatches = launchTokenCheck(options.apiToken);

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = STREAM_PATH.exec(url.pathname);
    if (!match) return reject(socket, 404, 'Not Found');
    if (!hosts.has(req.headers.host ?? '')) return reject(socket, 403, 'Forbidden');
    if (!req.headers.origin || !origins.has(req.headers.origin))
      return reject(socket, 403, 'Forbidden');
    if (!launchTokenMatches(req.headers[API_TOKEN_HEADER]))
      return reject(socket, 401, 'Unauthorized');

    const id = match[1]!;
    const token = url.searchParams.get('token') ?? '';
    wss.handleUpgrade(req, socket, head, (ws) => {
      let terminal: AttachedTerminal | null = null;
      const flow = createOutputFlow(
        { pause: () => terminal?.pause(), resume: () => terminal?.resume() },
        () => ws.bufferedAmount,
      );
      const batcher = outputBatcher(ws, flow.sent);
      try {
        terminal = sessions.attach(
          id,
          token,
          {
            output: batcher.write,
            send: (message) => {
              batcher.flush();
              if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
            },
            close: () => ws.close(1000),
          },
          requestedSize(url),
        );
        forwardClientMessages(ws, terminal, flow);
      } catch (error) {
        flow.stop();
        const reason =
          error instanceof TerminalAuthError ? error.message : 'The terminal could not start.';
        ws.close(4401, reason);
      }
    });
  });
  return wss;
}
