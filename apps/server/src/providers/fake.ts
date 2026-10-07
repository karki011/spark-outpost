import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { PlanEntry, TokenUsage } from '@spark-outpost/contracts';
import type {
  Provider,
  ProviderCapabilityReport,
  ProviderOutput,
  ProviderTurn,
  TurnAttachment,
} from './provider.ts';
import { ModelRejectedError, ProviderError } from './provider.ts';
import { followedFiles } from '../agent-config/instructions.ts';
import { fakeApprovalTurn, wantsApproval } from './fake-approvals.ts';
import { fakePublishTurn, wantsPublish } from './fake-publish.ts';
import { editStreamPlan, fakeEditStream } from './fake-edit-stream.ts';
import { commandPlan, fakeCommandTurn } from './fake-commands.ts';
import { ZAI_EFFORTS, ZAI_MODELS } from '../agents/acp/zai.ts';
import {
  fakeCompactOutputs,
  fakeCompactTurn,
  fakeSessionOutputs,
  withFakeContext,
} from './fake-context.ts';

export const FAKE_PROVIDER_NAME = 'fake';
const FAKE_FAILURE_TRIGGER = '#fail';
export const FAKE_REJECTED_MODEL = 'gpt-6.1-sol';
export const FAKE_REJECTION_BODY = `{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The '${FAKE_REJECTED_MODEL}' model is not supported when using Codex with a ChatGPT account."}}`;
const FAKE_PLAN_TRIGGER = '#plan';
const FAKE_TITLE_TRIGGER = '#title';
export const FAKE_TITLE = 'Tidy the fake reply';
export const FAKE_PR_URL = 'https://github.com/spark-outpost/demo/pull/42';
const FAKE_PLAN_STEPS = ['Read the request', 'Look through the code', 'Write the answer'];
export const FAKE_COST_USD = 0.0042;
export const FAKE_TOKENS: TokenUsage = {
  input: 900,
  output: 300,
  total: 1200,
  cachedRead: 600,
  cachedWrite: null,
  thought: 80,
};

export interface FakeProviderTiming {
  stepMs: number;
  wordMs: number;
}

const defaultTiming: FakeProviderTiming = { stepMs: 400, wordMs: 40 };

type NamedAttachment = Pick<TurnAttachment, 'name'>;

export function fakeReply(
  prompt: string,
  attachments: readonly NamedAttachment[] = [],
  projectRoots: readonly string[] = [],
): string {
  const parts = [
    `This reply comes from the fake provider, which echoes your message so the pipeline can be tested without a real model. You wrote: "${prompt.trim()}"`,
  ];
  if (attachments.length > 0) {
    parts.push(`Attachments: ${attachments.map((attachment) => attachment.name).join(', ')}.`);
  }
  if (projectRoots.length > 0) {
    parts.push(`Repos: ${projectRoots.map((root) => path.basename(root)).join(', ')}.`);
  }
  return parts.join(' ');
}

function attachmentSteps(attachments: readonly NamedAttachment[]): ProviderOutput[] {
  if (attachments.length === 0) return [];
  const name = `Reading ${attachments.length} ${attachments.length === 1 ? 'attachment' : 'attachments'}`;
  return [
    { kind: 'step_started', name },
    { kind: 'step_finished', name },
  ];
}

function replyOutputs(reply: string): ProviderOutput[] {
  return [
    ...reply.split(/(?<=\s)/).map((delta): ProviderOutput => ({ kind: 'text_delta', delta })),
    { kind: 'usage', contextUsed: 12_000, contextSize: 200_000, costUsd: FAKE_COST_USD },
    { kind: 'tokens', tokens: FAKE_TOKENS },
  ];
}

const planUpdate = (done: number): ProviderOutput => ({
  kind: 'plan',
  entries: FAKE_PLAN_STEPS.map((content, index): PlanEntry => ({
    content,
    priority: index === 0 ? 'high' : index === 2 ? 'low' : 'medium',
    status: index < done ? 'completed' : index === done ? 'in_progress' : 'pending',
  })),
});

function planSteps(prompt: string): ProviderOutput[] {
  if (!prompt.includes(FAKE_PLAN_TRIGGER)) return [];
  const tool = 'Searched the code';
  return [
    planUpdate(0),
    planUpdate(1),
    { kind: 'step_started', name: tool, tool: true },
    { kind: 'step_finished', name: tool },
    planUpdate(3),
  ];
}

