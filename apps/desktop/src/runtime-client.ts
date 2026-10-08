import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rm, type FileHandle } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as delay } from 'node:timers/promises';
import type { Database, DatabaseOptions } from './postgres.ts';
import { createSecret, runtimePaths, runtimeProof, sameProof } from './runtime-handshake.ts';
import {
  RUNTIME_FRAME_LIMIT,
  runtimeEventSchema,
  runtimeInfoSchema,
  type RuntimeEvent,
  type RuntimeHandshake,
  type RuntimeInfo,
  type RuntimeRequest,
} from './runtime-protocol.ts';
import { isAlive, recordedPid, retireHost } from './runtime-retire.ts';
import type { ServiceLink, ServiceOptions } from './service.ts';
import type { Supervised } from './supervisor.ts';

interface RuntimeOptions {
  userData: string;
  version: string;
  serverDir: string;
  bootstrap: string;
  log(name: string, line: string): void;
}

async function claim(lockFile: string): Promise<FileHandle | null> {
  for (;;) {
    try {
      return await open(lockFile, 'wx', 0o600);
    } catch {
      let owner: number;
      try {
        owner = Number((await readFile(lockFile, 'utf8')).trim());
      } catch {
        continue;
      }
      if (!Number.isInteger(owner) || owner <= 0 || isAlive(owner)) return null;
      await rm(lockFile, { force: true });
    }
  }
}

export class LocalRuntime {
  private readonly waiting = new Map<
    string,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  private readonly links = new Map<string, ServiceLink>();
  private readonly logs = new Map<string, (line: string) => void>();
  private readonly exits = new Map<string, (code: number | null) => void>();
  private buffer = '';
  private readonly decoder = new StringDecoder('utf8');
  private welcomed: ((event: Extract<RuntimeEvent, { kind: 'welcome' }>) => void) | null = null;

  private constructor(
    private readonly socket: Socket,
    private readonly options: RuntimeOptions,
  ) {
    socket.on('data', (chunk: Buffer) => this.receive(this.decoder.write(chunk)));
    socket.on('error', () => undefined);
    socket.on('close', () => {
      for (const pending of this.waiting.values())
        pending.reject(new Error('The local runtime disconnected.'));
      this.waiting.clear();
      for (const link of this.links.values()) link.close();
      this.links.clear();
      for (const exited of this.exits.values()) exited(1);
      this.exits.clear();
    });
  }

