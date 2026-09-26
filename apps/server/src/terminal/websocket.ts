import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { TERMINAL_INPUT_MAX_LENGTH, terminalClientMessageSchema } from '@spark-outpost/contracts';
import { TerminalAuthError, type AttachedTerminal, type TerminalSessions } from './sessions.ts';

const STREAM_PATH = /^\/api\/terminal\/sessions\/([0-9a-f-]{36})\/stream$/;
const MAX_MESSAGE_BYTES = 64 * 1024;
const DEFAULT_SIZE = { cols: 100, rows: 24 };

export interface TerminalSocketOptions {
  port: number;
  allowedOrigins: readonly string[];
}

function reject(socket: Duplex, status: number, message: string) {
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
}

function sizeFrom(url: URL) {
  const cols = Number(url.searchParams.get('cols'));
  const rows = Number(url.searchParams.get('rows'));
  return Number.isInteger(cols) && Number.isInteger(rows) && cols >= 10 && rows >= 4
    ? { cols: Math.min(cols, 500), rows: Math.min(rows, 200) }
    : DEFAULT_SIZE;
}

const MAX_FRAME_BYTES = 64 * 1024;

function outputBatcher(ws: WebSocket) {
  let pending: string[] = [];
  let size = 0;
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    if (pending.length === 0 || ws.readyState !== ws.OPEN) return;
    ws.send(Buffer.from(pending.join(''), 'utf8'), { binary: true });
    pending = [];
    size = 0;
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

function wire(ws: WebSocket, terminal: AttachedTerminal) {
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
    if (message.data.type === 'close') terminal.close();
  });
  ws.on('close', () => terminal.disconnect());
}

export function attachTerminalSockets(
  server: Server,
  sessions: TerminalSessions,
  options: TerminalSocketOptions,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const hosts = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`]);
  const origins = new Set(options.allowedOrigins);

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = STREAM_PATH.exec(url.pathname);
    if (!match) return reject(socket, 404, 'Not Found');
    if (!hosts.has(req.headers.host ?? '')) return reject(socket, 403, 'Forbidden');
    if (!req.headers.origin || !origins.has(req.headers.origin))
      return reject(socket, 403, 'Forbidden');

    const id = match[1]!;
    const token = url.searchParams.get('token') ?? '';
    wss.handleUpgrade(req, socket, head, (ws) => {
      const batcher = outputBatcher(ws);
      try {
        const terminal = sessions.attach(
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
          sizeFrom(url),
        );
        wire(ws, terminal);
      } catch (error) {
        const reason =
          error instanceof TerminalAuthError ? error.message : 'The terminal could not start.';
        ws.close(4401, reason);
      }
    });
  });
  return wss;
}
