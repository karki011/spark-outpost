import type { RemoteSwitch } from '@spark-outpost/contracts';

export type RemoteRule = 'always' | 'never' | 'pairing' | 'passkey' | RemoteSwitch;

const ALWAYS = `
GET /{*path}
GET /api/health
GET /api/events
GET /api/remote/switches
GET /api/remote/session
GET /api/remote/push
DELETE /api/remote/push/subscription
GET /api/spark-pause
PUT /api/spark-pause
GET /api/agent-config/trust
GET /api/analytics/overview
GET /api/analytics/rollups
GET /api/analytics/spend
GET /api/analytics/outcomes
GET /api/runs/:id/changes
POST /api/approvals/:id/decision
POST /api/approvals/:id/hold
POST /api/approvals/:id/retry
GET /api/spark-rules
POST /api/runs/:id/revert
GET /api/tasks/:id/changes/revert-file
POST /api/tasks/:id/changes/revert-file
GET /api/attachments/:id/content
POST /api/attachments
GET /api/conversations/:id/audit/export.csv
GET /api/conversations/:id/audit/export.jsonl
GET /api/conversations/:id/audit/summary
GET /api/runs/:id/audit/log
GET /api/runs/:id/audit/verify
GET /api/chat-settings/defaults
GET /api/repos-folders
GET /api/conversations/:id/share
GET /api/conversations/:id/tickets
GET /api/conversations/:id/workspace
GET /api/conversations/:id/workspace/bring
GET /api/projects/:id/branches
GET /api/providers/:provider/capabilities
PATCH /api/conversations/:id/settings
POST /api/chat-context
POST /api/conversations/:id/tickets
POST /api/conversations/:id/tickets/dismiss
POST /api/conversations/:id/tickets/unlink
POST /api/conversations/:id/workspace/bring
PUT /api/conversations/:id/workspace
GET /api/conversations/:id/file-view
POST /api/conversations/:id/update
POST /api/spark-assistant
GET /api/spark-assistant/settings
GET /api/spark-assistant/events
GET /api/spark-assistant/history
POST /api/spark-assistant/topic
GET /api/conversations/:id/agent-commands
GET /api/conversations/:id/agent-terminals
PATCH /api/conversations/:id
POST /api/conversations/:id/fresh-session
POST /api/conversations/:id/seen
GET /api/attention
POST /api/attention/chats/:id/read
POST /api/attention/:key/read
POST /api/attention/:key/set-aside
POST /api/attention/:key/dismiss
PUT /api/conversations/pinned-order
GET /api/home/digest
GET /api/home/recap
GET /api/home/today
GET /api/providers/health
GET /api/usage/spend
GET /api/usage/summary
GET /api/usage/plan-limits
POST /api/home/digest
POST /api/home/recap
POST /api/home/recap/:id/refine
POST /api/runs/:id/continue
POST /api/runs/:id/start-fresh
GET /api/map/links
GET /api/map/unmatched
GET /api/projects/:id/map
GET /api/projects/:id/map/areas/:areaId
GET /api/projects/:id/map/neighbors
GET /api/projects/:id/map/locate
PUT /api/projects/:id/map/areas/:areaId/category
GET /api/conversations/:id/mcp
GET /api/model-cards
GET /api/runs/:id/outcome
PUT /api/runs/:id/feedback
GET /api/conversations/:id/pull-requests
POST /api/conversations/:id/pull-requests/refresh
POST /api/conversations/:id/pull-requests/:watchId/refresh
GET /api/project-clones
GET /api/project-clones/options
GET /api/projects
GET /api/projects/:id/file
GET /api/projects/:id/files
GET /api/projects/:id/git
POST /api/projects/:id/attachments
PUT /api/projects/:id/chat-order
PUT /api/projects/order
DELETE /api/conversations/:id/queue/:itemId
GET /api/conversations/:id/queue
PATCH /api/conversations/:id/queue/:itemId
POST /api/conversations/:id/queue
POST /api/conversations/:id/queue/:itemId/send-now
POST /api/conversations/:id/queue/send-now
PUT /api/conversations/:id/queue/order
POST /api/conversations/:id/steers/:itemId/resend
DELETE /api/conversations/:id/steers/:itemId
GET /api/outposts
GET /api/outposts/:id
GET /api/outposts/:id/library
GET /api/outposts/:id/suggestions
GET /api/conversations/:id/outpost-drafts
PATCH /api/outposts/:id
POST /api/outposts/:id/posts
POST /api/outposts/:id/posts/:postId/cancel
POST /api/outposts/:id/posts/:postId/start-now
POST /api/outposts/:id/posts/:postId/pin
POST /api/outposts/drafts/:id/start
GET /api/conversations
GET /api/conversations/:id
GET /api/conversations/:id/annotations
GET /api/runs/:id
GET /api/run-events
GET /api/runs/:id/reasoning/:messageId
GET /api/runs/:id/commands/:commandId/output
GET /api/runs/:id/orchestration
GET /api/runs/active
POST /api/conversations
POST /api/conversations/:id/messages
POST /api/runs/:id/cancel
GET /api/setup
GET /api/setup/full-disk-access
GET /api/setup/git
GET /api/conversations/:id/pr-route
GET /api/conversations/:id/pushes
GET /api/github/connection
GET /api/tasks/:id/ship
POST /api/tasks/:id/ship
GET /api/projects/:id/sign-ins
GET /api/slack
GET /api/slack/channels
GET /api/slack/direct-messages
POST /api/slack/context
POST /api/slack/presence
POST /api/slack/start
GET /api/tasks/:id
GET /api/tasks/:id/artifacts/:file
GET /api/tasks/:id/changes
GET /api/tasks/:id/changes/diff
GET /api/tasks/:id/changes/files
GET /api/tasks/:id/changes/summary
POST /api/tasks/:id/links
GET /api/teammates
POST /api/teammate-starters/:starter/dismiss
POST /api/teammates/:id/home
PUT /api/conversations/:id/teammate
GET /api/tickets
GET /api/tickets/:source/:key
GET /api/tickets/attention-settings
GET /api/tickets/connections
GET /api/tickets/connections/:source/move-options
GET /api/tickets/inbox
GET /api/tickets/search
DELETE /api/tickets/:source/:key/dismiss
DELETE /api/tickets/:source/:key/snooze
PUT /api/tickets/:source/:key/dismiss
PUT /api/tickets/:source/:key/notice-seen
PUT /api/tickets/:source/:key/snooze
POST /api/tickets/:source/:key/assign
POST /api/tickets/:source/:key/comments
POST /api/tickets/:source/:key/start
POST /api/tickets/:source/:key/transition
`;

