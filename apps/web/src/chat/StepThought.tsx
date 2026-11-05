import { useQuery } from '@tanstack/react-query';
import { reasoningTextSchema } from '@spark-outpost/contracts';
import { request } from '../api/client.ts';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { thoughtText } from './thought-text.ts';

interface StepThoughtProps {
  id: string;
  runId: string;
  reasoningId: string;
  live: string | undefined;
  streaming: boolean;
}

export function StepThought({ id, runId, reasoningId, live, streaming }: StepThoughtProps) {
  const saved = useQuery({
    queryKey: ['reasoning', runId, reasoningId],
    queryFn: () => request(reasoningTextSchema, `/runs/${runId}/reasoning/${reasoningId}`),
    enabled: live === undefined,
    staleTime: Infinity,
  });
  const text = live ?? saved.data?.text;
  return (
    <div id={id} className="step-thought" role="group" aria-label="Thinking" tabIndex={0}>
      {text === undefined ? (
        <QueryWait query={saved} what="the thinking">
          <Skeleton label="Opening the thinking" shape="lines" rows={2} />
        </QueryWait>
      ) : text.trim() === '' && !streaming ? (
        'No thinking text was shared.'
      ) : (
        thoughtText(text)
      )}
    </div>
  );
}
