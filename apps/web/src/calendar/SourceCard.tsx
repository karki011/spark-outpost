import '../conversations/chat-menu.css';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MenuItem, MenuShell, type MenuAnchor } from '../conversations/MenuShell.tsx';
import { anchorFor } from '../conversations/menu-anchor.ts';
import { DotsIcon } from '../ui/icons.tsx';
import type { RowsView } from './CalendarAccounts.tsx';
import { CalendarName } from './CalendarName.tsx';
import { DisconnectDialog, type DisconnectCopy } from '../connectors/DisconnectDialog.tsx';

type Panel = 'choose' | 'edit';

const PANEL: Record<Panel, { title: string; label: string }> = {
  choose: { title: 'Choose calendars', label: 'Choose calendars' },
  edit: { title: 'Agents can edit', label: 'Agents can edit' },
};

export const CHOOSE_HINT = 'Included calendars show on Today and count as busy.';

export interface SourceCardProps {
  name: string;
  icon: ReactNode;
  sync: string | null;
  pill: ReactNode;
  hasCalendars: boolean;
  startChoosing: boolean;
  editHint: string;
  disconnect: DisconnectCopy;
  busy?: boolean;
  onDisconnect: () => void;
  rows: (view: RowsView) => ReactNode;
  children?: ReactNode;
}

function PanelBox({
  panel,
  hint,
  onDone,
  children,
}: {
  panel: Panel;
  hint: string;
  onDone: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <div className="cal-panel" role="group" aria-labelledby={titleId} data-panel={panel}>
      <div className="cal-panel-h">
        <p>
          <b id={titleId}>{PANEL[panel].title}</b>
          <small>{hint}</small>
        </p>
        <button type="button" className="btn line sm" onClick={onDone}>
          Done
        </button>
      </div>
      {children}
    </div>
  );
}

export function SourceCard(props: SourceCardProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [panel, setPanel] = useState<Panel | null>(() =>
    props.startChoosing && props.hasCalendars ? 'choose' : null,
  );
  const focusPanel = useRef(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!focusPanel.current || !panel) return;
    focusPanel.current = false;
    bodyRef.current?.querySelector<HTMLElement>('.cal-rows input, .cal-rows button')?.focus();
  }, [panel]);
  const focusTrigger = () => triggerRef.current?.focus();
  const closeMenu = () => {
    setMenu(null);
    focusTrigger();
  };
  const openPanel = (next: Panel) => {
    setMenu(null);
    focusPanel.current = true;
    setPanel(next);
  };
  const donePanel = () => {
    setPanel(null);
    focusTrigger();
  };
  const menuLabel = `Options for ${props.name}`;
  return (
    <section className="cal-source-card" aria-label={props.name}>
      <div className="cal-source-h">
        <span className="cal-source-icon" aria-hidden="true">
          {props.icon}
        </span>
        <p className="cal-source-name">
          <CalendarName name={props.name} />
          {props.sync && <small>{props.sync}</small>}
        </p>
        {props.pill}
        <button
          ref={triggerRef}
          type="button"
          className="icon-btn cal-source-more"
          aria-label={menuLabel}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          onClick={(event) => setMenu(menu ? null : anchorFor(event.currentTarget, null))}
        >
          <DotsIcon />
        </button>
      </div>
      <div ref={bodyRef} className="cal-source-body">
        {props.hasCalendars && panel === null && props.rows('card')}
        {props.hasCalendars && panel !== null && (
          <PanelBox
            panel={panel}
            hint={panel === 'choose' ? CHOOSE_HINT : props.editHint}
            onDone={donePanel}
          >
            {props.rows(panel)}
          </PanelBox>
        )}
        {props.children}
      </div>
      {menu && (
        <MenuShell
          anchor={menu}
          label={menuLabel}
          page="main"
          className="cal-menu"
          onClose={closeMenu}
        >
          {props.hasCalendars && (
            <>
              <MenuItem label={PANEL.choose.label} onSelect={() => openPanel('choose')} />
              <MenuItem label={PANEL.edit.label} onSelect={() => openPanel('edit')} />
            </>
          )}
          <MenuItem
            label="Disconnect…"
            danger
            disabled={props.busy ?? false}
            onSelect={() => {
              setMenu(null);
              setConfirming(true);
            }}
          />
        </MenuShell>
      )}
      {confirming && (
        <DisconnectDialog
          copy={props.disconnect}
          onCancel={() => {
            setConfirming(false);
            focusTrigger();
          }}
          onConfirm={() => {
            setConfirming(false);
            focusTrigger();
            props.onDisconnect();
          }}
        />
      )}
    </section>
  );
}
