import { useId } from 'react';
import type { TeammateView } from '@spark-outpost/contracts';
import { TeammateFace } from '../teammates/TeammateFace.tsx';
import { BackIcon, SparkleIcon } from '../ui/icons.tsx';
import { PageTabs } from '../ui/PageTabs.tsx';
import { SparkDetails, SparkSummary } from './SparkDetails.tsx';
import { SparkFiles } from './SparkFiles.tsx';
import { useFollowSparkFolder, useSparkFolder } from './use-crew-files.ts';

export type DetailTab = 'details' | 'files';

interface SparkDetailProps {
  spark: TeammateView;
  tab: DetailTab;
  remote: boolean;
  chatOpen: boolean;
  onTab: (tab: DetailTab) => void;
  onChat: () => void;
  onBack: () => void;
}

export function SparkDetail({
  spark,
  tab,
  remote,
  chatOpen,
  onTab,
  onChat,
  onBack,
}: SparkDetailProps) {
  const titleId = useId();
  const folder = useSparkFolder(spark.id, !remote);
  useFollowSparkFolder(spark.id, chatOpen && !remote);
  return (
    <>
      <header className="spk-top">
        <div className="spk-head">
          <button type="button" className="btn ghost sm spk-back" onClick={onBack}>
            <BackIcon /> All Sparks
          </button>
          {!remote && (
            <button
              type="button"
              className="btn sm spk-new-spark"
              aria-pressed={chatOpen}
              onClick={onChat}
            >
              <SparkleIcon /> Ask an agent
            </button>
          )}
        </div>
        <div className="spk-who">
          <TeammateFace face={spark.face} state={spark.state} size={44} />
          <div>
            <h1 id={titleId}>{spark.name}</h1>
            <p>{spark.role || 'Spark'}</p>
          </div>
        </div>
        {!remote && (
          <PageTabs
            ariaLabel={`${spark.name}: details, skills and files`}
            options={[
              { id: 'details', label: 'Details' },
              { id: 'files', label: 'Skills and files', count: folder.data?.files.length ?? null },
            ]}
            value={tab}
            onChange={(id) => onTab(id as DetailTab)}
          />
        )}
      </header>
      {remote ? (
        <div className="spk-body" role="region" aria-labelledby={titleId}>
          <SparkSummary spark={spark} />
        </div>
      ) : tab === 'details' ? (
        <div className="spk-body" role="tabpanel" aria-label="Details">
          <SparkDetails
            key={spark.id}
            spark={spark}
            onInstructions={() => onTab('files')}
            onDeleted={onBack}
          />
        </div>
      ) : (
        <div className="spk-body spk-body-files" role="tabpanel" aria-label="Skills and files">
          <SparkFiles key={spark.id} sparkId={spark.id} sparkName={spark.name} />
        </div>
      )}
    </>
  );
}
