import { useId } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TicketConnection, UpdateTicketSettingsRequest } from '@spark-outpost/contracts';
import { ticketKeys, ticketsApi } from './tickets-api.ts';
import { BlobToggle } from '../brand/BlobToggle.tsx';

type SyncKey = 'moveOnShip' | 'moveOnMerge';

const SWITCHES: { key: SyncKey; label: string; hint: string }[] = [
  {
    key: 'moveOnShip',
    label: 'Move tickets to In review when a PR opens',
    hint: 'Spark also adds the PR link to the ticket.',
  },
  {
    key: 'moveOnMerge',
    label: 'Move tickets to Done when the PR merges',
    hint: 'Spark checks merged PRs when it refreshes your tickets.',
  },
];

export function TicketSyncSettings({ connection }: { connection: TicketConnection }) {
  const id = useId();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (body: UpdateTicketSettingsRequest) =>
      ticketsApi.updateSettings(connection.source, body),
    onSuccess: (connections) => queryClient.setQueryData(ticketKeys.connections, connections),
  });
  const checked = (key: SyncKey) => {
    const pending = save.isPending ? save.variables[key] : undefined;
    return pending ?? connection[key];
  };
  return (
    <div className="tk-sync">
      {SWITCHES.map((item) => (
        <div key={item.key}>
          <label className="tk-switch">
            <BlobToggle
              size="sm"
              label={item.label}
              checked={checked(item.key)}
              describedBy={`${id}-${item.key}`}
              onChange={(next) => save.mutate({ [item.key]: next })}
            />
            <span>{item.label}</span>
          </label>
          <p id={`${id}-${item.key}`} className="tk-field-help">
            {item.hint}
          </p>
        </div>
      ))}
      {save.isError && (
        <p className="tk-field-err" role="alert">
          {save.error.message}
        </p>
      )}
    </div>
  );
}
