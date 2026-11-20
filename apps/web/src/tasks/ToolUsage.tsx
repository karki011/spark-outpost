import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '../api/client.ts';
import { formatElapsed } from '../ui/elapsed.ts';
import { stepsOfRuns, toolUsage, type UsageRow } from './tool-usage.ts';

const SHOWN = 8;

interface ToolUsageProps {
  conversationId: string;
  runIds: readonly string[];
}

function usageText(row: UsageRow): string {
  const calls = `${row.calls} ${row.calls === 1 ? 'call' : 'calls'}`;
  return row.ms > 0 ? `${calls} · ${formatElapsed(row.ms)}` : calls;
}

function Rows({ rows }: { rows: readonly UsageRow[] }) {
  return rows.map((row) => (
    <li key={row.key}>
      <b title={row.key}>{row.label}</b>
      <span>{usageText(row)}</span>
    </li>
  ));
}

function UsageList({ title, rows }: { title: string; rows: readonly UsageRow[] }) {
  if (rows.length === 0) return null;
  const rest = rows.slice(SHOWN);
  return (
    <>
      <div className="wsec-h cost-h">
        <h3>{title}</h3>
      </div>
      <ul className="cost-subagents" aria-label={title}>
        <Rows rows={rows.slice(0, SHOWN)} />
      </ul>
      {rest.length > 0 && (
        <details className="cost-more">
          <summary>{`${rest.length} more`}</summary>
          <ul className="cost-subagents" aria-label={`${title}, more`}>
            <Rows rows={rest} />
          </ul>
        </details>
      )}
    </>
  );
}

export function ToolUsage({ conversationId, runIds }: ToolUsageProps) {
  const detail = useQuery({
    queryKey: queryKeys.conversation(conversationId),
    queryFn: () => api.getConversation(conversationId),
  });
  const usage = toolUsage(stepsOfRuns(detail.data?.activity, runIds));
  if (usage.tools.length === 0) return null;
  return (
    <section className="cost-tools" aria-label="Tool use">
      <UsageList title="By tool" rows={usage.tools} />
      <UsageList title="By MCP server" rows={usage.servers} />
      <UsageList title="By skill" rows={usage.skills} />
      <p className="wnote">
        Calls and time each tool ran, as the agent reported its steps. Providers don’t report cost
        per tool, so none is shown, and calls that ran side by side overlap in time.
      </p>
    </section>
  );
}
