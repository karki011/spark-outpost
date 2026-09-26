import '../usage/usage.css';
import { useId, type ReactNode } from 'react';
import { costTip, type CostSourceLabel } from '../usage/format.ts';

export function ProviderDot({ provider }: { provider: string }) {
  return (
    <i
      className="pdot"
      style={{ background: `var(--c-${provider}, var(--muted))` }}
      aria-hidden="true"
    />
  );
}

const sourceText: Record<string, string> = {
  reported: 'reported',
  estimated: 'estimated',
  mixed: 'includes estimates',
};

export function SourceTag({ source }: { source: CostSourceLabel }) {
  if (!source) return <span className="srctag none">not reported</span>;
  return (
    <span className={source === 'reported' ? 'srctag' : 'srctag est'} title={costTip(source)}>
      {sourceText[source]}
    </span>
  );
}

interface Row {
  key: string;
  cells: ReactNode[];
}

interface AuditTableProps {
  title: string;
  head: string[];
  numeric: number[];
  rows: Row[];
  foot?: ReactNode[];
}

export function AuditTable({ title, head, numeric, rows, foot }: AuditTableProps) {
  const titleId = useId();
  const cellClass = (index: number) => (numeric.includes(index) ? 'n' : undefined);
  return (
    <section className="aud-sec">
      <h4 className="ah" id={titleId}>
        {title}
      </h4>
      <div className="tscroll" tabIndex={0} role="region" aria-labelledby={titleId}>
        <table className="atable">
          <thead>
            <tr>
              {head.map((label, index) => (
                <th key={label} scope="col" className={cellClass(index)}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                {row.cells.map((cell, index) => (
                  <td key={index} className={cellClass(index)}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {foot && (
            <tfoot>
              <tr>
                {foot.map((cell, index) => (
                  <td key={index} className={cellClass(index)}>
                    {cell}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
