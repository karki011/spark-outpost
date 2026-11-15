import { withTransaction, type Db, type DbClient } from './db.ts';
import { newId } from './ids.ts';

export interface SlackMention {
  channelId: string;
  ts: string;
  authorName: string;
  place: string;
  permalink: string;
  mentionedAt: Date;
}

export interface SlackMentionOwner {
  teamId: string;
  memberId: string;
  validatedAt: Date;
}

async function stillWatching(
  client: DbClient,
  workspaceId: string,
  owner: SlackMentionOwner,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM slack_connections
      WHERE workspace_id = $1 AND team_id = $2 AND member_id = $3
        AND date_trunc('milliseconds', validated_at) = $4
        AND state = 'connected' AND COALESCE(settings->>'watchMentions', 'true') <> 'false'
      FOR SHARE`,
    [workspaceId, owner.teamId, owner.memberId, owner.validatedAt],
  );
  return rows.length > 0;
}

export function saveSlackMentions(
  db: Db,
  workspaceId: string,
  owner: SlackMentionOwner,
  mentions: readonly SlackMention[],
): Promise<number> {
  if (mentions.length === 0) return Promise.resolve(0);
  return withTransaction(db, async (client) => {
    if (!(await stillWatching(client, workspaceId, owner))) return 0;
    let added = 0;
    for (const mention of mentions) {
      const { rowCount } = await client.query(
        `INSERT INTO slack_mentions
           (id, workspace_id, channel_id, ts, author_name, place, permalink, mentioned_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (workspace_id, channel_id, ts) DO NOTHING`,
        [
          newId(),
          workspaceId,
          mention.channelId,
          mention.ts,
          mention.authorName,
          mention.place,
          mention.permalink,
          mention.mentionedAt,
        ],
      );
      added += rowCount ?? 0;
    }
    return added;
  });
}
