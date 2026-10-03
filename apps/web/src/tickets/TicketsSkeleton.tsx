const WIDTHS = ['62%', '48%', '71%', '55%', '66%', '44%', '58%'];

export function SkeletonRows({ count, flow = false }: { count: number; flow?: boolean }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={flow ? 'sk-irow flow' : 'sk-irow'}>
          <span />
          <span className="sk" style={{ width: 12 }} />
          <span className="sk" style={{ width: 52 }} />
          {flow && <span className="sk sk-chip" />}
          <span className="sk" style={{ width: WIDTHS[index % WIDTHS.length] }} />
          <span className="sk" style={{ width: 96 }} />
          <span className="sk" style={{ width: 22 }} />
          {flow && <span className="sk sk-who" />}
        </div>
      ))}
    </div>
  );
}

function SkeletonSection({ rows, title }: { rows: number; title: number }) {
  return (
    <>
      <div className="sk-sec" aria-hidden="true">
        <span className="sk" style={{ width: 12 }} />
        <span className="sk" style={{ width: title }} />
        <span className="sk" style={{ width: 14 }} />
      </div>
      <SkeletonRows count={rows} flow />
    </>
  );
}

export function TicketsSkeleton({ sourcesLabel }: { sourcesLabel: string }) {
  return (
    <div className="ib" aria-busy="true">
      <p className="sr-only" role="status">
        Loading tickets from {sourcesLabel}
      </p>
      <div className="ib-main">
        <div className="tk-sum sk-sum" aria-hidden="true">
          {[52, 96, 92, 84, 108].map((width, index) => (
            <span key={index} className="sk" style={{ width }} />
          ))}
        </div>
        <SkeletonSection rows={3} title={120} />
        <SkeletonSection rows={2} title={90} />
        <SkeletonSection rows={4} title={70} />
      </div>
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="sk-detail" aria-hidden="true">
      {['40%', '92%', '86%', '64%', '78%', '50%'].map((width, index) => (
        <span key={index} className="sk" style={{ width }} />
      ))}
    </div>
  );
}
