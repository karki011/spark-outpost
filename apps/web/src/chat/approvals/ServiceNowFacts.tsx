import {
  isServiceNowAction,
  serviceNowAsksAlways,
  type ServiceNowAction,
  type ServiceNowEditAction,
  type SparkAction,
} from '@spark-outpost/contracts';
import { VisibilityTag } from '../../tickets/ServiceNowNotes.tsx';

function Text({ label, text, caller }: { label: string; text: string; caller?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {caller !== undefined && <VisibilityTag visibility={caller ? 'customer' : 'internal'} />}
        <div className="sac-text">{text || '(empty)'}</div>
      </dd>
    </>
  );
}

function Swap({ label, before, after }: { label: string; before: string; after: string }) {
  if (before === after) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <s>{before || 'None'}</s> → <b>{after || 'None'}</b>
      </dd>
    </>
  );
}

function Changes({ action }: { action: ServiceNowEditAction }) {
  const { before, after } = action;
  if (!before || !after) return null;
  return (
    <>
      <Swap
        label="Short description"
        before={before.shortDescription}
        after={after.shortDescription}
      />
      <Swap label="Urgency" before={before.urgency} after={after.urgency} />
      <Swap label="Impact" before={before.impact} after={after.impact} />
      {before.description !== after.description && (
        <>
          <Text label="Description now" text={before.description} />
          <Text label="Description after" text={after.description} />
        </>
      )}
    </>
  );
}

function Move({ action }: { action: ServiceNowEditAction }) {
  const move = action.move;
  if (!move) return null;
  return (
    <>
      <dt>State</dt>
      <dd>
        <s>{move.from}</s> → <b>{move.to}</b>
      </dd>
      {move.closeCode && (
        <>
          <dt>Resolution code</dt>
          <dd>{move.closeCode}</dd>
        </>
      )}
      {move.closeNotes && <Text label="Resolution notes" text={move.closeNotes} caller />}
    </>
  );
}

function EditFacts({ action }: { action: ServiceNowEditAction }) {
  const { record } = action;
  return (
    <dl className="sac-facts">
      <dt>Record</dt>
      <dd>
        <a href={record.url} target="_blank" rel="noreferrer">
          {`${record.number} · ${record.title}`}
        </a>
      </dd>
      {action.op === 'update' && <Changes action={action} />}
      {action.op === 'work_note' && (
        <Text label="Work note" text={action.note ?? ''} caller={false} />
      )}
      {action.op === 'comment' && (
        <>
          <dt>Seen by</dt>
          <dd>
            {record.caller ? `${record.caller} (caller) and watchers` : 'The caller and watchers'}
          </dd>
          <Text label="Comment" text={action.note ?? ''} caller />
        </>
      )}
      {action.op === 'move' && <Move action={action} />}
    </dl>
  );
}

export function ServiceNowFacts({ action }: { action: ServiceNowAction }) {
  if (action.action === 'servicenow_edit') return <EditFacts action={action} />;
  return (
    <dl className="sac-facts">
      <dt>Reads</dt>
      <dd>{action.what}</dd>
    </dl>
  );
}

const asServiceNow = (action: SparkAction) =>
  isServiceNowAction(action.action) ? (action as ServiceNowAction) : null;

export function serviceNowByline(action: SparkAction, agent: string): string | null {
  const serviceNow = asServiceNow(action);
  if (!serviceNow) return null;
  if (serviceNow.action === 'servicenow_read') return `${agent} wants to read ServiceNow.`;
  return `${agent} asks Spark to do this in ServiceNow.`;
}

export function serviceNowNote(action: SparkAction): string | null {
  const serviceNow = asServiceNow(action);
  if (!serviceNow) return null;
  if (serviceNow.action === 'servicenow_read') {
    return 'What the agent reads goes to its model provider, and Spark treats it as untrusted. Allowing covers reading it for the rest of this chat.';
  }
  const tells = serviceNowAsksAlways(serviceNow)
    ? ' Your instance may email the caller. This asks in every mode.'
    : '';
  return `Nothing changes until you confirm.${tells} If the record changed in the meantime, Spark changes nothing.`;
}
