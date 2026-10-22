import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { isRecord } from './records.ts';

export interface PermissionRules {
  deny: string[];
  ask: string[];
}

export const NO_PERMISSION_RULES: PermissionRules = { deny: [], ask: [] };

export const PROJECT_SETTINGS_FILES = [
  '.claude/settings.json',
  '.claude/settings.local.json',
] as const;

const MAX_FILE_BYTES = 256 * 1024;
const MAX_RULES = 200;
const MAX_RULE_LENGTH = 512;
const RULE = /^[A-Za-z][\w-]*\*?(?:\([^\r\n]+\))?$/;
const PATH_RULE = /^(Read|Edit|Write|MultiEdit|NotebookEdit|Glob|Grep)\((\/[^/].*|\/)\)$/s;

export function validRule(rule: unknown): rule is string {
  return typeof rule === 'string' && rule.length <= MAX_RULE_LENGTH && RULE.test(rule);
}

export function rebasedRule(rule: string, base: string): string {
  const match = PATH_RULE.exec(rule);
  if (!match) return rule;
  return `${match[1]}(/${path.join(base, match[2]!)})`;
}

function rulesIn(permissions: Record<string, unknown>, key: 'deny' | 'ask'): unknown[] {
  const list = permissions[key];
  return Array.isArray(list) ? list.slice(0, MAX_RULES) : [];
}

export function readPermissionRules(text: string, base: string): PermissionRules {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NO_PERMISSION_RULES;
  }
  const permissions = isRecord(parsed) && isRecord(parsed.permissions) ? parsed.permissions : {};
  const pick = (key: 'deny' | 'ask') =>
    rulesIn(permissions, key)
      .filter(validRule)
      .map((rule) => rebasedRule(rule, base));
  return { deny: pick('deny'), ask: pick('ask') };
}

async function readSmallFile(file: string): Promise<string | null> {
  const found = await stat(file).catch(() => null);
  if (!found?.isFile() || found.size > MAX_FILE_BYTES) return null;
  return readFile(file, 'utf8').catch(() => null);
}

interface SettingsFile {
  file: string;
  base: string;
}

export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const configured = env.CLAUDE_CONFIG_DIR?.trim();
  return configured && path.isAbsolute(configured) ? configured : path.join(home, '.claude');
}

function settingsFiles(roots: readonly string[], configDir: string): SettingsFile[] {
  const user = { file: path.join(configDir, 'settings.json'), base: configDir };
  const project = roots.flatMap((root) =>
    PROJECT_SETTINGS_FILES.map((name) => ({ file: path.join(root, name), base: root })),
  );
  return [user, ...project];
}

function mergedRules(parts: readonly PermissionRules[]): PermissionRules {
  return {
    deny: [...new Set(parts.flatMap((part) => part.deny))],
    ask: [...new Set(parts.flatMap((part) => part.ask))],
  };
}

export async function loadPermissionRules(
  roots: readonly string[],
  configDir: string = claudeConfigDir(),
): Promise<PermissionRules> {
  const parts = await Promise.all(
    settingsFiles(roots, configDir).map(async ({ file, base }) => {
      const text = await readSmallFile(file);
      return text === null ? NO_PERMISSION_RULES : readPermissionRules(text, base);
    }),
  );
  return mergedRules(parts);
}
