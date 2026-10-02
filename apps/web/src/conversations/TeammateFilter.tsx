import { teammateFilterKey } from '@spark-outpost/contracts';
import { parseChatFilter, withTeammateToken } from '../categories/category-filter.ts';
import { TeammateFace } from '../teammates/TeammateFace.tsx';
import { useTeammates } from '../teammates/use-teammates.ts';

interface TeammateFilterProps {
  search: string;
  onSearch: (search: string) => void;
}

export function TeammateFilter({ search, onSearch }: TeammateFilterProps) {
  const { teammates } = useTeammates();
  if (teammates.length === 0) return null;
  const active = parseChatFilter(search).teammate;
  return (
    <div className="tm-filter" role="group" aria-label="Filter chats by Spark">
      {teammates.map((teammate) => {
        const on = teammateFilterKey(teammate.name) === active;
        return (
          <button
            key={teammate.id}
            type="button"
            className={on ? 'tm-filter-chip on' : 'tm-filter-chip'}
            aria-pressed={on}
            title={on ? `Show all chats` : `Show chats with ${teammate.name}`}
            onClick={() => onSearch(withTeammateToken(search, on ? null : teammate.name))}
          >
            <TeammateFace face={teammate.face} size={18} state={teammate.state} />
            <span>{teammate.name}</span>
          </button>
        );
      })}
    </div>
  );
}
