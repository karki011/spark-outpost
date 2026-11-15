import { atlassianConfirm, type JiraEditAction } from '@spark-outpost/contracts';
import { openAtlassian, type AtlassianSession } from '../../../atlassian/session.ts';
import { ACTION_NOTE } from '../../actions/action-note.ts';
import { proposeAction } from '../../actions/confirm.ts';
import { ticketDepsFor } from '../../deps.ts';
import { sparkTool, type SparkToolContext } from '../../tool.ts';
import { jiraEditInput, type JiraEditArgs } from './jira-edit-input.ts';
import { planOther } from './jira-plan-other.ts';
import { planUpdate } from './jira-plan-update.ts';
import { planIssueWork } from './jira-plan-work.ts';

const ISSUE_WORK = new Set<JiraEditArgs['action']>([
  'transition',
  'comment',
  'edit_comment',
  'delete_comment',
  'link',
  'unlink',
  'watch',
  'unwatch',
  'vote',
  'unvote',
  'log_work',
  'edit_worklog',
  'delete_worklog',
  'delete',
]);

function plan(
  context: SparkToolContext,
  session: AtlassianSession,
  args: JiraEditArgs,
): Promise<JiraEditAction> {
  if (args.action === 'update') return planUpdate(session, args);
  if (ISSUE_WORK.has(args.action)) return planIssueWork(session, args);
  return planOther(context, session, args);
}

async function edit(context: SparkToolContext, args: JiraEditArgs) {
  const session = await openAtlassian(ticketDepsFor(context.deps, context.scope), 'jira');
  const action = await plan(context, session, args);
  return proposeAction(context, action, { confirmName: atlassianConfirm(action) });
}

export const jiraEditTool = sparkTool({
  name: 'spark_jira_edit',
  needs: 'jira',
  acts: true,
  title: 'Change Jira',
  description: `Changes Jira; ids come from spark_jira. update (key, or keys for one card over several): summary, description (Markdown), labels, addLabels, removeLabels, priority, parent (key or none), issueType, team, assignee or reporter (name, accountId, me, none), originalEstimate, remainingEstimate (2h), fields (any field by id or name: components, fixVersions, duedate, Story Points…). transition: to (move or status), resolution, fields, body as a comment. comment, edit_comment (id): body, visibility; delete_comment (id). link: linkType, otherKey; unlink (id). watch, unwatch (user, default me); vote, unvote. log_work: timeSpent, start, body; edit_worklog, delete_worklog (id). attach: path of a file in the chat's project or kept files; delete_attachment (id). sprint (id) or backlog for key or keys; rank: otherKey, to before|after. create_sprint (id = board, name, start, end, body = goal); start_sprint, complete_sprint (id). create_version (project, name, start, end, body); release_version (id). clone (name). delete (withSubtasks). ${ACTION_NOTE}`,
  input: jiraEditInput,
  run: (args, context) => edit(context, args),
});
