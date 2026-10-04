import type { SlackContextResponse } from '@spark-outpost/contracts';
import { saveAttachment } from '../persistence/attachments.ts';
import { saveSlackContextItem } from '../persistence/slack.ts';
import type { SlackDeps } from './connection.ts';
import {
  readSlackThread,
  requireSlackRef,
  slackThreadDocument,
  type SlackThread,
} from './thread.ts';

export async function saveSlackThreadAttachment(deps: SlackDeps, thread: SlackThread) {
  const attachment = await saveAttachment(deps.db, deps.workspaceId, {
    name: `Slack thread in ${thread.preview.channel.name}.md`,
    mediaType: 'text/markdown',
    data: Buffer.from(slackThreadDocument(thread), 'utf8'),
  });
  await saveSlackContextItem(deps.db, attachment.id, {
    ...thread.ref,
    permalink: thread.preview.permalink,
  });
  return attachment;
}

export async function slackContextFromLink(
  deps: SlackDeps,
  url: string,
): Promise<SlackContextResponse> {
  const thread = await readSlackThread(deps, requireSlackRef(url));
  return { attachment: await saveSlackThreadAttachment(deps, thread), preview: thread.preview };
}
