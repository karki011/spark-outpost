import os from 'node:os';
import type { NativeTerminalProvider, NativeTerminalState } from '@spark-outpost/contracts';
import { listShells } from '../../persistence/terminal-shells.ts';
import {
  isAlive,
  processTable,
  runningCommand,
  type ProcessRow,
} from '../../terminal/process-group.ts';
import { sparkTool, type SparkToolContext } from '../tool.ts';

function shortPath(cwd: string, home: string): string {
  return cwd === home || cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
}

function programOf(pid: number, table: readonly ProcessRow[]): string | null {
  const command = runningCommand(pid, table);
  return command ? (command.split(' ')[0] ?? null) : null;
}

async function terminals({ deps, scope }: SparkToolContext) {
  const shells = (await listShells(deps.db, scope.workspaceId)).filter((shell) =>
    isAlive(shell.pid),
  );
  const table = shells.length > 0 ? await processTable() : [];
  const native =
    shells.length > 0
      ? await deps.db.query<{
          id: string;
          provider: NativeTerminalProvider;
          state: NativeTerminalState;
        }>('SELECT id, provider, state FROM native_terminal_sessions WHERE id = ANY($1::uuid[])', [
          shells.map((shell) => shell.id),
        ])
      : { rows: [] };
  const agents = new Map(native.rows.map((row) => [row.id, row]));
  const home = os.homedir();
  const items = shells.map((shell) => {
    const program = programOf(shell.pid, table);
    const agent = agents.get(shell.id);
    const busy = agent
      ? ['starting', 'unknown'].includes(agent.state)
        ? null
        : agent.state === 'working'
      : program !== null;
    return {
      name: shell.label,
      cwd: shortPath(shell.cwd, home),
      chat: shell.conversationId ? { id: shell.conversationId, title: shell.chatTitle } : null,
      openedAt: shell.openedAt,
      busy,
      ...(program ? { running: program } : {}),
      ...(agent ? { agent: { provider: agent.provider, state: agent.state } } : {}),
    };
  });
  return {
    open: items.length,
    terminals: items,
    note: 'Only names, folders, running programs and verified agent state; busy is null when agent activity is unknown. Terminal output is never shared.',
  };
}

export const terminalTool = sparkTool({
  name: 'spark_terminals',
  privateData: true,
  title: 'Terminals',
  description:
    "The user's open Spark terminals: name, folder, linked session, opening time, running program name and native agent state when verified. Unknown agent activity has busy:null. Never returns terminal output or observes terminals outside Spark.",
  input: {},
  run: (_args, context) => terminals(context),
});
