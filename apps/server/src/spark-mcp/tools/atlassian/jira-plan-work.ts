import type { JiraEditAction } from '@spark-outpost/contracts';
import type { JiraFacts } from '../../../atlassian/jira-edits.ts';
import { fieldText, fieldValue, findField, userLookup } from '../../../atlassian/jira-meta.ts';
import { resolveUser } from '../../../atlassian/jira-users.ts';
import type { AtlassianSession } from '../../../atlassian/session.ts';
import { SparkToolError } from '../../tool.ts';
import { needs, type JiraEditArgs } from './jira-edit-input.ts';
import { issueFacts, shown } from './jira-plan-update.ts';
import { baseAction, cardText, jiraTime, row } from './jira-plans.ts';

const onIssue = (session: AtlassianSession, op: JiraEditAction['op'], facts: JiraFacts) =>
  baseAction(
    op,
    { key: facts.key, title: facts.summary, url: session.jira.browse(facts.key) },
    facts.updated,
  );

const visibilityText = (args: JiraEditArgs) =>
  args.visibility
    ? `${args.visibility.type} ${args.visibility.value}`
    : 'Everyone who can see the issue';

async function transition(session: AtlassianSession, args: JiraEditArgs, facts: JiraFacts) {
  const wanted = needs(args.to, 'to: a move or status name from spark_jira transitions');
  const moves = await session.jira.work.transitions(facts.key);
  const lower = wanted.toLowerCase();
  const move =
    moves.find((entry) => entry.id === wanted) ??
    moves.find((entry) => entry.name.toLowerCase() === lower) ??
    moves.find((entry) => entry.to?.toLowerCase() === lower);
  if (!move) {
    const names = moves.map((entry) => `${entry.name} (to ${entry.to ?? '?'})`).join(', ');
    throw new SparkToolError(
      `${facts.key} can't move to "${wanted}" now. Moves: ${names || 'none'}.`,
    );
  }
  const users = userLookup(session.jira.client, { me: session.accountId, issueKey: facts.key });
  const wantedFields = {
    ...(args.resolution ? { resolution: args.resolution } : {}),
    ...args.fields,
  };
  const fields: Record<string, unknown> = {};
  const rows = [row('Status', facts.status ?? '', move.to ?? move.name)];
  for (const [name, value] of Object.entries(wantedFields)) {
    if (move.fields.length === 0) {
      throw new SparkToolError(`The move ${move.name} has no screen, so it can't set ${name}.`);
    }
    const meta = findField(move.fields, name);
    fields[meta.id] = await fieldValue(meta, value, users);
    rows.push(row(meta.name, null, fieldText(value)));
  }
  if (args.body) rows.push(row('Comment', null, args.body));
  return {
    ...onIssue(session, 'transition', facts),
    rows,
    plan: { id: move.id, fields, comment: args.body ?? null },
  };
}

async function comment(session: AtlassianSession, args: JiraEditArgs, facts: JiraFacts) {
  const body = needs(args.body, 'body with the comment text');
  return {
    ...onIssue(session, 'comment', facts),
    rows: [row('Comment', null, body), row('Visible to', null, visibilityText(args))],
    plan: { body, visibility: args.visibility ?? null },
  };
}

async function existingComment(session: AtlassianSession, args: JiraEditArgs, facts: JiraFacts) {
  const id = needs(args.id, 'id: the comment id from spark_jira read');
  const found = await session.jira.comment(facts.key, id);
  const mine = session.accountId !== null && found.authorId === session.accountId;
  const action = onIssue(session, args.action, facts);
  const rows = [row('Written by', null, mine ? 'You' : (found.author ?? 'someone else'))];
  if (args.action === 'delete_comment') {
    return {
      ...action,
      rows,
      comment: { id, before: cardText(found.body), after: null, updatedAt: found.updatedAt },
    };
  }
  const body = needs(args.body, 'body with the new comment text');
  if (args.visibility) rows.push(row('Visible to', null, visibilityText(args)));
  return {
    ...action,
    rows,
    comment: { id, before: cardText(found.body), after: body, updatedAt: found.updatedAt },
    plan: { visibility: args.visibility ?? null },
  };
}

async function link(session: AtlassianSession, args: JiraEditArgs, facts: JiraFacts) {
  const other = needs(args.otherKey, 'otherKey');
  const wanted = needs(args.linkType, 'linkType, such as Blocks or "is blocked by"').toLowerCase();
  const [types, target] = await Promise.all([
    session.jira.work.linkTypes(),
    session.jira.facts(other),
  ]);
  const type = types.find((entry) =>
    [entry.name, entry.outward, entry.inward].some((name) => name.toLowerCase() === wanted),
  );
  if (!type) {
    throw new SparkToolError(
      `No link type "${args.linkType}". Types: ${types.map((entry) => entry.name).join(', ')}.`,
    );
  }
  const reversed = type.inward.toLowerCase() === wanted && type.outward.toLowerCase() !== wanted;
  const [from, to] = reversed ? [target.key, facts.key] : [facts.key, target.key];
  return {
    ...onIssue(session, 'link', facts),
    rows: [row('Link', null, `${from} ${type.outward} ${to}`)],
    plan: { type: type.name, inward: to, outward: from },
  };
}

