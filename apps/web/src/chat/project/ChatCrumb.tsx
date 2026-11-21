import './chat-crumb.css';
import { shownChatTitle, type ConversationSummary, type Project } from '@spark-outpost/contracts';
import { SubChatStatusWord } from '../../conversations/SubChatStatusWord.tsx';
import { repoSummary } from './repo-list.ts';

interface ChatCrumbProps {
  chat: ConversationSummary | undefined;
  repos: readonly Project[];
  onOpenChat: (conversationId: string) => void;
}

export function ChatCrumb({ chat, repos, onOpenChat }: ChatCrumbProps) {
  const parent = chat?.parent;
  if (parent) {
    const title = shownChatTitle(parent.title);
    return (
      <nav className="sub-crumb" aria-label="Parent chat">
        <button
          type="button"
          className="sub-crumb-back"
          title={`Back to ${title}`}
          onClick={() => onOpenChat(parent.id)}
        >
          <span aria-hidden="true">‹ </span>
          <span className="sr-only">Back to </span>
          <span className="sub-crumb-name">{title}</span>
        </button>
        <span aria-hidden="true">/</span>
      </nav>
    );
  }
  if (repos.length === 0) return null;
  return (
    <span className="crumb" title={repos.map((repo) => repo.rootPath).join('\n')}>
      {repoSummary(repos.map((repo) => repo.name))} /
    </span>
  );
}

export function ChatHeadStatus({ chat }: { chat: ConversationSummary | undefined }) {
  if (!chat?.subChat) return null;
  return <SubChatStatusWord status={chat.subChat.status} />;
}
