import type { ModelRouting, ProviderCapabilities, ProviderSetup } from '@spark-outpost/contracts';
import { Tick } from './EffortOptions.tsx';
import { cleanDescription, optionLabel } from './model-options.ts';

interface ModelListProps {
  provider: ProviderSetup;
  capabilities: ProviderCapabilities | undefined;
  loading: boolean;
  selected: string | null;
  onSelect: (model: string) => void;
  routing?: ModelRouting;
  onAuto?: (() => void) | null;
  hint?: string | null;
}

function AutoOption({ checked, onSelect }: { checked: boolean; onSelect: () => void }) {
  return (
    <button type="button" className="mopt" role="radio" aria-checked={checked} onClick={onSelect}>
      <span>
        <b>Auto</b>
        <small>Rules pick the size: smaller for trivial edits, top for destructive work.</small>
      </span>
      <Tick />
    </button>
  );
}

export function ModelList({
  provider,
  capabilities,
  loading,
  selected,
  onSelect,
  routing = 'pinned',
  onAuto = null,
  hint = null,
}: ModelListProps) {
  const options = capabilities?.models ?? [];
  const auto = routing === 'auto' && onAuto !== null;
  return (
    <div role="radiogroup" aria-label={`${provider.name} model`}>
      {onAuto && <AutoOption checked={auto} onSelect={onAuto} />}
      {options.length === 0 && (
        <p className="mempty">
          {loading ? `Asking ${provider.name} for its models…` : 'No models reported yet.'}
        </p>
      )}
      {options.map((option) => {
        const description = cleanDescription(option);
        return (
          <button
            key={option.id}
            type="button"
            className="mopt"
            role="radio"
            aria-checked={!auto && option.id === selected}
            onClick={() => onSelect(option.id)}
          >
            <span>
              <b>{optionLabel(option, capabilities)}</b>
              {description && <small title={description}>{description}</small>}
            </span>
            <Tick />
          </button>
        );
      })}
      {hint && <p className="mhint">{hint}</p>}
    </div>
  );
}
