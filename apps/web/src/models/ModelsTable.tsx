import type { ProviderCardsView } from '@spark-outpost/contracts';
import { SortHeader } from '../ui/SortHeader.tsx';
import { MODEL_COLUMNS, ModelRow, UncardedRow } from './ModelRow.tsx';
import './models-table.css';
import { groupModels, nextSort, type ModelSort, type SortKey } from './model-list.ts';

interface ModelsTableProps {
  view: ProviderCardsView;
  sort: ModelSort | null;
  onSort: (sort: ModelSort | null) => void;
}

function GroupTitle({ title }: { title: string }) {
  return (
    <tr className="mc-group-row">
      <th scope="rowgroup" colSpan={MODEL_COLUMNS}>
        <span>{title}</span>
      </th>
    </tr>
  );
}

export function ModelsTable({ view, sort, onSort }: ModelsTableProps) {
  const sortBy = (key: SortKey, label: string, tall = false) => (
    <SortHeader
      label={label}
      numeric={!tall}
      rowSpan={tall ? 2 : undefined}
      direction={sort?.key === key ? sort.direction : null}
      onSort={() => onSort(nextSort(sort, key))}
    />
  );
  return (
    <div className="mc-table dt-scroll">
      <table className="dt">
        <caption className="sr-only">
          {view.provider.label} models. Prices are in US dollars per million tokens.
        </caption>
        <colgroup>
          <col className="mc-col-model" />
          <col className="mc-col-tier" />
        </colgroup>
        <colgroup>
          <col className="mc-col-in" />
          <col className="mc-col-cached" />
          <col className="mc-col-out" />
        </colgroup>
        <colgroup>
          <col className="mc-col-context" />
          <col className="mc-col-speed" />
          <col className="mc-col-effort" />
          <col className="mc-col-knowledge" />
          <col className="mc-col-passed" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" rowSpan={2} className="dt-pin">
              Model
            </th>
            {sortBy('tier', 'Tier', true)}
            <th scope="colgroup" colSpan={3} className="num mc-price-head">
              Price per 1M tokens
            </th>
            <th scope="col" rowSpan={2} className="num">
              Context / max output
            </th>
            <th scope="col" rowSpan={2}>
              Speed
            </th>
            <th scope="col" rowSpan={2}>
              Effort
            </th>
            <th scope="col" rowSpan={2} className="num">
              Knowledge
            </th>
            <th scope="col" rowSpan={2} className="num">
              Passed
            </th>
          </tr>
          <tr>
            {sortBy('input', 'In')}
            {sortBy('cached', 'Cached')}
            {sortBy('output', 'Out')}
          </tr>
        </thead>
        {groupModels(view.models, sort).map((group) => (
          <tbody key={group.id}>
            <GroupTitle title={group.title} />
            {group.models.map((model) => (
              <ModelRow key={model.card.id} view={model} />
            ))}
          </tbody>
        ))}
        {view.uncardedModels.length > 0 && (
          <tbody>
            <GroupTitle title="No card yet" />
            {view.uncardedModels.map((model) => (
              <UncardedRow key={model.id} label={model.label} />
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}
