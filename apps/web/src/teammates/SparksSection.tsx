import { TEAMMATE_STATE_LABELS } from '@spark-outpost/contracts';
import { DocLink } from '../ui/DocLink.tsx';
import { PlusIcon, TrashIcon } from '../ui/icons.tsx';
import { StarterSuggestions } from './StarterSuggestions.tsx';
import { TeammateFace } from './TeammateFace.tsx';
import { openTeammateSheet } from './teammate-store.ts';
import { useTeammates } from './use-teammates.ts';

export function SparksSection() {
  const { loading, error, teammates, starters } = useTeammates();
  return (
    <>
      <p className="lede">
        Named teammates, each with a face, a role, its own home chat, defaults for new chats and
        standing instructions. <DocLink topic="Sparks" doc={{ page: 'sparks' }} />
      </p>
      {error && (
        <p className="set-hint" role="alert">
          {error.message}
        </p>
      )}
      {loading ? (
        <ul className="tm-set-list" aria-hidden="true">
          {[0, 1].map((key) => (
            <li key={key} className="tm-set-row">
              <span className="hsk dot" />
              <span className="hsk" style={{ width: '40%' }} />
            </li>
          ))}
        </ul>
      ) : teammates.length === 0 ? (
        <StarterSuggestions starters={starters} />
      ) : (
        <>
          <ul className="tm-set-list" aria-label="Your Sparks">
            {teammates.map((teammate) => (
              <li key={teammate.id} className="tm-set-row">
                <TeammateFace face={teammate.face} state={teammate.state} size={32} />
                <span className="tm-set-text">
                  <b>{teammate.name}</b>
                  <small>
                    {[teammate.role, TEAMMATE_STATE_LABELS[teammate.state]]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </span>
                <button
                  type="button"
                  className="btn line sm"
                  aria-label={`Edit ${teammate.name}`}
                  onClick={() => openTeammateSheet({ kind: 'edit', id: teammate.id })}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn line sm"
                  aria-label={`Delete ${teammate.name}`}
                  onClick={() =>
                    openTeammateSheet({ kind: 'edit', id: teammate.id, focus: 'delete' })
                  }
                >
                  <TrashIcon /> Delete
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn line sm tm-new-inline"
            onClick={() => openTeammateSheet({ kind: 'create' })}
          >
            <PlusIcon /> New Spark
          </button>
        </>
      )}
    </>
  );
}
