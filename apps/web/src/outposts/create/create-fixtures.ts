import type {
  Attachment,
  ProviderCapabilities,
  ProviderSetup,
  Project,
} from '@spark-outpost/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/client.ts';
import { setupKey } from '../../api/setup.ts';
import { API_CHAT, FE_CHAT, WEB_PROJECT, chat } from '../test-fixtures.ts';
import {
  emptyChat,
  type AgentChoice,
  type ChatDraft,
  type CreateDraft,
  type NewId,
} from './create-draft.ts';
import { agentView } from './create-labels.ts';
import type { CreateData } from './use-create-data.ts';

export const API_PROJECT = '0d000000-0000-4000-8000-000000000002';
export const CODEX: AgentChoice = { provider: 'codex', model: null, agentMode: 'agent' };

export function countingIds(): NewId {
  let next = 0;
  return () => {
    next += 1;
    return `0e000000-0000-4000-8000-${String(next).padStart(12, '0')}`;
  };
}

export function file(number: number, name = `file-${number}.md`): Attachment {
  return {
    id: `0f000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
    name,
    mediaType: 'text/markdown',
    size: 1200,
    kind: 'text',
  };
}

export function project(id: string, name: string): Project {
  return {
    id,
    name,
    rootPath: `/Users/maya/${name}`,
    displayPath: `~/${name}`,
    createdAt: '2026-10-09T10:00:00.000Z',
    commandAllowlist: [],
  };
}

export function existing(newId: NewId, chatId: string, handle: string): ChatDraft {
  return {
    ...emptyChat(CODEX, newId),
    chatId,
    handle,
    open: false,
    added: true,
    touched: true,
  };
}

export function fresh(newId: NewId, projectId: string | null, handle: string): ChatDraft {
  return {
    ...emptyChat(CODEX, newId),
    kind: 'new',
    projectId,
    handle,
    open: false,
    added: true,
    touched: true,
  };
}

export function draftOf(chats: ChatDraft[], name = 'Usage by user'): CreateDraft {
  return { name, chats };
}

export const CODEX_CAPABILITIES: ProviderCapabilities = {
  provider: 'codex',
  models: [{ id: 'gpt-5', label: 'GPT-5 (preview)', description: null }],
  efforts: [],
  defaultModel: 'gpt-5',
  modes: [
    { id: 'read-only', label: 'Read-only', description: 'Reads only.', kind: 'standard' },
    { id: 'agent', label: 'Approve for me', description: 'Asks when unsafe.', kind: 'auto_review' },
  ],
  defaultMode: 'agent',
  options: [],
  capturedAt: '2026-10-09T10:00:00.000Z',
};

const CODEX_SETUP = {
  id: 'codex',
  name: 'Codex',
  connection: { method: 'cli' },
} as unknown as ProviderSetup;

export function createData(overrides: Partial<CreateData> = {}): CreateData {
  const capabilitiesOf: CreateData['capabilitiesOf'] = (provider) =>
    provider === 'codex' ? CODEX_CAPABILITIES : undefined;
  return {
    chats: [
      chat(FE_CHAT, { title: 'Usage page', projectIds: [WEB_PROJECT] }),
      chat(API_CHAT, { title: 'Rate limit headers', projectIds: [API_PROJECT] }),
    ],
    projects: [project(WEB_PROJECT, 'web'), project(API_PROJECT, 'api')],
    projectNames: { [WEB_PROJECT]: 'web', [API_PROJECT]: 'api' },
    providers: [CODEX_SETUP],
    defaults: CODEX,
    level: 'full-auto',
    capabilitiesOf,
    loadingOf: () => false,
    agentOf: (draft) => (draft.kind === 'new' ? agentView(draft, capabilitiesOf('codex')) : null),
    ...overrides,
  };
}

export function seedCreateQueries(client: QueryClient): void {
  client.setQueryData(setupKey, { providers: [CODEX_SETUP] });
  client.setQueryData(['chat-defaults'], {
    provider: 'codex',
    model: null,
    effort: null,
    permission: null,
    agentMode: 'agent',
    level: 'full-auto',
    options: {},
    routing: 'auto',
  });
  client.setQueryData(queryKeys.capabilities('codex'), CODEX_CAPABILITIES);
}
