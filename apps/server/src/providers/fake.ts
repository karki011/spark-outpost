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
import { ProviderError } from './provider.ts';
import { fakeApprovalTurn, wantsApproval } from './fake-approvals.ts';
import { ZAI_EFFORTS, ZAI_MODELS } from '../agents/acp/zai.ts';

export const FAKE_PROVIDER_NAME = 'fake';
export const FAKE_FAILURE_TRIGGER = '#fail';
export const FAKE_PLAN_TRIGGER = '#plan';
export const FAKE_TITLE_TRIGGER = '#title';
export const FAKE_TITLE = 'Tidy the fake reply';
export const FAKE_PR_URL = 'https://github.com/spark-outpost/demo/pull/42';
export const FAKE_PLAN_STEPS = ['Read the request', 'Look through the code', 'Write the answer'];
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

function planReply(prompt: string): string {
  return prompt.includes(FAKE_PLAN_TRIGGER) ? ` Opened a draft pull request: ${FAKE_PR_URL}` : '';
}

export function fakeProviderPlan(
  prompt: string,
  attachments: readonly NamedAttachment[] = [],
  projectRoots: readonly string[] = [],
): ProviderOutput[] {
  const reply = fakeReply(prompt, attachments, projectRoots) + planReply(prompt);
  const words = reply.split(/(?<=\s)/);
  return [
    { kind: 'step_started', name: 'Reading your message' },
    { kind: 'step_finished', name: 'Reading your message' },
    ...attachmentSteps(attachments),
    ...planSteps(prompt),
    { kind: 'step_started', name: 'Writing a reply' },
    { kind: 'step_finished', name: 'Writing a reply' },
    ...words.map((delta): ProviderOutput => ({ kind: 'text_delta', delta })),
    { kind: 'usage', contextUsed: 12_000, contextSize: 200_000, costUsd: FAKE_COST_USD },
    { kind: 'tokens', tokens: FAKE_TOKENS },
  ];
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
  };
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
  };
}

export function createFakeProvider(timing: FakeProviderTiming = defaultTiming): Provider {
  return {
    name: FAKE_PROVIDER_NAME,
    async *run(turn: ProviderTurn) {
      if (turn.prompt.includes(FAKE_FAILURE_TRIGGER)) {
        await delay(timing.stepMs, undefined, { signal: turn.signal });
        throw new ProviderError(
          'The fake provider failed on purpose because the message contains #fail.',
        );
      }
      if (wantsApproval(turn.prompt)) {
        await delay(timing.stepMs, undefined, { signal: turn.signal });
        yield* fakeApprovalTurn(turn);
        return;
      }
      const titled = turn.askTitle && turn.prompt.includes(FAKE_TITLE_TRIGGER);
      const outputs = fakeProviderPlan(turn.prompt, turn.attachments, turn.projectRoots);
      if (titled) outputs.push({ kind: 'text_delta', delta: `\n\nTitle: ${FAKE_TITLE}` });
      for (const output of outputs) {
        const wait =
          output.kind === 'step_started' ||
          output.kind === 'step_finished' ||
          output.kind === 'plan'
            ? timing.stepMs
            : timing.wordMs;
        await delay(wait, undefined, { signal: turn.signal });
        yield output;
      }
    },
  };
}
