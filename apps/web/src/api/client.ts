import { z } from 'zod';
import {
  agentCommandsResponseSchema,
  annotationListSchema,
  type AgentCommandsResponse,
  type AnnotationInput,
  type MessageAnnotation,
  type StartAs,
  EMPTY_CONVERSATION_USAGE,
  UNTITLED_CONVERSATION,
  usageSummarySchema,
  type UsageSummary,
  chatSettingsSchema,
  providerCapabilitiesSchema,
  type ChatSettings,
  type ProviderCapabilities,
  type ProviderId,
  type UpdateChatSettingsRequest,
  type UpdateConversationRequest,
  conversationDetailSchema,
  conversationSummarySchema,
  runSchema,
  sendMessageResponseSchema,
  type ConversationDetail,
  type ConversationSummary,
  type Run,
  type SendMessageResponse,
} from '@spark-outpost/contracts';

export class ApiError extends Error {
  readonly status: number;
  readonly url: string | null;
  readonly body: unknown;

  constructor(status: number, message: string, url: string | null = null, body: unknown = null) {
    super(message);
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

async function send(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch (cause) {
    if (init?.signal?.aborted) throw cause;
    throw new ApiError(0, 'The server could not be reached.', url);
  }
}

export async function request<T>(
  schema: z.ZodType<T>,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `/api${path}`;
  const response = await send(url, init);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `The server responded with ${response.status}.`;
    throw new ApiError(response.status, message, url, payload);
  }
  return schema.parse(payload);
}

const drafts = new Set<string>();

export function newDraftId(): string {
  const id = crypto.randomUUID();
  drafts.add(id);
  return id;
}

export function forgetDraft(conversationId: string): void {
  drafts.delete(conversationId);
}

function saved<T>(conversationId: string): (result: T) => T {
  return (result) => {
    drafts.delete(conversationId);
    return result;
  };
}

export const api = {
  health: (): Promise<{ ok: boolean }> => request(z.object({ ok: z.boolean() }), '/health'),
  listConversations: (): Promise<ConversationSummary[]> =>
    request(z.array(conversationSummarySchema), '/conversations'),
  searchConversations: (query: string, signal?: AbortSignal): Promise<ConversationSummary[]> =>
    request(
      z.array(conversationSummarySchema),
      `/conversations?${new URLSearchParams({ q: query }).toString()}`,
      { signal: signal ?? null },
    ),
  orderPinned: (conversationIds: string[]): Promise<null> =>
    request(z.null(), '/conversations/pinned-order', {
      method: 'PUT',
      body: JSON.stringify({ conversationIds }),
    }),
  updateConversation: (
    id: string,
    update: UpdateConversationRequest,
  ): Promise<ConversationSummary> =>
    request(conversationSummarySchema, `/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    }),
  markConversationRead: (id: string): Promise<null> =>
    request(z.null(), `/conversations/${id}/read`, { method: 'POST', body: '{}' }),
  startFreshSession: (id: string): Promise<{ closed: number }> =>
    request(z.object({ closed: z.number() }), `/conversations/${id}/fresh-session`, {
      method: 'POST',
      body: '{}',
    }),
  getAgentCommands: async (id: string): Promise<AgentCommandsResponse> => {
    if (drafts.has(id)) return { provider: null, commands: [] };
    return request(agentCommandsResponseSchema, `/conversations/${id}/agent-commands`);
  },
  deleteConversation: (id: string): Promise<null> =>
    request(z.null(), `/conversations/${id}`, { method: 'DELETE', keepalive: true }),
  getConversation: async (id: string): Promise<ConversationDetail> => {
    if (drafts.has(id)) return draftConversation(id, await api.getChatDefaults());
    return request(conversationDetailSchema, `/conversations/${id}`).catch(
      async (error: unknown) => {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        return draftConversation(id, await api.getChatDefaults());
      },
    );
  },
  getChatDefaults: (): Promise<ChatSettings> =>
    request(chatSettingsSchema, '/chat-settings/defaults'),
  sendMessage: (
    conversationId: string,
    id: string,
    content: string,
    attachmentIds: string[] = [],
    annotations: AnnotationInput[] = [],
    startAs: StartAs | null = null,
  ): Promise<SendMessageResponse> =>
    request(sendMessageResponseSchema, `/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        id,
        content,
        attachmentIds,
        annotations,
        source: 'ui',
        ...(startAs ? { startAs } : {}),
      }),
    }).then(saved(conversationId)),
  listAnnotations: async (conversationId: string): Promise<MessageAnnotation[]> => {
    if (drafts.has(conversationId)) return [];
    const list = await request(
      annotationListSchema,
      `/conversations/${conversationId}/annotations`,
    );
    return list.annotations;
  },
  cancelRun: (runId: string, signal?: AbortSignal): Promise<Run> =>
    request(runSchema, `/runs/${runId}/cancel`, {
      method: 'POST',
      body: '{}',
      ...(signal ? { signal } : {}),
    }),
  updateChatSettings: (
    conversationId: string,
    update: UpdateChatSettingsRequest,
  ): Promise<ChatSettings> =>
    request(chatSettingsSchema, `/conversations/${conversationId}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    }).then(saved(conversationId)),
  getCapabilities: (provider: ProviderId): Promise<ProviderCapabilities> =>
    request(providerCapabilitiesSchema, `/providers/${provider}/capabilities`),
  getUsageSummary: (): Promise<UsageSummary> => request(usageSummarySchema, '/usage/summary'),
};

function draftConversation(id: string, settings: ChatSettings): ConversationDetail {
  return {
    conversation: {
      id,
      title: UNTITLED_CONVERSATION,
      updatedAt: new Date().toISOString(),
      projectIds: [],
      latestRun: null,
      archivedAt: null,
      pinnedAt: null,
      pinnedOrder: null,
      projectOrder: null,
      unread: false,
      needsInput: false,
      attention: null,
      titleSource: 'message',
      category: null,
    },
    messages: [],
    runs: [],
    activity: {},
    settings,
    usageTotals: EMPTY_CONVERSATION_USAGE,
    tasks: [],
    approvals: [],
  };
}

export const queryKeys = {
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversations', id] as const,
  agentCommands: (id: string) => ['conversations', id, 'agent-commands'] as const,
  annotations: (id: string) => ['conversations', id, 'annotations'] as const,
  conversationSearches: ['conversation-search'] as const,
  conversationSearch: (query: string) => ['conversation-search', query] as const,
  allCapabilities: ['capabilities'] as const,
  capabilities: (provider: ProviderId) => ['capabilities', provider] as const,
  usageSummary: ['usage-summary'] as const,
};

export const CAPABILITIES_STALE_MS = 60 * 60 * 1000;

export function capabilitiesQuery(provider: ProviderId) {
  return {
    queryKey: queryKeys.capabilities(provider),
    queryFn: () => api.getCapabilities(provider),
  };
}
