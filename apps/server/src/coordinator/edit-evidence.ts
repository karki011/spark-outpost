import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseShell, type ShellScript } from '../approvals/shell-parse.ts';
import type { Queryable } from '../persistence/db.ts';
import { pieceCommands, pieceToolEdits } from '../persistence/run-writes.ts';

export interface EditEvidence {
  mine: ReadonlySet<string>;
  others: ReadonlySet<string>;
}

export const NO_EVIDENCE: EditEvidence = { mine: new Set(), others: new Set() };

export function insideTree(bases: readonly string[], from: string, target: string): string | null {
  const absolute = path.resolve(from, target);
  for (const base of bases) {
    const relative = path.relative(base, absolute);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
  }
  return null;
}

function staticTargets(script: ShellScript | null): string[] {
  return (script?.redirects ?? []).flatMap((redirect) =>
    redirect.operator.includes('>') && redirect.target && !redirect.target.dynamic
      ? [redirect.target.text]
      : [],
  );
}

export function commandDir(stored: string | null, cwd: string): string {
  if (!stored) return cwd;
  if (stored === '~' || stored.startsWith('~/')) return path.join(homedir(), stored.slice(1));
  return path.resolve(cwd, stored);
}

function afterLeadingCd(script: ShellScript, from: string): string | null {
  const [program, folder] = script.commands[0]?.words ?? [];
  if (program?.text !== 'cd') return from;
  if (!folder || folder.dynamic || folder.glob) return null;
  return path.resolve(from, folder.text);
}

export async function redirectWrites(command: string, from: string): Promise<string[]> {
  const script = await parseShell(command).catch(() => null);
  const folder = script ? afterLeadingCd(script, from) : null;
  if (folder === null) return [];
  return staticTargets(script).map((target) => path.resolve(folder, target));
}

export async function editEvidence(
  db: Queryable,
  parentRunId: string,
  pieceKey: string,
  cwd: string,
): Promise<EditEvidence> {
  const bases = [...new Set([cwd, await realpath(cwd).catch(() => cwd)])];
  const mine = new Set<string>();
  const others = new Set<string>();
  const add = (key: string, from: string, target: string) => {
    const relative = insideTree(bases, from, target);
    if (relative) (key === pieceKey ? mine : others).add(relative);
  };
  for (const edit of await pieceToolEdits(db, parentRunId)) add(edit.pieceKey, cwd, edit.path);
  for (const ran of await pieceCommands(db, parentRunId)) {
    for (const target of await redirectWrites(ran.command, commandDir(ran.cwd, cwd))) {
      add(ran.pieceKey, cwd, target);
    }
  }
  return { mine, others };
}
