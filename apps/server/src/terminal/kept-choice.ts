import { nodeLauncher } from './session-host/host-launch.ts';
import { hostKept } from './session-host/host-kept.ts';
import { sessionHostPaths } from './session-host/paths.ts';
import { tmuxKept, type KeptSessions } from './kept-sessions.ts';
import { chooseTmux, tmuxChoiceLine, type TmuxHost } from './tmux/tmux-host.ts';

export interface KeptChoice {
  kept: KeptSessions | null;
  tmux: TmuxHost | null;
  line: string;
}

export interface KeptChoiceInput {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  tmuxDirectory: string;
  hostDirectory: string;
  localDir: string | null;
}

const WITHOUT = 'Terminal sessions run without the session host';
const STOP_ON_RESTART = 'they stop when Spark restarts.';

export function usesSessionHost(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  return platform === 'win32'
    ? env.SPARK_TERMINAL_HOST !== 'off'
    : env.SPARK_TERMINAL_HOST === 'on';
}

export function chooseKeptSessions(input: KeptChoiceInput): KeptChoice {
  if (usesSessionHost(input.env, input.platform)) {
    try {
      const paths = sessionHostPaths(input.hostDirectory, input.platform);
      return {
        kept: hostKept({ paths, launcher: nodeLauncher() }),
        tmux: null,
        line: 'Terminal sessions run under the Spark session host.',
      };
    } catch (error) {
      return {
        kept: null,
        tmux: null,
        line: `${WITHOUT} (${(error as Error).message}); ${STOP_ON_RESTART}`,
      };
    }
  }
  if (input.platform === 'win32')
    return { kept: null, tmux: null, line: `${WITHOUT} (it is turned off); ${STOP_ON_RESTART}` };
  const choice = chooseTmux(input.env, input.tmuxDirectory, input.localDir);
  return {
    kept: choice.host ? tmuxKept(choice.host) : null,
    tmux: choice.host,
    line: tmuxChoiceLine(choice),
  };
}