async function unlink(session: AtlassianSession, args: JiraEditArgs, facts: JiraFacts) {
  const id = needs(args.id, 'id: the link id from spark_jira read');
  const found = await session.jira.work.linkById(id);
  const text = `${found.outwardIssue?.key ?? '?'} ${found.type.outward} ${found.inwardIssue?.key ?? '?'}`;
  return { ...onIssue(session, 'unlink', facts), rows: [row('Link', text, null)], plan: { id } };
}

async function watcher(session: AtlassianSession, args: JiraEditArgs, facts: JiraFacts) {
  const user = await resolveUser(session.jira.client, args.user ?? 'me', {
    me: session.accountId,
    issueKey: facts.key,
  });
  if (!user) throw new SparkToolError('Pass user: a name, an accountId or me.');
  const adding = args.action === 'watch';
  return {
    ...onIssue(session, args.action, facts),
    rows: [row('Watcher', adding ? null : user.name, adding ? user.name : null)],
    plan: { accountId: user.accountId },
  };
}

async function worklog(session: AtlassianSession, args: JiraEditArgs, facts: JiraFacts) {
  const input = {
    ...(args.timeSpent ? { timeSpent: args.timeSpent } : {}),
    ...(args.start ? { started: jiraTime(args.start) } : {}),
    ...(args.body ? { comment: args.body } : {}),
  };
  if (args.action === 'log_work') {
    needs(args.timeSpent, 'timeSpent, such as 1h 30m');
    return {
      ...onIssue(session, 'log_work', facts),
      rows: [
        row('Time spent', null, input.timeSpent ?? ''),
        row('Started', null, input.started ?? 'now'),
        ...(args.body ? [row('Comment', null, args.body)] : []),
      ],
      plan: input,
    };
  }
  const id = needs(args.id, 'id: the work log id from spark_jira worklogs');
  const log = await session.jira.work.worklog(facts.key, id);
  const action = onIssue(session, args.action, facts);
  const old = [row('Written by', null, log.author ?? '')];
  if (args.action === 'delete_worklog') {
    return {
      ...action,
      rows: [
        ...old,
        row('Time spent', log.timeSpent ?? '', null),
        row('Comment', log.comment, null),
      ],
      plan: { id, updated: log.updated },
    };
  }
  return {
    ...action,
    rows: [
      ...old,
      row('Time spent', log.timeSpent ?? '', input.timeSpent ?? log.timeSpent ?? ''),
      row('Started', log.started ?? '', input.started ?? log.started ?? ''),
      row('Comment', log.comment, input.comment ?? log.comment),
    ],
    plan: { id, updated: log.updated, input },
  };
}

function remove(session: AtlassianSession, args: JiraEditArgs, facts: JiraFacts) {
  if (facts.subtasks.length > 0 && !args.withSubtasks) {
    throw new SparkToolError(
      `${facts.key} has subtasks (${facts.subtasks.join(', ')}). Nothing was deleted. Pass withSubtasks true to delete them with it.`,
    );
  }
  return {
    ...onIssue(session, 'delete', facts),
    before: issueFacts(shown(facts)),
    subtasks: facts.subtasks,
  };
}

export async function planIssueWork(
  session: AtlassianSession,
  args: JiraEditArgs,
): Promise<JiraEditAction> {
  const facts = await session.jira.facts(needs(args.key, 'key'));
  switch (args.action) {
    case 'transition':
      return transition(session, args, facts);
    case 'comment':
      return comment(session, args, facts);
    case 'edit_comment':
    case 'delete_comment':
      return existingComment(session, args, facts);
    case 'link':
      return link(session, args, facts);
    case 'unlink':
      return unlink(session, args, facts);
    case 'watch':
    case 'unwatch':
      return watcher(session, args, facts);
    case 'vote':
    case 'unvote':
      return {
        ...onIssue(session, args.action, facts),
        rows: [
          row(
            'Your vote',
            args.action === 'unvote' ? 'Yes' : null,
            args.action === 'vote' ? 'Yes' : null,
          ),
        ],
        plan: {},
      };
    case 'log_work':
    case 'edit_worklog':
    case 'delete_worklog':
      return worklog(session, args, facts);
    case 'delete':
      return remove(session, args, facts);
    default:
      throw new SparkToolError(`${args.action} is not an issue action.`);
  }
}
