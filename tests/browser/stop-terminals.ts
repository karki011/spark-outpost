import { existsSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_BRANCH_PREFIX } from '../../apps/server/src/projects/worktrees.ts';
import {
  killTmuxServer,
  tmuxBaseEnv,
  tmuxBinary,
} from '../../apps/server/src/terminal/tmux/tmux-host.ts';
import { TEST_DATA_DIR } from './stub-config.ts';

export default function stopTerminalSessions(): void {
  const localDir = path.resolve(import.meta.dirname, '../../.local');
  const directory = path.join(TEST_DATA_DIR, DEFAULT_BRANCH_PREFIX, 'tmux');
  const socket = path.join(directory, 's');
  const bin = tmuxBinary(process.env, localDir);
  if (!bin || !existsSync(socket)) return;
  killTmuxServer({
    bin,
    directory,
    socket,
    configPath: path.join(directory, 'tmux.conf'),
    env: tmuxBaseEnv(process.env),
  });
}
