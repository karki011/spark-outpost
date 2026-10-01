import {
  SkelBars,
  SkelChartArea,
  SkelHeatmap,
  SkelRings,
  SkeletonCard,
} from './charts/Skeleton.tsx';

export function OverviewSkeleton() {
  return (
    <div className="an-grid">
      <SkeletonCard title="Spark health" wide>
        <SkelRings count={1} />
      </SkeletonCard>
      <SkeletonCard title="activity">
        <SkelHeatmap />
      </SkeletonCard>
      <SkeletonCard title="spend trend">
        <SkelChartArea />
      </SkeletonCard>
      <SkeletonCard title="keep and pass rates" wide>
        <SkelRings />
        <SkelBars rows={2} />
      </SkeletonCard>
    </div>
  );
}
