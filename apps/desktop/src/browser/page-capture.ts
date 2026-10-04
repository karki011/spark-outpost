import type { Cdp } from './cdp.ts';
import { BoundedLog, withoutQuery } from './bounded-log.ts';

const PENDING_MAX = 400;

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
  network: BoundedLog;
  reset(): void;
  stop(): void;
}

const SHELL_WARNING = /^%c?Electron Security Warning \(/;

export function fromTheShell(text: string): boolean {
  return SHELL_WARNING.test(text);
}

export async function capturePageLogs(cdp: Cdp): Promise<PageLogs> {
  const consoleLog = new BoundedLog();
  const network = new BoundedLog();
  const pending = new Map<string, { method: string; url: string }>();

  const onConsole = (params: Record<string, unknown>) => {
    const args = (params.args as RemoteValue[] | undefined) ?? [];
    const text = args.map(argText).join(' ');
    if (fromTheShell(text)) return;
    consoleLog.push({
      level: String(params.type ?? 'log'),
      text,
      source: null,
      status: null,
      method: null,
    });
  };
  const onException = (params: Record<string, unknown>) => {
    const details = (params.exceptionDetails ?? {}) as {
      text?: string;
      url?: string;
      lineNumber?: number;
      exception?: RemoteValue;
    };
    consoleLog.push({
      level: 'error',
      text: details.exception?.description ?? details.text ?? 'Uncaught error',
      source: details.url ? `${withoutQuery(details.url)}:${details.lineNumber ?? 0}` : null,
      status: null,
      method: null,
    });
  };
  const onLogEntry = (params: Record<string, unknown>) => {
    const entry = (params.entry ?? {}) as { level?: string; text?: string; url?: string };
    consoleLog.push({
      level: entry.level ?? 'info',
      text: entry.text ?? '',
      source: entry.url ? withoutQuery(entry.url) : null,
      status: null,
      method: null,
    });
  };
  const onRequest = (params: Record<string, unknown>) => {
    const request = (params.request ?? {}) as { url?: string; method?: string };
    if (pending.size >= PENDING_MAX) pending.delete(pending.keys().next().value!);
    pending.set(String(params.requestId), {
      method: request.method ?? 'GET',
      url: withoutQuery(request.url ?? ''),
    });
  };
  const onResponse = (params: Record<string, unknown>) => {
    const sent = pending.get(String(params.requestId));
    const response = (params.response ?? {}) as { status?: number; url?: string };
    pending.delete(String(params.requestId));
    const status = response.status ?? null;
    network.push({
      level: status !== null && status >= 400 ? 'error' : 'info',
      text: `${sent?.method ?? 'GET'} ${sent?.url ?? withoutQuery(response.url ?? '')}`,
      source: null,
      status,
      method: sent?.method ?? null,
    });
  };
  const onFailed = (params: Record<string, unknown>) => {
    const sent = pending.get(String(params.requestId));
    pending.delete(String(params.requestId));
    if (!sent || params.canceled === true) return;
    const why = String(params.blockedReason ?? params.errorText ?? 'failed');
    network.push({
      level: 'error',
      text: `${sent.method} ${sent.url} failed: ${why}`,
      source: null,
      status: null,
      method: sent.method,
    });
  };

  const handlers: Record<string, (params: Record<string, unknown>) => void> = {
    'Runtime.consoleAPICalled': onConsole,
    'Runtime.exceptionThrown': onException,
    'Log.entryAdded': onLogEntry,
    'Network.requestWillBeSent': onRequest,
    'Network.responseReceived': onResponse,
    'Network.loadingFailed': onFailed,
  };
  const stop = cdp.listen((method, params) => handlers[method]?.(params));
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable', { maxTotalBufferSize: 1024, maxResourceBufferSize: 1024 });
  const reset = () => {
    consoleLog.clear();
    network.clear();
    pending.clear();
  };
  return { console: consoleLog, network, reset, stop };
}