export const FAKE_THOUGHT = ['First I read the message.\n', 'Then I plan a short reply.'];

function thinkingSteps(prompt: string): ProviderOutput[] {
  if (!prompt.includes('#think')) return [];
  return [
    { kind: 'step_started', name: 'Thinking' },
    ...FAKE_THOUGHT.map((delta): ProviderOutput => ({ kind: 'thought_delta', delta })),
    { kind: 'step_finished', name: 'Thinking' },
  ];
}

function planReply(prompt: string): string {
  return prompt.includes(FAKE_PLAN_TRIGGER) ? ` Opened a draft pull request: ${FAKE_PR_URL}` : '';
}

export function fakeProviderPlan(
  prompt: string,
  attachments: readonly NamedAttachment[] = [],
  projectRoots: readonly string[] = [],
): ProviderOutput[] {
  const reply = fakeReply(prompt, attachments, projectRoots) + planReply(prompt);
  return [
    { kind: 'step_started', name: 'Reading your message' },
    { kind: 'step_finished', name: 'Reading your message' },
    ...attachmentSteps(attachments),
    ...thinkingSteps(prompt),
    ...planSteps(prompt),
    { kind: 'step_started', name: 'Writing a reply' },
    { kind: 'step_finished', name: 'Writing a reply' },
    ...replyOutputs(reply),
  ];
}

const FAKE_DIGEST_TRIGGER = '<activity>';
export const FAKE_UNKNOWN_CHAT = '00000000-0000-4000-8000-00000000dead';

interface FakeDigestChat {
  id: string;
  title: string;
  unfinished: string[];
}

interface FakeDigestData {
  days?: { threads: { chats: FakeDigestChat[] }[] }[];
  flagged?: { itemId: string; key: string; flags: { text: string }[] }[];
}

function digestData(prompt: string): FakeDigestData {
  const start = prompt.lastIndexOf('<activity>\n');
  const end = prompt.lastIndexOf('\n</activity>');
  const block = start >= 0 && end > start ? prompt.slice(start + 11, end) : '{}';
  return JSON.parse(block) as FakeDigestData;
}

export const FAKE_UNKNOWN_ITEM = 'ticket:linear:FAKE-404';

function fakeBriefItems(data: FakeDigestData) {
  return [
    ...(data.flagged ?? []).map((item) => ({
      itemId: item.itemId,
      text: `Handle ${item.key}: ${item.flags[0]?.text ?? 'flagged'}.`,
    })),
    { itemId: FAKE_UNKNOWN_ITEM, text: 'Made up.' },
  ];
}

function fakeDigestReply(prompt: string): string {
  const data = digestData(prompt);
  const chats = (data.days ?? []).flatMap((day) => day.threads.flatMap((thread) => thread.chats));
  const first = chats[0];
  const open = chats.find((chat) => chat.unfinished.length > 0);
  return JSON.stringify({
    lines: [
      {
        text: first ? `Today you worked on ${first.title}.` : 'Today was quiet.',
        chatId: first?.id ?? null,
      },
      { text: 'This line points at a chat that does not exist.', chatId: FAKE_UNKNOWN_CHAT },
    ],
    suggestions: [
      ...(open
        ? [
            {
              chatId: open.id,
              reason: `Unfinished: ${open.unfinished.join(', ')}.`,
              draft: `Let's continue ${open.title}: pick up the open step and finish it.`,
            },
          ]
        : []),
      { chatId: FAKE_UNKNOWN_CHAT, reason: 'Made up.', draft: 'Made up.' },
    ],
    items: fakeBriefItems(data),
  });
}

export function fakeCapabilities(provider?: string): ProviderCapabilityReport {
  if (provider === 'zai') return fakeZaiCapabilities();
  return {
    models: [
      { id: 'fake-fast', label: 'Fake Fast', description: 'Quick test replies' },
      { id: 'fake-deep', label: 'Fake Deep', description: 'Slower test replies' },
    ],
    efforts: [
      { id: 'low', label: 'Low', description: 'Quick replies' },
      { id: 'medium', label: 'Medium', description: 'Balanced' },
      { id: 'high', label: 'High', description: 'Thinks longer' },
    ],
    defaultModel: 'fake-fast',
    modes: fakeModes(provider),
    defaultMode: provider === 'codex' ? 'agent' : 'default',
    options: [],
  };
}

