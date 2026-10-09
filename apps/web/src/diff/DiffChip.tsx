import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChangeSummary } from '@spark-outpost/contracts';
import { DiffStat, LineTotals } from '../chat/changes/FileChangeList.tsx';
import { DIFF_KEYS } from '../ui/Keys.tsx';
import { MAC } from '../ui/shortcuts.ts';
import { TERMINAL_DOCK_ID } from '../terminal/dock/TerminalButton.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { diffApi, diffKeys } from './diff-api.ts';
import { matchesDiffShortcut } from './diff-shortcut.ts';

const DIFF_SHORTCUT_ARIA = MAC ? 'Meta+D' : 'Control+D';

function typingEndOfInput(event: KeyboardEvent): boolean {
  if (MAC || event.shiftKey) return false;
  return Boolean(document.activeElement?.closest(`#${TERMINAL_DOCK_ID}`));
}

export function diffChipLabel(added: number, removed: number, files: number): string {
  const count = (value: number) => value.toLocaleString('en-US');
  const where = `${count(files)} ${files === 1 ? 'file' : 'files'}`;
  return `${count(added)} ${added === 1 ? 'line' : 'lines'} added, ${count(removed)} removed in ${where}`;
}

interface DiffChipProps {
  taskId: string | null;
  open: boolean;
  onToggle(): void;
}

export function DiffChip({ taskId, open, onToggle }: DiffChipProps) {
  const summary = useQuery({
    queryKey: diffKeys.summary(taskId ?? ''),
    queryFn: () => diffApi.summary(taskId ?? ''),
    enabled: taskId !== null,
  });
  const visible = taskId !== null && (summary.data?.files ?? 0) > 0;
  const slot = useRef<HTMLSpanElement>(null);
  const toggle = useRef(onToggle);
  useEffect(() => {
    toggle.current = onToggle;
  }, [onToggle]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesDiffShortcut(event, MAC)) return;
      if (!slot.current || slot.current.closest('[hidden]')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (typingEndOfInput(event)) return;
      event.preventDefault();
      event.stopPropagation();
      toggle.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
  return (
    <span ref={slot} className="dchip-slot">
      {visible && summary.data && (
        <DiffChipButton summary={summary.data} open={open} onToggle={onToggle} />
      )}
    </span>
  );
}

interface DiffChipButtonProps {
  summary: ChangeSummary;
  open: boolean;
  onToggle(): void;
}

function DiffChipButton({ summary, open, onToggle }: DiffChipButtonProps) {
  const tip = useTooltip('Review changes', { keys: DIFF_KEYS });
  const { added, removed, files } = summary;
  return (
    <>
      <button
        type="button"
        className="dchip"
        aria-label={diffChipLabel(added, removed, files)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts={DIFF_SHORTCUT_ARIA}
        {...tip.triggerProps}
        onClick={onToggle}
      >
        <LineTotals added={added} removed={removed} />
        <DiffStat added={added} removed={removed} />
      </button>
      {tip.tooltip}
    </>
  );
}
