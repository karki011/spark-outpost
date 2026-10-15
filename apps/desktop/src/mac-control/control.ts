import {
  macAppRefusal,
  macRefusalLine,
  refusedAppName,
  refusedBundleId,
  type MacApp,
  type MacHostErrorCode,
  type MacHostRequest,
  type MacIndicator,
  type MacRunningApp,
  type MacStatus,
  type MacTarget,
} from '@spark-outpost/contracts';
import { MacHelperError, type MacHelper } from './helper-process.ts';
import { macOutlinePage } from './outline.ts';

export class MacOpError extends Error {
  readonly code: MacHostErrorCode;

  constructor(code: MacHostErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface MacControlOptions {
  helper: MacHelper;
  sparkPids(): ReadonlySet<number>;
  indicator(state: MacIndicator | null): void;
  now?: () => number;
}

export interface MacControl {
  run(request: MacHostRequest, signal: AbortSignal): Promise<unknown>;
  stop(): void;
  resume(): void;
}

interface Controlled {
  pid: number;
  app: string;
  run: string;
  chatId: string;
}

const TAKEOVER_SLACK_MS = 500;
const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

const MESSAGES: Partial<Record<MacHostErrorCode, string>> = {
  not_trusted:
    'Spark Outpost does not have the Accessibility permission. Ask the user to allow it in Settings → Mac control.',
  screen_locked:
    'The screen is locked, asleep or showing the screen saver, so Spark does not read or act. Try again when the user is back.',
  paused_by_user:
    'The user took over with the mouse or keyboard, so Mac control is paused. Wait until they press Resume or send a new message.',
  stopped: 'The user stopped Mac control for this turn. Do not try again in this turn.',
};

const PASSED: ReadonlySet<string> = new Set([
  'not_trusted',
  'no_app',
  'no_window',
  'gone',
  'changed',
  'not_pressable',
  'not_found',
  'stopped',
  'cancelled',
]);

function opError(code: MacHostErrorCode, message?: string): MacOpError {
  return new MacOpError(code, MESSAGES[code] ?? message ?? 'Mac control could not do that.');
}

export function hostError(error: unknown): MacOpError {
  if (error instanceof MacOpError) return error;
  if (error instanceof MacHelperError) {
    const code = PASSED.has(error.code) ? (error.code as MacHostErrorCode) : 'failed';
    return opError(code, error.message);
  }
  return opError('failed', (error as Error).message);
}

function closedApp(bundleId: string): MacApp {
  return {
    pid: null,
    name: bundleId,
    bundleId,
    frontmost: false,
    windows: [],
    refused: refusedBundleId(bundleId),
  };
}

function runKey(request: { chatId: string; runId: string | null }): string {
  return request.runId ?? `chat:${request.chatId}`;
}

function sameApp(app: Pick<MacApp, 'name' | 'bundleId'>, wanted: string): boolean {
  const name = wanted.trim().toLowerCase();
  return app.bundleId?.toLowerCase() === name || app.name.toLowerCase() === name;
}

export function createMacControl(options: MacControlOptions): MacControl {
  const { helper } = options;
  const now = options.now ?? Date.now;
  const stopped = new Set<string>();
  const active = new Map<string, Controlled>();
  const chatRefs = new Map<string, Set<string>>();
  let controlled: Controlled | null = null;
  let paused: string | null = null;
  let lastActionAt: number | null = null;
  let lastDid: string | null = null;

  const show = () =>
    options.indicator(
      controlled ? { app: controlled.app, did: lastDid, paused: paused !== null } : null,
    );

  const toApp = (app: MacRunningApp): MacApp => ({
    pid: app.pid,
    name: app.name,
    bundleId: app.bundleId,
    frontmost: app.frontmost,
    windows: app.windows,
    refused: macAppRefusal(app, options.sparkPids()),
  });

  const listApps = async (signal: AbortSignal) =>
    (await helper.call({ op: 'apps' }, signal)).apps.map(toApp);

  const tookOver = (status: MacStatus): boolean => {
    if (!controlled || lastActionAt === null) return false;
    if (status.frontmostPid !== controlled.pid) return false;
    return status.idleSeconds * 1000 + TAKEOVER_SLACK_MS < now() - lastActionAt;
  };

  const guard = async (run: string, signal: AbortSignal) => {
    if (stopped.has(run)) throw opError('stopped');
    const status = await helper.call({ op: 'status' }, signal);
    if (!status.trusted) throw opError('not_trusted');
    if (status.locked) throw opError('screen_locked');
    if (paused !== null && paused !== run) {
      paused = null;
      lastActionAt = null;
    }
    if (paused === run) throw opError('paused_by_user');
    if (tookOver(status)) {
      paused = run;
      show();
      throw opError('paused_by_user');
    }
  };

  const refKey = (ref: string) => `${helper.pid ?? 0}:${ref}`;

  const own = (chatId: string, refs: readonly string[]) => {
    const known = chatRefs.get(chatId) ?? new Set<string>();
    for (const ref of refs) known.add(refKey(ref));
    chatRefs.set(chatId, known);
  };

  const checkOwned = (chatId: string, ref: string | undefined) => {
    if (ref === undefined || chatRefs.get(chatId)?.has(refKey(ref))) return;
    throw opError('gone', `${ref} was not read in this chat. Read the app again.`);
  };

  const sameTarget = (target: MacTarget, pid: number): MacTarget => {
    if (target.pid !== pid) {
      throw opError('refused', `${target.ref} belongs to another app. Read the app you are using.`);
    }
    return target;
  };

  const allowedApp = async (pid: number, signal: AbortSignal): Promise<MacApp> => {
    const app = (await listApps(signal)).find((candidate) => candidate.pid === pid);
    if (!app) throw opError('no_app', 'That app is no longer running. Call spark_mac_apps again.');
    if (app.refused) throw opError('refused', macRefusalLine(app.refused, app.name));
    return app;
  };

  const acted = (request: { chatId: string; runId: string | null }, app: MacApp, did: string) => {
    const run = runKey(request);
    controlled = { pid: app.pid!, app: app.name, run, chatId: request.chatId };
    active.set(run, controlled);
    lastActionAt = now();
    lastDid = did;
    show();
  };

  const resolve = async (
    request: Extract<MacHostRequest, { op: 'resolve' }>,
    signal: AbortSignal,
  ) => {
    const found = (await listApps(signal)).find((app) => sameApp(app, request.app));
    if (found) return { app: found };
    const named = refusedAppName(request.app);
    if (named) return { app: { ...closedApp(request.app), bundleId: null, refused: named } };
    if (!BUNDLE_ID.test(request.app)) {
      throw opError('no_app', `${request.app} is not running. Pass its bundle id to open it.`);
    }
    return { app: closedApp(request.app) };
  };

  const read = async (request: Extract<MacHostRequest, { op: 'read' }>, signal: AbortSignal) => {
    const run = runKey(request);
    await guard(run, signal);
    const app = await allowedApp(request.pid, signal);
    checkOwned(request.chatId, request.ref);
    const found = await helper.call(
      {
        op: 'read',
        pid: request.pid,
        ...(request.window === undefined ? {} : { window: request.window }),
        ...(request.ref === undefined ? {} : { ref: request.ref }),
        ...(request.scope === undefined ? {} : { scope: request.scope }),
      },
      signal,
    );
    const page = macOutlinePage(found.nodes, request.mode, request.offset, request.maxChars);
    own(request.chatId, [found.rootRef, ...found.nodes.map((node) => node.ref)]);
    acted(
      request,
      app,
      `Read ${found.window.title ? `window "${found.window.title.slice(0, 80)}"` : 'a window'}`,
    );
    return {
      app,
      window: found.window,
      scope: found.scope,
      rootRef: found.rootRef,
      mode: request.mode,
      truncated: found.truncated,
      ...page,
    };
  };

  const target = async (
    request: Extract<MacHostRequest, { op: 'target' }>,
    signal: AbortSignal,
  ) => {
    await guard(runKey(request), signal);
    const app = await allowedApp(request.pid, signal);
    const found = await aimAt(request, app, signal);
    own(request.chatId, [found.ref]);
    return { app, target: sameTarget(found, request.pid) };
  };

  const aimAt = async (
    request: Extract<MacHostRequest, { op: 'target' }>,
    app: MacApp,
    signal: AbortSignal,
  ): Promise<MacTarget> => {
    if (request.menu) {
      return helper.call({ op: 'menu', pid: request.pid, path: request.menu }, signal);
    }
    if (request.focused) {
      const focused = await helper.call({ op: 'focused', pid: request.pid }, signal);
      if (!focused) throw opError('not_found', `Nothing has the keyboard focus in ${app.name}.`);
      return focused;
    }
    if (!request.ref) throw opError('not_found', 'Pass a ref.');
    checkOwned(request.chatId, request.ref);
    return helper.call(
      { op: 'target', pid: request.pid, ref: request.ref, refind: request.refind },
      signal,
    );
  };

  const act = async (request: Extract<MacHostRequest, { op: 'act' }>, signal: AbortSignal) => {
    const run = runKey(request);
    await guard(run, signal);
    const app = await allowedApp(request.pid, signal);
    checkOwned(request.chatId, request.ref);
    if (request.action === 'scroll') {
      await helper.call(
        {
          op: 'scroll',
          pid: request.pid,
          direction: request.direction ?? 'down',
          ...(request.ref ? { ref: request.ref } : {}),
        },
        signal,
      );
    } else if (!request.ref || !request.expect) {
      throw opError('not_found', 'Pass a ref.');
    } else if (request.action === 'key') {
      await helper.call(
        {
          op: 'key',
          pid: request.pid,
          ref: request.ref,
          key: request.key ?? 'space',
          expect: request.expect,
        },
        signal,
      );
    } else {
      await helper.call(
        { op: 'press', pid: request.pid, ref: request.ref, expect: request.expect },
        signal,
      );
    }
    acted(request, app, request.did);
    return { did: request.did };
  };

  const open = async (request: Extract<MacHostRequest, { op: 'open' }>, signal: AbortSignal) => {
    const byId = refusedBundleId(request.bundleId);
    if (byId) throw opError('refused', macRefusalLine(byId, request.bundleId));
    const run = runKey(request);
    await guard(run, signal);
    const { pid } = await helper.call({ op: 'open', bundleId: request.bundleId }, signal);
    const app = await allowedApp(pid, signal);
    acted(request, app, `Opened ${app.name}`);
    return { app };
  };

  const endRun = (request: Extract<MacHostRequest, { op: 'end_run' }>) => {
    const ending = [...active.values()]
      .filter((entry) =>
        request.runId === null ? entry.chatId === request.chatId : entry.run === request.runId,
      )
      .map((entry) => entry.run);
    if (request.runId !== null) ending.push(request.runId);
    for (const run of ending) {
      stopped.delete(run);
      active.delete(run);
      if (paused === run) paused = null;
    }
    if (!controlled || active.has(controlled.run)) return { ended: false };
    controlled = [...active.values()].at(-1) ?? null;
    lastActionAt = null;
    show();
    return { ended: true };
  };

  return {
    async run(request, signal) {
      try {
        if (request.op === 'apps') return { apps: await listApps(signal) };
        if (request.op === 'resolve') return await resolve(request, signal);
        if (request.op === 'read') return await read(request, signal);
        if (request.op === 'target') return await target(request, signal);
        if (request.op === 'act') return await act(request, signal);
        if (request.op === 'open') return await open(request, signal);
        return endRun(request);
      } catch (error) {
        throw hostError(error);
      }
    },
    stop() {
      for (const run of active.keys()) stopped.add(run);
      if (paused) stopped.add(paused);
      helper.kill();
      active.clear();
      controlled = null;
      paused = null;
      lastActionAt = null;
      show();
    },
    resume() {
      paused = null;
      lastActionAt = null;
      show();
    },
  };
}
