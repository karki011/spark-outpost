import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileIcon } from '../chat/attachments/attachment-icons.tsx';
import { ArtifactIcon } from '../ui/icons.tsx';
import { MemberFace } from './MemberFace.tsx';
import type { MemberView } from './member-view.ts';
import type { ReactNode } from 'react';
import { outpostLibrary, type LibraryEntry } from './outpost-library.ts';
import { outpostKeys, outpostsApi } from './outposts-api.ts';

interface LibraryTabProps {
  outpostId: string;
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

export function LibraryTab({ outpostId, members, onOpenChat }: LibraryTabProps) {
  const signal = members.map((member) => `${member.conversationId}:${member.state}`).join(',');
  const query = useQuery({
    queryKey: outpostKeys.library(outpostId, signal),
    queryFn: () => outpostsApi.library(outpostId),
    placeholderData: keepPreviousData,
  });
  const library = outpostLibrary(members, query.data);
  const loading = query.isPending;
  if (library.artifacts.length === 0 && library.files.length === 0) {
    return (
      <p className="op-pane-empty" aria-busy={loading}>
        {loading
          ? 'Gathering the chats’ files…'
          : 'No files yet. Pages the chats make and files added to them show here; changed code shows on each request.'}
      </p>
    );
  }
  return (
    <div className="op-groups">
      <p className="op-pane-note">Files and pages the member chats made. Open one in its chat.</p>
      <Section
        title="Artifacts"
        items={library.artifacts}
        icon={<ArtifactIcon />}
        onOpenChat={onOpenChat}
      />
      <Section
        title="Chat files"
        items={library.files}
        icon={<FileIcon />}
        onOpenChat={onOpenChat}
      />
    </div>
  );
}
