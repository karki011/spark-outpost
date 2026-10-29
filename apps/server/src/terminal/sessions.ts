import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { ProviderId, TerminalEndReason, TerminalStep } from '@spark-outpost/contracts';
import { catalogEntry, type CatalogEntry } from '../providers/catalog.ts';
import { detectHint } from './hints.ts';
import {
  killProcessTree,
  killProcessTreeSoon,
  processTable,
  runningCommand,
} from './process-group.ts';
import type { PtyProcess, SpawnPty } from './pty.ts';
import type {
  AgentRequest,
  AttachedTerminal,
  OpenView,
  ShellRequest,
  ShellWatcher,
  TerminalClient,
  TerminalLimits,
  TerminalView,
} from './session-types.ts';
import { defaultLimits, TerminalAuthError, TerminalLimitError } from './session-types.ts';

export * from './session-types.ts';

const OUTPUT_TAIL_BYTES = 8_000;
const REPLAY_BYTES = 256_000;

interface SetupKind {
  type: 'setup';
  entry: CatalogEntry;
  firstCommand: string;
}

interface ShellKind {
  type: 'shell';
  cwd: string;
  conversationId: string | null;
  label?: string | undefined;
  agent?: AgentRequest;
}

interface ViewKind {
  type: 'view';
  open: OpenView;
}

interface Session {
  id: string;
  token: Buffer;
  kind: SetupKind | ShellKind | ViewKind;
  attached: boolean;
  tokenExpiresAt: number;
  replay: string;
  view: TerminalView | null;
  pty: PtyProcess | null;
  client: TerminalClient | null;
  commandOutput: string;
  lastHintId: string | null;
  lastInputAt: number;
  pendingCommand: { command: string; hintedAt: number } | null;
  quietTimer: NodeJS.Timeout | null;
  timers: NodeJS.Timeout[];
  idleTimer: NodeJS.Timeout | null;
}

const isAgent = (kind: Session['kind']): kind is ShellKind & { agent: AgentRequest } =>
  kind.type === 'shell' && kind.agent !== undefined;

export class TerminalSessions {
  private readonly sessions = new Map<string, Session>();
  private folderWatch: NodeJS.Timeout | null = null;

  constructor(
    private readonly spawn: SpawnPty,
    private readonly limits: TerminalLimits = defaultLimits,
    private readonly watcher: ShellWatcher | null = null,
  ) {}

  get activeCount(): number {
    return this.sessions.size;
  }

  create(
    provider: ProviderId,
    step: TerminalStep = 'install',
  ): { id: string; token: string; command: string } {
    if (this.countOf('setup') >= this.limits.maxSessions) {
      throw new TerminalLimitError('Close the open terminal before starting another one.');
    }
    const entry = catalogEntry(provider);
    const firstCommand = step === 'login' ? entry.loginCommand : entry.installCommand;
    const { session, token } = this.register({ type: 'setup', entry, firstCommand });
    return { id: session.id, token, command: firstCommand };
  }

  createShell(request: ShellRequest): { id: string; token: string } {
    if (this.countOf('shell') >= this.limits.maxShells) {
      throw new TerminalLimitError(
        `You have ${this.limits.maxShells} terminals open. Close one before opening another.`,
      );
    }
    const { session, token } = this.register({ type: 'shell', ...request });
    this.watchFolders();
    return { id: session.id, token };
  }

  createAgent(request: AgentRequest): { id: string; token: string } {
    const existing = this.sessions.get(request.id);
    if (existing) {
      if (
        existing.kind.type !== 'shell' ||
        !existing.kind.agent ||
        existing.kind.conversationId !== request.conversationId ||
        existing.kind.cwd !== request.cwd ||
        existing.kind.agent.command !== request.command ||
        JSON.stringify(existing.kind.agent.args) !== JSON.stringify(request.args)
      ) {
        throw new TerminalAuthError('That terminal session belongs to another launch.');
      }
      return this.reattach(request.id)!;
    }
    if (this.countOf('shell') >= this.limits.maxShells) {
      throw new TerminalLimitError('Close a terminal before starting another agent.');
    }
    const { session, token } = this.register(
      { type: 'shell', ...request, agent: request },
      request.id,
    );
    try {
      this.startPty(session, { cols: 100, rows: 30 });
    } catch (error) {
      this.end(session, 'closed', null);
      throw error;
    }
    this.watchFolders();
    return { id: session.id, token };
  }

  reattach(id: string): { id: string; token: string } | null {
    const session = this.sessions.get(id);
    if (!session || !isAgent(session.kind)) return null;
    const oldClient = session.client;
    session.client = null;
    session.attached = false;
    oldClient?.close();
    session.token = randomBytes(32);
    session.tokenExpiresAt = Date.now() + this.limits.tokenTtlMs;
    return { id, token: session.token.toString('base64url') };
  }

