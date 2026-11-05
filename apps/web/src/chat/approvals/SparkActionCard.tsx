import './spark-action-card.css';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  ARTIFACT_KIND_LABELS,
  editableFields,
  holdsToConfirm,
  serviceNowAsksAlways,
  sparkActionQuestion,
  ticketSourceNames,
  type Approval,
  type ApprovalDecidedValue,
  type ApprovalOption,
  type SparkAction,
} from '@spark-outpost/contracts';
import { approvalsApi } from '../../api/approvals.ts';
import { formatBytes } from '../../api/attachments.ts';
import { WarnIcon } from '../../ui/icons.tsx';
import { HoldToConfirm } from '../../ui/HoldToConfirm.tsx';
import { approvalAnchor } from '../../crew/conversation-crew.ts';
import { isAllow } from './approval-outcome.ts';
import { ObservedNote } from './ObservedNote.tsx';
import { HandoffFacts, SignInFacts } from './SignInFacts.tsx';
import { MacFacts, macByline, macNote } from './MacFacts.tsx';
import { CalendarFacts, calendarByline, calendarNote } from './CalendarFacts.tsx';
import { AtlassianFacts, atlassianByline, atlassianNote } from './AtlassianFacts.tsx';
import { ServiceNowFacts, serviceNowByline, serviceNowNote } from './ServiceNowFacts.tsx';
import { SiteFacts } from './SiteFacts.tsx';
import { OutpostStartFacts, outpostStartByline, outpostStartNote } from './OutpostStartFacts.tsx';
import { siteByline, siteNote } from './site-card-text.ts';
import { PrFollowUpFacts, PrRoundFacts } from './PrFollowUpFacts.tsx';
import { McpActionFacts } from '../../settings/mcp/McpActionFacts.tsx';
import { TeammateFacts } from '../../teammates/TeammateFacts.tsx';
import { useRemoteClient } from '../../phone/use-remote-client.ts';
import { draftOf, editsOf, Fields } from './SparkActionFields.tsx';
import { RULES_ON_THE_MAC, RulesEditFacts, rulesByline, rulesNote } from './RulesEditFacts.tsx';
import {
  PLUGINS_ON_THE_MAC,
  PluginEditFacts,
  pluginsByline,
  pluginsNote,
} from './PluginEditFacts.tsx';

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
    case 'servicenow_read':
    case 'servicenow_edit':
      return <ServiceNowFacts action={action} />;
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
    case 'rules_edit':
      return <RulesEditFacts action={action} />;
    case 'plugins_edit':
      return <PluginEditFacts action={action} />;
    case 'publish_artifact':
      return (
        <dl className="sac-facts">
          <Fact label="Artifact">{action.title}</Fact>
          <Fact label="Kind">
            {ARTIFACT_KIND_LABELS[action.kind]}, version {action.version}
          </Fact>
          <Fact label="Size">{formatBytes(action.bytes)}</Fact>
        </dl>
      );
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
    serviceNowByline(action, agent) ??
    outpostStartByline(action, agent) ??
    rulesByline(action) ??
    pluginsByline(action);
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
    macNote(action) ??
    calendarNote(action) ??
    atlassianNote(action) ??
    serviceNowNote(action) ??
    outpostStartNote(action) ??
    rulesNote(action) ??
    pluginsNote(action);
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

function holdLabel(action: SparkAction): string {
  if (action.action !== 'plugins_edit') return 'Hold to allow once';
  return action.enabled ? 'Hold to turn on' : 'Hold to turn off';
}

function macOnlyNote(action: SparkAction): string | null {
  if (action.action === 'rules_edit') return RULES_ON_THE_MAC;
  if (action.action === 'plugins_edit') return PLUGINS_ON_THE_MAC;
  return null;
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
  const callerSees = serviceNowAsksAlways(action);
  const requested = approval.payload.sparkRequested === true && !callerSees;
  useEffect(() => {
    if (!requested) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    confirmRef.current?.focus();
  }, [requested]);
  const warning = takeover(action);
  const secretFiles = approval.payload.secretSend;
  const holdOption = holdsToConfirm(approval.payload) ? approval.options.find(isAllow) : undefined;
  const blankTitle = editableFields(action.action).includes('title') && !draft.title.trim();
  const { remote } = useRemoteClient();
  const onTheMac = remote ? macOnlyNote(action) : null;
  const shown = approval.options.filter((option) => option !== holdOption);
  const primary = shown.find(isAllow);
  const buttonClass = (option: ApprovalOption) =>
    option === primary ? 'btn primary sm' : isAllow(option) ? 'btn line sm' : 'btn ghost sm deny';
  const answerButtons = shown.map((option) => (
    <button
      key={option.optionId}
      ref={option === primary ? confirmRef : undefined}
      type="button"
      className={buttonClass(option)}
      disabled={decide.isPending || (isAllow(option) && blankTitle)}
      onClick={() => decide.mutate(option.optionId)}
    >
      {option.name}
    </button>
  ));
  return (
    <div
      className={callerSees ? 'appr sac sac-caller' : 'appr sac'}
      role="group"
      aria-labelledby={headingId}
      id={approvalAnchor(approval.id)}
    >
      <div className="appr-h">
        <span className="ic" aria-hidden="true">
          {callerSees ? <WarnIcon /> : <i className="appr-dia" />}
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
      {onTheMac ? (
        <p className="appr-reason">{onTheMac}</p>
      ) : (
        <div className="appr-acts">
          {holdOption ? (
            <HoldToConfirm
              label={holdLabel(action)}
              hint="Hold 1.5 seconds, with the mouse or Space."
              holdingHint="Keep holding. Let go now to cancel."
              releasedHint={
                action.action === 'plugins_edit'
                  ? 'Released early. Nothing changed.'
                  : 'Released early. Nothing was sent.'
              }
              disabled={decide.isPending}
              onConfirm={() => decide.mutate(holdOption.optionId)}
              adornment={answerButtons}
            />
          ) : (
            answerButtons
          )}
        </div>
      )}
      {decide.isError && (
        <p className="appr-err" role="alert">
          {decide.error.message}
        </p>
      )}
    </div>
  );
}
