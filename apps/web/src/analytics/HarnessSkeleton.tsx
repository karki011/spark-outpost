import { SkelBars, SkelChartArea, SkelTableRows, SkeletonCard } from './charts/Skeleton.tsx';

export function HarnessSkeleton() {
  return (
    <div className="an-grid">
      <SkeletonCard title="routing flow" wide>
        <SkelChartArea height={140} />
      </SkeletonCard>
      <SkeletonCard title="Jev confidence and outcome" wide>
        <SkelChartArea />
      </SkeletonCard>
      <SkeletonCard title="rule vs Jev" wide>
        <SkelBars rows={3} />
        <SkelTableRows rows={4} />
      </SkeletonCard>
      <SkeletonCard title="checks, loops and approvals">
        <SkelTableRows rows={4} />
        <SkelBars rows={3} />
      </SkeletonCard>
    </div>
  );
}
