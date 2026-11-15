import { readFile } from 'node:fs/promises';
import type { JiraEditAction } from '@spark-outpost/contracts';
import { changeFields, type JiraEdits } from '../../atlassian/jira-edits.ts';
import { sha256 } from '../tools/atlassian/jira-plan-other.ts';
import { planOf } from '../tools/atlassian/jira-plans.ts';
import type { Performed } from './performed.ts';

export class AtlassianChangedError extends Error {}

export const JIRA_CHANGED =
  'The issue changed in Jira after the card was shown, so Spark changed nothing. Ask the agent to read it again.';

const done = (
  message: string,
  url: string | null,
  output: Record<string, unknown> = {},
): Performed => ({
  message,
  url,
  output,
});

async function unchanged(jira: JiraEdits, key: string, updated: string | null) {
  const now = await jira.facts(key);
  if (updated !== null && now.updated !== updated) throw new AtlassianChangedError(JIRA_CHANGED);
  return now;
}

async function update(jira: JiraEdits, action: JiraEditAction): Promise<Performed> {
  const targets = [{ key: action.ticket.key, updated: action.updated }, ...action.targets];
  for (const target of targets) await unchanged(jira, target.key, target.updated);
  const extra = action.plan ? planOf(action, 'update') : { fields: {}, update: {} };
  const body = {
    fields: { ...changeFields(action.changes), ...extra.fields },
    ...(Object.keys(extra.update).length > 0 ? { update: extra.update } : {}),
  };
  const changed: string[] = [];
  for (const target of targets) {
    try {
      await jira.edit(target.key, body);
      changed.push(target.key);
    } catch (error) {
      if (changed.length === 0) throw error;
      throw new Error(
        `Only part of the change was made: ${changed.join(', ')} changed; ${target.key} failed and the rest were not tried. ${(error as Error).message}`,
        { cause: error },
      );
    }
  }
  const what = [
    ...new Set([...Object.keys(action.changes), ...action.rows.map((row) => row.label)]),
  ];
  return done(`Changed ${what.join(', ')} on ${changed.join(', ')}.`, action.ticket.url, {
    key: action.ticket.key,
    ...(changed.length > 1 ? { changed } : {}),
  });
}

async function issueWork(jira: JiraEdits, action: JiraEditAction): Promise<Performed> {
  const { key, url } = action.ticket;
  switch (action.op) {
    case 'transition': {
      await unchanged(jira, key, action.updated);
      const plan = planOf(action, 'transition');
      await jira.work.transition(key, plan.id, plan.fields, plan.comment ?? undefined);
      const status = action.rows.find((row) => row.label === 'Status')?.after ?? 'the new status';
      return done(`Moved ${key} to ${status}.`, url, { key });
    }
    case 'comment': {
      await unchanged(jira, key, null);
      const plan = planOf(action, 'comment');
      const id = await jira.work.addComment(key, plan.body, plan.visibility);
      return done(`Commented on ${key}.`, url, { commentId: id });
    }
    case 'link': {
      const plan = planOf(action, 'link');
      await Promise.all([unchanged(jira, plan.inward, null), unchanged(jira, plan.outward, null)]);
      await jira.work.link(plan.type, plan.inward, plan.outward);
      return done(`Linked: ${action.rows[0]?.after ?? key}.`, url);
    }
    case 'unlink': {
      const plan = planOf(action, 'unlink');
      await jira.work.linkById(plan.id);
      await jira.work.unlink(plan.id);
      return done(`Removed the link ${action.rows[0]?.before ?? plan.id}.`, url);
    }
    case 'watch':
    case 'unwatch': {
      await unchanged(jira, key, null);
      const plan = planOf(action, action.op);
      await jira.work.watch(key, plan.accountId, action.op === 'watch');
      const name = action.rows[0]?.after ?? action.rows[0]?.before ?? 'the watcher';
      return done(
        `${action.op === 'watch' ? 'Added' : 'Removed'} ${name} as a watcher on ${key}.`,
        url,
      );
    }
    case 'vote':
    case 'unvote':
      await unchanged(jira, key, null);
      await jira.work.vote(key, action.op === 'vote');
      return done(action.op === 'vote' ? `Voted for ${key}.` : `Removed your vote on ${key}.`, url);
    default:
      return worklogs(jira, action);
  }
}

async function worklogs(jira: JiraEdits, action: JiraEditAction): Promise<Performed> {
  const { key, url } = action.ticket;
  if (action.op === 'log_work') {
    await unchanged(jira, key, null);
    const id = await jira.work.addWorklog(key, planOf(action, 'log_work'));
    return done(`Logged work on ${key}.`, url, { worklogId: id });
  }
  const plan = planOf(action, action.op === 'edit_worklog' ? 'edit_worklog' : 'delete_worklog');
  const now = await jira.work.worklog(key, plan.id);
  if (now.updated !== plan.updated) throw new AtlassianChangedError(JIRA_CHANGED);
  if (action.op === 'delete_worklog') {
    await jira.work.deleteWorklog(key, plan.id);
    return done(`Deleted work log ${plan.id} (${now.timeSpent ?? 'no time'}) on ${key}.`, url);
  }
  await jira.work.editWorklog(key, plan.id, planOf(action, 'edit_worklog').input);
  return done(`Changed work log ${plan.id} on ${key}.`, url);
}

