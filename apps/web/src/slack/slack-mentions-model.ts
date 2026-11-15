import { freshUpdate, type AttentionItem } from '@spark-outpost/contracts';

export interface SlackMentionRow {
  key: string;
  line: string;
  url: string | null;
  at: string;
}

export function slackMentionRows(items: readonly AttentionItem[]): SlackMentionRow[] {
  return items
    .filter((item) => item.kind === 'slack-mention' && freshUpdate(item))
    .map((item) => ({
      key: item.key,
      line: item.detail ?? 'Someone mentioned you in Slack',
      url: item.url ?? null,
      at: item.at,
    }))
    .toSorted((a, b) => b.at.localeCompare(a.at));
}
