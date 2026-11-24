import type { ConversationDetail, SendMessageResponse } from '@spark-outpost/contracts';

export function withSavedSend(
  detail: ConversationDetail,
  saved: Partial<SendMessageResponse>,
): ConversationDetail {
  const { message, run } = saved;
  if (!message || !run) return detail;
  const hasMessage = detail.messages.some((entry) => entry.id === message.id);
  const hasRun = detail.runs.some((entry) => entry.id === run.id);
  if (hasMessage && hasRun) return detail;
  return {
    ...detail,
    messages: hasMessage ? detail.messages : [...detail.messages, message],
    runs: hasRun ? detail.runs : [...detail.runs, run],
  };
}
