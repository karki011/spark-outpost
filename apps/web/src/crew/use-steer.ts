import { STEER_AUTO, type Orchestration, type SteerTarget } from '@spark-outpost/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { PickerChoice } from '../ui/ChoicePicker.tsx';
import { queryKeys } from '../api/client.ts';
import { taskApi } from '../tasks/task-api.ts';
import { steerablePieces, steerChoices } from './steer-targets.ts';

export interface SteerControl {
  choices: readonly PickerChoice[];
  target: SteerTarget;
  onTarget: (target: SteerTarget) => void;
  send: (text: string) => Promise<void>;
  status: string | null;
}

export function useSteer(
  conversationId: string,
  orchestration: Orchestration | null,
): SteerControl | null {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<SteerTarget>(STEER_AUTO);
  const steer = useMutation({
    mutationFn: ({ taskId, text }: { taskId: string; text: string }) =>
      taskApi.steer(taskId, { text, target }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) }),
  });
  const list = steerablePieces(orchestration);
  const taskId = orchestration?.taskId;
  if (!list || !taskId) return null;
  const choices = steerChoices(list);
  return {
    choices,
    target: choices.some((choice) => choice.id === target) ? target : STEER_AUTO,
    onTarget: setTarget,
    send: async (text) => {
      await steer.mutateAsync({ taskId, text });
    },
    status: steer.error?.message ?? steer.data?.reply ?? null,
  };
}
