import {
  atlassianProductNames,
  isAtlassianAction,
  type AtlassianAction,
  type ConfluenceEditAction,
  type JiraEditAction,
  type SparkAction,
} from '@spark-outpost/contracts';

function Link({ href, children }: { href: string | null; children: string }) {
  if (!href) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function Text({ label, text }: { label: string; text: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
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

const SUBJECTS: Partial<Record<JiraEditAction['op'], string>> = {
  create_sprint: 'Board',
  start_sprint: 'Sprint',
  complete_sprint: 'Sprint',
  create_version: 'Project',
  release_version: 'Version',
};

function JiraRow({ row }: { row: JiraEditAction['rows'][number] }) {
  const label = row.key ? `${row.key} · ${row.label}` : row.label;
  if (row.before !== null && row.after !== null) {
    return <Swap label={label} before={row.before} after={row.after} />;
  }
  if (row.before !== null) return <Text label={`${label} (removed)`} text={row.before} />;
  return <Text label={label} text={row.after ?? ''} />;
}

function JiraRows({ action }: { action: JiraEditAction }) {
  return (
    <>
      {action.targets.length > 0 && (
        <>
          <dt>Also changes</dt>
          <dd>{action.targets.map((target) => `${target.key} · ${target.title}`).join(', ')}</dd>
        </>
      )}
      {action.rows.map((row, index) => (
        <JiraRow key={`${row.key ?? ''}-${row.label}-${index}`} row={row} />
      ))}
    </>
  );
}

function JiraFacts({ action }: { action: JiraEditAction }) {
  const { before, after, comment } = action;
  return (
    <dl className="sac-facts">
      <dt>{SUBJECTS[action.op] ?? 'Issue'}</dt>
      <dd>
        <Link href={action.ticket.url}>{`${action.ticket.key} · ${action.ticket.title}`}</Link>
      </dd>
      {before && after && (
        <>
          <Swap label="Summary" before={before.summary} after={after.summary} />
          <Swap label="Priority" before={before.priority ?? ''} after={after.priority ?? ''} />
          <Swap label="Labels" before={before.labels.join(', ')} after={after.labels.join(', ')} />
          <Swap label="Type" before={before.type ?? ''} after={after.type ?? ''} />
          <Swap label="Parent" before={before.parent ?? ''} after={after.parent ?? ''} />
          <Swap label="Team" before={before.team ?? ''} after={after.team ?? ''} />
          {before.description !== after.description && (
            <>
              <Text label="Description now" text={before.description} />
              <Text label="Description after" text={after.description} />
            </>
          )}
        </>
      )}
      <JiraRows action={action} />
      {comment && <Text label="Comment now" text={comment.before} />}
      {comment?.after && <Text label="Comment after" text={comment.after} />}
      {action.subtasks.length > 0 && (
        <>
          <dt>Subtasks</dt>
          <dd>{action.subtasks.join(', ')} are deleted too</dd>
        </>
      )}
    </dl>
  );
}

function ConfluenceFacts({ action }: { action: ConfluenceEditAction }) {
  const { page, before, after } = action;
  return (
    <dl className="sac-facts">
      {page.space && (
        <>
          <dt>Space</dt>
          <dd>{page.space}</dd>
        </>
      )}
      <dt>Page</dt>
      <dd>
        <Link href={page.url}>{page.title}</Link>
        {page.version !== null && ` (version ${page.version})`}
      </dd>
      {before && after && <Swap label="Title" before={before.title} after={after.title} />}
      {action.op === 'update' && before && after && before.text !== after.text && (
        <>
          <Text label="Page now" text={before.text} />
          <Text label="Page after" text={after.text} />
        </>
      )}
      {action.op === 'create' && after && <Text label="Page" text={after.text} />}
      {action.op === 'comment' && after && <Text label="Comment" text={after.text} />}
      {action.op === 'delete' && before && <Text label="Page now" text={before.text} />}
    </dl>
  );
}

export function AtlassianFacts({ action }: { action: AtlassianAction }) {
  if (action.action === 'atlassian_read') {
    return (
      <dl className="sac-facts">
        <dt>Reads</dt>
        <dd>{action.what}</dd>
      </dl>
    );
  }
  if (action.action === 'jira_edit') return <JiraFacts action={action} />;
  return <ConfluenceFacts action={action} />;
}

const asAtlassian = (action: SparkAction) =>
  isAtlassianAction(action.action) ? (action as AtlassianAction) : null;

export function atlassianByline(action: SparkAction, agent: string): string | null {
  const atlassian = asAtlassian(action);
  if (!atlassian) return null;
  if (atlassian.action === 'atlassian_read') {
    return `${agent} wants to read ${atlassianProductNames[atlassian.product]}.`;
  }
  return `${agent} asks Spark to do this in ${atlassian.action === 'jira_edit' ? 'Jira' : 'Confluence'}.`;
}

export function atlassianNote(action: SparkAction): string | null {
  const atlassian = asAtlassian(action);
  if (!atlassian) return null;
  if (atlassian.action === 'atlassian_read') {
    return 'What the agent reads goes to its model provider, and Spark treats it as untrusted. Allowing covers reading it for the rest of this chat.';
  }
  const trash =
    atlassian.action === 'confluence_edit' && atlassian.op === 'delete'
      ? ' The page goes to the Confluence trash.'
      : '';
  return `Nothing changes until you confirm.${trash} If it changed in the meantime, Spark changes nothing.`;
}
