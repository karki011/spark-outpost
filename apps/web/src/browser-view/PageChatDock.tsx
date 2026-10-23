import './page-chat-dock.css';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { InvolvementLevel } from '@spark-outpost/contracts';
import { useProjects } from '../chat/project/use-chat-repos.ts';
import { CloseIcon } from '../tasks/TaskIcons.tsx';
import { DockChip } from './DockChip.tsx';
import { ArrowUpIcon, EyeIcon, ExternalLinkIcon } from '../ui/icons.tsx';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { startPageChat, type PageRef } from './page-chat.ts';

export interface DockRequest {
  key: number;
  page: PageRef | null;
  selection: string | null;
  link: string | null;
}

interface PageChatDockProps {
  request: DockRequest;
  onOpenChat(chatId: string): void;
  onClose(): void;
}

const LEVELS: { id: InvolvementLevel; label: string; description: string }[] = [
  { id: 'hands-off', label: 'Automatic', description: 'Keeps changes; publishes nothing' },
  { id: 'full-auto', label: 'Full auto → PR', description: 'Keeps changes, then opens a PR' },
];

export function PageChatDock({ request, onOpenChat, onClose }: PageChatDockProps) {
  const projects = useProjects();
  const ids = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const [page, setPage] = useState(request.page);
  const [selection, setSelection] = useState(request.selection);
  const [text, setText] = useState(request.link ? `Open ${request.link} and ` : '');
  const [projectId, setProjectId] = useState<string>('');
  const [level, setLevel] = useState<InvolvementLevel>('hands-off');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [started, setStarted] = useState<string | null>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const send = async () => {
    if (text.trim() === '' || sending) return;
    setSending(true);
    setProblem(null);
    try {
      const chatId = await startPageChat({
        page,
        selection,
        text: text.trim(),
        projectId: projectId || null,
        level,
      });
      setStarted(chatId);
    } catch (error) {
      setProblem((error as Error).message || 'The chat didn’t start.');
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <aside className="pcd" aria-labelledby={`${ids}-title`} onKeyDown={onKeyDown}>
      <header className="pcd-head">
        <h2 id={`${ids}-title`}>New chat</h2>
        <span className="pcd-badge">Beside this tab</span>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      {started ? (
        <div className="pcd-started" role="status">
          <p>The chat started. It keeps running when you close this.</p>
          <button type="button" className="btn" onClick={() => onOpenChat(started)}>
            <ExternalLinkIcon />
            Open chat
          </button>
        </div>
      ) : (
        <>
          <p className="pcd-note">
            <EyeIcon />
            The page and your selection go with your first message as attachments marked untrusted,
            read when you send. Only what you type is your message.
          </p>
          <form
            className="pcd-form"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            {(page || selection) && (
              <ul className="pcd-chips" aria-label="Attached">
                {page && (
                  <DockChip
                    label={page.title || page.url}
                    detail="page text"
                    removeLabel="Remove page text"
                    onRemove={() => {
                      setPage(null);
                      input.current?.focus();
                    }}
                  />
                )}
                {selection && (
                  <DockChip
                    label="Selected text"
                    detail={`${selection.length} chars`}
                    removeLabel={`Remove ${selection.length} chars`}
                    onRemove={() => {
                      setSelection(null);
                      input.current?.focus();
                    }}
                  />
                )}
              </ul>
            )}
            <textarea
              ref={input}
              className="inp pcd-input"
              aria-label="Message"
              placeholder="What should the agent do with this page?"
              rows={4}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing)
                  return;
                event.preventDefault();
                void send();
              }}
            />
            <div className="pcd-row">
              <ChoicePicker
                label="Project"
                choices={[
                  { id: '', label: 'No project' },
                  ...(projects.data ?? []).map((project) => ({
                    id: project.id,
                    label: project.name,
                  })),
                ]}
                value={projectId}
                onChange={setProjectId}
              />
              <ChoicePicker
                label="Autonomy"
                choices={LEVELS}
                value={level}
                onChange={(id) => setLevel(id === 'full-auto' ? 'full-auto' : 'hands-off')}
              />
              <button
                type="submit"
                className="icon-btn pcd-send"
                aria-label="Send"
                disabled={text.trim() === '' || sending}
              >
                <ArrowUpIcon />
              </button>
            </div>
            {problem && (
              <p className="pcd-problem" role="alert">
                {problem}
              </p>
            )}
          </form>
        </>
      )}
    </aside>
  );
}
