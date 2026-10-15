import type { MacAction, SparkAction } from '@spark-outpost/contracts';

function isMac(action: SparkAction): action is MacAction {
  return (
    action.action === 'mac_use_app' || action.action === 'mac_act' || action.action === 'mac_press'
  );
}

export function MacFacts({ action }: { action: MacAction }) {
  return (
    <dl className="sac-facts">
      <dt>App</dt>
      <dd>
        {action.app} ({action.bundleId})
      </dd>
      {action.action === 'mac_use_app' && (
        <>
          <dt>First step</dt>
          <dd>{action.first}</dd>
        </>
      )}
      {action.action === 'mac_act' && (
        <>
          <dt>First step</dt>
          <dd>{action.did}</dd>
        </>
      )}
      {action.action === 'mac_press' && (
        <>
          <dt>Press</dt>
          <dd>{action.what}</dd>
          {action.window && (
            <>
              <dt>Window</dt>
              <dd>{action.window}</dd>
            </>
          )}
        </>
      )}
    </dl>
  );
}

export function macByline(action: SparkAction, agent: string): string | null {
  if (!isMac(action)) return null;
  if (action.action === 'mac_use_app') return `${agent} wants to read and use ${action.app}.`;
  if (action.action === 'mac_act')
    return `${agent} wants to press buttons and menus in ${action.app}.`;
  return `${agent} wants to press something that may send, delete, submit or publish.`;
}

export function macNote(action: SparkAction): string | null {
  if (!isMac(action)) return null;
  if (action.action === 'mac_use_app') {
    return 'What the agent reads in this app goes to the model provider, and Spark treats it as untrusted. Allowing covers this app for the rest of this chat. Answer on this Mac.';
  }
  if (action.action === 'mac_act') {
    return 'Allowing covers pressing in this app for the rest of this chat. Sends and deletes still ask each time. Answer on this Mac.';
  }
  return 'Spark asks for every press like this, in every mode. Allowing covers this one press only. Answer on this Mac.';
}