  static async connect(options: RuntimeOptions): Promise<LocalRuntime> {
    const directory = path.join(options.userData, 'runtime');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const paths = runtimePaths(directory);
    const attach = async () => {
      let token: string;
      try {
        token = (await readFile(paths.token, 'utf8')).trim();
      } catch {
        return null;
      }
      const socket = await new Promise<Socket | null>((resolve) => {
        const candidate = connect(paths.socket);
        candidate.once('connect', () => resolve(candidate));
        candidate.once('error', () => {
          candidate.destroy();
          resolve(null);
        });
        candidate.setTimeout(1_000, () => {
          candidate.destroy();
          resolve(null);
        });
      });
      if (!socket) return null;
      socket.setTimeout(0);
      const runtime = new LocalRuntime(socket, options);
      try {
        const info = await Promise.race([
          runtime.prove(token).then(() => runtime.info()),
          delay(5_000, undefined, { ref: false }).then(() => {
            throw new Error('The local runtime did not authenticate.');
          }),
        ]);
        return { runtime, info };
      } catch {
        socket.destroy();
        return null;
      }
    };
    const existing = await attach();
    if (existing?.info.version === options.version) return existing.runtime;
    const lockFile = path.join(directory, 'starting');
    const lock = await claim(lockFile);
    if (!lock) {
      existing?.runtime.detach();
      for (let attempt = 0; attempt < 100; attempt += 1) {
        await delay(100);
        const pending = await attach();
        if (pending?.info.version === options.version) return pending.runtime;
        pending?.runtime.detach();
      }
      throw new Error('The local runtime is still starting. Reopen Spark to retry.');
    }
    try {
      await lock.writeFile(String(process.pid));
      if (existing)
        options.log(
          'runtime',
          `Stopping the local runtime left by Spark ${existing.info.version ?? 'of an earlier build'}.`,
        );
      await retireHost({
        directory,
        pid: existing?.info.pid ?? (await recordedPid(paths.endpoint)),
        stop: existing ? () => existing.runtime.stop() : null,
      });
      await rm(paths.endpoint, { force: true });
      const child = spawn(
        process.execPath,
        [options.bootstrap, directory, options.version, options.serverDir],
        {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        },
      );
      child.unref();
      let failed: Error | null = null;
      child.once('error', (error) => {
        failed = error;
      });
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (failed) throw failed;
        await delay(100);
        const started = await attach();
        if (started) return started.runtime;
        if (child.exitCode !== null)
          throw new Error(`The local runtime exited with ${child.exitCode}.`);
      }
      throw new Error('The local runtime did not become ready.');
    } finally {
      await lock.close();
      await rm(lockFile, { force: true });
    }
  }

  private prove(token: string): Promise<void> {
    const nonce = createSecret();
    return new Promise((resolve, reject) => {
      this.socket.once('close', () => reject(new Error('The local runtime disconnected.')));
      this.welcomed = (event) => {
        this.welcomed = null;
        if (!sameProof(event.proof, runtimeProof(token, 'host', nonce, event.nonce))) {
          reject(new Error('The local runtime did not prove its identity.'));
          return;
        }
        this.write({ kind: 'proof', proof: runtimeProof(token, 'client', nonce, event.nonce) });
        resolve();
      };
      this.write({ kind: 'hello', nonce });
    });
  }

  private write(frame: RuntimeHandshake | { id: string; request: RuntimeRequest }) {
    this.socket.write(`${JSON.stringify(frame)}\n`);
  }

  private receive(chunk: string) {
    this.buffer += chunk;
    if (this.buffer.length > RUNTIME_FRAME_LIMIT) {
      this.socket.destroy();
      return;
    }
    let boundary: number;
    while ((boundary = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 1);
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        this.socket.destroy();
        return;
      }
      const parsed = runtimeEventSchema.safeParse(raw);
      if (!parsed.success) {
        this.socket.destroy();
        return;
      }
      const event = parsed.data;
      if (event.kind === 'welcome') {
        if (!this.welcomed) {
          this.socket.destroy();
          return;
        }
        this.welcomed(event);
      } else if (event.kind === 'reply') {
        const pending = this.waiting.get(event.id);
        this.waiting.delete(event.id);
        if (event.error) pending?.reject(new Error(event.error));
        else pending?.resolve(event.result);
      } else if (event.kind === 'log') {
        const log = this.logs.get(event.name);
        if (log) log(event.line);
        else this.options.log(event.name, event.line);
      } else if (event.kind === 'service:message')
        this.links.get(event.name)?.receive(event.message);
      else if (event.kind === 'service:exit') {
        this.links.get(event.name)?.close();
        this.links.delete(event.name);
        this.exits.get(event.name)?.(event.code);
        this.exits.delete(event.name);
      }
    }
  }

  private request(request: RuntimeRequest): Promise<unknown> {
    if (this.socket.destroyed) return Promise.reject(new Error('The local runtime disconnected.'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.write({ id, request });
    });
  }

  async info(): Promise<RuntimeInfo> {
    return runtimeInfoSchema.parse(await this.request({ kind: 'info' }));
  }

  async database(options: DatabaseOptions): Promise<Database> {
    const serializable = {
      dataDir: options.dataDir,
      passwordFile: options.passwordFile,
      port: options.port,
    };
    const result = (await this.request({ kind: 'database:start', options: serializable })) as {
      url: string;
    };
    return {
      url: result.url,
      stop: async () => {
        await this.request({ kind: 'database:stop' });
      },
    };
  }

  async configure(api: NonNullable<RuntimeInfo['api']>): Promise<void> {
    await this.request({ kind: 'configure', api });
  }

  service(options: ServiceOptions): Supervised {
    const bridge = options.connect;
    const serializable = {
      name: options.name,
      bootstrap: options.bootstrap,
      entry: options.entry,
      cwd: options.cwd,
      env: options.env,
    };
    let settle: (code: number | null) => void = () => undefined;
    const exited = new Promise<number | null>((resolve) => {
      settle = resolve;
    });
    this.exits.set(options.name, settle);
    this.logs.set(options.name, options.log);
    const link = bridge?.({
      post: (message) => {
        void this.request({ kind: 'service:post', name: options.name, message }).catch(
          () => undefined,
        );
      },
    });
    if (link) this.links.set(options.name, link);
    const starting = this.request({ kind: 'service:start', options: serializable }).catch(
      (error: Error) => {
        options.log(error.message);
        settle(1);
      },
    );
    return {
      exited,
      stop: async () => {
        await starting;
        await this.request({ kind: 'service:stop', name: options.name });
      },
    };
  }

  detach(): void {
    this.socket.end();
  }

  async stop(): Promise<void> {
    await this.request({ kind: 'shutdown' });
    this.socket.end();
  }
}
