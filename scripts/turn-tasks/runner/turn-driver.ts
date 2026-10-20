import { startStack, type Stack } from '../instance/stack.ts';
import { seedWorkspace } from '../instance/seed.ts';
import { AUTONOMY_LEVEL, type TurnDriver } from './driver.ts';
import { PROVIDER_SETUPS, type Provider } from './providers.ts';

export interface DriverChoice {
  provider: Provider;
  model: string;
  effort: string;
}

export interface DriverOptions extends DriverChoice {
  live: boolean;
  dir: string;
  slot: number;
}

export type DriverParts = Pick<Stack, 'api' | 'db' | 'close'>;

export function turnDriver(parts: DriverParts, choice: DriverChoice): TurnDriver {
  const { api } = parts;
  const { provider, model, effort } = choice;
  return {
    provider,
    db: parts.db,
    setupFor: (mode) => ({ model, effort, agentMode: PROVIDER_SETUPS[provider].modes[mode] }),
    async openChat(repo, setup) {
      const project = await api.call<{ id: string }>('POST', '/projects', { rootPath: repo });
      await api.call('PATCH', `/projects/${project.id}`, { workPlace: 'checkout' });
      const conversationId = crypto.randomUUID();
      await api.call('PATCH', `/conversations/${conversationId}/settings`, {
        projectIds: [project.id],
        provider,
        level: AUTONOMY_LEVEL,
        ...setup,
      });
      return { conversationId, repo };
    },
    async send(chat, text) {
      const sent = await api.call<{ run: { id: string } }>(
        'POST',
        `/conversations/${chat.conversationId}/messages`,
        { id: crypto.randomUUID(), content: text, source: 'bench' },
      );
      return sent.run.id;
    },
    finished: (runId) => api.finished(runId),
    pending: (chat) => api.pending(chat.conversationId),
    async decide(approval, optionId) {
      await api.call('POST', `/approvals/${approval.id}/decision`, {
        optionId,
        scope: 'once',
        payloadHash: approval.payloadHash,
      });
    },
    cancel: (runId) => api.cancel(runId),
    close: parts.close,
  };
}

export async function startTurnDriver(options: DriverOptions): Promise<TurnDriver> {
  const stack = await startStack({ live: options.live, dir: options.dir, slot: options.slot });
  try {
    await seedWorkspace(stack.db, options.provider, options.model);
  } catch (error) {
    await stack.close();
    throw error;
  }
  return turnDriver(stack, options);
}
