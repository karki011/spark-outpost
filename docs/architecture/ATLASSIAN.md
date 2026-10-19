# Atlassian connector

One connector, **Atlassian**, covers Jira and Confluence on one Atlassian Cloud site. It replaced the Jira-only connection.

## Connection

- Auth is what Jira used before: site address, email and an API token, sent as HTTP Basic `email:token`. No OAuth.
- A connection saved before Spark stored account ids gets its account id on the first agent call, so own-comment checks work.
- The token lives in the keychain under the same secret id as before (`ticket:jira`). The connection row is still `ticket_connections` with `source = 'jira'`; Jira tickets keep the `jira` source id everywhere (inbox, chat links, development cache, ticket events, audit).
- Migration `0188_atlassian_products.sql` adds `jira_on`, `jira_reach`, `confluence_on` and `confluence_reach`. An existing Jira connection becomes Atlassian with nothing to re-enter: Jira stays on and reachable, Confluence is off and unchecked. Spark checks Confluence in the background when it lists connections (never holding the list up, at most every 10 minutes until it gets an answer) and stores the answer; the user turns Confluence on with its switch. Confluence starts off for an upgraded connection so no new agent access appears without a choice.
- On connect, Spark asks both products at once (`atlassian/products.ts`): Jira `GET /rest/api/3/myself`, Confluence `GET /wiki/api/v2/spaces?limit=1`. 401, 403 and 404 mean the token does not reach that product (a token scoped to Jira gets 401 from Confluence). A product that answers is turned on. The account comes from Jira, or from Confluence `GET /wiki/rest/api/user/current` when Jira is out of reach. When neither answers, a 401 says the token was rejected.
- Turning a product on checks it again when it was not reachable, and refuses with a plain line when it still is not. Turning Jira off removes Jira from the inbox, ticket tools and agent tools in one place: `openSource` returns nothing for it.
- The card: site and email, **Connected**, a **···** menu whose **Disconnect…** asks in a dialog (shared with Calendar in `apps/web/src/connectors/DisconnectDialog.tsx`), a **Jira** and a **Confluence** row with a switch and one line each, and the ticket move settings under **Jira tickets** while Jira is on. Onboarding and Connections render the same card.
- Paired devices: the product switches go through `PATCH /api/tickets/connections/:source`, the existing route behind the **connections** remote switch. No route was added. A paired device answers Jira and Confluence cards like ticket cards, except deletes, which sit behind the **high-risk cards** switch (`remote/policy.ts`).

## Agent tools

Four tools, offered only while the product is connected, reachable and on (`needs: 'jira'` and `needs: 'confluence'`). Creating, commenting, moving and assigning Jira issues stay with the existing ticket tools.

| Tool                    | Does                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spark_jira`            | `search` by JQL (`POST /rest/api/3/search/jql`, `nextPageToken`); `read` one issue with its description (paged) and the latest 20 comments with id and whether mine |
| `spark_jira_edit`       | `update` summary, description, labels, priority; `edit_comment` and `delete_comment` on the user's own comments; `delete` an issue (`withSubtasks` for subtasks)    |
| `spark_confluence`      | `search` by CQL (`GET /wiki/rest/api/search`, v1: there is no CQL search in v2); `read` a page as Markdown-like text, paged at 12,000 characters, with its version  |
| `spark_confluence_edit` | `create` (space key, title, Markdown body, optional parent), `update` (needs the version read), `comment` (footer comment), `delete` (moves the page to the trash)  |

Confluence calls use REST v2 (`/wiki/api/v2/pages`, `/footer-comments`, `/spaces`) except search and the current user. A v2 `DELETE /pages/{id}` moves a page to the trash; purging needs a second call on the trashed page, which Spark never makes. Endpoints were checked against Atlassian's published v2 OpenAPI document and the v1 search reference on 2026-10-19; nothing was verified against a live site beyond reads.

### Approval

- Reads follow the agent mode like a Spark action, once per chat per product: at once in Auto, Bypass permissions, Approve for me and Full access (and in Accept edits when the user's message asked), otherwise an `atlassian_read` card that allows the rest of the chat.
- Writes are `jira_edit` and `confluence_edit` Spark actions through `proposeAction`: they follow the mode the same way, with a card that shows the change before and after (summary, labels, priority, description, comment text, page title and text, capped at 4,000 characters on the card).
- Deleting an issue, a comment or a page always asks, in every mode.
- When the card is confirmed, Spark reads the item again and changes nothing when it moved on: a Jira issue whose `updated` changed, a comment whose `updated` changed, an issue whose subtasks are not the ones the card listed, or a page whose version is no longer the one on the card (update, comment and delete). `update` also refuses at once when the version the agent passes is not the current one, and a 409 from Confluence is reported the same way, so the agent reads the page again.
- Every read and write is an audit entry, without page or issue bodies (`atlassianAuditFacts`). Writes are a send to Jira or Confluence for the send flag; reads record private work data, so a later send off the computer carries the note.

### Content

- Jira and Confluence text is untrusted data: results are wrapped in `<atlassian_evidence>` with a note saying so.
- Agent Markdown becomes Confluence storage XHTML in `atlassian/confluence-format.ts`: headings, paragraphs, lists, quotes, code blocks, bold, italic, inline code and `http(s)` links. Everything else is escaped text, so an agent cannot write macros or raw markup. Pages are read back from storage to text.
- Errors: 401 asks to reconnect, 403 and 404 say the account can't see the item, 429 says when to try again from `Retry-After`; nothing is changed on any of them.

## Tests

`apps/server/test/fake-confluence.ts` and the Jira fake (`fake-jira.ts`, `fake-jira-edits.ts`) serve both products from one origin, with faults for 409, 429 and an unreachable Confluence. DB tests cover connect and products, the migration, both tools' approval paths and conflicts; `tests/browser/atlassian-connector.spec.ts` covers the card, the disconnect dialog and the two cards, with axe in every theme.
