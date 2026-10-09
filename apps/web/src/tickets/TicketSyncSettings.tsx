import { useId } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ticketSourceNames,
  type TicketConnection,
  type TicketMove,
  type UpdateTicketSettingsRequest,
} from '@spark-outpost/contracts';
import { ticketKeys, ticketsApi } from './tickets-api.ts';
import { AUTOMATIC, moveChoices, moveNotes, withMove } from './move-status-model.ts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';

type SyncKey = 'moveOnShip' | 'moveOnMerge';

interface MoveRow {
  move: TicketMove;
  toggle: SyncKey | null;
  label: string;
  hint: string;
  picker: string;
}

const ROWS: MoveRow[] = [
  {
    move: 'in_review',
    toggle: 'moveOnShip',
    label: 'Move tickets to In review when a PR opens',
    hint: 'Spark also adds the PR link to the ticket.',
    picker: 'In review status',
  },
  {
    move: 'done',
    toggle: 'moveOnMerge',
    label: 'Move tickets to Done when the PR merges',
    hint: 'Spark checks merged PRs when it refreshes your tickets.',
    picker: 'Done status',
  },
  {
    move: 'in_progress',
    toggle: null,
    label: 'Status when you start work on a ticket',
    hint: 'Used when Start work moves the ticket.',
    picker: 'In progress status',
  },
];

export function TicketSyncSettings({ connection }: { connection: TicketConnection }) {
  const id = useId();
  const queryClient = useQueryClient();
  const source = ticketSourceNames[connection.source];
  const options = useQuery({
    queryKey: ticketKeys.moveOptions(connection.source),
    queryFn: () => ticketsApi.moveOptions(connection.source),
  });
  const save = useMutation({
    mutationFn: (body: UpdateTicketSettingsRequest) =>
      ticketsApi.updateSettings(connection.source, body),
    onSuccess: (connections) => {
      queryClient.setQueryData(ticketKeys.connections, connections);
      void queryClient.invalidateQueries({ queryKey: ticketKeys.moveOptions(connection.source) });
    },
  });
  const pending = save.isPending ? save.variables : undefined;
  const moveStatuses = pending?.moveStatuses ?? connection.moveStatuses;
  return (
    <div className="tk-sync">
      {ROWS.map((row) => {
        const chosen = moveStatuses[row.move];
        const notes = moveNotes(options.data, row.move, chosen);
        const { toggle } = row;
        return (
          <div key={row.move}>
            {toggle ? (
              <label className="tk-switch">
                <BlobToggle
                  size="sm"
                  label={row.label}
                  checked={pending?.[toggle] ?? connection[toggle]}
                  describedBy={`${id}-${row.move}`}
                  onChange={(next) => save.mutate({ [toggle]: next })}
                />
                <span>{row.label}</span>
              </label>
            ) : (
              <p className="tk-move-title">{row.label}</p>
            )}
            <p id={`${id}-${row.move}`} className="tk-field-help">
              {row.hint}
            </p>
            <div className="tk-move">
              <ChoicePicker
                label={row.picker}
                choices={moveChoices(options.data, row.move, chosen)}
                value={chosen ?? AUTOMATIC}
                onChange={(choice) =>
                  save.mutate({ moveStatuses: withMove(moveStatuses, row.move, choice) })
                }
              />
              <ul className="tk-move-notes" aria-label={`${row.picker} by project`}>
                {notes.map((note) => (
                  <li key={note.project} className={note.warn ? 'warn' : undefined}>
                    <b>{note.project}</b> {note.text}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}
      {options.isError && (
        <p className="tk-field-err" role="alert">
          Couldn’t read the statuses from {source}: {options.error.message}
        </p>
      )}
      {save.isError && (
        <p className="tk-field-err" role="alert">
          {save.error.message}
        </p>
      )}
    </div>
  );
}
