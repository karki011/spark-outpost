import type { SparkAction } from '@spark-outpost/contracts';

type SiteAction = Extract<SparkAction, { action: 'read_page' | 'open_page' | 'act_page' }>;

export function SiteFacts({ action }: { action: SiteAction }) {
  return (
    <dl className="sac-facts">
      <dt>{action.action === 'open_page' ? 'Address' : 'Page'}</dt>
      <dd>
        {action.origin}
        {action.path}
      </dd>
      {'title' in action && action.title && (
        <>
          <dt>Title</dt>
          <dd>{action.title}</dd>
        </>
      )}
      {action.action === 'act_page' && (
        <>
          <dt>First step</dt>
          <dd>{action.did}</dd>
          <dt>Tab</dt>
          <dd>{action.userTab ? 'Yours: you opened it' : 'The agent’s'}</dd>
        </>
      )}
    </dl>
  );
}