const NEVER = `
GET /api/user-plugins
PUT /api/user-plugins/:key
POST /api/user-plugins/:key/review
POST /api/browser-history
GET /api/browser-history
POST /api/browser-history/clear
PUT /api/spark-rules/rule
PUT /api/spark-rules/gh-allowed
POST /api/spark-rules/recommended
POST /api/spark-rules/outside-change
GET /api/artifacts/:id/versions/:version/file
GET /api/chat-files/:id/content
GET /api/projects/:id/pull-requests/open
POST /api/conversations/:id/workspace/adopt
POST /api/approvals/:id/spark-rule
GET /api/calendar/status
POST /api/calendar/connect
POST /api/calendar/disconnect
POST /api/calendar/open-settings
PATCH /api/calendar/calendars/:key
PATCH /api/calendar/settings
GET /api/calendar/day
GET /api/calendar/range
GET /api/calendar/now
POST /api/calendar/refresh
PUT /api/calendar/marks
POST /api/calendar/open
POST /api/calendar/event
GET /api/calendar/google/sign-in
POST /api/calendar/google/sign-in
DELETE /api/calendar/google/sign-in
DELETE /api/calendar/google/accounts/:id
GET /api/island/requests
POST /api/island/requests/:id/claim
GET /api/remote/access
PUT /api/remote/access
PATCH /api/remote/switches
GET /api/remote/push/contact
PUT /api/remote/push/contact
GET /api/remote/devices
PATCH /api/remote/devices/:id
DELETE /api/remote/devices/:id
DELETE /api/remote/devices/:id/passkeys
POST /api/remote/devices/disconnect-all
GET /api/remote/pairings
POST /api/remote/pairings
POST /api/remote/pairings/:id/confirm
POST /api/remote/pairings/:id/deny
GET /api/remote/audit
GET /api/remote/tailscale
POST /api/remote/tailscale/on
POST /api/remote/tailscale/off
DELETE /api/terminal/sessions/:id
GET /api/terminal/sessions/:id/busy
POST /api/terminal/sessions
POST /api/terminal/sessions/:id/attach
GET /api/conversations/:id/terminal/usage
GET /api/terminal-live
GET /api/terminal-agents
GET /api/conversations/:id/terminal/start
POST /api/conversations/:id/terminal
POST /api/conversations/:id/terminal/images
DELETE /api/conversations/:id/terminal
POST /api/terminal/shells
GET /api/chat-ports
POST /api/terminal/previews
GET /api/conversations/:id/agent-terminals/:terminalId/output
POST /api/conversations/:id/agent-terminals/:terminalId/view
POST /api/conversations/:id/agent-terminals/:terminalId/stop
GET /api/conversations/:id/preview
GET /api/projects/:id/preview
POST /api/conversations/:id/preview/start
POST /api/conversations/:id/preview/stop
PUT /api/projects/:id/preview
POST /api/conversations/:id/workspace/open
GET /api/diagnostics/export
GET /api/instructions-file
POST /api/setup/git/install
POST /api/outposts
GET /api/outposts/drafts/:id
DELETE /api/outposts/:id
PUT /api/outposts/:id/instructions
PUT /api/outposts/:id/members/:conversationId
DELETE /api/outposts/:id/members/:conversationId
GET /api/a2a/chats/:chatId/.well-known/agent-card.json
POST /api/a2a/chats/:chatId
`;

