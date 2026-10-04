import { previewConfigSchema, type PreviewConfig } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import {
  askPreviewStop,
  previewRows,
  projectPreviewRows,
  recordPreviewEvent,
  savePreviewLog,
  savePreviewState,
  type PreviewAction,
  type PreviewRow,
  type PreviewState,
} from '../persistence/preview-servers.ts';
import {
  freePortFrom,
  lastLines,
  logTail,
  portOf,
  previewEnvironment,
  probeTargets,
  PORT_TRIES,
  workingFolder,
} from './launch.ts';

export interface PreviewProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (exit: { exitCode: number | null }) => void): void;
  kill(): void;
}

export interface PreviewSpawn {
  command: string;
  cwd: string;
  env: Record<string, string>;
}

export interface PreviewRuntime {
  spawn(options: PreviewSpawn): PreviewProcess;
  portFree(port: number): Promise<boolean>;
  answers(url: string): Promise<boolean>;
  folderExists(folder: string): Promise<boolean>;
  env: NodeJS.ProcessEnv;
}

export interface PreviewTimings {
  readyTimeoutMs: number;
  probeEveryMs: number;
  restartBackoffMs: readonly number[];
  stableMs: number;
  watchEveryMs: number;
  logFlushMs: number;
}

export const defaultPreviewTimings: PreviewTimings = {
  readyTimeoutMs: 60_000,
  probeEveryMs: 300,
  restartBackoffMs: [1_000, 2_000, 5_000, 10_000],
  stableMs: 60_000,
  watchEveryMs: 3_000,
  logFlushMs: 1_000,
};

export interface PreviewViewer {
  output(data: string): void;
  ended(): void;
}

export interface PreviewView {
  input(data: string): void;
  resize(cols: number, rows: number): void;
  detach(): void;
}

const OUTPUT_MAX = 200_000;
const FAILURE_LINES = 12;
const SPARK = { by: 'spark', runId: null, conversationId: null } as const;

type Phase = 'starting' | 'ready' | 'backoff' | 'over';

interface Live {
  row: PreviewRow;
  config: PreviewConfig;
  cwd: string;
  process: PreviewProcess | null;
  generation: number;
  phase: Phase;
  port: number;
  busy: number[];
  url: string | null;
  attempts: number;
  startedAt: number;
  readyAt: number;
  output: string;
  viewers: Set<PreviewViewer>;
  probeTimer: NodeJS.Timeout | null;
  restartTimer: NodeJS.Timeout | null;
  logTimer: NodeJS.Timeout | null;
}

