import '../spark/spark.css';
import type { Profile } from '@spark-outpost/contracts';
import { AgentInstructionsSetting } from '../spark/AgentInstructionsSetting.tsx';
import { CompactionSettings } from '../spark/CompactionSettings.tsx';
import { LevelSetting } from '../spark/LevelSetting.tsx';
import { ArchiveInactiveSetting } from './ArchiveInactiveSetting.tsx';
import { AutoContinueSetting } from './AutoContinueSetting.tsx';
import { CodeModeSetting } from './CodeModeSetting.tsx';
import { CollapseTurnsSetting } from './CollapseTurnsSetting.tsx';
import { PluginsSettings } from './PluginsSettings.tsx';
import { BusyEnterSetting } from './BusyEnterSetting.tsx';
import { TerminalRecordSetting } from './TerminalRecordSetting.tsx';
import { WideWindowSetting } from './WideWindowSetting.tsx';

export function ChatsSection({ profile }: { profile: Profile }) {
  return (
    <>
      <section className="spark-group" aria-labelledby="chats-autonomy">
        <h4 id="chats-autonomy">Autonomy</h4>
        <LevelSetting level={profile.defaultLevel} />
        <AutoContinueSetting seconds={profile.autoContinueSeconds} />
      </section>
      <CompactionSettings profile={profile} />
      <section className="spark-group" aria-labelledby="chats-window">
        <h4 id="chats-window">In the chat</h4>
        <BusyEnterSetting action={profile.busyEnter} />
        <WideWindowSetting layout={profile.wideWindow} />
        <CollapseTurnsSetting enabled={profile.collapseFinishedTurns} />
      </section>
      <section className="spark-group" aria-labelledby="chats-list">
        <h4 id="chats-list">Chat list</h4>
        <ArchiveInactiveSetting days={profile.archiveInactiveDays} />
      </section>
      <section className="spark-group" aria-labelledby="chats-sessions">
        <h4 id="chats-sessions">Agent sessions</h4>
        <CodeModeSetting enabled={profile.codeMode} unavailable={profile.codeModeUnavailable} />
        <AgentInstructionsSetting profile={profile} />
        <TerminalRecordSetting enabled={profile.terminalRecordLikeChat} />
      </section>
      <PluginsSettings />
    </>
  );
}
