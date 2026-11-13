import './sparks-page.css';
import '../teammates/teammates.css';
import '../teammates/teammate-sheet.css';
import './builder.css';
import { useCallback, useState, type ReactNode } from 'react';
import type { CrewDraft, Teammate } from '@spark-outpost/contracts';
import { requestChat } from '../app/chat-request.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { openTeammateSheet, useTeammateCreated } from '../teammates/teammate-store.ts';
import { useTeammates } from '../teammates/use-teammates.ts';
import { DocLink } from '../ui/DocLink.tsx';
import { PlusIcon, SparkleIcon } from '../ui/icons.tsx';
import { PageTabs } from '../ui/PageTabs.tsx';
import { BuilderDock } from './BuilderDock.tsx';
import { BuilderDrafts } from './BuilderDrafts.tsx';
import { CrewTab } from './CrewTab.tsx';
import { SparkDetail, type DetailTab } from './SparkDetail.tsx';
import {
  useSparksPageRequests,
  type SparksPageRequest,
  type SparksPageTab,
} from './sparks-route.ts';
import { useWorkflowCount, WorkflowsTab } from './WorkflowsTab.tsx';

interface WithBuilderProps {
  open: boolean;
  chatId: string | null;
  onChat(chatId: string | null): void;
  onClose(): void;
  children: ReactNode;
}

function WithBuilder({ open, chatId, onChat, onClose, children }: WithBuilderProps) {
  return (
    <>
      {children}
      {open && <BuilderDock chatId={chatId} onChat={onChat} onClose={onClose} />}
    </>
  );
}

export function SparksPage() {
  const { loading, error, teammates, starters } = useTeammates();
  const { remote } = useRemoteClient();
  const workflows = useWorkflowCount();
  const [tab, setTab] = useState<SparksPageTab>('crew');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('details');
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderChatId, setBuilderChatId] = useState<string | null>(null);
  const closeBuilder = useCallback(() => {
    setBuilderOpen(false);
    setBuilderChatId(null);
  }, []);
  const review = useCallback((draft: CrewDraft) => {
    if (!draft.inBuilder) {
      requestChat(draft.conversationId);
      return;
    }
    setBuilderChatId(draft.conversationId);
    setBuilderOpen(true);
  }, []);
  const open = useCallback((sparkId: string | null) => {
    setTab('crew');
    setDetailTab('details');
    setOpenId(sparkId);
  }, []);
  useSparksPageRequests(
    useCallback(
      (request: SparksPageRequest) => {
        open(request.sparkId);
        setTab(request.tab);
        if (request.builder) {
          setBuilderChatId(null);
          setBuilderOpen(true);
        }
      },
      [open],
    ),
  );
  useTeammateCreated(useCallback((created: Teammate) => open(created.id), [open]));
  const spark = teammates.find((entry) => entry.id === openId) ?? null;

  const builder = builderOpen && !remote;
  if (spark) {
    return (
      <WithBuilder
        open={builder}
        chatId={builderChatId}
        onChat={setBuilderChatId}
        onClose={closeBuilder}
      >
        <main className="main sparks" aria-label={`Spark ${spark.name}`}>
          <SparkDetail
            spark={spark}
            tab={detailTab}
            remote={remote}
            onTab={setDetailTab}
            onBack={() => setOpenId(null)}
          />
        </main>
      </WithBuilder>
    );
  }
  return (
    <WithBuilder
      open={builder}
      chatId={builderChatId}
      onChat={setBuilderChatId}
      onClose={closeBuilder}
    >
      <main className="main sparks" aria-labelledby="sparks-title">
        <header className="spk-top">
          <div className="spk-head">
            <div>
              <h1 id="sparks-title">Sparks</h1>
              <p>
                Agents with their own instructions and skills.{' '}
                <DocLink topic="Sparks" doc={{ page: 'sparks' }} />
              </p>
            </div>
            {!remote && (
              <div className="spk-head-actions">
                <button
                  type="button"
                  className="btn sm spk-new-spark"
                  aria-pressed={builderOpen}
                  onClick={() => {
                    if (builderOpen) closeBuilder();
                    else setBuilderOpen(true);
                  }}
                >
                  <SparkleIcon /> Build with an agent
                </button>
                {tab === 'crew' && teammates.length > 0 && (
                  <button
                    type="button"
                    className="btn primary sm spk-new-spark"
                    onClick={() => openTeammateSheet({ kind: 'create' })}
                  >
                    <PlusIcon /> New Spark
                  </button>
                )}
              </div>
            )}
          </div>
          {!remote && <BuilderDrafts builderOpen={builder} onReview={review} />}
          <PageTabs
            ariaLabel="Crew and workflows"
            options={[
              { id: 'crew', label: 'Crew', count: loading ? null : teammates.length },
              { id: 'workflows', label: 'Workflows', count: workflows },
            ]}
            value={tab}
            onChange={(id) => setTab(id as SparksPageTab)}
          />
        </header>
        {tab === 'crew' ? (
          <div className="spk-body" role="tabpanel" aria-label="Crew">
            <CrewTab
              loading={loading}
              error={error}
              sparks={teammates}
              starters={starters}
              remote={remote}
              onOpen={open}
            />
          </div>
        ) : (
          <WorkflowsTab />
        )}
      </main>
    </WithBuilder>
  );
}
