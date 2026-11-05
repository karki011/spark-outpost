import {
  askAgentTerminalStop,
  endAgentTerminal,
  endLiveAgentTerminals,
  markAgentTerminalRunning,
  saveAgentTerminalOutput,
} from '../persistence/agent-terminal-changes.ts';
import {
  agentTerminalOutput,
  liveAgentTerminals,
  type AgentTerminalRow,
} from '../persistence/agent-terminals.ts';
import type { Db } from '../persistence/db.ts';
import { commandEnvironment } from '../preview/launch.ts';
import type { PreviewProcess } from '../preview/servers.ts';
import { recordTerminalStops } from './agent-terminal-audit.ts';
import { createAgentTerminalRecord, type AgentTerminalRecord } from './agent-terminal-output.ts';
import type { AgentTerminalRuntime } from './agent-terminal-process.ts';
import { agentTerminalSecretRoots } from './agent-terminal-roots.ts';
import type { TerminalView, ViewedOutput } from './sessions.ts';

export interface AgentTerminalTimings {
  saveMs: number;
  watchEveryMs: number;
}

export const defaultAgentTerminalTimings: AgentTerminalTimings = {
  saveMs: 1_000,
  watchEveryMs: 3_000,
};

interface Live {
  id: string;
  cwd: string;
  process: PreviewProcess;
  record: AgentTerminalRecord;
  viewers: Set<ViewedOutput>;
  saveTimer: NodeJS.Timeout | null;
}

export class AgentTerminals {
  private readonly live = new Map<string, Live>();
  private queue: Promise<void> = Promise.resolve();
  private watch: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly workspaceId: string,
    private readonly runtime: AgentTerminalRuntime,
    private readonly timings: AgentTerminalTimings = defaultAgentTerminalTimings,
  ) {}

  get runningCount(): number {
    return this.live.size;
  }

  running(id: string): boolean {
    return this.live.has(id);
  }

  async recover(): Promise<void> {
    await endLiveAgentTerminals(this.db, this.workspaceId, 'startup');
  }

  sync(): Promise<void> {
    return this.serialize(() => this.reconcile());
  }

  stopAll(): Promise<void> {
    return this.serialize(async () => {
      for (const live of [...this.live.values()]) {
        this.kill(live);
        this.drop(live);
        live.record.finish();
        await this.saveOutput(live).catch(() => undefined);
      }
      const ended = await endLiveAgentTerminals(this.db, this.workspaceId, 'quit');
      await recordTerminalStops(this.db, ended);
    });
  }

  view(
    id: string,
    viewer: ViewedOutput,
    size: { cols: number; rows: number },
  ): TerminalView | null {
    const live = this.live.get(id);
    if (!live) return null;
    if (live.record.replay) viewer.output(live.record.replay);
    live.viewers.add(viewer);
    live.process.resize(size.cols, size.rows);
    return {
      input: () => undefined,
      resize: (cols, rows) => {
        if (this.live.get(id) === live) live.process.resize(cols, rows);
      },
      detach: () => {
        live.viewers.delete(viewer);
      },
    };
  }

  private serialize(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work);
    this.queue = next.catch((error: unknown) =>
      console.error('An agent terminal step failed', error),
    );
    return next;
  }

  private async reconcile(): Promise<void> {
    const rows = await liveAgentTerminals(this.db, this.workspaceId);
    const known = new Set(rows.map((row) => row.id));
    for (const live of [...this.live.values()]) {
      if (known.has(live.id)) continue;
      this.kill(live);
      this.drop(live);
    }
    for (const row of rows) {
      const live = this.live.get(row.id);
      if (row.wanted === 'stopped') {
        if (live) await this.finish(live);
        else await this.endUnowned(row);
      } else if (!live && row.status === 'starting') {
        await this.launch(row);
      }
    }
  }

  private async launch(row: AgentTerminalRow): Promise<void> {
    if (!(await this.runtime.folderExists(row.cwd))) {
      await this.fail(row.id, `The folder ${row.cwd} does not exist.`);
      return;
    }
    const secretValues = await agentTerminalSecretRoots(this.db, row)
      .then((roots) => this.runtime.secretValues(roots))
      .catch(() => []);
    let process: PreviewProcess;
    try {
      process = this.runtime.spawn({
        command: row.command,
        cwd: row.cwd,
        env: commandEnvironment(this.runtime.env),
      });
    } catch (error) {
      await this.fail(row.id, `The command could not start: ${(error as Error).message}`);
      return;
    }
    const live: Live = {
      id: row.id,
      cwd: row.cwd,
      process,
      record: createAgentTerminalRecord(secretValues),
      viewers: new Set(),
      saveTimer: null,
    };
    this.live.set(row.id, live);
    process.onData((data) => this.took(live, data));
    process.onExit(({ exitCode }) => {
      void this.serialize(() => this.exited(live, exitCode));
    });
    if (await markAgentTerminalRunning(this.db, row.id, process.pid)) {
      this.watchFolders();
      return;
    }
    this.kill(live);
    this.drop(live);
  }

  private took(live: Live, data: string): void {
    if (this.live.get(live.id) !== live) return;
    live.record.push(data);
    for (const viewer of live.viewers) viewer.output(data);
    live.saveTimer ??= setTimeout(() => {
      live.saveTimer = null;
      void this.saveOutput(live).catch(() => undefined);
    }, this.timings.saveMs);
  }

  private saveOutput(live: Live): Promise<void> {
    return saveAgentTerminalOutput(this.db, live.id, live.record.tail, live.record.total);
  }

  private async exited(live: Live, exitCode: number | null): Promise<void> {
    if (this.live.get(live.id) !== live) return;
    this.drop(live);
    live.record.finish();
    await this.end(live.id, exitCode, true, live.record.tail, live.record.total);
  }

  private async finish(live: Live): Promise<void> {
    this.kill(live);
    this.drop(live);
    live.record.finish();
    await this.end(live.id, null, true, live.record.tail, live.record.total);
  }

  private async endUnowned(row: AgentTerminalRow): Promise<void> {
    const saved = await agentTerminalOutput(this.db, row.conversationId, row.id);
    await this.end(
      row.id,
      null,
      row.status === 'running',
      saved?.output ?? '',
      saved?.outputChars ?? 0,
    );
  }

  private async fail(id: string, reason: string): Promise<void> {
    await this.end(id, null, false, reason, reason.length);
  }

  private async end(
    id: string,
    exitCode: number | null,
    spawned: boolean,
    output: string,
    outputChars: number,
  ): Promise<void> {
    const ended = await endAgentTerminal(this.db, id, { exitCode, spawned, output, outputChars });
    if (ended) await recordTerminalStops(this.db, [ended]);
  }

  private kill(live: Live): void {
    try {
      live.process.kill();
    } catch {
      return;
    }
  }

  private drop(live: Live): void {
    if (live.saveTimer) clearTimeout(live.saveTimer);
    live.saveTimer = null;
    if (this.live.get(live.id) === live) this.live.delete(live.id);
    for (const viewer of live.viewers) viewer.ended();
    live.viewers.clear();
    if (this.live.size === 0 && this.watch) {
      clearInterval(this.watch);
      this.watch = null;
    }
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
      await askAgentTerminalStop(this.db, live.id, 'folder_removed');
      await this.finish(live);
    }
  }
}
