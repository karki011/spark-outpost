import { useQuery } from '@tanstack/react-query';
import { subagentUsageParts, type SubagentRow } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';

interface SubagentCostsProps {
  conversationId: string;
  runIds: readonly string[];
}

function durationOf(row: SubagentRow): number | null {
  return row.startedAt !== null && row.endedAt !== null ? row.endedAt - row.startedAt : null;
}

export function SubagentCosts({ conversationId, runIds }: SubagentCostsProps) {
  const detail = useQuery({
    queryKey: queryKeys.conversation(conversationId),
    queryFn: () => api.getConversation(conversationId),
  });
  const rows = runIds.flatMap((runId) => detail.data?.subagents?.[runId] ?? []);
  if (rows.length === 0) return null;
  return (
    <>
      <div className="wsec-h cost-h">
        <h3>Sub-agents</h3>
      </div>
      <ul className="cost-subagents" aria-label="Usage by sub-agent">
        {rows.map((row) => (
          <li key={row.id}>
            <b>{row.name}</b>
            <span>
              {subagentUsageParts(row, durationOf(row)).join(' · ') || 'No usage reported'}
            </span>
          </li>
        ))}
      </ul>
      <p className="wnote">
        As each agent reported it, and already part of the totals above. A cost shows only when the
        agent reports the model and the token split.
      </p>
    </>
  );
}
