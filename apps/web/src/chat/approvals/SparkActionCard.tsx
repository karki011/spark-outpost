import './spark-action-card.css';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  editableFields,
  sparkActionQuestion,
  ticketPriorityNameSchema,
  ticketSourceNames,
  ticketStatusLabels,
  ticketStatusSchema,
  type Approval,
  type ApprovalDecidedValue,
  type SparkAction,
  type SparkActionEdits,
} from '@spark-outpost/contracts';
import { approvalsApi } from '../../api/approvals.ts';
import { ChoicePicker } from '../../ui/ChoicePicker.tsx';
import { HoldToConfirm } from '../../ui/HoldToConfirm.tsx';
import { approvalAnchor } from '../../crew/conversation-crew.ts';
import { isAllow } from './approval-outcome.ts';
import { ObservedNote } from './ObservedNote.tsx';
import { HandoffFacts, SignInFacts } from './SignInFacts.tsx';
import { MacFacts, macByline, macNote } from './MacFacts.tsx';
import { CalendarFacts, calendarByline, calendarNote } from './CalendarFacts.tsx';
import { AtlassianFacts, atlassianByline, atlassianNote } from './AtlassianFacts.tsx';
import { SiteFacts } from './SiteFacts.tsx';
import { OutpostStartFacts, outpostStartByline, outpostStartNote } from './OutpostStartFacts.tsx';
import { siteByline, siteNote } from './site-card-text.ts';
import { PrFollowUpFacts, PrRoundFacts } from './PrFollowUpFacts.tsx';
import { McpActionFacts } from '../../settings/mcp/McpActionFacts.tsx';
import { TeammateFacts } from '../../teammates/TeammateFacts.tsx';

interface Draft {
  title: string;
  description: string;
  body: string;
  type: string | null;
  priority: string;
  labels: string;
  status: string;
  to: string;
  skip: string[];
}

const STATUS_CHOICES = ticketStatusSchema.options.map((status) => ({
  id: status,
  label: ticketStatusLabels[status],
}));

function nameChoices(action: SparkAction, current: string) {
  const names = action.action === 'transition_ticket' ? (action.choices ?? []) : [];
  return [...new Set([...names, current])].map((name) => ({ id: name, label: name }));
}

const PRIORITY_CHOICES = [
  { id: '', label: 'None' },
  ...ticketPriorityNameSchema.options.map((priority) => ({
    id: priority,
    label: priority[0]!.toUpperCase() + priority.slice(1),
  })),
];

const TEXT_LABELS: Partial<Record<SparkAction['action'], string>> = {
  comment_ticket: 'Comment',
  post_slack: 'Slack message',
};

function draftOf(action: SparkAction): Draft {
  return {
    title: 'title' in action ? action.title : '',
    description: action.action === 'create_ticket' ? action.description : '',
    body: 'body' in action ? (action.body ?? '') : '',
    type: action.action === 'create_ticket' ? action.type : null,
    priority: action.action === 'create_ticket' ? (action.priority ?? '') : '',
    labels: action.action === 'create_ticket' ? action.labels.join(', ') : '',
    status: action.action === 'transition_ticket' ? action.status : '',
    to: action.action === 'transition_ticket' ? (action.to ?? '') : '',
    skip: action.action === 'pr_follow_up' ? action.skip : [],
  };
}

function editsOf(action: SparkAction, draft: Draft): SparkActionEdits {
  const before = draftOf(action);
  const edits: SparkActionEdits = {};
  for (const field of editableFields(action.action)) {
    if (field === 'skip') {
      if (draft.skip.length > 0) edits.skip = draft.skip;
      continue;
    }
    if (draft[field] === before[field]) continue;
    if (field === 'labels') {
      edits.labels = draft.labels
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean);
    } else if (field === 'priority') {
      edits.priority = ticketPriorityNameSchema.safeParse(draft.priority).data ?? null;
    } else if (field === 'status') {
      edits.status = ticketStatusSchema.parse(draft.status);
    } else if (field === 'type') {
      edits.type = draft.type?.trim() || null;
    } else {
      edits[field] = draft[field];
    }
  }
  return edits;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function TicketLink({ ticket }: { ticket: { key: string; title: string; url: string | null } }) {
  const text = `${ticket.key} · ${ticket.title}`;
  return ticket.url ? (
    <a href={ticket.url} target="_blank" rel="noreferrer">
      {text}
    </a>
  ) : (
    <span>{text}</span>
  );
}

