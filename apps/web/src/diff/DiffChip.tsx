import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DiffStat } from '../chat/changes/FileChangeList.tsx';
import { formatTotal } from '../chat/changes/change-rules.ts';
import { DIFF_KEYS } from '../ui/Keys.tsx';
import { hasModifier, MAC } from '../ui/shortcuts.ts';
import { useTooltip } from '../ui/Tooltip.tsx';
import { diffApi, diffKeys } from './diff-api.ts';

const DIFF_SHORTCUT_ARIA = MAC ? 'Meta+Shift+D' : 'Control+Shift+D';

export function isDiffShortcut(event: KeyboardEvent): boolean {
  return hasModifier(event) && event.shiftKey && !event.altKey && event.code === 'KeyD';
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
  const tip = useTooltip('Review changes', { keys: DIFF_KEYS });
  const visible = taskId !== null && (summary.data?.files ?? 0) > 0;
  const button = useRef<HTMLButtonElement>(null);
  const toggle = useRef(onToggle);
  useEffect(() => {
    toggle.current = onToggle;
  }, [onToggle]);
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isDiffShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!document.activeElement?.closest('.dd')) button.current?.focus();
      toggle.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [visible]);
  if (!visible || !summary.data) return null;
  const { added, removed, files } = summary.data;
  return (
    <>
      <button
        ref={button}
        type="button"
        className="dchip"
        aria-label={diffChipLabel(added, removed, files)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts={DIFF_SHORTCUT_ARIA}
        {...tip.triggerProps}
        onClick={onToggle}
      >
        <span className="plus">+{formatTotal(added)}</span>
        <span className="minus">−{formatTotal(removed)}</span>
        <DiffStat added={added} removed={removed} />
      </button>
      {tip.tooltip}
    </>
  );
}
