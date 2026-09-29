import { useId, useState, type ReactNode } from 'react';
import { isSmallSample } from '@spark-outpost/contracts';
import { EmptyScene } from '../../brand/EmptyScene.tsx';

interface TableColumn<Row> {
  label: string;
  value: (row: Row) => ReactNode;
  numeric?: boolean;
}

interface DataTableProps<Row> {
  caption: string;
  columns: readonly TableColumn<Row>[];
  rows: readonly Row[];
}

export function DataTable<Row>({ caption, columns, rows }: DataTableProps<Row>) {
  return (
    <div className="an-table-wrap">
      <table className="an-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.label} scope="col" className={column.numeric ? 'num' : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column.label} className={column.numeric ? 'num' : undefined}>
                  {column.value(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SampleFlag({ n, noun = 'runs' }: { n: number; noun?: string | undefined }) {
  if (!isSmallSample(n)) return null;
  return (
    <span className="an-flag">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          d="M8 2 15 14H1z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M8 6.5v3.2M8 11.6v.1"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      Small sample (n={n} {noun})
    </span>
  );
}

export function EmptyChart({ children }: { children: ReactNode }) {
  return (
    <EmptyScene size="compact" className="an-empty">
      {children}
    </EmptyScene>
  );
}

interface ChartCardProps<Row> {
  title: string;
  summary: string;
  n: number;
  noun?: string;
  table?: DataTableProps<Row>;
  className?: string;
  aside?: ReactNode;
  children: ReactNode;
}

export function ChartCard<Row>({
  title,
  summary,
  n,
  noun,
  table,
  className,
  aside,
  children,
}: ChartCardProps<Row>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <section className={className ? `an-card ${className}` : 'an-card'} aria-labelledby={id}>
      <header className="an-card-h">
        <h3 id={id}>{title}</h3>
        <SampleFlag n={n} noun={noun} />
        {aside}
      </header>
      <p className="an-sum">{summary}</p>
      {children}
      {table && table.rows.length > 0 && (
        <>
          <button
            type="button"
            className="an-toggle"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M2 3h12v10H2zM2 7h12M6 3v10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
            {open ? 'Hide data table' : 'Show data table'}
          </button>
          {open && <DataTable {...table} />}
        </>
      )}
    </section>
  );
}
