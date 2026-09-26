import { z } from 'zod';
import {
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

  constructor(status: number, message: string, url: string | null = null) {
    super(message);
    this.status = status;
    this.url = url;
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
    throw new ApiError(response.status, message, url);
  }
  return schema.parse(payload);
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
  deleteConversation: (id: string): Promise<null> =>
    request(z.null(), `/conversations/${id}`, { method: 'DELETE', keepalive: true }),
  getConversation: (id: string): Promise<ConversationDetail> =>
    request(conversationDetailSchema, `/conversations/${id}`).catch(async (error: unknown) => {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      return draftConversation(id, await api.getChatDefaults());
    }),
  getChatDefaults: (): Promise<ChatSettings> =>
    request(chatSettingsSchema, '/chat-settings/defaults'),
  sendMessage: (
    conversationId: string,
    id: string,
    content: string,
    attachmentIds: string[] = [],
  ): Promise<SendMessageResponse> =>
    request(sendMessageResponseSchema, `/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ id, content, attachmentIds }),
    }),
  cancelRun: (runId: string): Promise<Run> =>
    request(runSchema, `/runs/${runId}/cancel`, { method: 'POST', body: '{}' }),
  updateChatSettings: (
    conversationId: string,
    update: UpdateChatSettingsRequest,
  ): Promise<ChatSettings> =>
    request(chatSettingsSchema, `/conversations/${conversationId}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    }),
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
  conversationSearch: (query: string) => ['conversation-search', query] as const,
  capabilities: (provider: ProviderId) => ['capabilities', provider] as const,
  usageSummary: ['usage-summary'] as const,
};
