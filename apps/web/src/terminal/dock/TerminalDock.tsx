import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import '../terminal.css';
import './terminal-dock.css';
import { PlusIcon, XIcon } from '../../ui/icons.tsx';
import { useTooltip } from '../../ui/Tooltip.tsx';
import { DockResizer } from './DockResizer.tsx';
import { useDockHeight } from './dock-height.ts';
import {
  attachedShell,
  chatOf,
  closeShell,
  hideShells,
  newShell,
  parkHost,
  selectShell,
  shellCommand,
  useChatShells,
  type ShellTab,
} from './shell-store.ts';
import { StopShellConfirm } from './StopShellConfirm.tsx';
import { CHAT_MENU_BUTTON_ID } from '../../audit/ChatHeaderMenu.tsx';
import { TERMINAL_DOCK_ID } from './terminal-pane.tsx';

interface Stopping {
  tabId: string;
  command: string;
}

export function tabNames(tabs: readonly ShellTab[]): Map<string, string> {
  const seen = new Map<string, number>();
  const names = new Map<string, string>();
  for (const tab of tabs) {
    const label = tab.label ?? 'Terminal';
    const count = (seen.get(label) ?? 0) + 1;
    seen.set(label, count);
    names.set(tab.id, count === 1 ? label : `${label} (${count})`);
  }
  return names;
}

function DockTab({
  chatId,
  tab,
  name,
  active,
  onClose,
}: {
  chatId: string;
  tab: ShellTab;
  name: string;
  active: boolean;
  onClose: () => void;
}) {
  const classes = ['term-tab', active ? 'on' : '', tab.status === 'ended' ? 'ended' : ''];
  return (
    <div className={classes.filter(Boolean).join(' ')}>
      <button
        type="button"
        className="term-tab-pick"
        aria-pressed={active}
        title={tab.cwd ?? undefined}
        onClick={() => selectShell(chatId, tab.id)}
      >
        <span className={`term-light ${tab.status}`} aria-hidden="true" />
        {tab.label === null ? (
          <>
            <i className="term-tab-skel" aria-hidden="true" />
            <span className="sr-only">Opening terminal</span>
          </>
        ) : (
          <span className="term-tab-name">{name}</span>
        )}
      </button>
      <button
        type="button"
        className="term-tab-x"
        aria-label={`Close ${name}`}
        data-tab={tab.id}
        onClick={onClose}
      >
        <XIcon />
      </button>
    </div>
  );
}

export function TerminalDock({ chatId }: { chatId: string }) {
  const shells = useChatShells(chatId);
  const [height, setHeight] = useDockHeight();
  const section = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [stopping, setStopping] = useState<Stopping | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const addTip = useTooltip('New terminal');
  const hideTip = useTooltip('Hide terminal');
  const active = shells.tabs.find((tab) => tab.id === shells.activeId) ?? null;
  const activeId = active?.id ?? null;
  const host = active?.host ?? null;

  useLayoutEffect(() => {
    const target = body.current;
    if (!shells.open || !host || !activeId || !target) return;
    target.replaceChildren(host);
    attachedShell(activeId);
    return () => parkHost(host);
  }, [shells.open, host, activeId]);

  if (!shells.open) return null;
  const names = tabNames(shells.tabs);
  const stoppingTab = shells.tabs.find(
    (tab) => tab.id === stopping?.tabId && tab.status === 'open',
  );

  const requestClose = async (tab: ShellTab) => {
    const command = await shellCommand(chatId, tab.id);
    if (!command) {
      closeShell(chatId, tab.id);
      return;
    }
    const name = names.get(tab.id) ?? 'Terminal';
    setAnnouncement(`${command} is still running in ${name}. Hold to stop it, or keep it running.`);
    setStopping({ tabId: tab.id, command });
  };

  const keepRunning = ({ tabId, command }: Stopping) => {
    setStopping(null);
    setAnnouncement(`${command} keeps running.`);
    section.current?.querySelector<HTMLButtonElement>(`.term-tab-x[data-tab="${tabId}"]`)?.focus();
  };

  const stop = ({ tabId, command }: Stopping) => {
    setStopping(null);
    setAnnouncement(`Stopped ${command}.`);
    closeShell(chatId, tabId, true);
    if (chatOf(chatId).tabs.length === 0) document.getElementById(CHAT_MENU_BUTTON_ID)?.focus();
  };

  return (
    <section
      ref={section}
      id={TERMINAL_DOCK_ID}
      className="term-dock"
      aria-label="Terminal"
      style={{ '--term-h': `${height}px` } as CSSProperties}
    >
      <DockResizer height={height} onHeight={setHeight} />
      <div className="term-dock-head">
        <div className="term-tabs" role="group" aria-label="Terminals">
          {shells.tabs.map((tab) => (
            <DockTab
              key={tab.id}
              chatId={chatId}
              tab={tab}
              name={names.get(tab.id) ?? 'Terminal'}
              active={tab.id === activeId}
              onClose={() => void requestClose(tab)}
            />
          ))}
          <button
            type="button"
            className="icon-btn term-add"
            aria-label="New terminal"
            {...addTip.triggerProps}
            onClick={() => newShell(chatId)}
          >
            <PlusIcon />
          </button>
          {addTip.tooltip}
        </div>
        {active?.cwd && (
          <span className="term-where" title={active.cwd}>
            <bdi>{active.cwd}</bdi>
          </span>
        )}
        <button
          type="button"
          className="icon-btn term-hide"
          aria-label="Hide terminal"
          {...hideTip.triggerProps}
          onClick={() => {
            hideShells(chatId);
            document.getElementById(CHAT_MENU_BUTTON_ID)?.focus();
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {hideTip.tooltip}
      </div>
      <div className="term-dock-body" ref={body} />
      {stopping && stoppingTab && (
        <StopShellConfirm
          key={stopping.tabId}
          command={stopping.command}
          name={names.get(stoppingTab.id) ?? 'Terminal'}
          onStop={() => stop(stopping)}
          onKeep={() => keepRunning(stopping)}
        />
      )}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {active?.status === 'ended' && (
        <p className="term-dock-ended" role="status">
          <span>{active.notice}</span>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              closeShell(chatId, active.id);
              newShell(chatId);
            }}
          >
            Start a new terminal
          </button>
        </p>
      )}
    </section>
  );
}