async function files(jira: JiraEdits, action: JiraEditAction): Promise<Performed> {
  const { key, url } = action.ticket;
  if (action.op === 'attach') {
    const plan = planOf(action, 'attach');
    await unchanged(jira, key, null);
    const data = await readFile(plan.path);
    if (sha256(data) !== plan.sha256) {
      throw new AtlassianChangedError(
        'The file changed after the card was shown, so Spark uploaded nothing.',
      );
    }
    await jira.transfer.upload(
      `/rest/api/3/issue/${encodeURIComponent(key)}/attachments`,
      { name: plan.name, data, mimeType: plan.mimeType },
      `uploading ${plan.name} to ${key}`,
    );
    return done(`Uploaded ${plan.name} to ${key}.`, url);
  }
  if (action.op === 'delete_attachment') {
    const plan = planOf(action, 'delete_attachment');
    const file = await jira.projects.attachment(plan.id);
    await jira.projects.deleteAttachment(plan.id);
    return done(`Deleted the attachment ${file.filename} from ${key}.`, url);
  }
  await unchanged(jira, key, action.updated);
  const created = await jira.createIssue(planOf(action, 'clone').fields);
  const types = await jira.work.linkTypes().catch(() => []);
  const cloners = types.find((type) => type.name === 'Cloners');
  if (cloners) await jira.work.link(cloners.name, key, created.key).catch(() => undefined);
  return done(`Cloned ${key} as ${created.key}.`, created.url, { key: created.key });
}

async function agile(jira: JiraEdits, action: JiraEditAction): Promise<Performed> {
  const { key, url } = action.ticket;
  switch (action.op) {
    case 'sprint':
    case 'backlog': {
      for (const target of [{ key }, ...action.targets]) await unchanged(jira, target.key, null);
      if (action.op === 'backlog') {
        const plan = planOf(action, 'backlog');
        await jira.agile.moveToBacklog(plan.keys);
        return done(`Moved ${plan.keys.join(', ')} to the backlog.`, url);
      }
      const plan = planOf(action, 'sprint');
      const sprint = await jira.agile.sprint(plan.sprintId);
      if (sprint.state === 'closed')
        throw new AtlassianChangedError(`${sprint.name} closed after the card was shown.`);
      await jira.agile.moveToSprint(plan.sprintId, plan.keys);
      return done(`Moved ${plan.keys.join(', ')} to ${sprint.name}.`, url);
    }
    case 'rank': {
      const plan = planOf(action, 'rank');
      await unchanged(jira, key, null);
      await jira.agile.rank(key, plan.other, plan.after);
      return done(`Ranked ${key} ${plan.after ? 'after' : 'before'} ${plan.other}.`, url);
    }
    case 'create_sprint': {
      const plan = planOf(action, 'create_sprint');
      const sprint = await jira.agile.createSprint(plan.boardId, plan);
      return done(`Created the sprint ${sprint.name}.`, null, { sprintId: sprint.id });
    }
    default: {
      const plan = planOf(
        action,
        action.op === 'start_sprint' ? 'start_sprint' : 'complete_sprint',
      );
      const sprint = await jira.agile.sprint(plan.sprintId);
      if (sprint.state !== action.updated)
        throw new AtlassianChangedError(
          `${sprint.name} is ${sprint.state} now, so Spark changed nothing.`,
        );
      if (action.op === 'start_sprint') {
        const start = planOf(action, 'start_sprint');
        await jira.agile.updateSprint(plan.sprintId, 'active', start);
        return done(`Started ${sprint.name}.`, null);
      }
      await jira.agile.updateSprint(plan.sprintId, 'closed', {});
      return done(`Completed ${sprint.name}.`, null);
    }
  }
}

async function versions(jira: JiraEdits, action: JiraEditAction): Promise<Performed> {
  if (action.op === 'create_version') {
    const plan = planOf(action, 'create_version');
    const created = await jira.projects.createVersion(plan.projectId, plan);
    return done(`Created the version ${created.name} in ${action.ticket.key}.`, null, {
      versionId: created.id,
    });
  }
  const plan = planOf(action, 'release_version');
  const now = await jira.projects.version(plan.id);
  if (now.released)
    throw new AtlassianChangedError(`${now.name} was released after the card was shown.`);
  await jira.projects.releaseVersion(plan.id, plan.releaseDate);
  return done(`Released ${now.name}.`, null);
}

const AGILE = new Set([
  'sprint',
  'backlog',
  'rank',
  'create_sprint',
  'start_sprint',
  'complete_sprint',
]);

export function performJiraOp(jira: JiraEdits, action: JiraEditAction): Promise<Performed> {
  if (action.op === 'update') return update(jira, action);
  if (AGILE.has(action.op)) return agile(jira, action);
  if (action.op === 'create_version' || action.op === 'release_version')
    return versions(jira, action);
  if (['attach', 'delete_attachment', 'clone'].includes(action.op)) return files(jira, action);
  return issueWork(jira, action);
}
