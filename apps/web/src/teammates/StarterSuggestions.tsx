import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  TEAMMATE_STARTERS,
  starterRequest,
  type TeammateStarter,
  type TeammateStarterId,
} from '@spark-outpost/contracts';
import { PlusIcon, XIcon } from '../ui/icons.tsx';
import { TeammateFace } from './TeammateFace.tsx';
import { openTeammateSheet } from './teammate-store.ts';
import { teammateKeys, teammatesApi } from './teammates-api.ts';

interface StarterSuggestionsProps {
  starters: readonly TeammateStarterId[];
}

function StarterCard({ starter }: { starter: TeammateStarter }) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: teammateKeys.all });
  const add = useMutation({
    mutationFn: () => teammatesApi.create(starterRequest(starter)),
    onSuccess: refresh,
  });
  const dismiss = useMutation({
    mutationFn: () => teammatesApi.dismissStarter(starter.id),
    onSuccess: refresh,
  });
  const busy = add.isPending || dismiss.isPending;
  return (
    <li className="tm-starter">
      <span className="tm-blob" aria-hidden="true">
        <TeammateFace face={starter.face} size={40} />
      </span>
      <span className="tm-starter-main">
        <b>
          {starter.name} <span className="tm-role">· {starter.role}</span>
        </b>
        <small>{starter.instructions}</small>
        {(add.error ?? dismiss.error) && (
          <small className="tm-error" role="alert">
            {(add.error ?? dismiss.error)?.message}
          </small>
        )}
      </span>
      <span className="tm-starter-acts">
        <button
          type="button"
          className="btn primary sm"
          disabled={busy}
          aria-label={`Add ${starter.name}, ${starter.role}`}
          onClick={() => add.mutate()}
        >
          Add
        </button>
        <button
          type="button"
          className="icon-btn"
          disabled={busy}
          aria-label={`Dismiss ${starter.name}`}
          title="Not now"
          onClick={() => dismiss.mutate()}
        >
          <XIcon />
        </button>
      </span>
    </li>
  );
}

export function StarterSuggestions({ starters }: StarterSuggestionsProps) {
  const offered = TEAMMATE_STARTERS.filter((starter) => starters.includes(starter.id));
  return (
    <div className="tm-empty">
      <p className="tm-lede">
        Sparks are teammates with a name, a face and a chat of their own. Each one keeps your
        defaults and standing instructions.
        {offered.length > 0 && ' Add one to start, or make your own.'}
      </p>
      {offered.length > 0 && (
        <ul className="tm-starters" aria-label="Suggested Sparks">
          {offered.map((starter) => (
            <StarterCard key={starter.id} starter={starter} />
          ))}
        </ul>
      )}
      <button
        type="button"
        className="btn line sm tm-new-inline"
        onClick={() => openTeammateSheet({ kind: 'create' })}
      >
        <PlusIcon /> New Spark
      </button>
    </div>
  );
}
