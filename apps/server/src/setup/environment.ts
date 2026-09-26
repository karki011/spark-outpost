const SECRET_NAME = /(DATABASE_URL|SECRET|TOKEN|PASSWORD|_KEY)$/i;
const PARENT_AGENT_SESSION = /^CLAUDE/;
const KEPT_CLAUDE_SETTINGS = new Set(['CLAUDE_CONFIG_DIR']);

export function childEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || SECRET_NAME.test(name)) continue;
    if (PARENT_AGENT_SESSION.test(name) && !KEPT_CLAUDE_SETTINGS.has(name)) continue;
    clean[name] = value;
  }
  return clean;
}
