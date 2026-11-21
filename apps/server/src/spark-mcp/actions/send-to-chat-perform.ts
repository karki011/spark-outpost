import type { SendToChatAction } from '@spark-outpost/contracts';
import { createMessageAsk, targetChat, targetRefusal } from '../../sub-chats/asks.ts';
import { deliverAsk } from '../../sub-chats/delivery.ts';
import { chatTarget } from '../../workflow/queue-drain.ts';
import type { SparkToolContext } from '../tool.ts';
import { sentMessage } from '../tools/send-to-chat.ts';
import type { Performed } from './performed.ts';

export async function performSendToChat(
  { deps, scope }: SparkToolContext,
  action: SendToChatAction,
): Promise<Performed> {
  const to = await targetChat(deps.db, scope.workspaceId, action.from.id, action.to.id);
  const refusal = targetRefusal(action.from.id, to);
  if (refusal) throw new Error(refusal);
  await createMessageAsk(deps.db, {
    id: action.askId,
    workspaceId: scope.workspaceId,
    from: action.from,
    fromRunId: scope.runId,
    toConversationId: action.to.id,
    body: action.message,
    wantsReply: action.reply,
  });
  const delivered = await deliverAsk(deps.db, action.askId, chatTarget(deps.db));
  return {
    message: sentMessage(action, delivered),
    url: null,
    output: { askId: action.askId, delivered },
  };
}
