import { useRef } from 'react';
import { ChatHeaderMenu, type ChatMenuPane } from '../audit/ChatHeaderMenu.tsx';
import { GlobeIcon } from '../browser/BrowserIcons.tsx';
import { useBrowserShortcut } from '../browser/browser-shortcut.ts';
import { useAgentTv } from '../crew/agent-tv-store.ts';
import type { CrewAgent } from '../crew/crew-model.ts';
import { tvMenuPane } from '../crew/tv-menu-pane.tsx';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { requestSettings } from '../settings/settings-request.ts';
import { useTerminalPane } from '../terminal/dock/terminal-pane.tsx';
import { ThemePicker } from '../theme/ThemePicker.tsx';
import { usePhone } from '../ui/breakpoints.ts';
import { SlidersIcon } from '../ui/icons.tsx';
import { BROWSER_KEYS } from '../ui/Keys.tsx';
import { MAC } from '../ui/shortcuts.ts';

interface ChatHeadToolsProps {
  conversationId: string;
  agents: CrewAgent[];
  browser: { open: boolean; onToggle: () => void } | null;
  onAudit?: (() => void) | undefined;
  onStartFresh: () => void;
  terminalDock?: boolean;
  canStartFresh?: boolean;
}

export function ChatHeadTools({
  conversationId,
  agents,
  browser,
  onAudit,
  onStartFresh,
  terminalDock = true,
  canStartFresh = true,
}: ChatHeadToolsProps) {
  const phone = usePhone();
  const { remote } = useRemoteClient();
  const tv = useAgentTv();
  const menuButton = useRef<HTMLButtonElement>(null);
  const browserPane = browser && !remote ? browser : null;
  useBrowserShortcut(browserPane ? browserPane.onToggle : null);
  const terminalPane = useTerminalPane(conversationId, menuButton, !remote && terminalDock);
  const tvPane = tvMenuPane(conversationId, agents, tv.sourceId);
  const panes: ChatMenuPane[] = [
    ...(tvPane ? [tvPane] : []),
    ...(browserPane
      ? [
          {
            label: 'Browser',
            icon: <GlobeIcon />,
            open: browserPane.open,
            keys: BROWSER_KEYS,
            ariaKeys: MAC ? 'Meta+Shift+B' : 'Control+Shift+B',
            controls: 'work-panel',
            onToggle: browserPane.onToggle,
          },
        ]
      : []),
    ...(terminalPane ? [terminalPane] : []),
  ];
  return (
    <>
      {(onAudit || phone || panes.length > 0) && (
        <ChatHeaderMenu
          chatId={conversationId}
          onAudit={onAudit}
          onStartFresh={onAudit && canStartFresh ? onStartFresh : undefined}
          panes={panes}
          extras={
            phone
              ? [{ label: 'Theme', icon: <SlidersIcon />, onSelect: () => requestSettings('look') }]
              : []
          }
          buttonRef={menuButton}
        />
      )}
      {!phone && <ThemePicker />}
    </>
  );
}
