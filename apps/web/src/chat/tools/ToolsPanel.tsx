import { useEffect, useId, useRef, type RefObject } from 'react';
import type { Project } from '@spark-outpost/contracts';
import { requestSettings } from '../../settings/settings-request.ts';
import { ToolsGroups } from './ToolsGroups.tsx';

interface ToolsPanelProps {
  conversationId: string;
  repos: readonly Project[];
  provider: string | null;
  onClose: () => void;
}

function useDismiss(panel: RefObject<HTMLDivElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    panel.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onCloseRef.current();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [panel]);
}

export function ToolsPanel({ conversationId, repos, provider, onClose }: ToolsPanelProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useDismiss(panelRef, onClose);
  return (
    <div
      ref={panelRef}
      className="mpop left mcppop tools-panel open"
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <h2 id={titleId}>Tools in this chat</h2>
      <p>
        Changes apply to the next message.
        {repos.length > 0 && ' Hooks and trust are in Agent setup under the message box.'}
      </p>
      <ToolsGroups
        conversationId={conversationId}
        repos={repos}
        provider={provider}
        className="tools-scroll"
      />
      <div className="mcppop-foot">
        <button
          type="button"
          className="btn line sm"
          onClick={() => {
            onClose();
            requestSettings('mcp');
          }}
        >
          Manage in Settings
        </button>
        <button type="button" className="btn ghost sm" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
