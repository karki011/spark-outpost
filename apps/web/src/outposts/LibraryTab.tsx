import { useQueries } from '@tanstack/react-query';
import { api, queryKeys } from '../api/client.ts';
import { FileIcon } from '../chat/attachments/attachment-icons.tsx';
import { ArtifactIcon } from '../ui/icons.tsx';
import { MemberFace } from './MemberFace.tsx';
import type { MemberView } from './member-view.ts';
import type { ReactNode } from 'react';
import { outpostLibrary, type LibraryEntry } from './outpost-library.ts';

interface LibraryTabProps {
  members: readonly MemberView[];
  onOpenChat: (conversationId: string) => void;
}

function Section({
  title,
  items,
  icon,
  onOpenChat,
}: {
  title: string;
  items: readonly LibraryEntry[];
  icon: ReactNode;
  onOpenChat: (conversationId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="op-group">
      <h3>
        {title}
        <span className="op-group-count">{items.length}</span>
      </h3>
      <ul>
        {items.map((item) => {
          const name = item.name;
          return (
            <li key={item.id}>
              <button
                type="button"
                className="op-trow"
                aria-label={`${name}, ${item.meta}, from @${item.handle}. Open @${item.handle} in chat`}
                onClick={() => onOpenChat(item.conversationId)}
              >
                <span className="op-lib-icon" aria-hidden="true">
                  {icon}
                </span>
                <span className="op-trow-text">
                  <b>{name}</b>
                  <span className="op-trow-sub">
                    {item.meta} · @{item.handle}
                  </span>
                </span>
                <MemberFace chatId={item.conversationId} size="row" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function LibraryTab({ members, onOpenChat }: LibraryTabProps) {
  const details = useQueries({
    queries: members.map((member) => ({
      queryKey: queryKeys.conversation(member.conversationId),
      queryFn: () => api.getConversation(member.conversationId),
    })),
  });
  const library = outpostLibrary(
    members.map((member, index) => ({
      conversationId: member.conversationId,
      handle: member.handle,
      detail: details[index]?.data,
    })),
  );
  const loading = details.some((detail) => detail.isPending);
  if (library.artifacts.length === 0 && library.files.length === 0) {
    return (
      <p className="op-pane-empty" aria-busy={loading}>
        {loading ? 'Gathering the chats’ files…' : 'No files yet. Pages and files the chats make show here.'}
      </p>
    );
  }
  return (
    <div className="op-groups">
      <p className="op-pane-note">Files and pages the member chats made. Open one in its chat.</p>
      <Section title="Artifacts" items={library.artifacts} icon={<ArtifactIcon />} onOpenChat={onOpenChat} />
      <Section title="Chat files" items={library.files} icon={<FileIcon />} onOpenChat={onOpenChat} />
    </div>
  );
}