export class PreviewServers {
  private readonly live = new Map<string, Live>();
  private queue: Promise<void> = Promise.resolve();
  private watch: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly workspaceId: string,
    private readonly runtime: PreviewRuntime,
    private readonly timings: PreviewTimings = defaultPreviewTimings,
  ) {}

  get runningCount(): number {
    return this.live.size;
  }

  sync(): Promise<void> {
    return this.serialize(() => this.reconcile());
  }

  async stopProject(projectId: string, reason: string): Promise<void> {
    for (const row of await projectPreviewRows(this.db, projectId)) {
      await askPreviewStop(this.db, row.id, SPARK, reason);
    }
    await this.sync();
  }

  stopAll(reason: string): Promise<void> {
    return this.serialize(async () => {
      for (const live of [...this.live.values()]) {
        await askPreviewStop(this.db, live.row.id, SPARK, reason).catch(() => null);
        await this.finish(live);
      }
    });
  }

  view(
    id: string,
    viewer: PreviewViewer,
    size: { cols: number; rows: number },
  ): PreviewView | null {
    const live = this.live.get(id);
    if (!live) return null;
    if (live.output) viewer.output(live.output);
    live.viewers.add(viewer);
    live.process?.resize(size.cols, size.rows);
    return {
      input: (data) => live.process?.write(data),
      resize: (cols, rows) => live.process?.resize(cols, rows),
      detach: () => {
        live.viewers.delete(viewer);
      },
    };
  }

  private serialize(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work);
    this.queue = next.catch((error: unknown) =>
      console.error('A preview server step failed', error),
    );
    return next;
  }

  private async reconcile(): Promise<void> {
    const rows = await previewRows(this.db, this.workspaceId);
    const known = new Set(rows.map((row) => row.id));
    for (const live of [...this.live.values()]) {
      if (!known.has(live.row.id)) this.drop(live);
    }
    for (const row of rows) {
      const live = this.live.get(row.id);
      if (row.wanted === 'stopped') {
        if (live) await this.finish(live);
        else if (row.status === 'starting' || row.status === 'ready') {
          await savePreviewState(this.db, row.id, { status: 'stopped' }, row.logTail);
        }
      } else if (!live) {
        if (row.status === 'starting') await this.launch(row);
      } else if (row.status === 'starting' && live.phase === 'ready') {
        await this.save(live, { status: 'ready', url: live.url, pid: live.process?.pid ?? null });
      }
    }
  }

  private async launch(row: PreviewRow): Promise<void> {
    const { rows } = await this.db.query<{ preview: unknown }>(
      'SELECT preview FROM projects WHERE id = $1',
      [row.projectId],
    );
    const config = previewConfigSchema.safeParse(rows[0]?.preview);
    const cwd = config.success ? workingFolder(row.folder, config.data.folder) : null;
    const live: Live = {
      row,
      config: config.data ?? { command: '', url: 'http://localhost', folder: null, readyUrl: null },
      cwd: cwd ?? row.folder,
      process: null,
      generation: 0,
      phase: 'starting',
      port: 0,
      busy: [],
      url: null,
      attempts: 0,
      startedAt: 0,
      readyAt: 0,
      output: '',
      viewers: new Set(),
      probeTimer: null,
      restartTimer: null,
      logTimer: null,
    };
    this.live.set(row.id, live);
    if (!config.success) {
      await this.fail(live, 'This project has no preview set up. Add one in Settings, Projects.');
      return;
    }
    if (!cwd || !(await this.runtime.folderExists(cwd))) {
      await this.fail(live, `The preview folder ${cwd ?? config.data.folder} does not exist.`);
      return;
    }
    await this.start(live);
    this.watchFolders();
  }

  private async start(live: Live): Promise<void> {
    const first = portOf(live.config.url);
    const picked = await freePortFrom(first, this.runtime.portFree);
    if (!picked) {
      await this.fail(live, `Ports ${first} to ${first + PORT_TRIES - 1} are all in use.`);
      return;
    }
    live.port = picked.port;
    live.busy = picked.busy;
    live.generation += 1;
    const generation = live.generation;
    try {
      live.process = this.runtime.spawn({
        command: live.config.command,
        cwd: live.cwd,
        env: previewEnvironment(this.runtime.env, picked.port),
      });
    } catch (error) {
      await this.fail(live, `The preview command could not start: ${(error as Error).message}`);
      return;
    }
    live.phase = 'starting';
    live.startedAt = Date.now();
    live.url = null;
    live.process.onData((data) => this.took(live, generation, data));
    live.process.onExit(({ exitCode }) => {
      void this.serialize(() => this.exited(live, generation, exitCode));
    });
    await this.save(live, { status: 'starting', pid: live.process.pid, restarts: live.attempts });
    this.probeLater(live, generation);
  }

  private took(live: Live, generation: number, data: string): void {
    if (live.generation !== generation) return;
    live.output = (live.output + data).slice(-OUTPUT_MAX);
    for (const viewer of live.viewers) viewer.output(data);
    live.logTimer ??= setTimeout(() => {
      live.logTimer = null;
      void savePreviewLog(this.db, live.row.id, logTail(live.output)).catch(() => undefined);
    }, this.timings.logFlushMs);
  }

  private current(live: Live, generation: number): boolean {
    return this.live.get(live.row.id) === live && live.generation === generation;
  }

  private probeLater(live: Live, generation: number): void {
    live.probeTimer = setTimeout(() => {
      void this.probe(live, generation);
    }, this.timings.probeEveryMs);
  }

  private async probe(live: Live, generation: number): Promise<void> {
    if (!this.current(live, generation) || live.phase !== 'starting') return;
    const targets = probeTargets(live.config, live.port, live.busy, live.output);
    let answered: string | null = null;
    for (const target of targets) {
      if (await this.runtime.answers(target.probe).catch(() => false)) {
        answered = target.url;
        break;
      }
    }
    await this.serialize(async () => {
      if (!this.current(live, generation) || live.phase !== 'starting') return;
      if (answered) {
        await this.ready(live, answered);
        return;
      }
      if (Date.now() - live.startedAt < this.timings.readyTimeoutMs) {
        this.probeLater(live, generation);
        return;
      }
      const seconds = Math.round(this.timings.readyTimeoutMs / 1000);
      this.kill(live);
      await this.retryOrFail(
        live,
        `Nothing answered at ${targets[0]?.probe ?? live.config.url} within ${seconds} s.`,
      );
    });
  }

  private async ready(live: Live, url: string): Promise<void> {
    live.phase = 'ready';
    live.url = url;
    live.readyAt = Date.now();
    await this.save(live, { status: 'ready', url, pid: live.process?.pid ?? null });
    await this.event(live, 'ready', {
      url,
      port: portOf(url),
      movedFrom: portOf(url) === portOf(live.config.url) ? null : portOf(live.config.url),
    });
  }

  private async exited(live: Live, generation: number, exitCode: number | null): Promise<void> {
    if (!this.current(live, generation)) return;
    this.clearTimers(live);
    live.process = null;
    const wasReady = live.phase === 'ready';
    if (wasReady) {
      await this.event(live, 'crashed', { exitCode });
      if (Date.now() - live.readyAt >= this.timings.stableMs) live.attempts = 0;
    }
    const code = exitCode === null ? '' : ` with code ${exitCode}`;
    await this.retryOrFail(
      live,
      wasReady
        ? `The preview command exited${code}.`
        : `The preview command exited${code} before the page answered.`,
      wasReady,
    );
  }

  private async retryOrFail(live: Live, reason: string, wasReady = false): Promise<void> {
    const firstStart = !wasReady && live.attempts === 0;
    const delay = this.timings.restartBackoffMs[live.attempts];
    if (firstStart || delay === undefined) {
      const tried = live.attempts > 0 ? ` Spark restarted it ${live.attempts} times.` : '';
      await this.fail(live, `${reason}${tried}`);
      return;
    }
    live.attempts += 1;
    live.phase = 'backoff';
    live.generation += 1;
    const generation = live.generation;
    await this.save(live, { status: 'starting', restarts: live.attempts, detail: reason });
    live.restartTimer = setTimeout(() => {
      void this.serialize(async () => {
        if (!this.current(live, generation) || live.phase !== 'backoff') return;
        await this.event(live, 'restart', { attempt: live.attempts, after: reason });
        await this.start(live);
      });
    }, delay);
  }

  private async fail(live: Live, reason: string): Promise<void> {
    this.kill(live);
    this.drop(live);
    const lines = lastLines(logTail(live.output), FAILURE_LINES);
    const detail = lines ? `${reason}\n${lines}` : reason;
    await this.save(live, { status: 'failed', wanted: 'stopped', detail });
    await this.event(live, 'failed', { reason });
  }

  private async finish(live: Live): Promise<void> {
    this.kill(live);
    this.drop(live);
    await this.save(live, { status: 'stopped', wanted: 'stopped' });
  }

  private kill(live: Live): void {
    live.generation += 1;
    this.clearTimers(live);
    const running = live.process;
    live.process = null;
    try {
      running?.kill();
    } catch {
      return;
    }
  }

  private drop(live: Live): void {
    this.kill(live);
    live.phase = 'over';
    if (this.live.get(live.row.id) === live) this.live.delete(live.row.id);
    for (const viewer of live.viewers) viewer.ended();
    live.viewers.clear();
    if (this.live.size === 0 && this.watch) {
      clearInterval(this.watch);
      this.watch = null;
    }
  }

  private clearTimers(live: Live): void {
    for (const timer of [live.probeTimer, live.restartTimer, live.logTimer]) {
      if (timer) clearTimeout(timer);
    }
    live.probeTimer = null;
    live.restartTimer = null;
    live.logTimer = null;
  }

  private save(live: Live, state: PreviewState): Promise<void> {
    return savePreviewState(this.db, live.row.id, state, logTail(live.output));
  }

  private event(live: Live, action: PreviewAction, detail: Record<string, unknown>): Promise<void> {
    return recordPreviewEvent(this.db, {
      workspaceId: this.workspaceId,
      projectId: live.row.projectId,
      folder: live.row.folder,
      action,
      ask: SPARK,
      detail,
    });
  }

  private watchFolders(): void {
    if (this.watch || this.live.size === 0) return;
    this.watch = setInterval(() => {
      void this.serialize(() => this.checkFolders());
    }, this.timings.watchEveryMs);
    this.watch.unref();
  }

  private async checkFolders(): Promise<void> {
    for (const live of [...this.live.values()]) {
      if (await this.runtime.folderExists(live.cwd)) continue;
      await askPreviewStop(this.db, live.row.id, SPARK, 'folder_removed');
      await this.finish(live);
    }
  }
}
