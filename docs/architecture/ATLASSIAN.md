# Atlassian connector

One connector, **Atlassian**, covers Jira and Confluence on one Atlassian Cloud site. It replaced the Jira-only connection.

## Connection

- Auth is what Jira used before: site address, email and an API token, sent as HTTP Basic `email:token`. No OAuth.
- A connection saved before Spark stored account ids gets its account id on the first agent call, so own-comment checks work.
- The token lives in the keychain under the same secret id as before (`ticket:jira`). The connection row is still `ticket_connections` with `source = 'jira'`; Jira tickets keep the `jira` source id everywhere (inbox, chat links, development cache, ticket events, audit).
- Migration `0188_atlassian_products.sql` adds `jira_on`, `jira_reach`, `confluence_on` and `confluence_reach`. An existing Jira connection becomes Atlassian with nothing to re-enter: Jira stays on and reachable, Confluence is off and unchecked. Spark checks Confluence in the background when it lists connections (never holding the list up, at most every 10 minutes until it gets an answer) and stores the answer; the user turns Confluence on with its switch. Confluence starts off for an upgraded connection so no new agent access appears without a choice.
- On connect, Spark asks both products at once (`atlassian/products.ts`): Jira `GET /rest/api/3/myself`, Confluence `GET /wiki/api/v2/spaces?limit=1`. 401, 403 and 404 mean the token does not reach that product (a token scoped to Jira gets 401 from Confluence). A product that answers is turned on. The account comes from Jira, or from Confluence `GET /wiki/rest/api/user/current` when Jira is out of reach. When neither answers, a 401 says the token was rejected.
- Turning a product on checks it again when it was not reachable, and refuses with a plain line when it still is not. Turning Jira off removes Jira from the inbox, ticket tools and agent tools in one place: `openSource` returns nothing for it.
- The inbox reads Jira `search/jql` pages of 100 following `nextPageToken`, at most 5 pages (500 tickets) per list (open, recently done), one after another. When a token remains after the fifth page the inbox reports the source in `TicketInbox.truncated` and the Tickets page says it shows the 500 most recently updated.
- The card: site and email, **Connected**, a **···** menu whose **Disconnect…** asks in a dialog (shared with Calendar in `apps/web/src/connectors/DisconnectDialog.tsx`), a **Jira** and a **Confluence** row with a switch and one line each, and the ticket move settings under **Jira tickets** while Jira is on. Onboarding and Connections render the same card.
- Paired devices: the product switches go through `PATCH /api/tickets/connections/:source`, the existing route behind the **connections** remote switch. No route was added. A paired device answers Jira and Confluence cards like ticket cards, except deletes, which sit behind the **high-risk cards** switch (`remote/policy.ts`).

## Agent tools

Four tools, offered only while the product is connected, reachable and on (`needs: 'jira'` and `needs: 'confluence'`). Creating Jira issues stays with `spark_create_ticket`; the ticket tools for commenting, moving and assigning still work for Jira, and `spark_jira_edit` does all of it with more fields.

