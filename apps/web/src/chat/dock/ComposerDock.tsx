import type { ChatSettings, ConversationDetail, Project, Run } from '@spark-outpost/contracts';
import { ModelSwitchNote } from '../composer/ModelSwitchNote.tsx';
import { PrCard } from '../pull-request/PrCard.tsx';
import type { QuotesState } from '../quotes/use-quotes.ts';
import { WorkflowCard } from '../workflow-card/WorkflowCard.tsx';

const NO_RUNS: Run[] = [];

interface ComposerDockProps {
  conversationId: string;
  detail: ConversationDetail | undefined;
  settings: ChatSettings | null;
  repo: Project | null;
  quotes: QuotesState;
  onOpenLinks: (() => void) | null;
}

export function ComposerDock({
  conversationId,
  detail,
  settings,
  repo,
  quotes,
  onOpenLinks,
}: ComposerDockProps) {
  return (
    <>
      {detail && <WorkflowCard detail={detail} repo={repo} quotes={quotes} />}
      <PrCard conversationId={conversationId} onOpenLinks={onOpenLinks} />
      <ModelSwitchNote
        conversationId={conversationId}
        settings={settings}
        runs={detail?.runs ?? NO_RUNS}
      />
    </>
  );
}
