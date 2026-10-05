import '../composer/unusable-model.css';
import { useQuery } from '@tanstack/react-query';
import { pushActivityTitle, pushNoticesSchema, type PushNotice } from '@spark-outpost/contracts';
import { queryKeys, request } from '../../api/client.ts';

const pushesQuery = (conversationId: string) => ({
  queryKey: [...queryKeys.conversation(conversationId), 'pushes'] as const,
  queryFn: () => request(pushNoticesSchema, `/conversations/${conversationId}/pushes`),
});

interface PushNoticesProps {
  conversationId: string;
  runIds: readonly string[];
}

function stopped(pushes: readonly PushNotice[], runIds: readonly string[]): PushNotice[] {
  return pushes.filter((push) => push.outcome !== 'pushed' && runIds.includes(push.runId));
}

export function PushNotices({ conversationId, runIds }: PushNoticesProps) {
  const pushes = useQuery({
    ...pushesQuery(conversationId),
    select: (list) => stopped(list.pushes, runIds),
    notifyOnChangeProps: ['data'],
  });
  const shown = pushes.data ?? [];
  if (shown.length === 0) return null;
  return (
    <>
      {shown.map((push) => (
        <div key={push.id} className="push-notice">
          <p className="ai-note" role="status">
            {pushActivityTitle(push)}. Nothing was pushed.
          </p>
          {push.output && (
            <details className="error-details">
              <summary>Last lines of the output, secrets hidden</summary>
              <pre>{push.output}</pre>
            </details>
          )}
        </div>
      ))}
    </>
  );
}
