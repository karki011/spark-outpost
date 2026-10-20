import '../../chat/composer/composer-popovers.css';
import '../../chat/composer/model-picker.css';
import type { ProviderId } from '@spark-outpost/contracts';
import { ProviderBlob } from '../../brand/ProviderBlob.tsx';
import { ModelList } from '../../chat/composer/ModelList.tsx';
import { currentModel } from '../../chat/composer/model-options.ts';
import { ProviderSwitch } from '../../chat/composer/ProviderSwitch.tsx';
import type { AgentChoice } from './create-draft.ts';
import type { AgentView } from './create-labels.ts';
import { FieldPopover } from './FieldPopover.tsx';
import { defaultMode, type CreateData } from './use-create-data.ts';

interface AgentFieldProps {
  choice: AgentChoice;
  view: AgentView | null;
  data: Pick<CreateData, 'providers' | 'capabilitiesOf' | 'loadingOf'>;
  invalid: boolean;
  describedBy?: string | undefined;
  onChange: (choice: Partial<AgentChoice>) => void;
}

export function AgentField({
  choice,
  view,
  data,
  invalid,
  describedBy,
  onChange,
}: AgentFieldProps) {
  const setup = data.providers.find((provider) => provider.id === choice.provider);
  const provider = choice.provider;
  const capabilities = provider ? data.capabilitiesOf(provider) : undefined;

  const switchTo = (id: ProviderId) => {
    if (id === provider) return;
    onChange({ provider: id, model: null, agentMode: defaultMode(id, data.capabilitiesOf(id)) });
  };

  return (
    <FieldPopover
      label={view ? `Agent: ${view.agent}` : 'Agent'}
      invalid={invalid}
      describedBy={describedBy}
      disabled={!setup || provider === null}
      value={
        view && provider ? (
          <>
            <ProviderBlob providerId={provider} size={18} />
            <span>{view.provider}</span>
            <small>{view.model}</small>
          </>
        ) : (
          'No agent connected'
        )
      }
    >
      {setup && provider && (
        <>
          {data.providers.length > 1 && (
            <div className="op-pop-top">
              <span>{setup.name}</span>
              <ProviderSwitch providers={data.providers} active={provider} onSelect={switchTo} />
            </div>
          )}
          <ModelList
            provider={setup}
            capabilities={capabilities}
            loading={data.loadingOf(provider)}
            selected={currentModel(choice, capabilities)?.id ?? choice.model}
            onSelect={(model) => onChange({ model })}
          />
        </>
      )}
    </FieldPopover>
  );
}
