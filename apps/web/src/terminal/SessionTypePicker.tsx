import { Segmented } from '../ui/Segmented.tsx';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { useRemoteClient } from '../phone/use-remote-client.ts';

export interface SessionChoice {
  sessionType: 'chat' | 'terminal';
  terminalProvider: 'claude' | 'codex';
}

export function SessionTypePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: SessionChoice;
  onChange: (value: SessionChoice) => void;
  disabled?: boolean;
}) {
  const { remote } = useRemoteClient();
  if (remote) return null;
  return (
    <fieldset className="session-choice" disabled={disabled} aria-label="New session">
      <Segmented
        ariaLabel="Session type"
        options={[
          { id: 'chat', label: 'Chat' },
          { id: 'terminal', label: '>_ Terminal' },
        ]}
        value={value.sessionType}
        onChange={(id) => onChange({ ...value, sessionType: id as SessionChoice['sessionType'] })}
      />
      {value.sessionType === 'terminal' && (
        <ChoicePicker
          label="Terminal agent"
          choices={[
            { id: 'claude', label: 'Claude Code' },
            { id: 'codex', label: 'Codex' },
          ]}
          value={value.terminalProvider}
          onChange={(id) =>
            onChange({ ...value, terminalProvider: id as SessionChoice['terminalProvider'] })
          }
        />
      )}
    </fieldset>
  );
}
