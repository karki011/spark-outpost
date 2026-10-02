import os from 'node:os';
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
  const home = os.homedir();
  const items = shells.map((shell) => {
    const program = programOf(shell.pid, table);
    return {
      name: shell.label,
      cwd: shortPath(shell.cwd, home),
      chat: shell.conversationId ? { id: shell.conversationId, title: shell.chatTitle } : null,
      openedAt: shell.openedAt,
      busy: program !== null,
      ...(program ? { running: program } : {}),
    };
  });
  return {
    open: items.length,
    terminals: items,
    note: 'Only names, folders and whether a command is running; terminal output is never shared.',
  };
}

export const terminalTool = sparkTool({
  name: 'spark_terminals',
  privateData: true,
  title: 'Terminals',
  description:
    "The user's open Spark terminal tabs: name, folder, which chat each belongs to, when it opened, and whether a command is running (program name only). Never returns what the terminal printed.",
  input: {},
  run: (_args, context) => terminals(context),
});