function Facts({ action }: { action: SparkAction }) {
  switch (action.action) {
    case 'create_ticket':
      return (
        <dl className="sac-facts">
          <Fact label="Where">
            {ticketSourceNames[action.source]} · {action.project}
          </Fact>
          <Fact label="Assignee">{action.assignToMe ? 'You' : 'Nobody'}</Fact>
        </dl>
      );
    case 'comment_ticket':
      return (
        <dl className="sac-facts">
          <Fact label="Ticket">
            <TicketLink ticket={action.ticket} />
          </Fact>
        </dl>
      );
    case 'transition_ticket':
      return (
        <dl className="sac-facts">
          <Fact label="Ticket">
            <TicketLink ticket={action.ticket} />
          </Fact>
          <Fact label="Now">{action.from}</Fact>
        </dl>
      );
    case 'assign_ticket':
      return (
        <dl className="sac-facts">
          <Fact label="Ticket">
            <TicketLink ticket={action.ticket} />
          </Fact>
          <Fact label="Now">{action.currentAssignee ?? 'Unassigned'}</Fact>
          <Fact label="After">{action.to === 'me' ? 'You' : 'Unassigned'}</Fact>
        </dl>
      );
    case 'pr_follow_up_round':
      return <PrRoundFacts action={action} />;
    case 'create_teammate':
    case 'update_teammate':
      return <TeammateFacts action={action} />;
    case 'add_mcp_server':
    case 'update_mcp_server':
    case 'switch_mcp_server':
    case 'remove_mcp_server':
      return <McpActionFacts action={action} />;
    case 'read_page':
    case 'open_page':
    case 'act_page':
      return <SiteFacts action={action} />;
    case 'browser_sign_in':
      return <SignInFacts action={action} />;
    case 'browser_handoff':
      return <HandoffFacts action={action} />;
    case 'mac_use_app':
    case 'mac_act':
    case 'mac_press':
      return <MacFacts action={action} />;
    case 'calendar_read':
    case 'calendar_edit':
      return <CalendarFacts action={action} />;
    case 'atlassian_read':
    case 'jira_edit':
    case 'confluence_edit':
      return <AtlassianFacts action={action} />;
    case 'post_slack':
      return (
        <dl className="sac-facts">
          <Fact label="Channel">#{action.channel.name}</Fact>
          {action.asYou && <Fact label="Posts as">You, under your own name</Fact>}
          <Fact label="Where">
            {action.threadTs ? (
              action.permalink ? (
                <a href={action.permalink} target="_blank" rel="noreferrer">
                  A reply in this thread
                </a>
              ) : (
                'A reply in the thread this chat started from'
              )
            ) : (
              'A new message in the channel'
            )}
          </Fact>
        </dl>
      );
    case 'start_outpost':
      return <OutpostStartFacts action={action} />;
    case 'open_pr':
    case 'pr_follow_up':
    case 'ask_spark':
      return null;
  }
}

function byline(action: SparkAction, agent: string, secretFiles?: readonly string[]): string {
  const site = siteByline(action, agent, secretFiles);
  if (site) return site;
  const mac =
    macByline(action, agent) ??
    calendarByline(action, agent) ??
    atlassianByline(action, agent) ??
    outpostStartByline(action, agent);
  if (mac) return mac;
  if (action.action === 'pr_follow_up') {
    return 'Spark fixed the PR feedback in this chat. Confirm to push and reply on GitHub.';
  }
  return `${agent} asks Spark to do this for you.`;
}

function confirmNote(action: SparkAction, secretFiles?: readonly string[]): string {
  const site = siteNote(action, secretFiles);
  if (site) return site;
  const mac =
    macNote(action) ?? calendarNote(action) ?? atlassianNote(action) ?? outpostStartNote(action);
  if (mac) return mac;
  if (action.action === 'pr_follow_up') {
    return 'Nothing is pushed or posted until you confirm. Uncheck anything to leave it out; a fix reply needs the push.';
  }
  if (editableFields(action.action).length === 0) {
    return 'Nothing happens until you confirm. Spark does it as soon as you confirm, even after the agent has finished.';
  }
  return 'Nothing happens until you confirm. You can edit it first. Spark does it as soon as you confirm, even after the agent has finished.';
}

function takeover(action: SparkAction): string | null {
  if (action.action !== 'assign_ticket' || action.to !== 'me' || !action.currentAssignee) {
    return null;
  }
  return `${action.ticket.key} is assigned to ${action.currentAssignee}. Confirming takes it over.`;
}

interface FieldsProps {
  action: SparkAction;
  draft: Draft;
  onChange: (next: Draft) => void;
  disabled: boolean;
}

