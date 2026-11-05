import { fingerprintOf } from './fingerprint.ts';

export interface RedirectSetting {
  kind: 'env' | 'command';
  name: string;
  value: string;
  source: string;
}

export interface RedirectSettings {
  env: Record<string, string>;
  commands: Record<string, string>;
}

export const REDIRECT_COMMANDS = [
  'apiKeyHelper',
  'awsAuthRefresh',
  'awsCredentialExport',
  'gcpAuthRefresh',
  'otelHeadersHelper',
  'proxyAuthHelper',
] as const;

const REDIRECT_ENV = [
  /^ANTHROPIC_/,
  /^OPENAI_/,
  /^CLAUDE_CODE_USE_/,
  /_BASE_URL$/,
  /_PROXY$/,
  /_API_KEY$/,
  /_AUTH_TOKEN$/,
];
const HIDDEN_VALUE = /KEY|TOKEN|SECRET|PASSWORD|AUTH|HEADER/;

export function isRedirectEnv(name: string): boolean {
  const upper = name.toUpperCase();
  return REDIRECT_ENV.some((pattern) => pattern.test(upper));
}

export function isRedirectCommand(name: string): boolean {
  return (REDIRECT_COMMANDS as readonly string[]).includes(name);
}

export function shownValue(setting: RedirectSetting): string | null {
  if (setting.kind === 'command') return setting.value;
  return HIDDEN_VALUE.test(setting.name.toUpperCase()) ? null : setting.value;
}

export function redirectsFingerprint(settings: readonly RedirectSetting[]): string | null {
  if (settings.length === 0) return null;
  const canonical = settings.map((setting) => [
    setting.kind,
    setting.name,
    setting.value,
    setting.source,
  ]);
  return fingerprintOf(canonical);
}

export function redirectSettingsOf(settings: readonly RedirectSetting[]): RedirectSettings {
  const result: RedirectSettings = { env: {}, commands: {} };
  for (const setting of settings) {
    const target = setting.kind === 'env' ? result.env : result.commands;
    target[setting.name] = setting.value;
  }
  return result;
}
