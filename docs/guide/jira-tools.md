---
title: Jira tools for agents
section: Reference
type: reference
order: 1270
summary: Every Jira read and change an agent can make through Spark, and what each change shows on its card.
---

With **Jira** on in the Atlassian connector, agents read Jira with `spark_jira` and change it with `spark_jira_edit`. They act with your Jira permissions; when Jira refuses, the agent gets Jira's reason.

## Reads

| Read                                                  | `spark_jira` action                  |
| ----------------------------------------------------- | ------------------------------------ |
| Search by JQL                                         | `search`                             |
| One issue: fields, links, attachments, comments       | `read`                               |
| Issue types, sub-task types and teams in a project    | `types`                              |
| Fields you can set, with allowed values               | `fields`                             |
| Moves from the current status and their screen fields | `transitions`                        |
| People, projects, a project's components and versions | `users`, `projects`, `project`       |
| Link types, work logs, watchers and votes             | `link_types`, `worklogs`, `watchers` |
| An attachment as text or an image                     | `attachment`                         |
| Boards and their sprints                              | `boards`, `sprints`                  |

Reads follow the agent's mode, asking once per chat. Jira text is untrusted data.

## Changes

| Change                                                                   | `spark_jira_edit` action                           |
| ------------------------------------------------------------------------ | -------------------------------------------------- |
| Summary, description, labels, priority, parent, type, team               | `update`                                           |
| Assignee, reporter, estimates, any field by name (components, due date…) | `update`                                           |
| The same change on several issues, one card                              | `update` with `keys`                               |
| Move with a resolution and screen fields                                 | `transition`                                       |
| Comment, with role or group visibility; edit or delete one               | `comment`, `edit_comment`, `delete_comment`        |
| Link or unlink issues                                                    | `link`, `unlink`                                   |
| Watch, vote                                                              | `watch`, `unwatch`, `vote`, `unvote`               |
| Log, change or delete work                                               | `log_work`, `edit_worklog`, `delete_worklog`       |
| Upload a file from the chat's project or kept files; delete one          | `attach`, `delete_attachment`                      |
| Sprint, backlog, rank                                                    | `sprint`, `backlog`, `rank`                        |
| Create, start or complete a sprint                                       | `create_sprint`, `start_sprint`, `complete_sprint` |
| Create or release a version                                              | `create_version`, `release_version`                |
| Clone or delete an issue                                                 | `clone`, `delete`                                  |

`spark_create_ticket` also takes a Jira `parent`, `team` and `fields`.

## Cards

Changes follow the agent's mode like other [Spark tools](spark-tools.md#when-actions-ask-first). The card shows each field before and after, and Spark reads the issue again before writing; if it changed, nothing is written.

Deletes name what was deleted. `attach` never uploads secret files or files outside the chat's projects.