function Fields({ action, draft, onChange, disabled }: FieldsProps) {
  const id = useId();
  const fields = editableFields(action.action);
  const set = (field: keyof Draft) => (value: string) => onChange({ ...draft, [field]: value });
  return (
    <div className="sac-fields">
      {fields.includes('title') && (
        <label className="field" htmlFor={`${id}-title`}>
          <span>Title</span>
          <input
            id={`${id}-title`}
            className="inp"
            value={draft.title}
            disabled={disabled}
            onChange={(event) => set('title')(event.target.value)}
          />
        </label>
      )}
      {(fields.includes('description') || fields.includes('body')) && (
        <label className="field" htmlFor={`${id}-text`}>
          <span>{TEXT_LABELS[action.action] ?? 'Description'}</span>
          <textarea
            id={`${id}-text`}
            className="inp"
            rows={5}
            value={fields.includes('body') ? draft.body : draft.description}
            disabled={disabled}
            onChange={(event) =>
              set(fields.includes('body') ? 'body' : 'description')(event.target.value)
            }
          />
        </label>
      )}
      {fields.includes('status') && (
        <div className="field">
          <span>Move to</span>
          {draft.to ? (
            <ChoicePicker
              label="Move to"
              choices={nameChoices(action, draft.to)}
              value={draft.to}
              onChange={set('to')}
            />
          ) : (
            <ChoicePicker
              label="Move to"
              choices={STATUS_CHOICES}
              value={draft.status}
              onChange={set('status')}
            />
          )}
        </div>
      )}
      {fields.includes('priority') && (
        <div className="sac-row">
          <label className="field" htmlFor={`${id}-type`}>
            <span>Type</span>
            <input
              id={`${id}-type`}
              className="inp"
              placeholder={
                action.action === 'create_ticket' && action.source === 'jira' ? 'Task' : 'None'
              }
              value={draft.type ?? ''}
              disabled={disabled}
              onChange={(event) => set('type')(event.target.value)}
            />
          </label>
          <div className="field">
            <span>Priority</span>
            <ChoicePicker
              label="Priority"
              choices={PRIORITY_CHOICES}
              value={draft.priority}
              onChange={set('priority')}
            />
          </div>
          <label className="field" htmlFor={`${id}-labels`}>
            <span>Labels</span>
            <input
              id={`${id}-labels`}
              className="inp"
              placeholder="Comma separated"
              value={draft.labels}
              disabled={disabled}
              onChange={(event) => set('labels')(event.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}

export function SparkActionCard({
  approval,
  agent,
  onDecided,
}: {
  approval: Approval;
  agent: string;
  onDecided: (decided: ApprovalDecidedValue) => void;
}) {
  const action = approval.payload.sparkAction!;
  const headingId = useId();
  const [draft, setDraft] = useState(() => draftOf(action));
  const decide = useMutation({
    mutationFn: (optionId: string) => {
      const allowing = approval.options.some(
        (option) => option.optionId === optionId && isAllow(option),
      );
      const edits = allowing ? editsOf(action, draft) : {};
      return approvalsApi.decide(approval.id, {
        optionId,
        scope: 'once',
        payloadHash: approval.payloadHash,
        ...(Object.keys(edits).length > 0 ? { edits } : {}),
      });
    },
    onSuccess: onDecided,
  });
  const confirmRef = useRef<HTMLButtonElement>(null);
  const requested = approval.payload.sparkRequested === true;
  useEffect(() => {
    if (!requested) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    confirmRef.current?.focus();
  }, [requested]);
  const warning = takeover(action);
  const secretFiles = approval.payload.secretSend;
  const holdOption = secretFiles ? approval.options.find(isAllow) : undefined;
  const blankTitle = editableFields(action.action).includes('title') && !draft.title.trim();
  return (
    <div
      className="appr sac"
      role="group"
      aria-labelledby={headingId}
      id={approvalAnchor(approval.id)}
    >
      <div className="appr-h">
        <span className="ic" aria-hidden="true">
          <i className="appr-dia" />
        </span>
        <span id={headingId}>
          <b>{secretFiles ? 'Send a secret value?' : sparkActionQuestion(action)}</b>{' '}
          {byline(action, agent, secretFiles)}
        </span>
      </div>
      <Facts action={action} />
      {action.action === 'pr_follow_up' && (
        <PrFollowUpFacts
          action={action}
          skip={draft.skip}
          disabled={decide.isPending}
          onSkip={(skip) => setDraft({ ...draft, skip })}
        />
      )}
      <Fields action={action} draft={draft} onChange={setDraft} disabled={decide.isPending} />
      {warning && <p className="appr-reason">{warning}</p>}
      <ObservedNote observed={approval.payload.observed} />
      <p className="sac-note">{confirmNote(action, secretFiles)}</p>
      {holdOption && (
        <HoldToConfirm
          label="Hold to allow once"
          hint="Press and hold for 1.5 seconds, with the mouse or Space."
          holdingHint="Keep holding. Let go now to cancel."
          releasedHint="Released early. Nothing was sent."
          disabled={decide.isPending}
          onConfirm={() => decide.mutate(holdOption.optionId)}
        />
      )}
      <div className="appr-acts">
        {approval.options
          .filter((option) => option !== holdOption)
          .map((option) => (
            <button
              key={option.optionId}
              ref={isAllow(option) ? confirmRef : undefined}
              type="button"
              className={isAllow(option) ? 'btn primary sm' : 'btn ghost sm deny'}
              disabled={decide.isPending || (isAllow(option) && blankTitle)}
              onClick={() => decide.mutate(option.optionId)}
            >
              {option.name}
            </button>
          ))}
      </div>
      {decide.isError && (
        <p className="appr-err" role="alert">
          {decide.error.message}
        </p>
      )}
    </div>
  );
}
