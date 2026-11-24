import type { BrowserPaneTab, BrowserProfile } from '@spark-outpost/contracts';
import { AddressBar } from '../browser/AddressBar.tsx';
import {
  DevtoolsIcon,
  NavBackIcon,
  NavForwardIcon,
  ReloadIcon,
  StopIcon,
} from '../browser/BrowserIcons.tsx';
import { openInDefaultBrowser } from '../browser/chat-links.ts';
import { PANE_KEYS, type PaneCommands } from '../browser/pane-shortcuts.ts';
import { PageTools, ZoomBadge } from '../browser/PageTools.tsx';
import { ToolButton } from '../browser/ToolButton.tsx';
import { PanelLeftIcon, SIDEBAR_TOOL_KEYS } from '../conversations/sidebar-layout.tsx';
import { CommentIcon, ExternalLinkIcon } from '../ui/icons.tsx';
import { keysText, NEW_CHAT_KEYS } from '../ui/Keys.tsx';
import { MAC, shortcutText } from '../ui/shortcuts.ts';
import { ProfileBadge } from './ProfileSwitch.tsx';
import { SplitButton } from './SplitButton.tsx';
import { ViewSelect } from './ViewSelect.tsx';
import { sendViewCommand } from './view-store.ts';

const CHAT_ARIA = MAC ? 'Meta+Shift+O' : 'Control+Shift+O';

interface ViewBarProps {
  profile: BrowserProfile;
  commands: PaneCommands;
  tab: BrowserPaneTab | null;
  tabs: readonly BrowserPaneTab[];
  shown: BrowserPaneTab | null;
  splitShown: boolean;
  peeking: boolean;
  outside: string | null;
  sideHidden: boolean;
  chatOpen: boolean;
  onToggleSide(): void;
  onToggleChat(): void;
  onNewSplitPage(): void;
  onNotice(notice: string): void;
}

export function ViewBar({
  profile,
  commands,
  tab,
  tabs,
  shown,
  splitShown,
  peeking,
  outside,
  sideHidden,
  chatOpen,
  onToggleSide,
  onToggleChat,
  onNewSplitPage,
  onNotice,
}: ViewBarProps) {
  const blank = !tab || tab.url === '' || tab.error !== null;
  const act = (command: 'back' | 'forward' | 'reload' | 'stop') => {
    if (tab) sendViewCommand(profile, { command, tabId: tab.id });
  };
  return (
    <div className="bv-bar">
      <ToolButton
        label={sideHidden ? 'Show sidebar' : 'Hide sidebar'}
        keys={SIDEBAR_TOOL_KEYS}
        pressed={!sideHidden}
        onClick={onToggleSide}
      >
        <PanelLeftIcon />
      </ToolButton>
      {sideHidden && <ProfileBadge profile={profile} />}
      <ToolButton
        label="Back"
        keys={PANE_KEYS.back}
        disabled={!tab?.canGoBack}
        onClick={() => act('back')}
      >
        <NavBackIcon />
      </ToolButton>
      <ToolButton
        label="Forward"
        keys={PANE_KEYS.forward}
        disabled={!tab?.canGoForward}
        onClick={() => act('forward')}
      >
        <NavForwardIcon />
      </ToolButton>
      {tab?.loading ? (
        <ToolButton label="Stop loading" onClick={() => act('stop')}>
          <StopIcon />
        </ToolButton>
      ) : (
        <ToolButton
          label="Reload"
          keys={PANE_KEYS.reload}
          disabled={blank}
          onClick={() => act('reload')}
        >
          <ReloadIcon />
        </ToolButton>
      )}
      {tab?.picking ? (
        <span className="bv-picking" role="status">
          Click to select, ⇧ click for more, ↑↓ parent or child, drag a box. Esc finishes.
        </span>
      ) : (
        <AddressBar
          key={`${profile}:${tab?.id ?? ''}:${tab?.url ?? ''}`}
          commands={commands}
          tab={tab}
          placeholder="Type a web address"
        />
      )}
      <ZoomBadge tab={tab} commands={commands} />
      <button
        type="button"
        className="btn bv-chat-btn"
        aria-pressed={chatOpen}
        aria-keyshortcuts={CHAT_ARIA}
        title={`Chat about this tab (${keysText(NEW_CHAT_KEYS)})`}
        onClick={onToggleChat}
      >
        <CommentIcon />
        Chat
      </button>
      <ViewSelect profile={profile} tab={tab} disabled={blank} />
      <PageTools tab={tab} commands={commands} onNotice={onNotice} />
      <SplitButton
        profile={profile}
        tabs={tabs}
        shown={shown}
        inSplit={splitShown}
        disabled={peeking || shown === null}
        onNewPage={onNewSplitPage}
      />
      <ToolButton
        label={`Open developer tools (${shortcutText(['alt', 'mod', 'I'])})`}
        disabled={blank}
        onClick={() => tab && sendViewCommand(profile, { command: 'devtools', tabId: tab.id })}
      >
        <DevtoolsIcon />
      </ToolButton>
      <ToolButton
        label="Open in default browser"
        disabled={outside === null}
        onClick={() => outside && openInDefaultBrowser(outside)}
      >
        <ExternalLinkIcon />
      </ToolButton>
    </div>
  );
}
