import { ProfileSwitchSetting } from './ProfileSwitchSetting.tsx';

export const TERMINAL_RECORD_LABEL = 'Record Terminal sessions like chats';

const RECORD_INFO = {
  lead: 'For Claude Code Terminal sessions with Spark’s mod loaded. Off, Spark keeps only state, tool names and times, tokens and cost.',
  items: [
    {
      label: 'Recorded',
      text: 'Each tool call with its input and output, the replies, the files the turn changed, and an audit entry per call.',
    },
    {
      label: 'Flags',
      text: 'A push of another branch, a force push, a protected file or a write outside the project gets a flag. Nothing is stopped.',
    },
    {
      label: 'Secrets',
      text: 'Values from secret files are hidden, and a secret file is recorded by its path only.',
    },
  ],
};

export function TerminalRecordSetting({ enabled }: { enabled: boolean }) {
  return (
    <ProfileSwitchSetting
      enabled={enabled}
      label={TERMINAL_RECORD_LABEL}
      info={RECORD_INFO}
      doc={{ page: 'settings', heading: 'record-terminal-sessions' }}
      hint={(on) =>
        on
          ? 'New Claude turns keep commands, replies, changed files and an audit.'
          : 'Terminal sessions keep state, tool names and times, tokens and cost.'
      }
      toUpdate={(value) => ({ terminalRecordLikeChat: value })}
    />
  );
}
