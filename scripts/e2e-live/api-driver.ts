import { randomUUID } from 'node:crypto';
import {
  API_TOKEN_HEADER,
  modeForLegacy,
  type Approval,
  type BuildStyle,
} from '../../packages/contracts/src/index.ts';
import { balancedChoice, type UserChoice } from './balanced.ts';
import type { HarnessSetup } from './plan.ts';

export interface Chat {
  conversationId: string;
  projectId: string;
  repo: string;
}

export interface UiNote {
  at: string;
  kind: 'bug' | 'ux' | 'info';
  text: string;
  shot?: string;
}

export interface Answered {
  kind: string;
  label: string;
  via: 'ui' | 'api' | 'auto';
  why: string;
}

export interface TurnOutcome {
  runId: string;
  wallMs: number;
  timedOut: boolean;
  cancelledAtMs: number | null;
  answered: Answered[];
  notes: UiNote[];
}

export interface TurnOptions {
  timeoutMs: number;
  cancelAfterBuilderMs: number | null;
  builderStartedAt: (runId: string) => Promise<number | null>;
}

export class Api {
  constructor(
    readonly base: string,
    private readonly token: string,
  ) {}

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        [API_TOKEN_HEADER]: this.token,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(`${method} ${path} answered ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as T;
  }

  async linkProject(repo: string, buildStyle: BuildStyle, checks?: readonly string[]) {
    const project = await this.call<{ id: string }>('POST', '/projects', { rootPath: repo });
    if (buildStyle !== 'off') await this.call('PATCH', `/projects/${project.id}`, { buildStyle });
    if (checks) await this.call('PATCH', `/projects/${project.id}`, { checkCommands: checks });
    return project.id;
  }

  async pending(conversationId: string): Promise<Approval[]> {
    const detail = await this.call<{ approvals?: Approval[] }>(
      'GET',
      `/conversations/${conversationId}`,
    );
    return (detail.approvals ?? []).filter((approval) => approval.status === 'pending');
  }

  async decide(approval: Approval, choice: UserChoice): Promise<void> {
    await this.call('POST', `/approvals/${approval.id}/decision`, {
      optionId: choice.optionId,
      scope: choice.scope,
      payloadHash: approval.payloadHash,
    });
  }

  async finished(runId: string): Promise<boolean> {
    const run = await this.call<{ finishedAt?: string | null; status: string }>(
      'GET',
      `/runs/${runId}`,
    );
    return Boolean(run.finishedAt) || ['succeeded', 'failed', 'cancelled'].includes(run.status);
  }

  async cancel(runId: string): Promise<void> {
    await this.call('POST', `/runs/${runId}/cancel`, {});
  }

  async startFresh(conversationId: string): Promise<void> {
    await this.call('POST', `/conversations/${conversationId}/fresh-session`, {});
  }

  async orchestration(runId: string): Promise<unknown> {
    return this.call('GET', `/runs/${runId}/orchestration`).catch(() => null);
  }
}

export const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

export function chatSettings(setup: HarnessSetup) {
  const pinned = setup.model !== 'auto';
  if (!pinned && setup.chatModel) {
    return {
      provider: setup.provider,
      agentMode: modeForLegacy(setup.provider, 'do', setup.level),
      level: setup.level,
      routing: 'auto',
      model: setup.chatModel,
    };
  }
  return {
    provider: setup.provider,
    agentMode: modeForLegacy(setup.provider, 'do', setup.level),
    level: setup.level,
    routing: pinned ? 'pinned' : 'auto',
    ...(pinned ? { model: setup.model } : {}),
  };
}

export async function openApiChat(
  api: Api,
  repo: string,
  setup: HarnessSetup,
  checks?: readonly string[],
): Promise<Chat> {
  const projectId = await api.linkProject(repo, setup.buildStyle, checks);
  const conversationId = randomUUID();
  await api.call('PATCH', `/conversations/${conversationId}/settings`, {
    projectIds: [projectId],
    ...chatSettings(setup),
  });
  return { conversationId, projectId, repo };
}

export async function shouldCancel(outcome: TurnOutcome, options: TurnOptions): Promise<boolean> {
  if (options.cancelAfterBuilderMs === null || outcome.cancelledAtMs !== null) return false;
  const started = await options.builderStartedAt(outcome.runId);
  return started !== null && Date.now() - started >= options.cancelAfterBuilderMs;
}

export async function sendApiTurn(
  api: Api,
  chat: Chat,
  text: string,
  options: TurnOptions,
): Promise<TurnOutcome> {
  const started = Date.now();
  const sent = await api.call<{ run: { id: string } }>(
    'POST',
    `/conversations/${chat.conversationId}/messages`,
    { id: randomUUID(), content: text, source: 'e2e' },
  );
  const outcome: TurnOutcome = {
    runId: sent.run.id,
    wallMs: 0,
    timedOut: false,
    cancelledAtMs: null,
    answered: [],
    notes: [],
  };
  while (!(await api.finished(sent.run.id))) {
    for (const approval of await api.pending(chat.conversationId)) {
      const choice = balancedChoice(approval);
      if (choice.waitForAuto) continue;
      await api.decide(approval, choice);
      outcome.answered.push({
        kind: approval.kind,
        label: choice.label,
        via: 'api',
        why: choice.why,
      });
    }
    if (await shouldCancel(outcome, options)) {
      outcome.cancelledAtMs = Date.now() - started;
      await api.cancel(sent.run.id);
    }
    if (!outcome.timedOut && Date.now() - started > options.timeoutMs) {
      outcome.timedOut = true;
      await api.cancel(sent.run.id);
    }
    await sleep(500);
  }
  outcome.wallMs = Date.now() - started;
  return outcome;
}
