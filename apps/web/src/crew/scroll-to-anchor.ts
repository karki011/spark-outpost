import type { ConversationSummary } from '@spark-outpost/contracts';
import { prefersReducedMotion } from '../ui/motion.ts';
import { approvalAnchor } from './conversation-crew.ts';

const SCROLL_TRIES = 30;
const JUMP_TRIES = 180;

export function scrollToAnchor(anchor: string, tries = SCROLL_TRIES) {
  const target = document.getElementById(anchor);
  if (!target) {
    if (tries > 0) requestAnimationFrame(() => scrollToAnchor(anchor, tries - 1));
    return;
  }
  target.scrollIntoView({
    block: 'center',
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
  target.classList.remove('flash');
  void target.offsetWidth;
  target.classList.add('flash');
}

export function scrollToChatApproval(chat: Pick<ConversationSummary, 'attention'>) {
  const approvalId = chat.attention?.approvalId;
  if (approvalId) scrollToAnchor(approvalAnchor(approvalId), JUMP_TRIES);
}
