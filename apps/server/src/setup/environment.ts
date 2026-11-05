const SECRET_WORD = /SECRET|TOKEN|PASSWORD|KEY/i;
const DATABASE_URL_NAME = /DATABASE_URL$/i;
const GIT_CONFIG_ENTRY_NAME = /^GIT_CONFIG_KEY_\d+$/;
const PARENT_AGENT_SESSION = /^CLAUDE/;
const KEPT_CLAUDE_SETTINGS = new Set(['CLAUDE_CONFIG_DIR']);

export function isSecretEnvName(name: string): boolean {
  if (DATABASE_URL_NAME.test(name)) return true;
  return SECRET_WORD.test(name) && !GIT_CONFIG_ENTRY_NAME.test(name);
}

export function childEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || isSecretEnvName(name)) continue;
    if (PARENT_AGENT_SESSION.test(name) && !KEPT_CLAUDE_SETTINGS.has(name)) continue;
    clean[name] = value;
  }
  return clean;
}

const HIDDEN_VALUE_MIN_LENGTH = 6;
export const HIDDEN_VALUE = '[hidden]';

export function secretNamed(env: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([name]) => isSecretEnvName(name)));
}

export function withoutSecretNamed(env: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !isSecretEnvName(name)));
}

export function hiddenValues(env: Readonly<Record<string, string>>): string[] {
  const values = Object.values(secretNamed(env)).filter(
    (value) => value.length >= HIDDEN_VALUE_MIN_LENGTH,
  );
  return [...new Set(values)].sort((a, b) => b.length - a.length);
}

export function withoutValues(text: string, values: readonly string[]): string {
  return values.reduce((shown, value) => shown.replaceAll(value, HIDDEN_VALUE), text);
}
