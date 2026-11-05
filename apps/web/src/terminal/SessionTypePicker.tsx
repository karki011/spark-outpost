import { Segmented } from '../ui/Segmented.tsx';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import './native-terminal.css';

export interface SessionChoice {
  sessionType: 'chat' | 'terminal';
  terminalProvider: 'claude' | 'codex';
}

export function SessionTypePicker({
  value,
  onChange,
  disabled = false,
  agent = false,
}: {
  value: SessionChoice;
  onChange: (value: SessionChoice) => void;
  disabled?: boolean;
  agent?: boolean;
}) {
  const { remote } = useRemoteClient();
  if (remote) return null;
  return (
    <fieldset className="session-choice" disabled={disabled} aria-label="New session">
      <Segmented
        ariaLabel="Session type"
        options={[
          { id: 'chat', label: 'Chat' },
          { id: 'terminal', label: 'Terminal' },
        ]}
        value={value.sessionType}
        onChange={(id) => onChange({ ...value, sessionType: id as SessionChoice['sessionType'] })}
      />
      {agent && value.sessionType === 'terminal' && (
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
