import './run-in-chats.css';
import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { shownChatTitle, type ConversationSummary } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { ModalFrame } from '../ui/ModalFrame.tsx';
import { pickableChats, runInChatsLabel, startInChats, type ChatStart } from './run-in-chats.ts';

interface RunInChatsProps {
  workflowId: string;
  workflowName: string;
  onClose: () => void;
}

function ChatRow({
  chat,
  checked,
  failure,
  onToggle,
}: {
  chat: ConversationSummary;
  checked: boolean;
  failure: string | null;
  onToggle: () => void;
}) {
  return (
    <li>
      <label className="ric-chat">
        <input type="checkbox" checked={checked} onChange={onToggle} />
        <span>{shownChatTitle(chat.title)}</span>
      </label>
      {failure && <p className="ric-failure">{failure}</p>}
    </li>
  );
}

export function RunInChats({ workflowId, workflowName, onClose }: RunInChatsProps) {
  const titleId = useId();
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<readonly ChatStart[]>([]);
  const chats = useQuery({ queryKey: queryKeys.conversations, queryFn: api.listConversations });
  const shown = pickableChats(chats.data ?? [], query);
  const failureOf = (chatId: string): string | null => {
    const result = results.find((entry) => entry.chatId === chatId);
    return result && !result.ok ? result.error : null;
  };
  const toggle = (chatId: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  const run = async () => {
    setBusy(true);
    const started = await startInChats(workflowId, [...picked], message);
    setBusy(false);
    setResults(started);
    const failed = started.filter((result) => !result.ok).map((result) => result.chatId);
    if (failed.length === 0) onClose();
    else setPicked(new Set(failed));
  };
  const failures = results.filter((result) => !result.ok).length;
  return (
    <ModalFrame
      className="ric"
      labelledBy={titleId}
      busy={busy}
      failure={
        failures > 0
          ? `${failures} of ${results.length} didn’t start. The others are running.`
          : null
      }
      footClassName="ric-foot"
      foot={
        <>
          <button type="button" className="btn line sm" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary sm"
            disabled={busy || picked.size === 0}
            onClick={() => void run()}
          >
            {runInChatsLabel(picked.size)}
          </button>
        </>
      }
      onClose={onClose}
    >
      <h3 id={titleId}>Run {workflowName} in chats</h3>
      <p className="ric-hint">
        Each chat gets its own run, in its own folder and branch, all at once.
      </p>
      <input
        type="search"
        className="ric-search"
        aria-label="Find a chat"
        placeholder="Find a chat"
        value={query}
        data-autofocus
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul className="ric-chats" aria-label="Chats">
        {shown.map((chat) => (
          <ChatRow
            key={chat.id}
            chat={chat}
            checked={picked.has(chat.id)}
            failure={failureOf(chat.id)}
            onToggle={() => toggle(chat.id)}
          />
        ))}
        {chats.isSuccess && shown.length === 0 && <li className="ric-none">No chats match.</li>}
      </ul>
      <textarea
        className="ric-message"
        aria-label="Message for each run (optional)"
        placeholder="Message for each run (optional)"
        maxLength={4000}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
      />
    </ModalFrame>
  );
}
