import type { Attached, CreateRequest, HostExit, Listed } from './protocol.ts';
import type { ScreenModel } from './screen.ts';
import { ScrollBack } from './scroll-back.ts';

export interface HostPty {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (exit: { exitCode: number; signal?: number | undefined }) => void): void;
}

export interface SessionTableDeps {
  spawn(start: CreateRequest): HostPty;
  screen(cols: number, rows: number): ScreenModel;
  killTree(pid: number): Promise<void>;
  output(session: string, data: string): void;
  exited(session: string, exit: HostExit): void;
  scrollBack?: () => ScrollBack;
}

interface Entry {
  pty: HostPty;
  scroll: ScrollBack;
  screen: ScreenModel;
  exit: HostExit | null;
}

export class SessionTable {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly deps: SessionTableDeps) {}

  get size(): number {
    return this.entries.size;
  }

  create(start: CreateRequest): number {
    const existing = this.entries.get(start.session);
    if (existing && !existing.exit) throw new Error('That terminal session is already running.');
    if (existing) this.drop(start.session);
    const pty = this.deps.spawn(start);
    const entry: Entry = {
      pty,
      scroll: this.deps.scrollBack?.() ?? new ScrollBack(),
      screen: this.deps.screen(start.cols, start.rows),
      exit: null,
    };
    this.entries.set(start.session, entry);
    pty.onData((data) => {
      if (this.entries.get(start.session) !== entry) return;
      entry.scroll.push(data);
      entry.screen.write(data);
      this.deps.output(start.session, data);
    });
    pty.onExit(({ exitCode, signal }) => {
      if (this.entries.get(start.session) !== entry || entry.exit) return;
      entry.exit = { exitCode, signal: signal ? signal : null };
      this.deps.exited(start.session, entry.exit);
    });
    return pty.pid;
  }

  attach(session: string): Attached {
    const entry = this.required(session);
    return { pid: entry.pty.pid, replay: entry.scroll.text(), exit: entry.exit };
  }

  write(session: string, data: string): void {
    const entry = this.required(session);
    if (!entry.exit) entry.pty.write(data);
  }

  resize(session: string, cols: number, rows: number): void {
    const entry = this.required(session);
    if (entry.exit) return;
    entry.pty.resize(cols, rows);
    entry.screen.resize(cols, rows);
  }

  screen(session: string): Promise<string | null> {
    const entry = this.entries.get(session);
    return entry ? entry.screen.text() : Promise.resolve(null);
  }

  list(): Listed {
    return [...this.entries].map(([session, entry]) => ({
      session,
      pid: entry.pty.pid,
      exited: entry.exit !== null,
    }));
  }

  async kill(session: string): Promise<void> {
    const entry = this.entries.get(session);
    if (!entry) return;
    this.drop(session);
    if (entry.exit) return;
    await this.deps.killTree(entry.pty.pid).catch(() => undefined);
    try {
      entry.pty.kill();
    } catch {
      return;
    }
  }

  remove(session: string): void {
    if (this.entries.get(session)?.exit) this.drop(session);
  }

  async killAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((session) => this.kill(session)));
  }

  private drop(session: string): void {
    this.entries.get(session)?.screen.dispose();
    this.entries.delete(session);
  }

  private required(session: string): Entry {
    const entry = this.entries.get(session);
    if (!entry) throw new Error('That terminal session is no longer running.');
    return entry;
  }
}
