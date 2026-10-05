import { setSlackProblem } from '../persistence/slack.ts';
import { requireSlack, slackNotifyTarget, type SlackDeps } from './connection.ts';
import { sendSlackMessage } from './post.ts';
import { SlackApiError } from './web-api.ts';

export const SLACK_TEST_TEXT =
  '*Spark Outpost is connected.* Notifications about your chats will arrive here.';

export async function sendTestNotification(deps: SlackDeps): Promise<{ sentTo: string }> {
  const open = await requireSlack(deps);
  const { connection } = open;
  const target = slackNotifyTarget(connection);
  if (!target) {
    throw new SlackApiError(
      'bad_link',
      'Add your Slack member ID or pick a channel for notifications first.',
    );
  }
  await sendSlackMessage(deps, open, { channel: target, mrkdwn: SLACK_TEST_TEXT });
  if (connection.problem) await setSlackProblem(deps.db, deps.workspaceId, null);
  if (connection.method === 'sign_in') return { sentTo: 'you, as a message to yourself' };
  const toChannel = target === connection.settings.notifyChannelId;
  return { sentTo: toChannel ? 'your notifications channel' : 'you, as a direct message' };
}
