import { useState } from 'react';
import {
  isRetiring,
  type ModelRouting,
  type ProviderCapabilities,
  type ProviderSetup,
} from '@spark-outpost/contracts';
import { TickIcon } from '../../ui/icons.tsx';
import { cleanDescription, optionLabel, retiringLabel, visibleModels } from './model-options.ts';

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
      <TickIcon />
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
  const [showRetiring, setShowRetiring] = useState(false);
  const now = new Date();
  const models = capabilities?.models ?? [];
  const options = visibleModels(models, selected, showRetiring, now);
  const hasRetiring = models.some((model) => isRetiring(model, now));
  const auto = routing === 'auto' && onAuto !== null;
  return (
    <>
      <div role="radiogroup" aria-label={`${provider.name} model`}>
        {onAuto && <AutoOption checked={auto} onSelect={onAuto} />}
        {models.length === 0 && (
          <p className="mempty">
            {loading ? `Asking ${provider.name} for its models…` : 'No models reported yet.'}
          </p>
        )}
        {options.map((option) => {
          const description = cleanDescription(option);
          const retiring = retiringLabel(option, now);
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
                <b>
                  {optionLabel(option, capabilities)}
                  {retiring && <span className="mtag">{retiring}</span>}
                </b>
                {description && <small title={description}>{description}</small>}
              </span>
              <TickIcon />
            </button>
          );
        })}
      </div>
      {hasRetiring && (
        <button
          type="button"
          className="mretire"
          role="switch"
          aria-checked={showRetiring}
          onClick={() => setShowRetiring(!showRetiring)}
        >
          <span className="cswitch" aria-hidden="true">
            <i />
          </span>
          Show retiring models
        </button>
      )}
      {hint && <p className="mhint">{hint}</p>}
    </>
  );
}
