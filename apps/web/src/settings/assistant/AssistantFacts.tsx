import { useId } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AssistantFact } from '@spark-outpost/contracts';
import { assistantApi, assistantKeys } from '../../api/assistant.ts';
import { SettingRow } from '../SettingRow.tsx';

export const KEY_FACTS_LABEL = 'Key facts';

export function AssistantFacts({ facts }: { facts: AssistantFact[] }) {
  const hintId = useId();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: assistantApi.removeFact,
    onSuccess: (view) => queryClient.setQueryData(assistantKeys.settings, view),
  });
  const hint =
    remove.error?.message ??
    'Things you asked Ask Spark to remember, in your own words. They survive every new session.';
  return (
    <SettingRow label={KEY_FACTS_LABEL} hint={hint} hintId={hintId}>
      {facts.length === 0 ? (
        <span className="muted">None yet. Say “remember …” to add one.</span>
      ) : (
        <ul className="assistant-facts" aria-label="Key facts" aria-describedby={hintId}>
          {facts.map((fact) => (
            <li key={fact.id}>
              <span>{fact.text}</span>
              <button
                type="button"
                className="btn sm"
                aria-label={`Remove “${fact.text}”`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(fact.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </SettingRow>
  );
}