  createView(open: OpenView): { id: string; token: string } {
    if (this.countOf('view') >= this.limits.maxViews) {
      throw new TerminalLimitError('Too many terminal views are open. Close one first.');
    }
    const { session, token } = this.register({ type: 'view', open });
    return { id: session.id, token };
  }

  attach(
    id: string,
    token: string,
    client: TerminalClient,
    size: { cols: number; rows: number },
  ): AttachedTerminal {
    const session = this.sessions.get(id);
    const offered = Buffer.from(token, 'base64url');
    const valid =
      session !== undefined &&
      !session.attached &&
      Date.now() < session.tokenExpiresAt &&
      offered.length === session.token.length &&
      timingSafeEqual(offered, session.token);
    if (!session || !valid)
      throw new TerminalAuthError('This terminal link is invalid or already used.');

    session.client = client;
    session.attached = true;
    const kind = session.kind;
    if (kind.type === 'view') return this.attachView(session, kind, size);
    if (session.pty) {
      session.pty.resize(size.cols, size.rows);
      if (session.replay) client.output(session.replay);
    } else this.startPty(session, size);

    return {
      input: (data) => {
        if (session.client !== client) return;
        if (kind.type === 'setup') this.noteSetupInput(session, data);
        session.pty?.write(data);
      },
      resize: (cols, rows) => {
        if (session.client === client) session.pty?.resize(cols, rows);
      },
      colors: (colors) => {
        if (session.client === client) session.pty?.colors?.(colors);
      },
      close: () => {
        if (session.client === client) this.end(session, 'closed', null);
      },
      disconnect: () => {
        if (session.client !== client) return;
        if (!isAgent(kind)) this.end(session, 'disconnected', null);
        else {
          session.client = null;
          session.attached = false;
          session.tokenExpiresAt = 0;
        }
      },
    };
  }

  private startPty(session: Session, size: { cols: number; rows: number }): void {
    const kind = session.kind;
    if (kind.type === 'view') return;
    const agent = kind.type === 'shell' ? kind.agent : undefined;
    const spawned = agent?.observer?.begin('spawn');
    const firstOutput = agent?.observer?.begin('first_output');
    const pty = this.spawn(
      kind.type === 'shell'
        ? {
            ...size,
            cwd: kind.cwd,
            ...(agent
              ? {
                  command: agent.command,
                  args: agent.args,
                  sessionId: session.id,
                  ...(agent.adopt ? { adopt: true } : {}),
                  ...(agent.colors ? { colors: agent.colors } : {}),
                  ...(agent.env ? { env: agent.env } : {}),
                  ...(agent.observer ? { observer: agent.observer } : {}),
                }
              : {}),
          }
        : size,
    );
    spawned?.();
    session.pty = pty;
    if (kind.type === 'shell') {
      this.watcher?.opened({
        id: session.id,
        conversationId: kind.conversationId,
        label: kind.label ?? kind.cwd,
        cwd: kind.cwd,
        pid: pty.pid,
      });
    }
    let prefilled = kind.type === 'shell';
    pty.onData((data) => {
      firstOutput?.();
      this.handleOutput(session, data);
      if (!prefilled && kind.type === 'setup') {
        prefilled = true;
        pty.write(kind.firstCommand);
      }
    });
    pty.onExit((exit) => {
      this.end(session, 'exited', exit.exitCode);
      agent?.onExit?.(exit);
    });
    if (kind.type === 'setup') {
      session.timers.push(
        setTimeout(() => this.end(session, 'time_limit', null), this.limits.maxMs),
      );
      this.resetIdle(session);
    }
  }

  private attachView(
    session: Session,
    kind: ViewKind,
    size: { cols: number; rows: number },
  ): AttachedTerminal {
    const view = kind.open(
      {
        output: (data) => session.client?.output(data),
        ended: () => this.end(session, 'exited', null),
      },
      size,
    );
    if (!view) {
      this.end(session, 'exited', null);
      throw new TerminalAuthError('The preview is not running any more.');
    }
    session.view = view;
    return {
      input: (data) => view.input(data),
      resize: (cols, rows) => view.resize(cols, rows),
      colors: () => undefined,
      close: () => this.end(session, 'closed', null),
      disconnect: () => this.end(session, 'disconnected', null),
    };
  }

  kill(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.end(session, 'closed', null);
    return true;
  }

  send(id: string, data: string): boolean {
    const session = this.sessions.get(id);
    if (!session?.pty || !isAgent(session.kind)) return false;
    session.pty.write(data);
    session.lastInputAt = Date.now();
    return true;
  }

  async screen(id: string): Promise<string | null> {
    const session = this.sessions.get(id);
    if (!session?.pty?.screen || !isAgent(session.kind)) return null;
    return session.pty.screen();
  }

