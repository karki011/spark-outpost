import { friendlyStep, type TerminalTranscriptItem } from '@spark-outpost/contracts';
import { Markdown } from '../../chat/markdown/Markdown.tsx';

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
      {items.map((item) => (
        <li key={item.id} className={`rt-item rt-${item.kind}`}>
          <RemoteTerminalItem item={item} />
        </li>
      ))}
    </ol>
  );
}

function RemoteTerminalItem({ item }: { item: TerminalTranscriptItem }) {
  switch (item.kind) {
    case 'user':
      return <p className="rt-user-text">{item.text}</p>;
    case 'assistant':
      return <Markdown text={item.text} />;
    case 'tool':
      return (
        <p className="rt-tool-line">
          <span className="rt-tool-name">{friendlyStep(item.tool ?? '')}</span>
          {item.text && <code>{item.text}</code>}
        </p>
      );
    case 'interrupt':
      return <p className="rt-interrupt">{item.text}</p>;
  }
}
