import {
  assistantEventsSchema,
  assistantHistorySchema,
  assistantSettingsViewSchema,
  usageSummarySchema,
  type AssistantEvent,
  type AssistantHistory,
  type AssistantSettings,
  type AssistantSettingsView,
  type UsageSummary,
} from '@spark-outpost/contracts';
import { request } from './client.ts';

export const assistantKeys = {
  settings: ['spark-assistant', 'settings'] as const,
  events: ['spark-assistant', 'events'] as const,
  history: ['spark-assistant', 'history'] as const,
  usage: ['usage-summary', 'assistant'] as const,
};

export const assistantApi = {
  settings: (): Promise<AssistantSettingsView> =>
    request(assistantSettingsViewSchema, '/spark-assistant/settings'),
  save: (settings: AssistantSettings): Promise<AssistantSettingsView> =>
    request(assistantSettingsViewSchema, '/spark-assistant/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  clear: (facts: boolean): Promise<AssistantSettingsView> =>
    request(assistantSettingsViewSchema, '/spark-assistant/clear', {
      method: 'POST',
      body: JSON.stringify({ facts }),
    }),
  newTopic: (): Promise<AssistantSettingsView> =>
    request(assistantSettingsViewSchema, '/spark-assistant/topic', { method: 'POST', body: '{}' }),
  history: (before: string | null): Promise<AssistantHistory> =>
    request(
      assistantHistorySchema,
      `/spark-assistant/history${before ? `?before=${encodeURIComponent(before)}` : ''}`,
    ),
  removeFact: (id: string): Promise<AssistantSettingsView> =>
    request(assistantSettingsViewSchema, `/spark-assistant/facts/${id}`, { method: 'DELETE' }),
  events: (): Promise<AssistantEvent[]> =>
    request(assistantEventsSchema, '/spark-assistant/events').then((result) => result.events),
  usage: (): Promise<UsageSummary> => request(usageSummarySchema, '/usage/summary?scope=assistant'),
};
