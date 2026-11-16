import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  TEAMMATE_STARTERS,
  starterRequest,
  type TeammateStarter,
  type TeammateStarterId,
} from '@spark-outpost/contracts';
import { XIcon } from '../ui/icons.tsx';
import { TeammateFace } from './TeammateFace.tsx';
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
  if (offered.length === 0) return null;
  return (
    <div className="tm-empty">
      <h3 className="tm-starters-title">Or start from one of these</h3>
      <ul className="tm-starters" aria-label="Suggested Sparks">
        {offered.map((starter) => (
          <StarterCard key={starter.id} starter={starter} />
        ))}
      </ul>
    </div>
  );
}