  detach(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session?.pty?.detach) return false;
    this.end(session, 'shutdown', null, true);
    return true;
  }

  async runningCommand(id: string): Promise<string | null> {
    const session = this.sessions.get(id);
    if (session?.kind.type !== 'shell' || !session.pty) return null;
    return runningCommand(session.pty.pid, await processTable());
  }

  endChat(conversationId: string): number {
    const shells = [...this.sessions.values()].filter(
      (session) => session.kind.type === 'shell' && session.kind.conversationId === conversationId,
    );
    for (const session of shells) this.end(session, 'chat_removed', null);
    return shells.length;
  }

  killAll(): void {
    for (const session of [...this.sessions.values()]) this.end(session, 'shutdown', null);
  }

  private register(
    kind: Session['kind'],
    id: string = randomUUID(),
  ): { session: Session; token: string } {
    const token = randomBytes(32);
    const session: Session = {
      id,
      token,
      kind,
      attached: false,
      tokenExpiresAt: Date.now() + this.limits.tokenTtlMs,
      replay: '',
      view: null,
      pty: null,
      client: null,
      commandOutput: '',
      lastHintId: null,
      lastInputAt: 0,
      pendingCommand: null,
      quietTimer: null,
      timers: [],
      idleTimer: null,
    };
    session.timers.push(
      setTimeout(() => {
        if (!session.attached && !session.pty) this.end(session, 'closed', null);
      }, this.limits.tokenTtlMs),
    );
    this.sessions.set(session.id, session);
    return { session, token: token.toString('base64url') };
  }

  private countOf(type: Session['kind']['type']): number {
    let count = 0;
    for (const session of this.sessions.values()) if (session.kind.type === type) count += 1;
    return count;
  }

  private watchFolders() {
    if (this.folderWatch) return;
    this.folderWatch = setInterval(() => this.checkFolders(), this.limits.folderCheckMs);
    this.folderWatch.unref();
  }

  private checkFolders() {
    for (const session of [...this.sessions.values()]) {
      if (session.kind.type === 'shell' && !existsSync(session.kind.cwd)) {
        this.end(session, 'folder_removed', null);
      }
    }
    if (this.countOf('shell') === 0 && this.folderWatch) {
      clearInterval(this.folderWatch);
      this.folderWatch = null;
    }
  }

  private noteSetupInput(session: Session, data: string) {
    this.resetIdle(session);
    session.lastInputAt = Date.now();
    session.pendingCommand = null;
    if (data.includes('\r')) {
      session.commandOutput = '';
      session.lastHintId = null;
    }
  }

  private handleOutput(session: Session, data: string) {
    if (isAgent(session.kind)) session.replay = (session.replay + data).slice(-REPLAY_BYTES);
    session.client?.output(data);
    if (session.kind.type === 'shell') this.watcher?.output?.(session.id, data);
    if (session.kind.type !== 'setup') return;
    session.commandOutput = (session.commandOutput + data).slice(-OUTPUT_TAIL_BYTES);
    const detected = detectHint(session.kind.entry, session.commandOutput);
    if (detected && detected.hint.id !== session.lastHintId) {
      session.lastHintId = detected.hint.id;
      session.client?.send({ type: 'hint', hint: detected.hint });
      session.pendingCommand = detected.nextCommand
        ? { command: detected.nextCommand, hintedAt: Date.now() }
        : null;
    }
    this.scheduleNextCommand(session);
  }

  private scheduleNextCommand(session: Session) {
    if (session.quietTimer) clearTimeout(session.quietTimer);
    if (!session.pendingCommand) return;
    session.quietTimer = setTimeout(() => {
      const pending = session.pendingCommand;
      session.pendingCommand = null;
      if (pending && session.lastInputAt <= pending.hintedAt) session.pty?.write(pending.command);
    }, this.limits.quietMs);
  }

  private resetIdle(session: Session) {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => this.end(session, 'idle', null), this.limits.idleMs);
  }

  private end(
    session: Session,
    reason: TerminalEndReason,
    exitCode: number | null,
    keepRunning = false,
  ) {
    if (!this.sessions.delete(session.id)) return;
    if (isAgent(session.kind)) session.kind.agent.observer?.ended();
    session.timers.forEach(clearTimeout);
    if (session.idleTimer) clearTimeout(session.idleTimer);
    if (session.quietTimer) clearTimeout(session.quietTimer);
    session.view?.detach();
    session.view = null;
    if (keepRunning) session.pty?.detach?.();
    else if (session.pty?.kill) session.pty.kill();
    else if (session.pty && reason === 'shutdown') killProcessTree(session.pty.pid);
    else if (session.pty) void killProcessTreeSoon(session.pty.pid);
    if (session.pty && session.kind.type === 'shell') this.watcher?.ended(session.id);
    if (!keepRunning) session.client?.send({ type: 'ended', reason, exitCode });
    session.client?.close();
    session.client = null;
  }
}
