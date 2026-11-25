import { Fragment } from 'react';
import type { SparkAction } from '@spark-outpost/contracts';

const FIELD_LABELS: Record<string, string> = {
  method: 'Method',
  baseUrl: 'Endpoint',
  model: 'Model',
  fastModel: 'Fast model',
  keyHeader: 'Key header',
  siteUrl: 'Site',
  email: 'Email',
  instanceUrl: 'Instance',
  username: 'Username',
  authKind: 'Sign-in',
  server: 'Server',
};

export function SetupFacts({
  action,
}: {
  action: Extract<SparkAction, { action: 'prepare_setup' }>;
}) {
  return (
    <dl className="sac-facts">
      <dt>Connection</dt>
      <dd>{action.name}</dd>
      {Object.entries(action.fields).map(([field, value]) => (
        <Fragment key={field}>
          <dt>{FIELD_LABELS[field] ?? field}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
      <dt>Where</dt>
      <dd>{action.place}</dd>
      <dt>You finish</dt>
      <dd>{action.finish} The agent never sees it.</dd>
    </dl>
  );
}
