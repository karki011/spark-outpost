import os from 'node:os';
import type { KeptSessions } from '../kept-sessions.ts';
import { shellEnvironment, type SpawnPty } from '../pty.ts';
import { withHostConnection } from './host-connection.ts';
import { hostPty, type SessionHostConfig } from './host-pty.ts';
import { listedSchema } from './protocol.ts';

export function hostKept(
  config: SessionHostConfig,
  log: (line: string) => void = console.warn,
  start: typeof hostPty = hostPty,
): KeptSessions {
  const known = new Map<string, number>();
  const kill = (session: string) =>
    withHostConnection(config.paths, (connection) =>
      connection.request({ kind: 'kill', session }),
    ).then(() => undefined);

  return {
    spawner(base: SpawnPty): SpawnPty {
      let reported = false;
      return (options) => {
        if (!options.sessionId || !options.command) return base(options);
        const created = options.adopt ? undefined : options.observer?.begin('new_session');
        const pty = start(
          config,
          {
            adopt: options.adopt === true,
            create: {
              kind: 'create',
              session: options.sessionId,
              cols: Math.max(1, Math.trunc(options.cols)),
              rows: Math.max(1, Math.trunc(options.rows)),
              cwd: options.cwd ?? os.homedir(),
              command: options.command,
              args: options.args ?? [],
              env: { ...shellEnvironment(process.env), ...options.env },
            },
          },
          (session) => known.get(session) ?? null,
          {
            created: () => created?.(),
            fallback: (error) => {
              if (!reported)
                log(`Terminal sessions run without the session host: ${error.message}`);
              reported = true;
              options.observer?.backend('direct');
              return base(options);
            },
          },
        );
        options.observer?.backend('host');
        return pty;
      };
    },
    async listSessionIds() {
      const listed = await withHostConnection(config.paths, async (connection) =>
        listedSchema.parse(await connection.request({ kind: 'list' })),
      );
      known.clear();
      for (const row of listed ?? []) known.set(row.session, row.pid);
      return [...known.keys()];
    },
    killSessionTree: kill,
    killUnknownSessions: async () => undefined,
    stopAll: () =>
      withHostConnection(config.paths, (connection) => connection.request({ kind: 'shutdown' })),
  };
}
