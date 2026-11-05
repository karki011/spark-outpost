import '../../chat/composer/composer-popovers.css';
import '../../chat/composer/model-picker.css';
import { ModeOptions } from '../../chat/composer/ModeOptions.tsx';
import { PermissionIcon } from '../../chat/composer/PermissionChip.tsx';
import type { AgentChoice } from './create-draft.ts';
import type { AgentView } from './create-labels.ts';
import { FieldPopover } from './FieldPopover.tsx';
import type { CreateData } from './use-create-data.ts';

interface ModeFieldProps {
  choice: AgentChoice;
  view: AgentView | null;
  data: Pick<CreateData, 'capabilitiesOf' | 'loadingOf' | 'level'>;
  hasProject: boolean;
  onChange: (agentMode: string) => void;
}

export function ModeField({ choice, view, data, hasProject, onChange }: ModeFieldProps) {
  const provider = choice.provider;
  const capabilities = provider ? data.capabilitiesOf(provider) : undefined;
  return (
    <FieldPopover
      label={view ? `Permissions: ${view.mode}` : 'Permissions'}
      disabled={provider === null}
      value={
        view ? (
          <>
            <PermissionIcon risk={view.risk} />
            <span>{view.mode}</span>
          </>
        ) : (
          'Default mode'
        )
      }
    >
      {provider && (
        <ModeOptions
          provider={provider}
          modes={capabilities?.modes ?? []}
          defaultMode={capabilities?.defaultMode ?? null}
          selected={view?.modeId ?? null}
          level={data.level}
          hasRepos={hasProject}
          loading={data.loadingOf(provider)}
          onMode={onChange}
        />
      )}
    </FieldPopover>
  );
}
