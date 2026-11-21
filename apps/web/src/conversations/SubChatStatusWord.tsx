import './sub-chat-rows.css';
import type { ReactNode } from 'react';
import { SUB_CHAT_STATUS_WORDS, type SubChatStatus } from '@spark-outpost/contracts';
import { BellIcon, CheckIcon, EyeIcon, PauseIcon, StrokeIcon } from '../ui/icons.tsx';

const ICONS: Record<SubChatStatus, ReactNode> = {
  needs_you: <BellIcon />,
  working: <StrokeIcon path="M12 3a9 9 0 1 0 9 9" />,
  held: <PauseIcon />,
  ready_for_review: <EyeIcon />,
  done: <CheckIcon className="sub-status-check" />,
};

export function SubChatStatusWord({ status }: { status: SubChatStatus }) {
  return (
    <span className="sub-status" data-status={status}>
      {ICONS[status]}
      <span>{SUB_CHAT_STATUS_WORDS[status]}</span>
    </span>
  );
}
