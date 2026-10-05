import type { Queryable } from '../persistence/db.ts';
import { prFollowUpSettings } from '../persistence/pr-settings.ts';
import type { Watch } from '../persistence/pr-watches.ts';

export type FollowUpMode = 'on' | 'ask' | 'off';

export async function followUpMode(
  db: Queryable,
  watch: Pick<Watch, 'workspaceId' | 'conversationId'>,
): Promise<FollowUpMode> {
  const settings = await prFollowUpSettings(db, watch.workspaceId);
  if (!settings.enabled) return 'off';
  return settings.ask ? 'ask' : 'on';
}
