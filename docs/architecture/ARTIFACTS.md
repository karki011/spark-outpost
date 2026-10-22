# Artifacts

An artifact is a page an agent makes for the user: HTML, Markdown or SVG. The user opens it beside the chat in the Work panel. Spark keeps every version. It runs sandboxed on its own origin and never reaches Spark, the network or the user's files. Built October 22, 2026, on top of the chat folders in [ACP_AGENTS.md](ACP_AGENTS.md).

## The tool

`spark_artifact` is a Spark action tool (`apps/server/src/spark-mcp/tools/artifact-tool.ts`). It is offered to every chat turn that may use action tools, project or not, and to Terminal sessions through the API's Spark tools host, on the same action path as the other Spark action tools there (not yet tried in a live Terminal session). It is not offered to Ask Spark or to read-only scopes.

| Action                           | What happens                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `publish {title, kind, content}` | Starts a new artifact at version 1                                                                                                           |
| `update {id, content, title?}`   | Adds the next version of an artifact in this chat                                                                                            |
| `read {id, version?}`            | Returns a version that was shown in this chat (the latest by default), as stored. It is Spark's own data about the chat, so it asks nothing. |

`publish` and `update` follow the agent's mode like other Spark action tools (`publish_artifact`, `action-policy.ts`). They run at once in Auto, Bypass permissions, Approve for me and Full access, and in Accept edits when the user's message asked for a page, chart, dashboard or similar. Otherwise they show a card with the title, kind, version and size.

Before the card, the content is checked and stored:

- **Boundary checks:** the content is at most 2 MB of UTF-8 (`ARTIFACT_MAX_BYTES`), an SVG must be one `<svg>` document, and the title is cleaned to 120 characters.
- **Scrubbing:** the content is scrubbed of saved sign-in values for the chat's project and of values from the secret files in the chat's projects and its own folder, as the browser tools do.
- **Storage:** it is written once (`wx`, 0600) to `<data>/<channel>/chats/<chat>/artifacts/<id>/<version>`, beside the chat's work folder and never inside it, so the safety floor keeps the agent from changing it. Each version gets a row in `artifact_page_versions` (migration 0204) with its sha256 and a random 256-bit view key.

The version is shown, and gets `published_at`, only when the action runs. A declined card leaves an unshown version that nothing serves, and keeps its number, so the picker can skip one (v1, v3). The audit holds the action with the artifact id, version, size and sha256, never the content. Deleting the chat removes the folder, and the rows go with the chat.

## MCP Apps and ACP mapping

The tool result is a text block and an MCP `resource_link` describing the artifact as an MCP Apps resource:

- `uri`: `ui://spark/<chat>/<id>`
- `mimeType`: `text/html;profile=mcp-app` for HTML, `text/markdown` or `image/svg+xml` otherwise
- `_meta.ui.csp`: `{ connectDomains: [], resourceDomains: [], frameDomains: [] }`, with `prefersBorder: true`

This follows [SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp) and the [ext-apps draft](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx). Spark's MCP server does not serve `resources/read` for these URIs; the agent reads a version with `read`. Spark renders no other server's `ui://` apps, and nothing in an artifact can call tools: there is no `window.claude` and no postMessage bridge.

An ACP `resource_link` in a tool call's content or in the agent's message whose URI parses as `ui://spark/<chat>/<id>` becomes an `artifact_link` output (`agents/acp/artifact-links.ts`). The worker turns it into an `ACTIVITY_SNAPSHOT` of type `artifact` only when the artifact belongs to the chat (`artifacts/activity.ts`). The tool also appends that activity itself when it shows a version, and the activity refreshes the chat.

The card under the turn is drawn from Spark's own record (`artifactPages` in the chat detail, per version's run). It never uses a title or kind the agent put in a link.

Whether the pinned adapters pass an MCP `resource_link` through to ACP tool call content has not been checked against a live Claude or Codex session. The fake agent does (`fake-acp-spark.ts`), and the card does not depend on it.

## Where it renders

The Work panel gets a third tab beside Work and Browser while an artifact is open. It has the title, a version picker, **Copy**, **Save as…** and **Close artifact**.

- **HTML** runs on its own origin, `http://127.0.0.1:<API_PORT + 10000>`, or `API_PORT - 10000` when the sum is above 65535 (`artifactPortFor`, worked out the same way by the server, Vite and the Mac app). This is a separate loopback server in the API process (`artifacts/origin-server.ts`) that serves only `GET /v/<view key>` for a shown HTML version. If its port can't be bound, the API logs it and runs on: the view has no address and the tab says the page can't be shown; Markdown, SVG, Copy and Save as… still work.
- **Markdown** renders in the app with the chat's Markdown renderer, which shows no raw HTML, images or non-web links.
- **SVG** renders as an `<img>` from a `data:` URL, so its scripts never run.

