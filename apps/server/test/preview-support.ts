import type {
  PreviewProcess,
  PreviewRuntime,
  PreviewSpawn,
  PreviewTimings,
} from '../src/preview/servers.ts';

export class FakePreviewProcess implements PreviewProcess {
  readonly written: string[] = [];
  killed = false;
  size: { cols: number; rows: number } | null = null;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(exit: { exitCode: number | null }) => void>();

  constructor(
    readonly pid: number,
    readonly options: PreviewSpawn,
  ) {}

  write(data: string): void {
    this.written.push(data);
  }

  resize(cols: number, rows: number): void {
    this.size = { cols, rows };
  }

  onData(listener: (data: string) => void): void {
    this.dataListeners.add(listener);
  }

  onExit(listener: (exit: { exitCode: number | null }) => void): void {
    this.exitListeners.add(listener);
  }

  kill(): void {
    this.killed = true;
  }

  print(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }

  exit(exitCode: number | null): void {
    for (const listener of this.exitListeners) listener({ exitCode });
  }
}

export interface FakePreviewRuntime {
  runtime: PreviewRuntime;
  spawned: FakePreviewProcess[];
  busyPorts: Set<number>;
  answering: Set<string>;
  missingFolders: Set<string>;
  spawnError: Error | null;
}

export function fakePreviewRuntime(env: NodeJS.ProcessEnv = { PATH: '/usr/bin' }) {
  const fake: FakePreviewRuntime = {
    spawned: [],
    busyPorts: new Set(),
    answering: new Set(),
    missingFolders: new Set(),
    spawnError: null,
    runtime: {
      env,
      spawn(options) {
        if (fake.spawnError) throw fake.spawnError;
        const process = new FakePreviewProcess(4000 + fake.spawned.length, options);
        fake.spawned.push(process);
        return process;
      },
      portFree: async (port) => !fake.busyPorts.has(port),
      answers: async (url) => fake.answering.has(url),
      folderExists: async (folder) => !fake.missingFolders.has(folder),
    },
  };
  return fake;
}

export const FAST_PREVIEW: PreviewTimings = {
  readyTimeoutMs: 400,
  probeEveryMs: 10,
  restartBackoffMs: [20, 20],
  stableMs: 60_000,
  watchEveryMs: 25,
  logFlushMs: 10,
};
