import type { Queryable } from './db.ts';
import { newId } from './ids.ts';

export interface SlackMention {
  channelId: string;
  ts: string;
  authorName: string;
  place: string;
  permalink: string;
  mentionedAt: Date;
}

export async function saveSlackMentions(
  db: Queryable,
  workspaceId: string,
  mentions: readonly SlackMention[],
): Promise<number> {
  let added = 0;
  for (const mention of mentions) {
    const { rowCount } = await db.query(
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
}
