import {
  BROWSER_HOST_ENV,
  browserActLine,
  browserBridgeToHostSchema,
  browserPlaceOf,
  type BrowserActTarget,
  type BrowserHostRequest,
} from '../../packages/contracts/src/index.ts';
import { stripedPng } from './striped-png.ts';

type Listener = (event: { data: unknown }) => void;

const listeners = new Set<Listener>();
const tab = { url: 'about:blank', title: '', typed: [] as string[] };

const TARGETS: Record<string, BrowserActTarget> = {
  ref_1: { role: 'button', name: 'Search', sensitive: false },
  ref_2: { role: 'searchbox', name: 'Search the docs', sensitive: false },
  ref_3: { role: 'textbox', name: '', sensitive: true },
};

function act(request: Extract<BrowserHostRequest, { op: 'act' }>) {
  const from = tab.url;
  const target = request.ref ? (TARGETS[request.ref] ?? null) : null;
  if (request.action === 'click') tab.url = `${new URL(from).origin}/results?q=clicked`;
  const { action, key, direction } = request;
  return {
    ...facts(),
    action,
    target,
    from,
    did: browserActLine({ action, target, key, direction }),
  };
}

function facts() {
  return {
    tabId: 'tab1',
    url: tab.url,
    title: tab.title,
    place: browserPlaceOf(tab.url),
    owner: 'agent',
  };
}

function answer(request: BrowserHostRequest): unknown {
  if (request.op === 'open') {
    tab.url = request.url;
    tab.title = 'Fixture login';
    return { ...facts(), status: 200, reused: false };
  }
  if (request.op === 'tabs') {
    return { tabs: [{ id: 'tab1', ...facts(), active: true }] };
  }
  if (request.op === 'sign_in') {
    tab.typed = [request.username, request.password];
    tab.url = `${request.sites[0]}/home?as=${encodeURIComponent(request.username)}`;
    tab.title = `Welcome ${request.username}`;
    return { ...facts(), steps: 1 };
  }
  if (request.op === 'read') {
    const echoed = tab.typed.join(' and ');
    return {
      ...facts(),
      mode: request.mode,
      text: `- heading "Welcome" [ref_1]\n- paragraph "The page repeats ${echoed}"`,
      total: 2,
      offset: 0,
      nextOffset: null,
      masked: 0,
    };
  }
  if (request.op === 'logs') {
    return {
      ...facts(),
      kind: request.kind,
      entries: [
        {
          at: new Date().toISOString(),
          level: 'log',
          text: `submitted ${tab.typed.join(' ')}`,
          source: null,
          status: null,
          method: null,
        },
      ],
      dropped: 0,
    };
  }
  if (request.op === 'end_run') return { closed: 0 };
  if (request.op === 'keep') return { kept: true };
  if (request.op === 'hand_over') {
    return { ...facts(), masked: request.handoff ? 0 : 2 };
  }
  if (request.op === 'page') {
    return { ...facts(), target: request.ref ? (TARGETS[request.ref] ?? null) : null };
  }
  if (request.op === 'act') return act(request);
  if (request.op === 'screenshot') {
    const height = request.fullPage ? 2400 : 800;
    return {
      ...facts(),
      data: stripedPng(1280, height).toString('base64'),
      mediaType: 'image/png',
      width: 1280,
      height,
      masked: 0,
    };
  }
  throw new Error('The fake browser does not support this request.');
}

function receive(raw: unknown): void {
  const parsed = browserBridgeToHostSchema.safeParse(raw);
  if (!parsed.success || parsed.data.kind !== 'browser:request') return;
  const { id, request } = parsed.data;
  let response: unknown;
  try {
    response = { kind: 'browser:response', id, ok: true, result: answer(request) };
  } catch (error) {
    response = {
      kind: 'browser:response',
      id,
      ok: false,
      code: 'failed',
      message: (error as Error).message,
    };
  }
  queueMicrotask(() => listeners.forEach((listener) => listener({ data: response })));
}

process.env[BROWSER_HOST_ENV] = '1';
Object.assign(process, {
  parentPort: {
    postMessage: receive,
    on: (_event: 'message', listener: Listener) => listeners.add(listener),
  },
});
