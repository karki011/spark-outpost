import {
  ticketSourceNames,
  type TicketAssigneeFilter,
  type TicketSourceId,
} from '@spark-outpost/contracts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { ALL_FILTERS, projectsOf, type TicketFilters } from './ticket-model.ts';
import type { Density } from './use-density.ts';

interface TicketFilterBarProps {
  sources: readonly TicketSourceId[];
  projects: readonly { project: string | null }[];
  filters: TicketFilters;
  onFilters: (filters: TicketFilters) => void;
  searching: boolean;
  assignee: TicketAssigneeFilter;
  onAssignee: (assignee: TicketAssigneeFilter) => void;
  density: Density;
  onDensity: (density: Density) => void;
}

const ASSIGNEES: { id: TicketAssigneeFilter; label: string }[] = [
  { id: 'anyone', label: 'Anyone' },
  { id: 'me', label: 'Me' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'others', label: 'Someone else' },
];

const DENSITIES = [
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'compact', label: 'Compact' },
];

export function TicketFilterBar(props: TicketFilterBarProps) {
  const { filters } = props;
  const teams = projectsOf(props.projects);
  if (filters.project && !teams.includes(filters.project)) teams.push(filters.project);
  const active =
    filters.source !== ALL_FILTERS.source ||
    filters.project !== ALL_FILTERS.project ||
    (props.searching && props.assignee !== 'anyone');
  const on = (flag: boolean) => (flag ? 'fsel on' : 'fsel');
  return (
    <div className="fbar" role="group" aria-label="Filters">
      {props.sources.length > 1 && (
        <div className={on(filters.source !== 'all')}>
          <ChoicePicker
            label="Source"
            value={filters.source}
            choices={[
              { id: 'all', label: 'All sources' },
              ...props.sources.map((source) => ({ id: source, label: ticketSourceNames[source] })),
            ]}
            onChange={(id) =>
              props.onFilters({ ...filters, source: id as TicketFilters['source'] })
            }
          />
        </div>
      )}
      <div className={on(Boolean(filters.project))}>
        <ChoicePicker
          label="Team or project"
          value={filters.project}
          choices={[
            { id: '', label: 'All teams and projects' },
            ...teams.map((team) => ({ id: team, label: team })),
          ]}
          onChange={(id) => props.onFilters({ ...filters, project: id })}
        />
      </div>
      {props.searching && (
        <div className={on(props.assignee !== 'anyone')}>
          <ChoicePicker
            label="Assignee"
            value={props.assignee}
            choices={ASSIGNEES}
            onChange={(id) => props.onAssignee(id as TicketAssigneeFilter)}
          />
        </div>
      )}
      {active && (
        <button
          type="button"
          className="fclear"
          onClick={() => {
            props.onFilters(ALL_FILTERS);
            props.onAssignee('anyone');
          }}
        >
          Clear filters
        </button>
      )}
      <span className="sp" />
      <Segmented
        ariaLabel="Row density"
        options={DENSITIES}
        value={props.density}
        onChange={(id) => props.onDensity(id as Density)}
      />
    </div>
  );
}
