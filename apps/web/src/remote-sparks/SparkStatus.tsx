import './spark-status.css';
import { REMOTE_SPARK_STATUS_LABELS, type RemoteSpark } from '@spark-outpost/contracts';
import { CheckIcon, ClockIcon, SpinnerIcon, WarnIcon } from '../ui/icons.tsx';
import { waitingWord } from './remote-sparks-copy.ts';

const STATUS_ICONS = {
  'not-paired': <ClockIcon />,
  checking: <SpinnerIcon />,
  online: <CheckIcon />,
  offline: <WarnIcon />,
} as const satisfies Record<RemoteSpark['status'], unknown>;

export function SparkStatus({ spark }: { spark: Pick<RemoteSpark, 'status' | 'needsYou'> }) {
  return (
    <>
      <span className="rs-status" data-status={spark.status}>
        {STATUS_ICONS[spark.status]}
        {REMOTE_SPARK_STATUS_LABELS[spark.status]}
      </span>
      {spark.needsYou > 0 && <span className="rs-needs">{waitingWord(spark.needsYou)}</span>}
    </>
  );
}
