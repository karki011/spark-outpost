import {
  DEFAULT_INVOLVEMENT_LEVEL,
  defaultModeFor,
  permissionFor,
  type NativeTerminalProvider,
  type InvolvementLevel,
} from '@spark-outpost/contracts';
import type { RunTarget } from './conversations.ts';
import type { Queryable } from './db.ts';

export async function nativeTerminalTarget(
  db: Queryable,
  conversationId: string,
  provider: NativeTerminalProvider,
  plan = false,
): Promise<RunTarget> {
  const { rows } = await db.query<{
    overrides: Record<string, { agentMode?: string; level?: InvolvementLevel }>;
    default_level: InvolvementLevel | null;
  }>(
    `SELECT c.overrides, p.default_level FROM conversations c
      LEFT JOIN profiles p ON p.workspace_id = c.workspace_id WHERE c.id = $1`,
    [conversationId],
  );
  const saved = rows[0]?.overrides[provider];
  const agentMode = plan
    ? provider === 'claude'
      ? 'plan'
      : 'read-only'
    : (saved?.agentMode ?? defaultModeFor(provider));
  return {
    provider,
    agentMode,
    permission: permissionFor(provider, agentMode),
    level: saved?.level ?? rows[0]?.default_level ?? DEFAULT_INVOLVEMENT_LEVEL,
  };
}
