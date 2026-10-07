import './data-table.css';
import { ArrowUpIcon } from './icons.tsx';

export type SortDirection = 'ascending' | 'descending';

interface SortHeaderProps {
  label: string;
  direction: SortDirection | null;
  onSort: () => void;
  numeric?: boolean;
  rowSpan?: number | undefined;
}

export function SortHeader({ label, direction, onSort, numeric, rowSpan }: SortHeaderProps) {
  return (
    <th
      scope="col"
      rowSpan={rowSpan}
      className={numeric ? 'num' : undefined}
      aria-sort={direction ?? undefined}
    >
      <button type="button" className="dt-sort" onClick={onSort}>
        {label}
        <ArrowUpIcon />
      </button>
    </th>
  );
}
