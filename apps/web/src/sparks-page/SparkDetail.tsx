import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TEAMMATE_STATE_LABELS, type TeammateView } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { requestChat } from '../app/chat-request.ts';
import { TeammateFace } from '../teammates/TeammateFace.tsx';
import { teammatesApi } from '../teammates/teammates-api.ts';
import { BackIcon, CheckIcon, SparkleIcon } from '../ui/icons.tsx';
import { PageTabs } from '../ui/PageTabs.tsx';
import { SparkActivity } from './SparkActivity.tsx';
import { SparkSummary } from './SparkDetails.tsx';
import { SparkFiles, inSkillsScope, type FilesStart } from './SparkFiles.tsx';
import { SparkSetup } from './SparkSetup.tsx';
import { useFollowSparkFolder, useSparkFolder } from './use-crew-files.ts';
import { useSparkSaveState, type SaveState } from './use-spark-save.ts';

export type DetailTab = 'setup' | 'skills' | 'files' | 'activity';

const TAB_LABELS: Record<DetailTab, string> = {
  setup: 'Setup',
  skills: 'Instructions and skills',
  files: 'Files',
  activity: 'Activity',
};

const SAVE_WORDS: Record<Exclude<SaveState, 'idle'>, string> = {
  saving: 'Saving…',
  saved: 'Saved',
  failed: 'Not saved',
};

interface SparkDetailProps {
  spark: TeammateView;
  tab: DetailTab;
  remote: boolean;
  chatOpen: boolean;
  onTab: (tab: DetailTab) => void;
  onChat: () => void;
  onOpenSpark: (sparkId: string) => void;
  onBack: () => void;
}

function useTalkTo(spark: TeammateView) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => teammatesApi.openHome(spark.id),
    onSuccess: (chat) => {
      void client.invalidateQueries({ queryKey: queryKeys.conversations });
      requestChat(chat.conversationId);
    },
  });
}

export function SparkDetail({
  spark,
  tab,
  remote,
  chatOpen,
  onTab,
  onChat,
  onOpenSpark,
  onBack,
}: SparkDetailProps) {
  const titleId = useId();
  const folder = useSparkFolder(spark.id, !remote);
  useFollowSparkFolder(spark.id, chatOpen && !remote);
  const saveState = useSparkSaveState(spark.id);
  const talk = useTalkTo(spark);
  const [trying, setTrying] = useState(false);
  const [start, setStart] = useState<FilesStart | null>(null);
  const openFile = (next: FilesStart) => {
    setStart(next);
    onTab(next.kind === 'file' && !inSkillsScope(next.path) ? 'files' : 'skills');
  };
  const pickTab = (next: DetailTab) => {
    setStart(null);
    onTab(next);
  };
  return (
    <>
      <header className="spk-top">
        <div className="spk-head spk-detail-head">
          <div className="spk-who">
            <button
              type="button"
              className="btn ghost sm spk-back"
              aria-label="All Sparks"
              onClick={onBack}
            >
              <BackIcon /> Sparks
            </button>
            <TeammateFace face={spark.face} state={spark.state} size={44} />
            <div>
              <h1 id={titleId}>{spark.name}</h1>
              <p>{spark.role || 'Spark'}</p>
            </div>
            <span className="spk-state-pill" data-state={spark.state}>
              {TEAMMATE_STATE_LABELS[spark.state]}
            </span>
          </div>
          <div className="spk-head-actions">
            {saveState !== 'idle' && (
              <span className="spk-state" role="status">
                {saveState === 'saved' && <CheckIcon />} {SAVE_WORDS[saveState]}
              </span>
            )}
            {!remote && (
              <button
                type="button"
                className="btn ghost sm spk-new-spark"
                aria-pressed={chatOpen}
                onClick={onChat}
              >
                <SparkleIcon /> Ask an agent
              </button>
            )}
            {!remote && (
              <button
                type="button"
                className="btn line sm"
                aria-pressed={trying && tab === 'setup'}
                onClick={() => {
                  setTrying(tab === 'setup' ? !trying : true);
                  onTab('setup');
                }}
              >
                Try it
              </button>
            )}
            <button
              type="button"
              className="btn primary sm"
              disabled={talk.isPending}
              onClick={() => talk.mutate()}
            >
              Talk to {spark.name}
            </button>
          </div>
        </div>
        {talk.isError && (
          <p className="spk-problem" role="alert">
            Couldn’t open the chat. {talk.error.message}
          </p>
        )}
        {!remote && (
          <PageTabs
            ariaLabel={`${spark.name}: setup, instructions, files and activity`}
            options={[
              { id: 'setup', label: TAB_LABELS.setup },
              { id: 'skills', label: TAB_LABELS.skills, count: folder.data?.skills.length ?? null },
              { id: 'files', label: TAB_LABELS.files, count: folder.data?.files.length ?? null },
              { id: 'activity', label: TAB_LABELS.activity },
            ]}
            value={tab}
            onChange={(id) => pickTab(id as DetailTab)}
          />
        )}
      </header>
      {remote ? (
        <div className="spk-body" role="region" aria-labelledby={titleId}>
          <SparkSummary spark={spark} />
        </div>
      ) : tab === 'setup' ? (
        <div className="spk-body" role="tabpanel" aria-label={TAB_LABELS.setup}>
          <SparkSetup
            key={spark.id}
            spark={spark}
            trying={trying}
            onOpenFile={openFile}
            onOpenSpark={onOpenSpark}
            onDeleted={onBack}
          />
        </div>
      ) : tab === 'activity' ? (
        <div className="spk-body" role="tabpanel" aria-label={TAB_LABELS.activity}>
          <SparkActivity key={spark.id} sparkId={spark.id} />
        </div>
      ) : (
        <div className="spk-body spk-body-files" role="tabpanel" aria-label={TAB_LABELS[tab]}>
          <SparkFiles
            key={`${spark.id}-${tab}-${start ? JSON.stringify(start) : ''}`}
            sparkId={spark.id}
            sparkName={spark.name}
            scope={tab === 'skills' ? 'skills' : 'all'}
            start={start}
          />
        </div>
      )}
    </>
  );
}
