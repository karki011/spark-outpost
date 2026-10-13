import { shellEnvironment, type PtyOptions, type SpawnPty } from '../pty.ts';
import { controlPty } from './control-pty.ts';
import type { TmuxHost } from './tmux-host.ts';

export function tmuxSpawner(
  base: SpawnPty,
  host: TmuxHost | null,
  log: (line: string) => void = console.warn,
  control: typeof controlPty = controlPty,
): SpawnPty {
  if (!host) return base;
  let reported = false;
  const direct = (options: PtyOptions, error: Error) => {
    if (options.adopt) throw error;
    if (!reported) log(`Terminal sessions run without tmux: ${error.message}`);
    reported = true;
    return base(options);
  };
  return (options) => {
    if (!options.sessionId || !options.command) return base(options);
    try {
      return control(host, {
        sessionId: options.sessionId,
        adopt: options.adopt === true,
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd ?? host.env.HOME ?? '/',
        command: options.command,
        args: options.args ?? [],
        env: { ...shellEnvironment(process.env), ...options.env },
      });
    } catch (error) {
      return direct(options, error as Error);
    }
  };
}
