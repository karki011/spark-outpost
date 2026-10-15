import '../../chat/thread.css';
import { useId, useState } from 'react';
import { friendlyStep, type TerminalTranscriptItem } from '@spark-outpost/contracts';
import { Markdown } from '../../chat/markdown/Markdown.tsx';
import { StepToggle, stepCount } from '../../chat/WorkLog.tsx';

type Row =
  | { kind: 'item'; item: TerminalTranscriptItem }
  | { kind: 'steps'; tools: TerminalTranscriptItem[] };

const NAMES_SHOWN = 3;

export function transcriptRows(items: readonly TerminalTranscriptItem[]): Row[] {
  const rows: Row[] = [];
  for (const item of items) {
    const last = rows.at(-1);
    if (item.kind === 'tool' && last?.kind === 'steps') last.tools.push(item);
    else if (item.kind === 'tool' && last?.kind === 'item' && last.item.kind === 'tool')
      rows[rows.length - 1] = { kind: 'steps', tools: [last.item, item] };
    else rows.push({ kind: 'item', item });
  }
  return rows;
}

function stepName(tool: TerminalTranscriptItem): string {
  return friendlyStep(tool.tool ?? '').replaceAll('`', '');
}

export function stepsLabel(tools: readonly TerminalTranscriptItem[]): string {
  const names = [...new Set(tools.map(stepName))];
  const shown = names.slice(0, NAMES_SHOWN).join(', ');
  return `${stepCount(tools)}: ${names.length > NAMES_SHOWN ? `${shown}, …` : shown}`;
}

export function RemoteTerminalItems({
  items,
  truncated,
}: {
  items: TerminalTranscriptItem[];
  truncated: boolean;
}) {
  if (items.length === 0) return <p className="rt-empty">Nothing in this session yet.</p>;
  return (
    <ol className="rt-items">
      {truncated && <li className="rt-earlier">Earlier messages are on your Mac.</li>}
      {transcriptRows(items).map((row) =>
        row.kind === 'steps' ? (
          <li key={row.tools[0]!.id} className="rt-item rt-steps">
            <ToolSteps tools={row.tools} />
          </li>
        ) : (
          <li key={row.item.id} className={`rt-item rt-${row.item.kind}`}>
            <RemoteTerminalItem item={row.item} />
          </li>
        ),
      )}
    </ol>
  );
}

function ToolSteps({ tools }: { tools: TerminalTranscriptItem[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className={open ? 'steps open' : 'steps'}>
      <StepToggle log={{ open, listId, toggle: () => setOpen(!open) }} label={stepsLabel(tools)} />
      <ol id={listId} className="rt-step-list" hidden={!open}>
        {tools.map((tool) => (
          <li key={tool.id}>
            <ToolLine item={tool} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function ToolLine({ item }: { item: TerminalTranscriptItem }) {
  return (
    <p className="rt-tool-line">
      <span className="rt-tool-name">{friendlyStep(item.tool ?? '')}</span>
      {item.text && <code>{item.text}</code>}
    </p>
  );
}

function Continues({ item }: { item: TerminalTranscriptItem }) {
  return item.clipped ? <p className="rt-continues">Continues on your Mac.</p> : null;
}

function RemoteTerminalItem({ item }: { item: TerminalTranscriptItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <>
          <p className="rt-user-text">{item.text}</p>
          <Continues item={item} />
        </>
      );
    case 'assistant':
      return (
        <>
          <Markdown text={item.text} />
          <Continues item={item} />
        </>
      );
    case 'tool':
      return <ToolLine item={item} />;
    case 'interrupt':
      return <p className="rt-interrupt">{item.text}</p>;
  }
}
