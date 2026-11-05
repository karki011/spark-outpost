import {
  SkelBars,
  SkelChartArea,
  SkelTableRows,
  SkelTreemap,
  SkeletonCard,
} from './charts/Skeleton.tsx';

export function SpendSkeleton() {
  return (
    <div className="an-grid">
      <SkeletonCard title="where the money went" wide>
        <SkelTreemap />
      </SkeletonCard>
      <SkeletonCard title="cost per finished turn">
        <SkelBars rows={4} />
      </SkeletonCard>
      <SkeletonCard title="reported and estimated">
        <SkelChartArea />
      </SkeletonCard>
      <SkeletonCard title="what resuming saved">
        <SkelBars rows={2} />
        <SkelTableRows rows={3} />
      </SkeletonCard>
    </div>
  );
}