const PAIRING = `
POST /api/remote/pair
POST /api/remote/pair/claim
`;

const PASSKEY_SIGN_IN = `
POST /api/remote/passkey/sign-in/options
POST /api/remote/passkey/sign-in
`;

const BEHIND_SWITCH: Record<RemoteSwitch, string> = {
  settings: `
GET /api/projects/:id/agent-config
PATCH /api/projects/:id/agent-config
PUT /api/projects/:id/agent-config/mcp/:name
PUT /api/projects/:id/agent-config/trust
PUT /api/projects/:id/agent-config/trust/redirects
PATCH /api/projects/:id
PATCH /api/profile
PUT /api/spark-assistant/settings
POST /api/spark-assistant/clear
DELETE /api/spark-assistant/facts/:id
PATCH /api/providers/:provider/defaults
PATCH /api/slack/settings
PATCH /api/tickets/attention-settings
POST /api/teammates
PATCH /api/teammates/:id
DELETE /api/teammates/:id
`,
  connections: `
GET /api/github/app/sign-in
GET /api/mcp/servers
GET /api/slack/sign-in
DELETE /api/github/app
DELETE /api/github/app/sign-in
POST /api/github/app/repos
POST /api/github/app/sign-in
DELETE /api/github/token
PUT /api/github/token
POST /api/github/test
DELETE /api/mcp/servers/:id
POST /api/mcp/servers
POST /api/mcp/servers/:id/test
PUT /api/mcp/servers/:id
PUT /api/mcp/servers/:id/enable
DELETE /api/providers/:provider/connection
POST /api/providers/:provider/test
POST /api/providers/:provider/verify
DELETE /api/slack/connection
DELETE /api/slack/sign-in
POST /api/slack/channels/:channelId/allow
POST /api/slack/direct-messages/:channelId/allow
POST /api/slack/scopes/check
POST /api/slack/sign-in
POST /api/slack/sign-in/callback
POST /api/slack/test
PUT /api/slack/channels
PUT /api/slack/connection
PUT /api/slack/direct-messages
DELETE /api/tickets/connections/:source
PATCH /api/tickets/connections/:source
PUT /api/tickets/connections/:source
`,
  projects: `
PUT /api/repos-folders
GET /api/folders
POST /api/folders
POST /api/projects
POST /api/projects/:id/git-init
POST /api/projects/restore
POST /api/project-clones
POST /api/project-clones/:id/cancel
DELETE /api/project-clones/:id
`,
  agentMode: '',
  highRiskCards: `
POST /api/rail-flags/:id/decision
`,
  signIns: `
POST /api/projects/:id/sign-ins
PUT /api/projects/:id/sign-ins/:signInId
DELETE /api/projects/:id/sign-ins/:signInId
`,
  reset: `
POST /api/reset
DELETE /api/conversations/:id
DELETE /api/projects/:id
`,
  devices: '',
  passkeys: `
GET /api/remote/passkeys
POST /api/remote/passkeys/options
POST /api/remote/passkeys
`,
  terminal: `
GET /api/conversations/:id/terminal
GET /api/conversations/:id/terminal/transcript
POST /api/conversations/:id/terminal/message
POST /api/conversations/:id/terminal/interrupt
`,
  terminalApprove: `
POST /api/conversations/:id/terminal/approval
`,
  notifications: `
PUT /api/remote/push/subscription
`,
  artifacts: `
GET /api/artifacts/:id/versions/:version/view
GET /api/artifacts/:id/versions/:version/page
`,
};

export const AGENT_MODE_FIELDS: Record<string, readonly string[]> = {
  'PATCH /api/conversations/:id/settings': ['agentMode', 'permission', 'level'],
  'PATCH /api/providers/:provider/defaults': ['agentMode', 'permission', 'level'],
};

export const HIGH_RISK_FIELDS: Record<string, readonly string[]> = {
  'POST /api/tickets/:source/:key/comments': ['visibility'],
};

export const CARD_ROUTE = 'POST /api/approvals/:id/decision';

function routesOf(block: string): string[] {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export const ROUTE_RULES: ReadonlyMap<string, RemoteRule> = new Map<string, RemoteRule>([
  ...routesOf(ALWAYS).map((route) => [route, 'always'] as const),
  ...routesOf(NEVER).map((route) => [route, 'never'] as const),
  ...routesOf(PAIRING).map((route) => [route, 'pairing'] as const),
  ...routesOf(PASSKEY_SIGN_IN).map((route) => [route, 'passkey'] as const),
  ...(Object.entries(BEHIND_SWITCH) as [RemoteSwitch, string][]).flatMap(([name, block]) =>
    routesOf(block).map((route) => [route, name] as const),
  ),
]);
