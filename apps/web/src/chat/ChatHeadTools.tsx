import { ChatHeaderMenu, type ChatMenuExtra } from '../audit/ChatHeaderMenu.tsx';
import { BrowserButton } from '../browser/BrowserButton.tsx';
import { AgentTvButton } from '../crew/AgentTvButton.tsx';
import { closeAgentTv, openAgentTv, useAgentTv } from '../crew/agent-tv-store.ts';
import type { CrewAgent } from '../crew/crew-model.ts';
import { TvIcon } from '../crew/tv-icons.tsx';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { requestSettings } from '../settings/settings-request.ts';
import { TerminalButton } from '../terminal/dock/TerminalButton.tsx';
import { ThemePicker } from '../theme/ThemePicker.tsx';
import { usePhone } from '../ui/breakpoints.ts';
import { SlidersIcon } from '../ui/icons.tsx';

interface ChatHeadToolsProps {
  conversationId: string;
  agents: CrewAgent[];
  browser: { open: boolean; onToggle: () => void } | null;
  onAudit?: (() => void) | undefined;
  onStartFresh: () => void;
}

export function ChatHeadTools({
  conversationId,
  agents,
  browser,
  onAudit,
  onStartFresh,
}: ChatHeadToolsProps) {
  const phone = usePhone();
  const { remote } = useRemoteClient();
  const tv = useAgentTv();
  const watching = tv.sourceId === conversationId;
  const extras: ChatMenuExtra[] = phone
    ? [
        ...(agents.length > 0
          ? [
              {
                label: watching ? 'Close Agent TV' : 'Agent TV',
                icon: <TvIcon />,
                onSelect: () => (watching ? closeAgentTv() : openAgentTv(conversationId)),
              },
            ]
          : []),
        { label: 'Theme', icon: <SlidersIcon />, onSelect: () => requestSettings('look') },
      ]
    : [];
  return (
    <>
      {(onAudit || phone) && (
        <ChatHeaderMenu
          chatId={conversationId}
          onAudit={onAudit}
          onStartFresh={onAudit ? onStartFresh : undefined}
          extras={extras}
        />
      )}
      {!phone && <AgentTvButton conversationId={conversationId} agents={agents} />}
      {browser && !remote && <BrowserButton open={browser.open} onToggle={browser.onToggle} />}
      {!remote && <TerminalButton chatId={conversationId} />}
      {!phone && <ThemePicker />}
    </>
  );
}
