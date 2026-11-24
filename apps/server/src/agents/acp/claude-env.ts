export const NO_IDLE_COMPACTION = {
  CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS: String(Number.MAX_SAFE_INTEGER),
};

export const FOREGROUND_COMMAND_MS = 60_000;

export const FOREGROUND_COMMAND_ENV = {
  BASH_DEFAULT_TIMEOUT_MS: String(FOREGROUND_COMMAND_MS),
  BASH_MAX_TIMEOUT_MS: String(FOREGROUND_COMMAND_MS),
};

export function withBackgroundedCommands(
  definition: { cli: string },
  env: Record<string, string>,
): Record<string, string> {
  const own = Object.keys(FOREGROUND_COMMAND_ENV).some((name) => env[name]);
  return definition.cli !== 'claude' || own ? env : { ...env, ...FOREGROUND_COMMAND_ENV };
}
