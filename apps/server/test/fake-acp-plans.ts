import * as acp from '@agentclientprotocol/sdk';
import type { RoleTurn } from './fake-acp-roles.ts';

export const PLAN_MODE_TRIGGER = '#planmode';
export const PROPOSED_PLAN_TRIGGER = '#proposedplan';
export const PLAN_REPLY_TRIGGER = '#planreply';
export const NATIVE_PLAN_TRIGGER = '#nativeplan';
export const PLAN_CALL_ONLY_TRIGGER = '#plancallonly';
export const PLAN_FILE_TRIGGER = '#planinfile';

export const FAKE_PLAN = [
  '# Add CSV export',
  '',
  'Goal: let people download their report as CSV.',
  '',
  '## Steps',
  '1. Add `src/export.ts` with a CSV writer',
  '2. Add a Download button to the report page',
  '3. Add a test for quoting commas',
  '',
  '## Decisions',
  '- Use the built-in writer, no new dependency',
].join('\n');

export const FAKE_PLAN_OPTIONS: acp.PermissionOption[] = [
  {
    optionId: 'exit-plan-clear-auto',
    name: 'Yes, clear context and use auto mode',
    kind: 'allow_always',
  },
  { optionId: 'exit-plan-auto', name: 'Yes, and use auto mode', kind: 'allow_always' },
  { optionId: 'exit-plan-default', name: 'Yes, manually approve edits', kind: 'allow_once' },
  { optionId: 'reject', name: 'No, keep planning', kind: 'reject_once' },
];

export async function planModeTurn(turn: RoleTurn, lockedMode: string): Promise<acp.StopReason> {
  await turn.update({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' });
  const toolCall = {
    toolCallId: 'plan1',
    title: 'Approve Plan',
    kind: 'switch_mode' as const,
    status: 'pending' as const,
    rawInput: { plan: FAKE_PLAN },
    content: [{ type: 'content' as const, content: { type: 'text' as const, text: FAKE_PLAN } }],
  };
  await turn.update({ sessionUpdate: 'tool_call', ...toolCall });
  const request: acp.RequestPermissionRequest = {
    sessionId: turn.sessionId,
    toolCall,
    options: FAKE_PLAN_OPTIONS,
  };
  const answer = await turn.client.request<
    acp.RequestPermissionResponse,
    acp.RequestPermissionRequest
  >(acp.methods.client.session.requestPermission, request);
  const chose = answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'cancelled';
  if (chose.startsWith('exit-plan-')) {
    await turn.update({ sessionUpdate: 'current_mode_update', currentModeId: lockedMode });
    await turn.update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'plan1',
      status: 'completed',
    });
    await turn.say(`Plan approved with ${chose}. Building it now.`);
    return 'end_turn';
  }
  await turn.update({ sessionUpdate: 'tool_call_update', toolCallId: 'plan1', status: 'failed' });
  await turn.say(`Kept planning (${chose}).`);
  return 'end_turn';
}

async function silentExitPlan(turn: RoleTurn, inFile: boolean): Promise<acp.StopReason> {
  await turn.update({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' });
  if (inFile) {
    await turn.update({
      sessionUpdate: 'tool_call',
      toolCallId: 'plan-file',
      title: 'Write plan',
      kind: 'edit',
      status: 'completed',
      rawInput: { file_path: '/Users/someone/.claude/plans/csv-export.md', content: FAKE_PLAN },
    });
  }
  const shown = {
    toolCallId: 'plan2',
    title: 'Approve Plan',
    kind: 'switch_mode' as const,
    status: 'pending' as const,
  };
  await turn.update({
    sessionUpdate: 'tool_call',
    ...shown,
    rawInput: inFile ? {} : { plan: FAKE_PLAN },
  });
  await turn.client.request(acp.methods.client.session.requestPermission, {
    sessionId: turn.sessionId,
    toolCall: { ...shown, rawInput: {} },
    options: FAKE_PLAN_OPTIONS,
  });
  await turn.update({ sessionUpdate: 'tool_call_update', toolCallId: 'plan2', status: 'failed' });
  return 'end_turn';
}

export async function planTurn(
  asked: string,
  turn: RoleTurn,
  mode: string,
): Promise<acp.StopReason | null> {
  if (asked.includes(PLAN_MODE_TRIGGER)) return planModeTurn(turn, mode);
  if (asked.includes(PLAN_CALL_ONLY_TRIGGER)) return silentExitPlan(turn, false);
  if (asked.includes(PLAN_FILE_TRIGGER)) return silentExitPlan(turn, true);
  if (!asked.includes(NATIVE_PLAN_TRIGGER)) return null;
  if (mode === 'plan') return planModeTurn(turn, mode);
  await turn.say(`Not in plan mode (${mode}).\n\n${FAKE_PLAN}`);
  return 'end_turn';
}

const LATEST_MESSAGE = 'Reply to the latest message:';
const REQUEST_SECTION = /## Request\n([\s\S]*?)(?:\n\n## |$)/;

export function currentRequest(prompt: readonly acp.ContentBlock[]): string {
  const last = prompt.findLast((block) => block.type === 'text');
  const text = (last?.type === 'text' ? last.text : '').split(LATEST_MESSAGE).at(-1)!;
  return REQUEST_SECTION.exec(text)?.[1] ?? text;
}

export async function planReplies(text: string, say: (chunk: string) => Promise<void>) {
  if (text.includes(PROPOSED_PLAN_TRIGGER)) {
    await say(
      `Here is my plan.\n\n<proposed_plan>\n${FAKE_PLAN}\n</proposed_plan>\n\nShall I go ahead?`,
    );
    return true;
  }
  if (text.includes(PLAN_REPLY_TRIGGER)) {
    await say(`${FAKE_PLAN}\n\nShall I go ahead?`);
    return true;
  }
  return false;
}