const mode = (id: string, label: string, description: string, kind: string) => ({
  id,
  label,
  description,
  kind,
});

export const FAKE_CLAUDE_MODES = [
  mode('default', 'Manual', 'Always ask before making changes', 'standard'),
  mode('acceptEdits', 'Accept edits', 'Automatically accept all file edits', 'standard'),
  mode('plan', 'Plan', 'Create a plan before making changes', 'plan'),
  mode('auto', 'Auto', 'Claude handles permission decisions', 'auto_review'),
  mode('bypassPermissions', 'Bypass permissions', 'Accepts all permissions', 'full_access'),
];

export const FAKE_CODEX_MODES = [
  mode(
    'read-only',
    'Read-only',
    'Requires approval to edit files and access the internet.',
    'standard',
  ),
  mode(
    'ask-every-action',
    'Ask every time',
    'Asks before every command and every file change. Commands run in a workspace-write sandbox without network.',
    'standard',
  ),
  mode(
    'agent',
    'Approve for me',
    'Only ask for actions detected as potentially unsafe',
    'auto_review',
  ),
  mode(
    'agent-full-access',
    'Full access',
    'Unrestricted access to the internet and any file on your computer',
    'full_access',
  ),
];

function fakeModes(provider: string | undefined) {
  return provider === 'codex' ? FAKE_CODEX_MODES : FAKE_CLAUDE_MODES;
}

function fakeZaiCapabilities(): ProviderCapabilityReport {
  return {
    models: ZAI_MODELS.map((model) => ({
      id: model.slot,
      label: model.label,
      description: model.description,
    })),
    efforts: ZAI_EFFORTS.map((id) => ({
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
      description: null,
    })),
    defaultModel: ZAI_MODELS[0]?.slot ?? null,
    modes: FAKE_CLAUDE_MODES,
    defaultMode: 'default',
    options: [],
  };
}

export function createFakeProvider(timing: FakeProviderTiming = defaultTiming): Provider {
  return {
    name: FAKE_PROVIDER_NAME,
    async *run(turn: ProviderTurn) {
      for await (const output of fakeTurn(turn, timing)) {
        turn.observe?.(output);
        yield output;
      }
    },
  };
}

async function* fakeTurn(
  turn: ProviderTurn,
  timing: FakeProviderTiming,
): AsyncGenerator<ProviderOutput> {
  if (turn.settings.model === FAKE_REJECTED_MODEL) {
    throw new ModelRejectedError('The fake provider', FAKE_REJECTED_MODEL, FAKE_REJECTION_BODY);
  }
  if (turn.prompt.includes(FAKE_FAILURE_TRIGGER)) {
    await delay(timing.stepMs, undefined, { signal: turn.signal });
    throw new ProviderError(
      'The fake provider failed on purpose because the message contains #fail.',
    );
  }
  if (wantsPublish(turn.prompt)) {
    yield* fakePublishTurn(turn);
    return;
  }
  if (wantsApproval(turn.prompt)) {
    await delay(timing.stepMs, undefined, { signal: turn.signal });
    yield* fakeApprovalTurn(turn);
    return;
  }
  const commands = commandPlan(turn.prompt);
  if (commands) {
    yield* fakeCommandTurn(turn, commands);
    return;
  }
  const editStream = editStreamPlan(turn.prompt);
  if (editStream) {
    yield* fakeEditStream(turn, editStream);
    return;
  }
  yield* fakeSessionOutputs(turn);
  if (fakeCompactTurn(turn)) {
    yield* fakeCompactOutputs(turn);
    return;
  }
  if (turn.repo) yield { kind: 'instructions', files: followedFiles(turn.repo) };
  const titled = turn.askTitle && turn.prompt.includes(FAKE_TITLE_TRIGGER);
  const outputs = (
    turn.prompt.includes(FAKE_DIGEST_TRIGGER)
      ? replyOutputs(fakeDigestReply(turn.prompt))
      : fakeProviderPlan(turn.prompt, turn.attachments, turn.projectRoots)
  ).map((output) => withFakeContext(turn, output));
  if (titled) outputs.push({ kind: 'text_delta', delta: `\n\nTitle: ${FAKE_TITLE}` });
  for (const output of outputs) {
    const wait =
      output.kind === 'step_started' || output.kind === 'step_finished' || output.kind === 'plan'
        ? timing.stepMs
        : timing.wordMs;
    await delay(wait, undefined, { signal: turn.signal });
    yield output;
  }
}
