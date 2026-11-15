import { useEffect, useId, useRef } from 'react';
import type { SetupState } from '@spark-outpost/contracts';
import { PHONE_SWITCH_OFF, useRemoteClient } from '../phone/use-remote-client.ts';
import { Segmented } from '../ui/Segmented.tsx';
import type { SettingsSection } from './section-ids.ts';
import {
  partsOf,
  type SettingsPartEntry,
  type SettingsSectionEntry,
} from './settings-sections.tsx';

interface SettingsPageBodyProps {
  entry: SettingsSectionEntry;
  part: SettingsSection | null;
  setup: SetupState | undefined;
  onOpenChat: (conversationId: string) => void;
  onSection: (section: SettingsSection) => void;
}

interface PartProps {
  part: SettingsPartEntry;
  setup: SetupState | undefined;
  onOpenChat: (conversationId: string) => void;
}

function PartBody({ part, setup, onOpenChat }: PartProps) {
  const phone = useRemoteClient();
  const off = part.remoteSwitch !== undefined && !phone.allows(part.remoteSwitch);
  return (
    <>
      {off && (
        <p className="set-off-note" role="note">
          {PHONE_SWITCH_OFF}
        </p>
      )}
      <div className={off ? 'set-off' : undefined} inert={off}>
        {part.render({ setup, off, onOpenChat })}
      </div>
    </>
  );
}

function StackedPart({ part, setup, onOpenChat, wanted }: PartProps & { wanted: boolean }) {
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (wanted) ref.current?.scrollIntoView({ block: 'start' });
  }, [wanted]);
  return (
    <section ref={ref} className="set-part" aria-labelledby={titleId}>
      <h4 id={titleId} className="set-part-title">
        {part.title}
      </h4>
      <PartBody part={part} setup={setup} onOpenChat={onOpenChat} />
    </section>
  );
}

function TabbedParts({ entry, part, setup, onOpenChat, onSection }: SettingsPageBodyProps) {
  const parts = partsOf(entry);
  const current = parts.find((candidate) => candidate.id === part) ?? parts[0]!;
  return (
    <>
      <div className="set-part-tabs">
        <Segmented
          ariaLabel={`Show in ${entry.label}`}
          options={parts.map((candidate) => ({ id: candidate.id, label: candidate.title }))}
          value={current.id}
          onChange={(id) => onSection(id as SettingsSection)}
        />
      </div>
      <PartBody key={current.id} part={current} setup={setup} onOpenChat={onOpenChat} />
    </>
  );
}

export function SettingsPageBody(props: SettingsPageBodyProps) {
  const { entry, part, setup, onOpenChat } = props;
  const parts = partsOf(entry);
  if (parts.length === 1) {
    return <PartBody part={parts[0]!} setup={setup} onOpenChat={onOpenChat} />;
  }
  if (entry.tabs) return <TabbedParts {...props} />;
  return (
    <>
      {parts.map((candidate) => (
        <StackedPart
          key={candidate.id}
          part={candidate}
          setup={setup}
          onOpenChat={onOpenChat}
          wanted={candidate.id === part}
        />
      ))}
    </>
  );
}
