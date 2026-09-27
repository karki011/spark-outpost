import * as acp from '@agentclientprotocol/sdk';

export const CODEX_DO_TRIGGER = '#codex ';

const COMMAND_OPTIONS: acp.PermissionOption[] = [
  { optionId: 'allow_once', name: 'Yes, proceed', kind: 'allow_once' },
  {
    optionId: 'accept_execpolicy_amendment',
    name: "Yes, and don't ask again for commands that start with this",
    kind: 'allow_always',
  },
  { optionId: 'decline', name: 'No, continue without it', kind: 'reject_once' },
  { optionId: 'cancel', name: 'No, and tell Codex what to do differently', kind: 'reject_once' },
];

const FILE_OPTIONS: acp.PermissionOption[] = [
  { optionId: 'allow_once', name: 'Yes, proceed', kind: 'allow_once' },
  {
    optionId: 'allow_for_session',
    name: "Yes, and don't ask again for these files",
    kind: 'allow_always',
  },
  { optionId: 'decline', name: 'No, continue without it', kind: 'reject_once' },
  { optionId: 'cancel', name: 'No, and tell Codex what to do differently', kind: 'reject_once' },
];

interface CodexAction {
  toolCall: acp.ToolCallUpdate;
  options: acp.PermissionOption[];
  label: string;
}

function actionFor(step: string, index: number, cwd: string): CodexAction {
  const toolCallId = `codex-${index}`;
  if (step.startsWith('patch ')) {
    const target = step.slice('patch '.length).trim();
    const path = target.startsWith('/') ? target : `${cwd}/${target}`;
    return {
      label: step,
      options: FILE_OPTIONS,
      toolCall: {
        toolCallId,
        kind: 'edit',
        status: 'pending',
        title: 'Edit files',
        locations: [{ path }],
      },
    };
  }
  return {
    label: step,
    options: COMMAND_OPTIONS,
    toolCall: {
      toolCallId,
      kind: 'execute',
      status: 'pending',
      title: 'Run command',
      rawInput: { command: step, cwd },
    },
  };
}

export async function codexDoTurn(
  text: string,
  cwd: string,
  sessionId: string,
  client: acp.AgentContext,
  say: (chunk: string) => Promise<void>,
): Promise<acp.StopReason> {
  const script = text.slice(text.indexOf(CODEX_DO_TRIGGER) + CODEX_DO_TRIGGER.length);
  const steps = script
    .split('\n')[0]!
    .split(';;')
    .map((step) => step.trim())
    .filter(Boolean);
  for (const [index, step] of steps.entries()) {
    const action = actionFor(step, index, cwd);
    await client.notify(acp.methods.client.session.update, {
      sessionId,
      update: { sessionUpdate: 'tool_call', ...action.toolCall, title: step } as acp.SessionUpdate,
    });
    const answer = await client.request(acp.methods.client.session.requestPermission, {
      sessionId,
      toolCall: action.toolCall,
      options: action.options,
      _meta: { permission: { version: 1, title: 'Run command?' } },
    });
    const chose = answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'cancelled';
    const ran =
      chose === 'allow_once' || chose.startsWith('accept') || chose === 'allow_for_session';
    await client.notify(acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: action.toolCall.toolCallId,
        status: ran ? 'completed' : 'failed',
      },
    });
    await say(`[${action.label}=${chose}]`);
    if (chose === 'cancel' || chose === 'cancelled') return 'cancelled';
  }
  return 'end_turn';
}
