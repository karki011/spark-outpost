export const CLAUDE_WINDOWS_ENV: Record<string, string> =
  process.platform === 'win32' ? { CLAUDE_CODE_USE_POWERSHELL_TOOL: '0' } : {};

export const CLAUDE_WINDOWS_ENV_NAMES = Object.keys(CLAUDE_WINDOWS_ENV);
