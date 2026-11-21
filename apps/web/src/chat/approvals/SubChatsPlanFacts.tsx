import { Fragment } from 'react';
import {
  subChatPlacement,
  type PlannedSubChat,
  type SparkAction,
  type StartSubChatsAction,
} from '@spark-outpost/contracts';

function settingsOf(piece: PlannedSubChat): string {
  if (piece.sameAsParent) return 'Same as this chat';
  return [piece.agentName, piece.model, piece.effort && `${piece.effort} effort`]
    .filter(Boolean)
    .join(' · ');
}

export function SubChatsPlanFacts({ action }: { action: StartSubChatsAction }) {
  return (
    <dl className="sac-facts">
      {action.pieces.map((piece, index) => (
        <Fragment key={piece.conversationId}>
          <dt>{index + 1}</dt>
          <dd>
            <b>{piece.title}</b> · {piece.project.name} · {subChatPlacement(piece, action.pieces)} ·{' '}
            {settingsOf(piece)}
            <br />
            {piece.task}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function subChatsByline(action: SparkAction, agent: string): string | null {
  if (action.action === 'stop_sub_chat') return `${agent} wants to stop a sub-chat’s turn.`;
  if (action.action !== 'start_sub_chats') return null;
  const count = action.pieces.length;
  return `${agent} wants to split this work into ${count === 1 ? 'a sub-chat' : `${count} sub-chats`}.`;
}

export function subChatsNote(action: SparkAction): string | null {
  if (action.action === 'stop_sub_chat') {
    return 'Nothing is stopped until you confirm. The sub-chat keeps its work and can go on later.';
  }
  if (action.action !== 'start_sub_chats') return null;
  return 'Nothing is created until you start it. Each sub-chat gets its own worktree, branch and pull request, runs in a mode no higher than this chat’s, and its task is the agent’s text, not yours.';
}
