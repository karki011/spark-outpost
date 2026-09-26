import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  ProviderId,
  TerminalEndReason,
  TerminalServerMessage,
  TerminalStep,
} from '@spark-outpost/contracts';
import { catalogEntry, type CatalogEntry } from '../providers/catalog.ts';
import { detectHint } from './hints.ts';
import { killProcessTree } from './process-group.ts';
import type { PtyProcess, SpawnPty } from './pty.ts';

export interface TerminalClient {
  output(data: string): void;
  send(message: TerminalServerMessage): void;
  close(): void;
}

export interface TerminalLimits {
  tokenTtlMs: number;
  idleMs: number;
  maxMs: number;
  maxSessions: number;
  quietMs: number;
}

export const defaultLimits: TerminalLimits = {
  tokenTtlMs: 60_000,
  idleMs: 10 * 60_000,
  maxMs: 30 * 60_000,
  maxSessions: 2,
  quietMs: 500,
};

const OUTPUT_TAIL_BYTES = 8_000;

interface Session {
  id: string;
  token: Buffer;
  entry: CatalogEntry;
  firstCommand: string;
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

export class TerminalLimitError extends Error {}
export class TerminalAuthError extends Error {}

export interface AttachedTerminal {
  input(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
  disconnect(): void;
}

export class TerminalSessions {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly spawn: SpawnPty,
    private readonly limits: TerminalLimits = defaultLimits,
  ) {}

  get activeCount(): number {
    return this.sessions.size;
  }

  create(
    provider: ProviderId,
    step: TerminalStep = 'install',
  ): { id: string; token: string; command: string } {
    if (this.sessions.size >= this.limits.maxSessions) {
      throw new TerminalLimitError('Close the open terminal before starting another one.');
    }
    const token = randomBytes(32);
    const entry = catalogEntry(provider);
    const session: Session = {
      id: randomUUID(),
      token,
      entry,
      firstCommand: step === 'login' ? entry.loginCommand : entry.installCommand,
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
        if (!session.pty) this.end(session, 'closed', null);
      }, this.limits.tokenTtlMs),
    );
    this.sessions.set(session.id, session);
    return {
      id: session.id,
      token: token.toString('base64url'),
      command: session.firstCommand,
    };
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
      session.pty === null &&
      offered.length === session.token.length &&
      timingSafeEqual(offered, session.token);
    if (!session || !valid)
      throw new TerminalAuthError('This terminal link is invalid or already used.');

    session.client = client;
    const pty = this.spawn(size);
    session.pty = pty;
    let prefilled = false;
    pty.onData((data) => {
      this.handleOutput(session, data);
      if (!prefilled) {
        prefilled = true;
        pty.write(session.firstCommand);
      }
    });
    pty.onExit(({ exitCode }) => this.end(session, 'exited', exitCode));
    session.timers.push(setTimeout(() => this.end(session, 'time_limit', null), this.limits.maxMs));
    this.resetIdle(session);

    return {
      input: (data) => {
        this.resetIdle(session);
        session.lastInputAt = Date.now();
        session.pendingCommand = null;
        if (data.includes('\r')) {
          session.commandOutput = '';
          session.lastHintId = null;
        }
        session.pty?.write(data);
      },
      resize: (cols, rows) => session.pty?.resize(cols, rows),
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

  killAll(): void {
    for (const session of [...this.sessions.values()]) this.end(session, 'shutdown', null);
  }

  private handleOutput(session: Session, data: string) {
    session.client?.output(data);
    session.commandOutput = (session.commandOutput + data).slice(-OUTPUT_TAIL_BYTES);
    const detected = detectHint(session.entry, session.commandOutput);
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

  private end(session: Session, reason: TerminalEndReason, exitCode: number | null) {
    if (!this.sessions.delete(session.id)) return;
    session.timers.forEach(clearTimeout);
    if (session.idleTimer) clearTimeout(session.idleTimer);
    if (session.quietTimer) clearTimeout(session.quietTimer);
    if (session.pty) killProcessTree(session.pty.pid);
    session.client?.send({ type: 'ended', reason, exitCode });
    session.client?.close();
    session.client = null;
  }
}
