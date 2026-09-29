import { PlusIcon, XIcon } from '../../ui/icons.tsx';

export interface Pair {
  key: number;
  name: string;
  value: string;
  stored: boolean;
}

let nextKey = 0;

export function newPair(name = '', value = '', stored = false): Pair {
  nextKey += 1;
  return { key: nextKey, name, value, stored };
}

interface McpPairsFieldProps {
  legend: string;
  label: string;
  addLabel: string;
  namePlaceholder: string;
  pairs: readonly Pair[];
  onChange: (pairs: Pair[]) => void;
}

export function McpPairsField({
  legend,
  label,
  addLabel,
  namePlaceholder,
  pairs,
  onChange,
}: McpPairsFieldProps) {
  const update = (key: number, change: Partial<Pair>) =>
    onChange(pairs.map((pair) => (pair.key === key ? { ...pair, ...change } : pair)));

  return (
    <fieldset className="mcp-pairs">
      <legend>{legend}</legend>
      {pairs.map((pair, index) => (
        <div key={pair.key} className="mcp-pair">
          <input
            className="inp sm mono"
            aria-label={`${label} ${index + 1} name`}
            placeholder={namePlaceholder}
            spellCheck={false}
            value={pair.name}
            onChange={(event) => update(pair.key, { name: event.target.value })}
          />
          <input
            className="inp sm"
            type="password"
            autoComplete="off"
            aria-label={`${label} ${index + 1} value`}
            placeholder={pair.stored ? 'Saved in keychain; blank keeps it' : 'Value'}
            value={pair.value}
            onChange={(event) => update(pair.key, { value: event.target.value })}
          />
          <button
            type="button"
            className="mcp-icon-btn"
            aria-label={`Remove ${label.toLowerCase()} ${pair.name || index + 1}`}
            onClick={() => onChange(pairs.filter((item) => item.key !== pair.key))}
          >
            <XIcon />
          </button>
        </div>
      ))}
      <div className="mcp-pairs-foot">
        <button
          type="button"
          className="mcp-text-btn"
          onClick={() => onChange([...pairs, newPair()])}
        >
          <PlusIcon />
          {addLabel}
        </button>
        <small>Values go to your keychain, never the database or logs.</small>
      </div>
    </fieldset>
  );
}
