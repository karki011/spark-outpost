import type { AssistantSession, AssistantSettingsView } from '@spark-outpost/contracts';

export function modelHint(view: AssistantSettingsView, providerName: string): string {
  const runsOn = view.runsOn;
  if (!runsOn) return 'Connect a provider first.';
  if (view.settings.modelChoice === 'fast' && runsOn.noFastModel) {
    return `${providerName} offers no faster model here, so Ask Spark uses its default model.`;
  }
  if (!runsOn.modelLabel) return 'Ask Spark uses the default chat model.';
  return `Ask Spark answers with ${runsOn.modelLabel}.`;
}

export function effortHint(view: AssistantSettingsView): string {
  const effort = view.runsOn?.effort;
  return effort ? `Ask Spark thinks at ${effort} effort.` : 'Ask Spark uses the chat effort.';
}

function clock(at: string): string {
  return new Date(at).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function sessionLine(session: AssistantSession | null): string {
  if (!session) return 'No session yet. The next question starts one.';
  const context =
    session.contextPercent === null ? '' : `, context ${session.contextPercent}% full`;
  return `One session since ${clock(session.startedAt)}, last used ${clock(session.lastUsedAt)}${context}.`;
}