The artifact origin:

- Answers only `Host: 127.0.0.1:<port>`, `GET` only.
- Checks the stored sha256 on every serve. A changed file is not served.
- Sets no cookies and asks for no launch token, so it has nothing that reaches Spark's API.
- Sends `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts; frame-ancestors <the app's origins>`.
- Also sends `nosniff`, `no-referrer`, a Permissions-Policy that turns off camera, microphone, location, clipboard and the like, and `no-store`.

The app's frame is `sandbox="allow-scripts"` with no `allow-same-origin`, so the page has an opaque origin. The app's own CSP gains `frame-src 'self' <artifact origin>` (`appContentSecurityPolicy`, built per launch from the API port in the server and in Vite).

The Mac app adds four guards (`apps/desktop/src/artifact-frames.ts`):

- The artifact port is in the Browser pane's blocked ports.
- A subframe of a Spark window may load only artifact pages (`will-frame-navigate`); every other navigation is refused, and the app's `frame-src` already stops one to another site in the renderer.
- A request from the artifact frame never gets the launch token added.
- Downloads and permission requests from the artifact origin are refused.

### Links

The artifact origin puts one script before the page (after a leading doctype, `artifacts/link-clicks.ts`). On a real click (`isTrusted`) of an `http(s)` link that the page did not handle itself, whatever its `target`, it stops the click and moves the frame to `/open?to=<address>` on the artifact origin. The Mac app catches that navigation (`artifactLinkRequest`, `guardSubframes`) and:

- refuses it unless it comes from an artifact frame, within 1 second of a real mouse-up (`before-mouse-event`) or Enter or Space (`before-input-event`) in that window, with no other link question open; one click allows one question;
- reads only `http(s)` addresses without a user name or password, shown as the parsed address (punycode for other scripts);
- shows a dialog naming the address, **Open in Browser** or **Cancel** (the default), and opens it with the external-link path (`openExternal`) only on **Open in Browser**.

A page script cannot open anything on its own: popups are blocked by the sandbox, a direct navigation is blocked by `frame-src`, and an `/open` request without a real click in the last second is dropped. A script that runs at the moment the user clicks somewhere in the window can still ask, but only the dialog, with the address in it, opens a link. The origin itself answers `/open` with 404, so outside the Mac app (a browser in development) a link opens nothing. On paired devices the `page` route gets no script: links there behave as the device's browser treats a sandboxed frame.

**Save as…** fetches `GET /api/artifacts/:id/versions/:version/file` (an attachment, `default-src 'none'; sandbox`) and saves it with the shared `ExportButton`, as the audit export does. **Copy** copies the stored text.

## Paired devices

**Open artifacts** (Remote control, off by default) allows `GET /api/artifacts/:id/versions/:version/view` and `/page`. The page route serves the same HTML with the same policy and `frame-ancestors 'self'`, in the same sandboxed frame. The `file` route is `never`.

On a phone the frame is on the Serve origin, still opaque. A device's browser has no Electron guard, so a script's own navigation or WebRTC (which CSP does not cover) could send data from the page off the device. The page holds only what the agent wrote, scrubbed of secret values, and no Spark data. With the switch off the tab says it is turned off.

## Tests

- `artifacts.db.test.ts`: publish in Auto with the `resource_link`, versions and read, Manual's card, the 2 MB limit, a bad SVG, another chat's id, secret-value scrubbing and the audit.
- `artifact-origin.db.test.ts`: the policy and headers, the host check, method, unknown key and changed file, no Markdown or SVG page, and the API's view, file and page routes.
- `artifacts-remote.db.test.ts`: **Open artifacts** off by default, `view` and `page` refused until it is on, `file` always refused.
- `artifact-links.test.ts`: the ACP mapping. `artifact-pages.test.ts`: the artifact port stays in range and never equals the API port.
- `artifact-frames.test.ts` and `downloads.test.ts`: the Mac app guards, including a clicked link that asks and opens, Cancel, a script's request without a click, one question per click, other schemes, sign-ins in the address and other frames. `link-clicks.test.ts`: where the link script goes.
- `tests/browser/artifacts.spec.ts`: card, tab, sandbox attribute, the frame's fetch to the API blocked and `document.cookie` denied, the version picker, Copy, Save as… and close, Markdown and SVG, a clicked link that becomes an `/open` request while `window.open` opens nothing, and in Manual the **Show it** card, then the turn's card without a reload.
