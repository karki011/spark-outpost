import './spark-setup.css';
import { useEffect, useRef } from 'react';
import { SPARK_INSTRUCTIONS_FILE, type TeammateView } from '@spark-outpost/contracts';
import { TrySpark } from '../crew-flows/TrySpark.tsx';
import { SparkIdentity } from './SparkDetails.tsx';
import type { FilesStart } from './SparkFiles.tsx';
import { SparkHandoff, SparkProjects } from './SparkHandoff.tsx';
import { SparkRunsOn } from './SparkRunsOn.tsx';
import { InstructionsCard, SkillsCard } from './SparkSideCards.tsx';
import { SparkUsedIn } from './SparkUsedIn.tsx';
import { useSparkFolder } from './use-crew-files.ts';

interface SparkSetupProps {
  spark: TeammateView;
  trying: boolean;
  onOpenFile: (start: FilesStart) => void;
  onOpenSpark: (sparkId: string) => void;
  onDeleted: () => void;
}

export function SparkSetup({ spark, trying, onOpenFile, onOpenSpark, onDeleted }: SparkSetupProps) {
  const folder = useSparkFolder(spark.id);
  const tryRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (trying) tryRef.current?.focus();
  }, [trying]);
  return (
    <div className="spk-setup">
      {trying && (
        <section ref={tryRef} className="spk-box spk-try" aria-label="Try it" tabIndex={-1}>
          <TrySpark key={spark.id} spark={spark} />
        </section>
      )}
      <div className="spk-setup-main">
        <SparkRunsOn spark={spark} />
        <SparkHandoff spark={spark} />
        <SparkProjects spark={spark} />
        <SparkIdentity spark={spark} onDeleted={onDeleted} />
      </div>
      <div className="spk-setup-side">
        <InstructionsCard
          spark={spark}
          onEdit={() => onOpenFile({ kind: 'file', path: SPARK_INSTRUCTIONS_FILE })}
        />
        <SkillsCard
          skills={folder.data?.skills}
          onOpen={(path) => onOpenFile({ kind: 'file', path })}
          onNew={() => onOpenFile({ kind: 'new-skill' })}
        />
        <SparkUsedIn sparkId={spark.id} onOpenSpark={onOpenSpark} />
      </div>
    </div>
  );
}
