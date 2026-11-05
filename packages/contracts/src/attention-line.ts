import type { ConversationAttention, ConversationSummary } from './conversations.ts';
import type { NativeTerminalSession } from './native-terminal.ts';

const PROVIDER_NAMES: Record<string, string> = {
  fake: 'Fake provider',
  claude: 'Claude',
  codex: 'Codex',
  zai: 'Z.ai (GLM)',
  custom: 'Custom endpoint',
};

export function providerName(provider: string): string {
  return PROVIDER_NAMES[provider] ?? provider;
}

export function terminalLabel(state: NativeTerminalSession['state']): string {
  const labels: Record<NativeTerminalSession['state'], string> = {
    starting: 'Starting',
    working: 'Running',
    waiting_for_permission: 'Waiting for permission',
    waiting_for_input: 'Waiting for input',
    ready: 'Idle',
    exited: 'Exited',
    error: 'Stopped with an error',
    unknown: 'Open',
    interrupted: 'Interrupted',
  };
  return labels[state];
}

export function terminalNeedsInput(chat: ConversationSummary): boolean {
  return (
    chat.terminal?.state === 'waiting_for_input' ||
    chat.terminal?.state === 'waiting_for_permission'
  );
}

export function needsInput(chat: ConversationSummary): boolean {
  return chat.needsInput || terminalNeedsInput(chat);
}

export function terminalWaitsAlone(chat: ConversationSummary): boolean {
  return chat.sessionType === 'terminal' && terminalNeedsInput(chat) && !chat.attention?.approvalId;
}

function agentSpeaking(attention: ConversationAttention): string {
  if (attention.agentName) return attention.agentName;
  return attention.provider ? providerName(attention.provider) : 'The agent';
}

function speaker(attention: ConversationAttention): string {
  const agent = agentSpeaking(attention);
  return attention.subagent ? `${agent}'s sub-agent ${attention.subagent}` : agent;
}

export function attentionLine(attention: ConversationAttention | null): string {
  if (!attention) return 'Needs your input';
  const name = attention.agentName;
  switch (attention.kind) {
    case 'permission':
      if (attention.prFeedback) return 'Spark is ready to push PR fixes and replies';
      return `${speaker(attention)} wants to ${attention.title}`;
    case 'plan':
      return name ? `${name}’s plan is ready for review` : 'The plan is ready for review';
    case 'review':
      return name ? `${name}’s changes are ready to review` : 'Changes are ready to review';
    case 'input':
      return name ? `${name} has a question` : attention.title || 'Needs your input';
    case 'stuck':
      return name ? `${name} was repeating itself` : 'The Builder was repeating itself';
    case 'flag':
      return attention.title;
  }
}

export function waitingLine(chat: ConversationSummary): string {
  if (chat.needsInput && !terminalWaitsAlone(chat)) return attentionLine(chat.attention);
  if (chat.sessionType === 'terminal' && chat.terminal) return terminalLabel(chat.terminal.state);
  return attentionLine(chat.attention);
}
