import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ConversationDetail,
  ProviderCapabilities,
  UpdateChatSettingsRequest,
} from '@spark-outpost/contracts';
import { api, queryKeys } from '../../api/client.ts';
import { selectableEfforts, shortLabel } from './model-options.ts';
import type { PickerSection } from './PickerNav.tsx';

export interface PickerRequest {
  section: PickerSection;
  id: number;
}

export function useChatSettingsUpdate(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: UpdateChatSettingsRequest) =>
      api.updateChatSettings(conversationId, change),
    onSuccess: (next) =>
      queryClient.setQueryData<ConversationDetail>(
        queryKeys.conversation(conversationId),
        (detail) => (detail ? { ...detail, settings: next } : detail),
      ),
  });
}

interface PickerCommandOptions {
  conversationId: string;
  capabilities: ProviderCapabilities | undefined;
  agentName: string;
  notify: (message: string) => void;
}

export function usePickerCommand({
  conversationId,
  capabilities,
  agentName,
  notify,
}: PickerCommandOptions) {
  const [request, setRequest] = useState<PickerRequest | null>(null);
  const update = useChatSettingsUpdate(conversationId);

  const run = (section: 'model' | 'effort', value: string) => {
    const wanted = value.trim().toLowerCase();
    const options =
      section === 'effort' ? selectableEfforts(capabilities) : (capabilities?.models ?? []);
    const match = wanted
      ? options.find(
          (option) =>
            option.id.toLowerCase() === wanted || shortLabel(option.label).toLowerCase() === wanted,
        )
      : undefined;
    if (match && section === 'effort') {
      update.mutate({ effort: match.id });
      notify(`Effort set to ${match.label}.`);
      return;
    }
    if (match) {
      update.mutate({ model: match.id, routing: 'pinned' });
      notify(`Model set to ${shortLabel(match.label)}.`);
      return;
    }
    if (wanted) notify(`${agentName} doesn't offer "${value}".`);
    setRequest({ section, id: (request?.id ?? 0) + 1 });
  };

  return { request, run };
}
