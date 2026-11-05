import { useState } from 'react';
import {
  isRetiring,
  type ProviderCapabilities,
  type ProviderSetup,
} from '@spark-outpost/contracts';
import { TickIcon } from '../../ui/icons.tsx';
import {
  availabilityTag,
  cleanDescription,
  optionLabel,
  retiringLabel,
  unusableChoice,
  visibleModels,
} from './model-options.ts';
import { UnusableModelNotice } from './UnusableModelNotice.tsx';
import { BlobSwitchFace } from '../../brand/BlobToggle.tsx';

interface ModelListProps {
  provider: ProviderSetup;
  capabilities: ProviderCapabilities | undefined;
  loading: boolean;
  selected: string | null;
  onSelect: (model: string) => void;
}

export function ModelList({ provider, capabilities, loading, selected, onSelect }: ModelListProps) {
  const [showRetiring, setShowRetiring] = useState(false);
  const now = new Date();
  const models = capabilities?.models ?? [];
  const options = visibleModels(models, selected, showRetiring, now);
  const hasRetiring = models.some((model) => isRetiring(model, now));
  const unusable = unusableChoice(selected, capabilities);
  return (
    <>
      {unusable && <UnusableModelNotice issue={unusable} onSwitch={onSelect} />}
      <div role="radiogroup" aria-label={`${provider.name} model`}>
        {models.length === 0 && (
          <p className="mempty">
            {loading ? `Asking ${provider.name} for its models…` : 'No models reported yet.'}
          </p>
        )}
        {options.map((option) => {
          const description = cleanDescription(option);
          const retiring = retiringLabel(option, now);
          const access = availabilityTag(option, capabilities);
          return (
            <button
              key={option.id}
              type="button"
              className="mopt"
              role="radio"
              aria-checked={option.id === selected}
              onClick={() => onSelect(option.id)}
            >
              <span>
                <b>
                  {optionLabel(option, capabilities)}
                  {retiring && <span className="mtag">{retiring}</span>}
                  {access && <span className="mtag">{access}</span>}
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
          <BlobSwitchFace checked={showRetiring} />
          Show retiring models
        </button>
      )}
    </>
  );
}
