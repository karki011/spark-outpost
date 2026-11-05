import type { Cdp } from './cdp.ts';
import { redactQuery } from '@spark-outpost/contracts';
import { BoundedLog } from './bounded-log.ts';
import { NetworkLog } from './network-capture.ts';
import { PageClock } from './page-clock.ts';

interface RemoteValue {
  type?: string;
  value?: unknown;
  description?: string;
}

function argText(arg: RemoteValue): string {
  if (typeof arg.value === 'string') return arg.value;
  if (arg.value !== undefined) return JSON.stringify(arg.value);
  return arg.description ?? arg.type ?? '';
}

export interface PageLogs {
  console: BoundedLog;
  network: NetworkLog;
  reset(): void;
  stop(): void;
}

const SHELL_WARNING = /^%c?Electron Security Warning \(/;

export function fromTheShell(text: string): boolean {
  return SHELL_WARNING.test(text);
}

interface CallFrame {
  url?: string;
  functionName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

const STACK_FRAMES = 8;

function where(url: string, line?: number, column?: number): string {
  const at =
    line === undefined ? '' : `:${line + 1}${column === undefined ? '' : `:${column + 1}`}`;
  return `${redactQuery(url)}${at}`;
}

export function stackText(frames: readonly CallFrame[] | undefined): string | null {
  const shown = (frames ?? []).filter((frame) => frame.url).slice(0, STACK_FRAMES);
  if (shown.length === 0) return null;
  return shown
    .map(
      (frame) =>
        `at ${frame.functionName || '(anonymous)'} ${where(frame.url!, frame.lineNumber, frame.columnNumber)}`,
    )
    .join('\n');
}

function wallMs(value: unknown): number {
  return typeof value === 'number' ? value : Date.now();
}

export async function capturePageLogs(cdp: Cdp): Promise<PageLogs> {
  const clock = new PageClock();
  const consoleLog = new BoundedLog();
  const network = new NetworkLog(undefined, clock);
  const push = (
    entry: { level: string; text: string; source: string | null; stack?: string | null },
    at: unknown,
  ) => {
    const wall = wallMs(at);
    consoleLog.push({
      ...entry,
      at: new Date(wall).toISOString(),
      ms: clock.fromWall(wall),
      status: null,
      method: null,
    });
  };

  const onConsole = (params: Record<string, unknown>) => {
    const args = (params.args as RemoteValue[] | undefined) ?? [];
    const text = args.map(argText).join(' ');
    if (fromTheShell(text)) return;
    const level = String(params.type ?? 'log');
    const trace = (params.stackTrace as { callFrames?: CallFrame[] } | undefined)?.callFrames;
    const top = trace?.find((frame) => frame.url);
    push(
      {
        level: level === 'warn' ? 'warning' : level,
        text,
        source: top?.url ? where(top.url, top.lineNumber, top.columnNumber) : null,
        stack:
          level === 'error' || level === 'trace' || level === 'assert' ? stackText(trace) : null,
      },
      params.timestamp,
    );
  };
  const onException = (params: Record<string, unknown>) => {
    const details = (params.exceptionDetails ?? {}) as {
      text?: string;
      url?: string;
      lineNumber?: number;
      columnNumber?: number;
      exception?: RemoteValue;
      stackTrace?: { callFrames?: CallFrame[] };
    };
    const message =
      details.exception?.description?.split('\n')[0] ?? details.text ?? 'Uncaught error';
    const unhandled = /^Uncaught \(in promise\)/.test(details.text ?? '');
    push(
      {
        level: 'error',
        text:
          unhandled && !message.startsWith('Uncaught')
            ? `Unhandled rejection: ${message}`
            : message,
        source: details.url ? where(details.url, details.lineNumber, details.columnNumber) : null,
        stack: stackText(details.stackTrace?.callFrames),
      },
      params.timestamp,
    );
  };
  const onLogEntry = (params: Record<string, unknown>) => {
    const entry = (params.entry ?? {}) as {
      level?: string;
      text?: string;
      url?: string;
      source?: string;
      timestamp?: number;
      stackTrace?: { callFrames?: CallFrame[] };
    };
    const failedLoad = entry.source === 'network' && entry.url;
    push(
      {
        level: entry.level ?? 'info',
        text: failedLoad
          ? `${entry.text ?? 'Failed to load resource'}: ${redactQuery(entry.url!)}`
          : (entry.text ?? ''),
        source: entry.url ? redactQuery(entry.url) : null,
        stack: stackText(entry.stackTrace?.callFrames),
      },
      entry.timestamp,
    );
  };
  const handlers: Record<string, (params: Record<string, unknown>) => void> = {
    'Runtime.consoleAPICalled': onConsole,
    'Runtime.exceptionThrown': onException,
    'Log.entryAdded': onLogEntry,
    'Network.requestWillBeSent': (params) => network.requestWillBeSent(params),
    'Network.responseReceived': (params) => network.responseReceived(params),
    'Network.requestServedFromCache': (params) => network.servedFromCache(params),
    'Network.dataReceived': (params) => network.dataReceived(params),
    'Network.loadingFinished': (params) => network.loadingFinished(params),
    'Network.loadingFailed': (params) => network.loadingFailed(params),
  };
  const stop = cdp.listen((method, params) => handlers[method]?.(params));
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable', { maxTotalBufferSize: 1024, maxResourceBufferSize: 1024 });
  const reset = () => {
    consoleLog.clear();
    network.clear();
  };
  return { console: consoleLog, network, reset, stop };
}
