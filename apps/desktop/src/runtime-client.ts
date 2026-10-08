import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as delay } from 'node:timers/promises';
import type { Database, DatabaseOptions } from './postgres.ts';
import {
  RUNTIME_FRAME_LIMIT,
  runtimeEventSchema,
  runtimeInfoSchema,
  type RuntimeInfo,
  type RuntimeRequest,
} from './runtime-protocol.ts';
import type { ServiceLink, ServiceOptions } from './service.ts';
import type { Supervised } from './supervisor.ts';

interface RuntimeOptions {
  userData: string;
  bootstrap: string;
  log(name: string, line: string): void;
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

  private constructor(
    private readonly socket: Socket,
    private readonly token: string,
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
    const tokenFile = path.join(directory, 'token');
    let token: string;
    try {
      token = (await readFile(tokenFile, 'utf8')).trim();
    } catch {
      token = randomBytes(32).toString('base64url');
      try {
        await writeFile(tokenFile, token, { mode: 0o600, flag: 'wx' });
      } catch {
        token = (await readFile(tokenFile, 'utf8')).trim();
      }
    }
    const endpointFile = path.join(directory, 'endpoint.json');
    const attach = async () => {
      try {
        const endpoint = JSON.parse(await readFile(endpointFile, 'utf8')) as {
          port: number;
          pid: number;
        };
        if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535)
          return null;
        const socket = await new Promise<Socket | null>((resolve) => {
          const candidate = connect(endpoint.port, '127.0.0.1');
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
        const runtime = new LocalRuntime(socket, token, options);
        try {
          await Promise.race([
            runtime.info(),
            delay(5_000).then(() => {
              throw new Error('The local runtime did not authenticate.');
            }),
          ]);
          return runtime;
        } catch {
          socket.destroy();
          return null;
        }
      } catch {
        return null;
      }
    };
    const existing = await attach();
    if (existing) return existing;
    const lockFile = path.join(directory, 'starting');
    let lock: Awaited<ReturnType<typeof open>>;
    try {
      lock = await open(lockFile, 'wx', 0o600);
    } catch {
      try {
        const owner = Number((await readFile(lockFile, 'utf8')).trim());
        if (Number.isInteger(owner) && owner > 0) {
          try {
            process.kill(owner, 0);
          } catch {
            await rm(lockFile, { force: true });
            return LocalRuntime.connect(options);
          }
        }
      } catch {
        return LocalRuntime.connect(options);
      }
      for (let attempt = 0; attempt < 100; attempt += 1) {
        await delay(100);
        const pending = await attach();
        if (pending) return pending;
      }
      throw new Error('The local runtime is still starting. Reopen Spark to retry.');
    }
    try {
      await lock.writeFile(String(process.pid));
      await rm(endpointFile, { force: true });
      const child = spawn(process.execPath, [options.bootstrap, directory], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
      child.unref();
      let failed: Error | null = null;
      child.once('error', (error) => {
        failed = error;
      });
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (failed) throw failed;
        await delay(100);
        const runtime = await attach();
        if (runtime) return runtime;
        if (child.exitCode !== null)
          throw new Error(`The local runtime exited with ${child.exitCode}.`);
      }
      throw new Error('The local runtime did not become ready.');
    } finally {
      await lock.close();
      await rm(lockFile, { force: true });
    }
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
      if (event.kind === 'reply') {
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
      this.socket.write(`${JSON.stringify({ id, token: this.token, request })}\n`);
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

  get port(): number {
    return this.socket.remotePort!;
  }

  detach(): void {
    this.socket.end();
  }

  async stop(): Promise<void> {
    await this.request({ kind: 'shutdown' });
    this.socket.end();
  }
}
