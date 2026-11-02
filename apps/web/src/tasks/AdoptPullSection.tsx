import './autonomy-section.css';
import { AdoptPullList } from '../chat/project/AdoptPullList.tsx';
import { useChatWorkspace } from '../chat/project/use-chat-workspace.ts';

export function AdoptPullSection({ conversationId }: { conversationId: string }) {
  const workspace = useChatWorkspace(conversationId);
  const data = workspace.data;
  if (!data?.projectId || data.current || data.place !== 'worktree') return null;
  return (
    <section className="wauto" aria-label="Pull request">
      <AdoptPullList conversationId={conversationId} projectId={data.projectId} />
    </section>
  );
}
