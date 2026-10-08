import { realpath } from 'node:fs/promises';
import type { Queryable } from '../persistence/db.ts';
import { runCommandLines, runEditDiffs } from '../persistence/run-writes.ts';
import { git } from '../projects/snapshot.ts';
import { commandDir, insideTree, redirectWrites } from './edit-evidence.ts';

export interface CrossingSite {
  runId: string;
  cwd: string;
  before: string;
  after: string | null;
}

export interface CrossingChange {
  patch: string;
  whole: boolean;
}

const prefixed = (mark: string, text: string) =>
  text
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => `${mark}${line}`)
    .join('\n');

async function wholeDiff(site: CrossingSite, path: string): Promise<string> {
  if (!site.after) return '';
  return git(site.cwd, ['diff', '--relative', site.before, site.after, '--', path]).catch(() => '');
}

async function commandsInto(
  db: Queryable,
  site: CrossingSite,
  bases: readonly string[],
  path: string,
): Promise<string[]> {
  const lines: string[] = [];
  for (const ran of await runCommandLines(db, site.runId)) {
    const written = await redirectWrites(ran.command, commandDir(ran.cwd, site.cwd));
    if (written.some((target) => insideTree(bases, site.cwd, target) === path)) {
      lines.push(`$ ${ran.command}`);
    }
  }
  return lines;
}

export async function crossingChange(
  db: Queryable,
  site: CrossingSite,
  path: string,
): Promise<CrossingChange> {
  const bases = [...new Set([site.cwd, await realpath(site.cwd).catch(() => site.cwd)])];
  const record = await runEditDiffs(db, site.runId);
  const edits = record.diffs.filter((diff) => insideTree(bases, site.cwd, diff.path) === path);
  const rewritten = edits.some((diff) => diff.oldText === null);
  const commands = await commandsInto(db, site, bases, path);
  const seen = edits.length + commands.length > 0;
  if (record.cut || rewritten || !seen) {
    return { patch: await wholeDiff(site, path), whole: true };
  }
  const changes = edits.map(
    (diff) => `${prefixed('-', diff.oldText ?? '')}\n${prefixed('+', diff.newText)}`,
  );
  return { patch: [...changes, ...commands].join('\n'), whole: false };
}
