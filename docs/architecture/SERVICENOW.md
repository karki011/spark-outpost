# ServiceNow connector

**ServiceNow** is a ticket source (`servicenow`) for one instance. It is offered in Connections → Connectors and in onboarding. Nothing here was checked against a live instance yet: the endpoints and behaviour follow ServiceNow's public docs, and the facts marked unverified wait for the owner's test on a Personal Developer Instance (PDI).

## Connection

- **Instance** (`servicenow.ts` in contracts): a bare name becomes `https://<name>.service-now.com`.
  - Any other host must be https, with no login, path or query, and a port up to 65535.
  - Plain http is accepted on loopback only (tests and the fake).
- **Sign-in:** a username with a password (HTTP Basic), or with an API key in the `x-sn-apikey` header. The `x-sn-apikey` name is unverified.
  - The secret lives only in the keychain as `ticket:servicenow`.
  - OAuth is not offered yet.
  - Every call uses `redirect: 'manual'`. A 3xx (or an opaque redirect) stops with "<host> sent Spark to another address…", so the secret never reaches another origin.
- **Connect:** `servicenow/connect.ts` reads the user from `sys_user` by `user_name`, then probes each record type with a one-row Table API read:
  - **Incidents** (`incident`);
  - **Requests and tasks** (`sc_req_item`, `sc_task`): reachable when either table answers, and a table that answers 403 later is skipped while the other still reads;
  - **Changes** (`change_request`);
  - **Problems** (`problem`).

  A type that answers is turned on. **Check connection** reprobes. A switch turned on is probed again and refused when it still can't be read.

- **Storage:** migrations `0209` and `0210` widen the source checks and add `auth_kind`, `login`, `servicenow_types` and `inbox_scope`. **Move on ship** and **Move on merge** are always off for ServiceNow and refused.
- **Paired devices:** the connection settings use `PATCH /api/tickets/connections/:source`, the existing route behind the **connections** switch.

## Tickets

- **The adapter** is `servicenow/source.ts` (a `TicketSource`). It sits on `servicenow/record-store.ts`, which owns:
  - Table API reads per table, with `sysparm_display_value=all`;
  - the number → table cache;
  - group membership;
  - journals (`sys_journal_field`, falling back to the record's journal text when that table is closed by an ACL);
  - attachment names and sizes;
  - PATCH writes.
- **Encoded queries** are built in `servicenow/query.ts` and never from raw text:
  - search text loses `^` and line breaks;
  - numbers must match the record-number key rule;
  - `sys_id`s must be `[A-Za-z0-9_-]`.
- **The inbox** shows records assigned to the user. With **Me and my groups** (the default) it also shows unassigned records in the user's groups.
- **States** come from `sys_choice` and are mapped through the shared status layer; **Resolved** counts as in review. If `sys_choice` can't be read, moves are refused.
- **Final states:** the generic move (Move menu, `spark_transition_ticket`, Ask Spark's move) refuses any final state: resolved, closed, cancelled, or closed complete, incomplete or skipped. Only `spark_servicenow_edit` reaches them, on a card that always asks. The Tickets Move menu has no such card yet; it shows the refusal and the user resolves in ServiceNow.
- **Notes:**
  - Generic writes (`spark_comment_ticket`, the pull request link, the composer's default) post **work notes**.
  - A comment the caller sees comes only from the composer's confirm dialog (`visibility: 'customer'` on the comments route, behind **High-risk cards** on a paired device) or from `spark_servicenow_edit`.
- **Read-only and not offered:** change requests are read only everywhere. There is no create or delete.

## Agent tools

Both tools are offered while ServiceNow is connected with at least one record type on (`needs: 'servicenow'`). `spark_create_ticket` needs a tracker other than ServiceNow (`needs: 'ticket_create'`).

| Tool                    | Does                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `spark_servicenow`      | `search`: an encoded query on one table that is on, or on every table that is on, paged per table. `mine` scopes it to the user's `sys_id` and their groups' unassigned records, never dynamic filters. A query holding `javascript` or a line break is refused. `read`: one record by number, with its description paged, work notes and comments kept apart, and attachment names. |
| `spark_servicenow_edit` | `update` sets short description, description, urgency and impact. `work_note` adds a work note. `comment` adds an additional comment the caller sees. `move` sets the state by name; a final state needs close notes, and on incidents a close code checked against the instance's `close_code` choices.                                                                             |

Priority is not written: instances usually derive it from impact and urgency.

### Approval

- **Reads** follow the agent mode once per chat, through the shared read gate (`spark-mcp/tools/read-gate.ts`, also used by Atlassian):
  - at once in Auto, Bypass permissions, Approve for me and Full access, and in Accept edits when the user's message asked;
  - otherwise a `servicenow_read` card.
- **Writes** are `servicenow_edit` Spark actions:
  - `update`, `work_note` and a non-final `move` follow the mode;
  - `comment` and a final `move` set `alwaysAsk`, so they show a card in every mode, Ask Spark's **Act** included.
- **Those cards:**
  - have verb buttons ("Post comment" / "Don't post", "Resolve" / "Don't resolve") and a warning outline;
  - never take focus on their own, so no stray key confirms them;
  - need **High-risk cards** on a paired device (`cardSwitch`);
  - Ask Spark refuses to answer them (`cardRefusal`).
- **Ask Spark** may propose them; a turn from a paired device gets no ServiceNow action, as with Jira.
- **On confirm,** Spark reads the record again. It changes nothing if it is no longer the same `sys_id`, or if `sys_updated_on` (the stored UTC value) moved on.
- **Audit and send flag:**
  - The audit records table, number, op, changed field names, the target state, the close code, and note and close-notes lengths. It never records text (`serviceNowAuditFacts`).
  - A write is a send to ServiceNow for the send flag. A read records private work data.

### Content

ServiceNow text is untrusted. Results are wrapped in `<servicenow_evidence>` with a note saying so, and the Tickets detail shows descriptions and notes as plain text.

## Tests

The fake instance is `apps/server/test/fake-servicenow*.ts`, run in the provider stub for browser specs. It serves records, choices, close codes, journals, attachments and PATCH. Its faults are 401, 403 per table, 429, a redirect, and a non-ServiceNow host.

- **DB:** `servicenow-connect`, `servicenow-tickets`, `servicenow-ticket-tools` and `servicenow-agent-tools`.
- **Unit:** `query`, `records` and the contract tests.
- **Browser:** `servicenow-connector`, `servicenow-tickets` and `servicenow-cards`.

## Unverified until the PDI test

- **API key:** the `x-sn-apikey` header, and its access policy.
- **Paging:** the `Link` and `X-Total-Count` headers. Spark pages by offset and doesn't rely on them.
- **Rate limits:** the units of `Retry-After`.
- **Journals:** whether an `itil` user can read `sys_journal_field`.
- **Close fields:** which close fields each table needs over REST (`close_code` and `close_notes` on incidents, notes elsewhere), and whether a data policy refuses a resolve without them.
- **Priority:** whether a direct write would be overwritten (Spark doesn't write it).
