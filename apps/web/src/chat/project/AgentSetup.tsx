import './agent-setup.css';
import { useEffect, useId, useState, type RefObject } from 'react';
import type { Project } from '@spark-outpost/contracts';
import { SlidersIcon } from '../../ui/icons.tsx';
import { usePopover } from '../../ui/use-popover.ts';
import { EverydayCards, HooksCard, IgnoredCard, McpCard } from './AgentSetupCards.tsx';
import { needsAttention } from './agent-setup.ts';
import { useAgentConfig, useAgentConfigChange } from './use-agent-config.ts';

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])';

function useFocusTrap(panelRef: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const focusables = () => [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    (focusables()[0] ?? panel).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusables();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener('keydown', onKeyDown);
    return () => panel.removeEventListener('keydown', onKeyDown);
  }, [panelRef, open]);
}

function RepoSetup({ project }: { project: Project }) {
  const config = useAgentConfig(project.id);
  const change = useAgentConfigChange(project.id);
  if (config.isPending) return <p className="as-empty">Looking at {project.name}…</p>;
  if (config.isError) {
    return (
      <p className="mpop-error" role="alert">
        {config.error.message}
      </p>
    );
  }
  const props = {
    config: config.data,
    name: project.name,
    busy: change.isPending,
    onChange: change.mutate,
  };
  return (
    <div className="as-cards">
      {change.isError && (
        <p className="mpop-error" role="alert">
          {change.error.message}
        </p>
      )}
      {config.data.warnings.map((warning) => (
        <p key={warning} className="as-note">
          {warning}
        </p>
      ))}
      <EverydayCards {...props} />
      <HooksCard {...props} />
      <McpCard {...props} />
      <IgnoredCard config={config.data} />
    </div>
  );
}

export function AgentSetup({ repos }: { repos: Project[] }) {
  const popover = usePopover<HTMLButtonElement, HTMLDivElement>();
  const { open, toggle, anchorRef, panelRef } = popover;
  const panelId = useId();
  const titleId = useId();
  const primary = repos[0]!;
  const [chosenId, setChosenId] = useState(primary.id);
  const shown = repos.find((repo) => repo.id === chosenId) ?? primary;
  const config = useAgentConfig(primary.id);
  const attention = config.data ? needsAttention(config.data) : false;
  useFocusTrap(panelRef, open);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="ctx-setup"
        aria-label={`Agent setup for ${primary.name}${attention ? ' (some parts are off)' : ''}`}
        title={`Agent setup for ${primary.name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        <SlidersIcon />
        {attention && <span className="ctx-dot" aria-hidden="true" />}
      </button>
      <div
        ref={panelRef}
        id={panelId}
        className={open ? 'mpop setuppop open' : 'mpop setuppop'}
        role="dialog"
        tabIndex={-1}
        aria-labelledby={titleId}
      >
        <div className="as-top">
          <h2 id={titleId}>Agent setup</h2>
          <p>What {shown.name} gives the agents. Changes apply to the next message.</p>
        </div>
        {repos.length > 1 && (
          <div className="as-repos" role="group" aria-label="Repo">
            {repos.map((repo) => (
              <button
                key={repo.id}
                type="button"
                aria-pressed={repo.id === shown.id}
                onClick={() => setChosenId(repo.id)}
              >
                {repo.name}
              </button>
            ))}
          </div>
        )}
        {open && <RepoSetup key={shown.id} project={shown} />}
      </div>
    </>
  );
}
