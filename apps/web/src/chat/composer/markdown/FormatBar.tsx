import { useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { MAC } from '../../../ui/shortcuts.ts';
import { BLOCK_TOOLS, INLINE_TOOLS, type Tool, type ToolAction } from './format-tools.tsx';
import type { Mark } from './md-inline.ts';
import { ariaShortcut, shortcutLabel, type FormatAction } from './md-keys.ts';

const ALL_TOOLS = [...INLINE_TOOLS, ...BLOCK_TOOLS];

function toolHint(tool: Tool): string {
  const keys = shortcutLabel(tool.action as FormatAction, MAC);
  return keys ? `${tool.label} ${keys}` : tool.label;
}

interface ToolButtonProps {
  tool: Tool;
  active: ReadonlySet<Mark>;
  tabIndex: number;
  onAction: (action: ToolAction) => void;
  onHint?: (hint: string | null) => void;
  onFocus?: () => void;
}

function ToolButton({ tool, active, tabIndex, onAction, onHint, onFocus }: ToolButtonProps) {
  return (
    <button
      type="button"
      className="mdf-tool"
      tabIndex={tabIndex}
      aria-label={tool.label}
      aria-pressed={tool.mark ? active.has(tool.mark) : undefined}
      aria-keyshortcuts={ariaShortcut(tool.action as FormatAction, MAC)}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={() => onHint?.(toolHint(tool))}
      onMouseLeave={() => onHint?.(null)}
      onFocus={() => {
        onHint?.(toolHint(tool));
        onFocus?.();
      }}
      onBlur={() => onHint?.(null)}
      onClick={() => onAction(tool.action)}
    >
      {tool.icon}
    </button>
  );
}

interface FormatBarProps {
  controls: string;
  active: ReadonlySet<Mark>;
  onAction: (action: ToolAction) => void;
  onLeave: () => void;
}

export function FormatBar({ controls, active, onAction, onLeave }: FormatBarProps) {
  const [current, setCurrent] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const move = (index: number) => {
    const next = (index + ALL_TOOLS.length) % ALL_TOOLS.length;
    setCurrent(next);
    barRef.current?.querySelectorAll<HTMLButtonElement>('.mdf-tool')[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      Home: 0,
      End: ALL_TOOLS.length - 1,
    };
    const target = moves[event.key];
    if (target !== undefined) {
      event.preventDefault();
      move(target);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onLeave();
    }
  };

  const button = (tool: Tool, index: number) => (
    <ToolButton
      key={tool.action}
      tool={tool}
      active={active}
      tabIndex={index === current ? 0 : -1}
      onAction={onAction}
      onHint={setHint}
      onFocus={() => setCurrent(index)}
    />
  );

  return (
    <div
      ref={barRef}
      className="mdf-bar"
      role="toolbar"
      aria-label="Formatting"
      aria-controls={controls}
      onKeyDown={onKeyDown}
    >
      {INLINE_TOOLS.map((tool, index) => button(tool, index))}
      <span className="mdf-sep" aria-hidden="true" />
      {BLOCK_TOOLS.map((tool, index) => button(tool, INLINE_TOOLS.length + index))}
      <span className="mdf-hint" aria-hidden="true">
        {hint}
      </span>
    </div>
  );
}

interface SelectionToolbarProps {
  toolbarRef: RefObject<HTMLDivElement | null>;
  active: ReadonlySet<Mark>;
  onAction: (action: ToolAction) => void;
}

export function SelectionToolbar({ toolbarRef, active, onAction }: SelectionToolbarProps) {
  return (
    <div ref={toolbarRef} className="mdf-float" role="toolbar" aria-label="Format selection">
      {INLINE_TOOLS.map((tool) => (
        <ToolButton
          key={tool.action}
          tool={tool}
          active={active}
          tabIndex={-1}
          onAction={onAction}
        />
      ))}
    </div>
  );
}