| Tool                    | Does                                                                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spark_jira`            | `search`, `read` (fields, links, attachments, comments with visibility), `types`, `fields`, `transitions`, `users`, `projects`, `project`, `link_types`, `worklogs`, `watchers`, `attachment` (text or image), `boards`, `sprints`; see [Jira actions](#jira-actions) |
| `spark_jira_edit`       | 26 actions, from `update` to `clone`; see [Jira actions](#jira-actions)                                                                                                                                                                                               |
| `spark_confluence`      | `search` by CQL (`GET /wiki/rest/api/search`, v1: there is no CQL search in v2); `read` a page as Markdown-like text, paged at 12,000 characters, with its version                                                                                                    |
| `spark_confluence_edit` | `create` (space key, title, Markdown body, optional parent), `update` (needs the version read), `comment` (footer comment), `delete` (moves the page to the trash)                                                                                                    |

Confluence calls use REST v2 (`/wiki/api/v2/pages`, `/footer-comments`, `/spaces`) except search and the current user. A v2 `DELETE /pages/{id}` moves a page to the trash; purging needs a second call on the trashed page, which Spark never makes. Endpoints were checked against Atlassian's published v2 OpenAPI document and the v1 search reference on 2026-10-19; nothing was verified against a live site beyond reads.

### Approval

- Reads follow the agent mode like a Spark action, once per chat per product: at once in Auto, Bypass permissions, Auto review and Full access (and in Accept edits when the user's message asked), otherwise an `atlassian_read` card that allows the rest of the chat.
- Writes are `jira_edit` and `confluence_edit` Spark actions through `proposeAction`: they follow the mode the same way, with a card that shows the change before and after (Jira: the legacy before and after facts plus `rows` of label, before and after, per issue for several; Confluence: page title and text; capped at 4,000 characters per value).
- Deleting an issue, a comment, a link, a work log, an attachment or a page follows the mode like any other write (owner decision, 2026-10-19); the result line names what was deleted, and a Confluence page is "Moved to trash".
- When the card is confirmed, Spark reads the item again and changes nothing when it moved on: a Jira issue whose `updated` changed, a comment whose `updated` changed, an issue whose subtasks are not the ones the card listed, or a page whose version is no longer the one on the card (update, comment and delete). `update` also refuses at once when the version the agent passes is not the current one, and a 409 from Confluence is reported the same way, so the agent reads the page again.
- Every read and write is an audit entry, without page or issue bodies (`atlassianAuditFacts`). Writes are a send to Jira or Confluence for the send flag; reads record private work data, so a later send off the computer carries the note.

### Content

- Jira and Confluence text is untrusted data: results are wrapped in `<atlassian_evidence>` with a note saying so.
- Agent Markdown becomes Confluence storage XHTML in `atlassian/confluence-format.ts`: headings, paragraphs, lists, quotes, code blocks, bold, italic, inline code and `http(s)` links. Everything else is escaped text, so an agent cannot write macros or raw markup. Pages are read back from storage to text.
- Errors: 401 asks to reconnect, 403 and 404 say the account can't see the item (adding what Jira said), 400 lists Jira's field errors, 429 says when to try again from `Retry-After`; nothing is changed on any of them.

### Ticket detail relations

The inbox's ticket detail (`jira.ts` `getTicket`) adds `parent`, `issuelinks` and `subtasks` to its one issue request and returns `parent`, `relations` and up to 50 `subtasks` (`subtasksMore` past that), read leniently in `jira-relations.ts`: a missing or odd field is an empty list, never a failed ticket. Read only, no extra request per link, and not part of any agent tool.

### Parent, issue type and team

- `spark_create_ticket` (Jira) takes `parent` and `team`; `spark_jira_edit` `update` takes `parent`, `issueType` and `team`. Linear refuses `parent` and `team` before any card. Everything goes in the one create or edit call as `fields.parent: {key}`, `fields.issuetype: {name}` and the Team field set to the team id string, so a sub-task type with a parent makes a real sub-task and an epic child gets its epic. Jira decides whether a type change is allowed; its refusal is passed on.
- The Team field is found with `GET /rest/api/3/field` by its type (`com.atlassian.teams:rm-teams-custom-field-team`, or `atlassian-team`), never by name, once per tool call; reads leave `team` null when it can't be found. A write refuses when there is none or several.
- A team is given by id (a UUID, the end of the team's profile address) or by name. A name is matched, ignoring case, against the teams on that project's latest 100 issues with a team (`cf[NNNNN] is not EMPTY`); no single match refuses and lists what was seen. Atlassian documents no team lookup by name for an API token, so there is no Teams API call.
- `types` reads `GET /rest/api/3/issue/createmeta/{project}/issuetypes`.
- Jira's field errors (`errors` as a map of field to message) are passed on by field; a 403 or 404 adds what Jira said.
- The Team value shapes come from Atlassian's Team field REST page (checked 2026-11-14); none of this was run against a live site.

### Jira actions

`spark_jira_edit` builds every write as a `jira_edit` action whose `plan` holds the request Spark built, checked again with a zod schema per action (`tools/atlassian/jira-plans.ts`) when the card is confirmed. Planning lives in `jira-plan-update.ts`, `jira-plan-work.ts` and `jira-plan-other.ts`; writing in `actions/jira-perform.ts`.

| Action                                             | REST                                                                                                             | Checked again before writing               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `update` (one key or `keys`, up to 20)             | `PUT /rest/api/3/issue/{key}` with `fields` and `update.labels` add and remove; parent `none` sends `parent: {}` | every issue's `updated`                    |
| `transition`                                       | `GET …/transitions?expand=transitions.fields`, `POST …/transitions` with screen `fields` and a comment           | `updated`                                  |
| `comment`, `edit_comment`, `delete_comment`        | `POST`/`PUT`/`DELETE …/comment` with `visibility` (role or group)                                                | the issue exists; the comment's `updated`  |
| `link`, `unlink`                                   | `GET /rest/api/3/issueLinkType`, `POST /rest/api/3/issueLink`, `GET`/`DELETE /issueLink/{id}`                    | both issues exist; the link exists         |
| `watch`, `unwatch`, `vote`, `unvote`               | `POST`/`DELETE …/watchers`, `…/votes`                                                                            | the issue exists                           |
| `log_work`, `edit_worklog`, `delete_worklog`       | `POST`/`PUT`/`DELETE …/worklog`                                                                                  | the issue exists; the work log's `updated` |
| `attach`, `delete_attachment`                      | `POST …/attachments` (multipart, `X-Atlassian-Token: no-check`), `GET`/`DELETE /rest/api/3/attachment/{id}`      | the file's sha256; the attachment exists   |
| `sprint`, `backlog`, `rank`                        | `POST /rest/agile/1.0/sprint/{id}/issue`, `POST /backlog/issue`, `PUT /issue/rank`                               | the issues exist; the sprint is not closed |
| `create_sprint`, `start_sprint`, `complete_sprint` | `POST /rest/agile/1.0/sprint`, `POST /sprint/{id}` with `state`                                                  | the sprint's state                         |
| `create_version`, `release_version`                | `POST /rest/api/3/version`, `PUT /version/{id}`                                                                  | not released yet                           |
| `clone`                                            | reads the source, `POST /rest/api/3/issue`, then a Cloners link when that type exists                            | the source's `updated`                     |

- Fields by id or name come from `GET …/editmeta` (an issue) or `GET /rest/api/3/issue/createmeta/{project}/issuetypes/{id}` (create). Values are checked by schema type in `atlassian/jira-meta.ts`: names become allowed-value ids, numbers and dates are checked, user fields resolve through `GET /rest/api/3/user/search` or `user/assignable/search`, rich text becomes ADF, unknown types pass as given.
- Comments can now be edited or deleted whoever wrote them, when Jira allows it; the card names the author. Before, Spark allowed only the user's own comments; this widening came from the coordinator's request for full Jira access on 2026-11-14 and is for the owner to confirm or roll back.
- `attach` reads only inside the chat's project roots and its kept folder, refuses secret and credential files and anything over 10 MB, and is a send.
- Reads: an attachment comes back as text (12,000 characters) or an image (4 MB) from `GET /rest/api/3/attachment/content/{id}`. Spark never follows that redirect with the API token: it reads the `Location` by hand, accepts only the site itself or an `https` Atlassian host (`atlassian.net`, `atlassian.com`, `atl-paas.net`) with no login in it, and fetches it without the authorization header.
- `update` with `keys` across projects refuses `fields`, `team`, `assignee` and `reporter`, whose ids are per project. When one issue of several fails, the card's result is a failure naming the issues already changed.
- Link direction follows Atlassian's issue link docs and KB ("outwardIssue: the issue the link originates from"): for "A blocks B" Spark sends A as `outwardIssue` and B as `inwardIssue`; Atlassian has admitted the POST docs mislead elsewhere, so this is the first thing to check on a live site.
- Nothing here ran against a live site. Looked up in Atlassian's docs or community: the Team field value, `createmeta/{project}/issuetypes`, link direction, removing a parent (only third-party advice, so `parent: {}` is a guess). Written from knowledge of the REST v3 and Agile 1.0 references and not checked this round, each unverified: `GET …/editmeta`; `GET …/createmeta/{project}/issuetypes/{id}` and its `fields` property; `GET …/transitions?expand=transitions.fields` and `POST …/transitions` with `fields` and `update.comment`; comment `visibility`; `GET /issueLinkType`, `POST /issueLink`, `GET`/`DELETE /issueLink/{id}`; `POST`/`DELETE …/watchers` (a JSON string body), `…/votes`; `…/worklog` with `started` as `yyyy-MM-ddTHH:mm:ss.SSS+0000`; `POST …/attachments` multipart with `X-Atlassian-Token: no-check`, `GET`/`DELETE /attachment/{id}`, `GET /attachment/content/{id}`; `GET /user/search`, `/user/assignable/search?issueKey=`, `GET /user?accountId=`; `GET /project/search`, `/project/{key}`, `/components`, `/versions`; `POST /version`, `PUT /version/{id}` with `released`; Agile `GET /board`, `/board/{id}/sprint`, `GET`/`POST /sprint/{id}`, `POST /sprint`, `POST /sprint/{id}/issue`, `POST /backlog/issue`, `PUT /issue/rank`; `complete_sprint` with open issues (Jira decides where they go).
- Not covered: moving an issue to another project, editing a sprint's name or dates after it starts, editing, archiving or deleting versions, creating components, reading change history. `assignee` goes through the edit screen (`fields.assignee`), not the assignee endpoint, so it fails where Assignee is not on that screen; `spark_assign_ticket` still uses the endpoint.

## Tests

`apps/server/test/fake-confluence.ts` and the Jira fake (`fake-jira.ts`, `fake-jira-edits.ts`) serve both products from one origin, with faults for 409, 429 and an unreachable Confluence. DB tests cover connect and products, the migration, both tools' approval paths and conflicts; `tests/browser/atlassian-connector.spec.ts` covers the card, the disconnect dialog and the two cards, with axe in every theme.
