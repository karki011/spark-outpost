import type { IgnoredSetting, RepoHook } from '@spark-outpost/contracts';
import { isRecord } from './records.ts';
import {
  REDIRECT_COMMANDS,
  isRedirectCommand,
  isRedirectEnv,
  type RedirectSetting,
} from './redirects.ts';

export type HookEntry = Record<string, unknown>;
export type HooksConfig = Record<string, HookEntry[]>;

export interface SourcedAllowRule {
  rule: string;
  source: string;
}

export interface SettingsFileSummary {
  hooks: RepoHook[];
  hooksConfig: HooksConfig;
  allowRules: SourcedAllowRule[];
  redirects: RedirectSetting[];
  ignored: IgnoredSetting[];
  warnings: string[];
}

const COMMAND_SETTINGS = [...REDIRECT_COMMANDS, 'statusLine', 'fileSuggestion'] as const;

const PREVIEW_MAX = 200;
const APPLIED_PERMISSION_KEYS = new Set(['allow', 'deny', 'ask']);

export function preview(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > PREVIEW_MAX ? `${oneLine.slice(0, PREVIEW_MAX - 1)}…` : oneLine;
}

export function hookPreview(hook: Record<string, unknown>): string | null {
  if (typeof hook.command === 'string') return preview(hook.command);
  if (typeof hook.url === 'string') return preview(`HTTP ${hook.url}`);
  if (typeof hook.prompt === 'string') return preview(`Prompt: ${hook.prompt}`);
  return null;
}

function readHooks(value: unknown, source: string, summary: SettingsFileSummary): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    summary.warnings.push(`${source}: "hooks" is not an object, so it was skipped.`);
    return;
  }
  for (const [event, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isRecord(entry) || !Array.isArray(entry.hooks)) continue;
      const matcher =
        typeof entry.matcher === 'string' && entry.matcher !== '' ? entry.matcher : null;
      const kept = entry.hooks.filter(isRecord);
      for (const hook of kept) {
        const command = hookPreview(hook);
        if (command) summary.hooks.push({ event, matcher, command, source });
      }
      if (kept.length > 0) {
        summary.hooksConfig[event] = [
          ...(summary.hooksConfig[event] ?? []),
          { ...entry, hooks: kept },
        ];
      }
    }
  }
}

function commandPreview(value: unknown): string {
  if (typeof value === 'string') return preview(value);
  if (isRecord(value) && typeof value.command === 'string') return preview(value.command);
  return 'set';
}

function allowRulesOf(settings: Record<string, unknown>): string[] {
  const permissions = isRecord(settings.permissions) ? settings.permissions : {};
  return Array.isArray(permissions.allow)
    ? permissions.allow.filter((rule): rule is string => typeof rule === 'string')
    : [];
}

function readRedirects(settings: Record<string, unknown>, source: string): RedirectSetting[] {
  const env = isRecord(settings.env) ? settings.env : {};
  const fromEnv = Object.entries(env).flatMap(([name, value]) =>
    typeof value === 'string' && isRedirectEnv(name)
      ? [{ kind: 'env' as const, name, value, source }]
      : [],
  );
  const fromCommands = Object.entries(settings).flatMap(([name, value]) =>
    typeof value === 'string' && isRedirectCommand(name)
      ? [{ kind: 'command' as const, name, value, source }]
      : [],
  );
  return [...fromEnv, ...fromCommands];
}

function readIgnored(settings: Record<string, unknown>, source: string): IgnoredSetting[] {
  const ignored: IgnoredSetting[] = [];
  const permissions = isRecord(settings.permissions) ? settings.permissions : {};
  const allow = allowRulesOf(settings);
  if (allow.length > 0) ignored.push({ source, kind: 'allow', items: allow.map(preview) });
  if (isRecord(settings.env)) {
    const names = Object.keys(settings.env);
    if (names.length > 0) ignored.push({ source, kind: 'env', items: names });
  }
  const commands = COMMAND_SETTINGS.filter((key) => settings[key] !== undefined).map(
    (key) => `${key}: ${commandPreview(settings[key])}`,
  );
  if (commands.length > 0) ignored.push({ source, kind: 'command', items: commands });
  const other = Object.keys(settings).filter(
    (key) =>
      key !== 'hooks' &&
      key !== 'env' &&
      key !== '$schema' &&
      !(COMMAND_SETTINGS as readonly string[]).includes(key),
  );
  const permissionKeys = Object.keys(permissions)
    .filter((key) => !APPLIED_PERMISSION_KEYS.has(key))
    .map((key) => `permissions.${key}`);
  const settingItems = [...other.filter((key) => key !== 'permissions'), ...permissionKeys];
  if (settingItems.length > 0) ignored.push({ source, kind: 'setting', items: settingItems });
  return ignored;
}

export function emptySummary(): SettingsFileSummary {
  return { hooks: [], hooksConfig: {}, allowRules: [], redirects: [], ignored: [], warnings: [] };
}

export function readSettingsFile(text: string, source: string, summary: SettingsFileSummary): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    summary.warnings.push(`${source} is not valid JSON, so it was skipped.`);
    return;
  }
  if (!isRecord(parsed)) {
    summary.warnings.push(`${source} is not a JSON object, so it was skipped.`);
    return;
  }
  readHooks(parsed.hooks, source, summary);
  summary.allowRules.push(...allowRulesOf(parsed).map((rule) => ({ rule, source })));
  summary.redirects.push(...readRedirects(parsed, source));
  summary.ignored.push(...readIgnored(parsed, source));
}
