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

interface Steer {
  runId: string;
  taskId: string;
  text: string;
  target: SteerTarget;
}

export function useSteer(
  conversationId: string,
  orchestration: Orchestration | null,
): SteerControl | null {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<{ runId: string; target: SteerTarget } | null>(null);
  const steer = useMutation({
    mutationFn: ({ taskId, text, target }: Steer) => taskApi.steer(taskId, { text, target }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) }),
  });
  const list = steerablePieces(orchestration);
  const taskId = orchestration?.taskId;
  if (!orchestration || !list || !taskId) return null;
  const { runId } = orchestration;
  const choices = steerChoices(list);
  const wanted = picked?.runId === runId ? picked.target : STEER_AUTO;
  const target = choices.some((choice) => choice.id === wanted) ? wanted : STEER_AUTO;
  const current = steer.variables?.runId === runId;
  return {
    choices,
    target,
    onTarget: (next) => setPicked({ runId, target: next }),
    send: async (text) => {
      await steer.mutateAsync({ runId, taskId, text, target });
    },
    status: current ? (steer.error?.message ?? steer.data?.reply ?? null) : null,
  };
}
