import './rail-tools.css';
import { useCallback, useMemo, useState } from 'react';
import type { Project } from '@spark-outpost/contracts';
import { requestSettings } from '../../settings/settings-request.ts';
import { ToolsGroups } from '../tools/ToolsGroups.tsx';
import type { RailGroups } from '../tools/ToolsGroupFrame.tsx';

interface RailToolsProps {
  conversationId: string;
  repos: readonly Project[];
  provider: string | null;
}

const OPEN_KEY = 'spark-outpost.chat-rail.tools-open';

function readOpen(): readonly string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((key) => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

function writeOpen(keys: readonly string[]): void {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(keys));
  } catch {
    return;
  }
}

function useOpenGroups(): RailGroups {
  const [open, setOpen] = useState(readOpen);
  const toggle = useCallback((key: string) => {
    setOpen((keys) => {
      const next = keys.includes(key) ? keys.filter((entry) => entry !== key) : [...keys, key];
      writeOpen(next);
      return next;
    });
  }, []);
  return useMemo(() => ({ isOpen: (key: string) => open.includes(key), toggle }), [open, toggle]);
}

export function RailTools({ conversationId, repos, provider }: RailToolsProps) {
  const groups = useOpenGroups();
  return (
    <section className="crail-section crail-tools" aria-label="Tools">
      <div className="crail-head">
        <h3 className="crail-title">Tools</h3>
        <button
          type="button"
          className="tools-link crail-manage"
          onClick={() => requestSettings('mcp')}
        >
          Manage
        </button>
      </div>
      <ToolsGroups
        conversationId={conversationId}
        repos={repos}
        provider={provider}
        className="crail-tools-body"
        rail={groups}
      />
      <p className="tools-note crail-tools-note">Changes apply to the next message.</p>
    </section>
  );
}
