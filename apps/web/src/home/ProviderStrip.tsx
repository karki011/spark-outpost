import { useQueries, useQuery } from '@tanstack/react-query';
import type { ProviderId } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { setupApi, setupKey } from '../api/setup.ts';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import { relativeTime } from '../ui/relative-time.ts';
import { useTooltip } from '../ui/Tooltip.tsx';
import { homeApi, homeKeys } from './home-api.ts';
import {
  modelLabel,
  problemText,
  statusOf,
  stripLabel,
  type ProviderStatus,
  type StripItem,
} from './provider-status.ts';

function StatusMark({ status }: { status: ProviderStatus }) {
  return (
    <svg
      className={`ps-mark ${status}`}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      {status === 'ok' && <circle cx="6" cy="6" r="5" />}
      {status === 'warn' && <path d="M6 1 11 10.5H1Z" />}
      {status === 'off' && <circle cx="6" cy="6" r="4" fill="none" strokeWidth="2" />}
    </svg>
  );
}

function StripButton({ item, onOpen }: { item: StripItem; onOpen: () => void }) {
  const label = stripLabel(item);
  const { triggerProps, tooltip } = useTooltip(label);
  return (
    <li>
      <button
        type="button"
        className="ps-btn"
        aria-label={label}
        onClick={onOpen}
        {...triggerProps}
      >
        <ProviderBlob
          providerId={item.id}
          size={26}
          expression={item.status === 'warn' ? 'sad' : item.status === 'off' ? 'sleepy' : 'idle'}
        />
        <StatusMark status={item.status} />
      </button>
      {tooltip}
    </li>
  );
}

export function ProviderStrip({ onSettings }: { onSettings: () => void }) {
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const health = useQuery({ queryKey: homeKeys.health, queryFn: homeApi.health });
  const connected = (setup.data?.providers ?? []).filter((provider) => provider.connection);
  const capabilities = useQueries({
    queries: connected.map((provider) => ({
      queryKey: queryKeys.capabilities(provider.id),
      queryFn: () => api.getCapabilities(provider.id as ProviderId),
      retry: false,
    })),
  });
  const offered = new Map(
    connected.map((provider, index) => [provider.id, capabilities[index]?.data]),
  );
  const issues = health.data?.issues ?? [];
  const issueFor = (id: string) => issues.find((issue) => issue.provider === id) ?? null;
  const items: StripItem[] = [
    ...(setup.data?.providers ?? []).map((provider): StripItem => {
      const caps = offered.get(provider.id);
      const problem = problemText(provider.connection, issueFor(provider.id), relativeTime);
      return {
        id: provider.id,
        name: provider.name,
        status: statusOf(provider.connection !== null, problem),
        model: modelLabel(provider.connection, caps?.models ?? [], caps?.defaultModel ?? null),
        problem,
      };
    }),
    ...(setup.data?.advisors ?? []).map((advisor): StripItem => {
      const problem = problemText(advisor.connection, issueFor(advisor.id), relativeTime);
      return {
        id: advisor.id,
        name: advisor.name,
        status: statusOf(advisor.connection !== null, problem),
        model: modelLabel(advisor.connection, [], null),
        problem,
      };
    }),
  ];
  const troubled = items.filter((item) => item.problem);
  const first = troubled[0];

  return (
    <div className="pstrip">
      <ul className="ps-list" aria-label="AI providers">
        {items.map((item) => (
          <StripButton key={item.id} item={item} onOpen={onSettings} />
        ))}
      </ul>
      {first && (
        <p className="ps-warn" role="status">
          <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 3 2 21h20ZM12 10v5M12 18h.01"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
          <span className="ps-warn-text">
            {first.name}: {first.problem}
            {troubled.length > 1 ? ` (+${troubled.length - 1} more)` : ''}
          </span>
          <button type="button" className="hlink" onClick={onSettings}>
            Fix
          </button>
        </p>
      )}
    </div>
  );
}
