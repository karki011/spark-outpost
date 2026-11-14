import { readdirSync } from 'node:fs';
import path from 'node:path';
import { ACCEPTED_RECORD } from '../spark-rules/accepted.ts';
import { USER_RULES_NAME, sparkChannel } from '../spark-rules/rules-store.ts';

export type ListEntries = (dir: string) => readonly string[];

const TOP_LEVEL_NAMES = ['runtime', 'logs'] as const;

const CHANNEL_NAMES = [
  'chats',
  'terminal-sessions',
  'terminal-workspaces',
  'tmux*',
  USER_RULES_NAME,
  ACCEPTED_RECORD,
] as const;

function listEntries(dir: string): readonly string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function sparkDataReadRules(
  dataDir: string | null,
  readable: readonly string[],
  list: ListEntries = listEntries,
  channel: string = sparkChannel(),
): string[] {
  if (!dataDir) return [];
  const root = path.resolve(dataDir);
  const channelDir = path.join(root, channel);
  const kept = readable.map((folder) => path.resolve(folder));
  const known = (dir: string): readonly string[] => {
    if (dir === root) return [...TOP_LEVEL_NAMES, channel];
    return dir === channelDir ? CHANNEL_NAMES : [];
  };
  const rules: string[] = [];
  const walk = (dir: string) => {
    for (const name of new Set([...known(dir), ...list(dir)])) {
      const entry = path.join(dir, name);
      if (kept.includes(entry)) continue;
      if (kept.some((folder) => folder.startsWith(`${entry}${path.sep}`))) {
        walk(entry);
        continue;
      }
      rules.push(`Read(/${entry})`, `Read(/${entry}/**)`);
    }
  };
  walk(root);
  return rules;
}
